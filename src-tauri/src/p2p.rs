//! P2P 局域网文件分享 — libp2p 节点模块。
//!
//! - mDNS → 局域网节点发现
//! - QUIC transport → 原生加密 + 多路复用（替代 TCP+Noise+Yamux）
//! - request_response（块级流式 / 搜索）→ 单块 ≤ 64KB，防 OOM
//! - 滑动窗口并发下载（16 并发）→ 消除串行瓶颈
//! - Command channel 模式 → 消除 Swarm 锁竞争
//! - tokio::fs 异步 IO → 避免阻塞事件循环

use log::{error, info, warn};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use libp2p::{
    identity, mdns,
    request_response::{self, OutboundRequestId, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
    Multiaddr, PeerId, StreamProtocol, SwarmBuilder,
};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::{oneshot, Mutex, Semaphore};

const CHUNK_SIZE: u64 = 64 * 1024;
/// 滑动窗口并发数
const CONCURRENCY: usize = 16;

// ---- 协议类型 ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRequest {
    pub hash: String,
    pub chunk_index: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileResponse {
    pub file_name: String,
    pub file_size: u64,
    pub total_chunks: u64,
    pub chunk_index: u64,
    pub chunk_data: Vec<u8>,
    pub error: Option<String>,
}

// ---- 搜索协议类型 ----

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub hash: String,
    pub file_name: String,
    pub file_size: u64,
}

// ---- Command channel（消除 Swarm 锁竞争） ----

/// 业务层通过 Command channel 向主循环发送指令，主循环单线程访问 Swarm。
pub enum Command {
    /// 发送一个块请求到目标节点
    SendRequest {
        target: PeerId,
        request: FileRequest,
        resp_tx: oneshot::Sender<FileResponse>,
    },
    /// 取消某个哈希的下载
    CancelDownload { hash: String },
    /// 向目标节点发送搜索请求
    SearchQuery {
        target: PeerId,
        query: String,
        resp_tx: oneshot::Sender<SearchResponse>,
    },
}

// ---- P2P 状态 ----

pub struct P2PState {
    pub peers: HashMap<PeerId, Vec<Multiaddr>>,
    pub file_registry: HashMap<String, FileEntry>,
    /// 本机 PeerId（启动时设置，供前端展示）
    pub local_peer_id: Option<String>,
    /// 下载任务入口 channel（由 request_file command 写入）
    pub download_tx: Option<UnboundedSender<DownloadRequest>>,
    /// Command channel 发送端（主循环持有 rx，业务层通过 tx 发送指令）
    pub cmd_tx: Option<UnboundedSender<Command>>,
    /// 活跃下载的取消令牌，按哈希索引
    pub cancel_tokens: HashMap<String, Arc<AtomicBool>>,
    /// 用于发送 Tauri 事件（下载进度等）
    pub app_handle: Option<tauri::AppHandle>,
}

#[derive(Debug, Clone)]
pub struct FileEntry {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    #[allow(dead_code)]
    pub register_timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct DownloadRequest {
    pub hash: String,
    /// 下载目录（文件名由对等节点提供）
    pub save_dir: String,
}

type RespRouter = Arc<Mutex<HashMap<OutboundRequestId, oneshot::Sender<FileResponse>>>>;
type SearchRouter = Arc<Mutex<HashMap<OutboundRequestId, oneshot::Sender<SearchResponse>>>>;

// ---- NetworkBehaviour ----

#[derive(NetworkBehaviour)]
struct P2PBehaviour {
    mdns: mdns::tokio::Behaviour,
    file_exchange: request_response::cbor::Behaviour<FileRequest, FileResponse>,
    search: request_response::cbor::Behaviour<SearchRequest, SearchResponse>,
}

// ---- 子序列匹配 ----

/// 检查 query 中的字符是否按序出现在 hash 中（不要求连续，只要求顺序）。
/// 例如 query="abcd" 可匹配 "fafbfcfdf"。
fn is_subsequence_match(query: &str, hash: &str) -> bool {
    let query = query.to_lowercase();
    let hash = hash.to_lowercase();
    let mut q_chars = query.chars();
    let mut current = q_chars.next();
    for hc in hash.chars() {
        if Some(hc) == current {
            current = q_chars.next();
            if current.is_none() {
                return true;
            }
        }
    }
    false
}

// ---- start_p2p_node（主事件循环） ----

pub async fn start_p2p_node(
    state: Arc<Mutex<P2PState>>,
    mut download_rx: UnboundedReceiver<DownloadRequest>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let id_keys = identity::Keypair::generate_ed25519();
    let peer_id = id_keys.public().to_peer_id();
    info!("[p2p] 节点启动: {}", peer_id);

    // Command channel：主循环持有 rx，tx 存入 state 供业务层使用
    let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<Command>();
    {
        let mut s = state.lock().await;
        s.local_peer_id = Some(peer_id.to_string());
        s.cmd_tx = Some(cmd_tx.clone());
    }

    let state_handler = state.clone();
    let resp_router: RespRouter = Arc::new(Mutex::new(HashMap::new()));
    let search_router: SearchRouter = Arc::new(Mutex::new(HashMap::new()));

    // Swarm 由主循环独占，不再需要 Mutex 包裹
    let mut swarm = SwarmBuilder::with_existing_identity(id_keys)
        .with_tokio()
        .with_quic()
        .with_behaviour(|key| {
            let mdns =
                mdns::tokio::Behaviour::new(mdns::Config::default(), key.public().to_peer_id())?;
            let fe = request_response::cbor::Behaviour::new(
                [(
                    StreamProtocol::new("/sovboard-file/2"),
                    ProtocolSupport::Full,
                )],
                request_response::Config::default(),
            );
            let se = request_response::cbor::Behaviour::new(
                [(
                    StreamProtocol::new("/sovboard-search/1"),
                    ProtocolSupport::Full,
                )],
                request_response::Config::default(),
            );
            Ok(P2PBehaviour {
                mdns,
                file_exchange: fe,
                search: se,
            })
        })?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    swarm.listen_on("/ip4/0.0.0.0/udp/0/quic-v1".parse()?)?;

    loop {
        tokio::select! {
            // ---- Swarm 事件 ----
            ev = swarm.select_next_some() => match ev {
                SwarmEvent::NewListenAddr { address, .. } => {
                    info!("[p2p] 监听: {}/p2p/{}", address, peer_id);
                }
                SwarmEvent::Behaviour(bev) => match bev {
                    P2PBehaviourEvent::Mdns(e) => match e {
                        mdns::Event::Discovered(list) => {
                            let mut st = state.lock().await;
                            for (pid, addr) in list {
                                info!("[p2p::mdns] 发现: {} -> {}", pid, addr);
                                st.peers.entry(pid).or_default().push(addr);
                            }
                        }
                        mdns::Event::Expired(list) => {
                            let mut st = state.lock().await;
                            for (pid, _addr) in list {
                                info!("[p2p::mdns] 移除: {}", pid);
                                st.peers.remove(&pid);
                            }
                        }
                    },
                    P2PBehaviourEvent::FileExchange(
                        request_response::Event::Message { message, .. }
                    ) => match message {
                        request_response::Message::Request { request, channel, .. } => {
                            let resp = make_response(&state_handler, &request).await;
                            let _ = swarm.behaviour_mut().file_exchange.send_response(channel, resp);
                        }
                        request_response::Message::Response { request_id, response } => {
                            if let Some(tx) = resp_router.lock().await.remove(&request_id) {
                                let _ = tx.send(response);
                            }
                        }
                    },
                    P2PBehaviourEvent::FileExchange(_) => {},
                    // ---- 搜索事件 ----
                    P2PBehaviourEvent::Search(
                        request_response::Event::Message { message, .. }
                    ) => match message {
                        request_response::Message::Request { request, channel, .. } => {
                            let resp = make_search_response(&state_handler, &request).await;
                            let _ = swarm.behaviour_mut().search.send_response(channel, resp);
                        }
                        request_response::Message::Response { request_id, response } => {
                            if let Some(tx) = search_router.lock().await.remove(&request_id) {
                                let _ = tx.send(response);
                            }
                        }
                    },
                    P2PBehaviourEvent::Search(_) => {},
                },
                _ => {}
            },

            // ---- 下载请求（来自前端 request_file command） ----
            req = download_rx.recv() => {
                if let Some(r) = req {
                    let (local, peers, app_handle_c) = {
                        let s = state.lock().await;
                        (s.file_registry.contains_key(&r.hash),
                         s.peers.keys().cloned().collect::<Vec<_>>(),
                         s.app_handle.clone())
                    };
                    if local { info!("[p2p::download] 本地已有: {}", r.hash); continue; }

                    if let Some(tgt) = peers.first().cloned() {
                        let tgt_id = tgt.to_string();
                        let cancel = Arc::new(AtomicBool::new(false));
                        state.lock().await.cancel_tokens.insert(r.hash.clone(), cancel.clone());

                        let cmd_tx_c = cmd_tx.clone();
                        let state_c = state.clone();
                        tokio::spawn(async move {
                            if let Err(e) = download_file(
                                cmd_tx_c, tgt, &tgt_id, &r.hash, &r.save_dir,
                                app_handle_c, cancel.clone(),
                            ).await {
                                error!("[p2p::download] 下载失败 [{}]: {}", r.hash, e);
                            }
                            state_c.lock().await.cancel_tokens.remove(&r.hash);
                        });
                    } else {
                        warn!("[p2p::download] 无在线节点: {}", r.hash);
                        if let Some(ah) = &app_handle_c {
                            let _ = ah.emit("download:error", serde_json::json!({
                                "hash": r.hash, "error": "无在线节点"
                            }));
                        }
                    }
                }
            },

            // ---- Command channel（SendRequest / CancelDownload / SearchQuery） ----
            cmd = cmd_rx.recv() => {
                match cmd {
                    Some(Command::SendRequest { target, request, resp_tx }) => {
                        let rid = swarm.behaviour_mut().file_exchange.send_request(&target, request);
                        resp_router.lock().await.insert(rid, resp_tx);
                    }
                    Some(Command::CancelDownload { hash }) => {
                        let s = state.lock().await;
                        if let Some(token) = s.cancel_tokens.get(&hash) {
                            token.store(true, Ordering::SeqCst);
                            info!("[p2p::download] 取消下载: {}", hash);
                        }
                    }
                    Some(Command::SearchQuery { target, query, resp_tx }) => {
                        let rid = swarm.behaviour_mut().search.send_request(&target, SearchRequest { query });
                        search_router.lock().await.insert(rid, resp_tx);
                    }
                    None => break,
                }
            }
        }
    }

    Ok(())
}

// ---- make_response（响应方，异步 IO） ----

async fn make_response(state: &Arc<Mutex<P2PState>>, req: &FileRequest) -> FileResponse {
    let entry = { state.lock().await.file_registry.get(&req.hash).cloned() };
    match entry {
        None => FileResponse {
            file_name: String::new(),
            file_size: 0,
            total_chunks: 0,
            chunk_index: req.chunk_index,
            chunk_data: vec![],
            error: Some("文件未找到".into()),
        },
        Some(e) => {
            let fs = e.file_size;
            let tc = (fs + CHUNK_SIZE - 1) / CHUNK_SIZE;
            let ci = req.chunk_index;
            if ci >= tc {
                FileResponse {
                    file_name: e.file_name,
                    file_size: fs,
                    total_chunks: tc,
                    chunk_index: ci,
                    chunk_data: vec![],
                    error: Some("块索引超出范围".into()),
                }
            } else {
                match read_chunk_async(&e.file_path, ci, fs).await {
                    Ok(data) => FileResponse {
                        file_name: e.file_name,
                        file_size: fs,
                        total_chunks: tc,
                        chunk_index: ci,
                        chunk_data: data,
                        error: None,
                    },
                    Err(err) => FileResponse {
                        file_name: e.file_name,
                        file_size: fs,
                        total_chunks: tc,
                        chunk_index: ci,
                        chunk_data: vec![],
                        error: Some(err),
                    },
                }
            }
        }
    }
}

// ---- make_search_response（搜索方，遍历本地 file_registry） ----

async fn make_search_response(state: &Arc<Mutex<P2PState>>, req: &SearchRequest) -> SearchResponse {
    let s = state.lock().await;
    let results: Vec<SearchResult> = s
        .file_registry
        .iter()
        .filter(|(hash, _)| is_subsequence_match(&req.query, hash))
        .map(|(hash, entry)| SearchResult {
            hash: hash.clone(),
            file_name: entry.file_name.clone(),
            file_size: entry.file_size,
        })
        .collect();
    SearchResponse { results }
}

/// 异步读取文件块（tokio::fs，不阻塞事件循环）。
async fn read_chunk_async(path: &str, ci: u64, file_size: u64) -> Result<Vec<u8>, String> {
    let mut f = tokio::fs::File::open(path)
        .await
        .map_err(|e| format!("open: {}", e))?;
    let offset = ci * CHUNK_SIZE;
    f.seek(std::io::SeekFrom::Start(offset))
        .await
        .map_err(|e| format!("seek: {}", e))?;
    let size = CHUNK_SIZE.min(file_size - offset) as usize;
    let mut buf = vec![0u8; size];
    f.read_exact(&mut buf)
        .await
        .map_err(|e| format!("read: {}", e))?;
    Ok(buf)
}

// ---- download_file（请求方，滑动窗口并发） ----

async fn download_file(
    cmd_tx: UnboundedSender<Command>,
    target: PeerId,
    target_peer_id: &str,
    hash: &str,
    save_dir: &str,
    app_handle: Option<tauri::AppHandle>,
    cancel: Arc<AtomicBool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let report = |event: &str, payload: serde_json::Value| {
        if let Some(ah) = &app_handle {
            let _ = ah.emit(event, payload);
        }
    };

    // ---- 阶段一：请求 chunk 0 获取元数据 ----
    let r0 = request_single_chunk(&cmd_tx, &target, hash, 0, &cancel).await?;
    if let Some(err) = &r0.error {
        report(
            "download:error",
            serde_json::json!({ "hash": hash, "error": err, "target_peer_id": target_peer_id }),
        );
        return Err(err.clone().into());
    }

    let fname = &r0.file_name;
    let fs = r0.file_size;
    let tc = r0.total_chunks;
    let save_path = format!("{}/{}", save_dir.trim_end_matches(&['/', '\\'][..]), fname);

    info!(
        "[p2p::download] 开始下载: {} ({:.1} MB, {} chunks)",
        fname,
        fs as f64 / 1e6,
        tc
    );

    // 创建文件
    if let Some(p) = std::path::Path::new(&save_path).parent() {
        tokio::fs::create_dir_all(p)
            .await
            .map_err(|e| format!("mkdir: {}", e))?;
    }
    let mut file = tokio::fs::File::create(&save_path)
        .await
        .map_err(|e| format!("create: {}", e))?;

    // 写入 chunk 0
    file.write_all(&r0.chunk_data)
        .await
        .map_err(|e| format!("write: {}", e))?;
    let mut received = r0.chunk_data.len() as u64;

    report(
        "download:progress",
        serde_json::json!({
            "hash": hash, "received": received, "total": fs,
            "file_name": fname, "file_path": save_path,
            "target_peer_id": target_peer_id,
        }),
    );

    // 单块文件直接完成
    if tc <= 1 {
        file.flush().await.map_err(|e| format!("flush: {}", e))?;
        info!(
            "[p2p::download] 完成: {} ({:.1} MB)",
            fname,
            fs as f64 / 1e6
        );
        report(
            "download:done",
            serde_json::json!({
                "hash": hash, "file_name": fname, "file_path": save_path,
                "size": fs, "target_peer_id": target_peer_id,
            }),
        );
        return Ok(());
    }

    // ---- 阶段二：滑动窗口并发下载剩余块 ----
    let semaphore = Arc::new(Semaphore::new(CONCURRENCY));

    let stream = stream::iter(1..tc).map(|ci| {
        let c_tx = cmd_tx.clone();
        let tgt = target;
        let h = hash.to_string();
        let sem = semaphore.clone();
        let cnl = cancel.clone();
        async move {
            // 检查取消
            if cnl.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
            let _permit = sem.acquire().await.unwrap();
            // 再次检查取消（可能在等待信号量时被取消）
            if cnl.load(Ordering::Relaxed) {
                return Err("cancelled".to_string());
            }
            let resp = request_single_chunk(&c_tx, &tgt, &h, ci, &cnl).await?;
            Ok((ci, resp))
        }
    });
    futures::pin_mut!(stream);
    let mut stream = stream.buffer_unordered(CONCURRENCY);

    let mut last_reported: u64 = received;

    while let Some(result) = stream.next().await {
        // 检查取消
        if cancel.load(Ordering::Relaxed) {
            let _ = tokio::fs::remove_file(&save_path).await;
            report(
                "download:error",
                serde_json::json!({
                    "hash": hash, "error": "用户取消",
                    "target_peer_id": target_peer_id,
                }),
            );
            return Err("用户取消".into());
        }

        match result {
            Ok((ci, resp)) => {
                if let Some(err) = &resp.error {
                    report(
                        "download:error",
                        serde_json::json!({
                            "hash": hash, "error": err,
                            "target_peer_id": target_peer_id,
                        }),
                    );
                    return Err(err.clone().into());
                }

                // Seek 到正确偏移写入（块可能乱序到达）
                let offset = ci * CHUNK_SIZE;
                file.seek(std::io::SeekFrom::Start(offset))
                    .await
                    .map_err(|e| format!("seek: {}", e))?;
                file.write_all(&resp.chunk_data)
                    .await
                    .map_err(|e| format!("write: {}", e))?;
                received += resp.chunk_data.len() as u64;

                // 每收到 ~10 块或最后一块时上报进度
                if received - last_reported >= CHUNK_SIZE * 10 || received >= fs {
                    last_reported = received;
                    report(
                        "download:progress",
                        serde_json::json!({
                            "hash": hash, "received": received, "total": fs,
                            "file_name": fname, "file_path": save_path,
                            "target_peer_id": target_peer_id,
                        }),
                    );
                }
            }
            Err(e) => {
                report(
                    "download:error",
                    serde_json::json!({
                        "hash": hash, "error": e,
                        "target_peer_id": target_peer_id,
                    }),
                );
                return Err(e.into());
            }
        }
    }

    file.flush().await.map_err(|e| format!("flush: {}", e))?;
    info!(
        "[p2p::download] 完成: {} ({:.1} MB)",
        fname,
        fs as f64 / 1e6
    );
    report(
        "download:done",
        serde_json::json!({
            "hash": hash, "file_name": fname, "file_path": save_path,
            "size": fs, "target_peer_id": target_peer_id,
        }),
    );
    Ok(())
}

/// 请求单个块（通过 Command channel，避免直接锁 Swarm）。
async fn request_single_chunk(
    cmd_tx: &UnboundedSender<Command>,
    target: &PeerId,
    hash: &str,
    chunk_index: u64,
    cancel: &AtomicBool,
) -> Result<FileResponse, String> {
    if cancel.load(Ordering::Relaxed) {
        return Err("已取消".into());
    }

    let (tx, rx) = oneshot::channel();
    cmd_tx
        .send(Command::SendRequest {
            target: *target,
            request: FileRequest {
                hash: hash.to_string(),
                chunk_index,
            },
            resp_tx: tx,
        })
        .map_err(|e| format!("发送请求失败: {}", e))?;

    // 带超时的等待（30s）
    match tokio::time::timeout(Duration::from_secs(30), rx).await {
        Ok(Ok(resp)) => Ok(resp),
        Ok(Err(_)) => Err("响应通道关闭".into()),
        Err(_) => Err("请求超时".into()),
    }
}
