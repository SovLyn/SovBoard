//! P2P 局域网文件分享 — libp2p 节点模块。
//!
//! - mDNS → 局域网节点发现
//! - request_response（块级流式）→ 单块 ≤ 64KB，防 OOM

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use libp2p::{
    identity, mdns, noise,
    request_response::{self, OutboundRequestId, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, StreamProtocol, SwarmBuilder,
};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::{oneshot, Mutex};

const CHUNK_SIZE: u64 = 64 * 1024;

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

// ---- P2P 状态 ----

pub struct P2PState {
    pub peers: HashMap<PeerId, Vec<Multiaddr>>,
    pub file_registry: HashMap<String, FileEntry>,
    pub download_tx: Option<UnboundedSender<DownloadRequest>>,
    /// 用于发送 Tauri 事件（下载进度等）
    pub app_handle: Option<tauri::AppHandle>,
}

#[derive(Debug, Clone)]
pub struct FileEntry {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub register_timestamp: u64,
}

#[derive(Debug, Clone)]
pub struct DownloadRequest {
    pub hash: String,
    /// 下载目录（文件名由对等节点提供）
    pub save_dir: String,
}

/// 下载进度事件（序列化后通过 Tauri event 发送给前端）。
#[derive(Debug, Clone, Serialize)]
pub struct DownloadProgress {
    pub hash: String,
    pub received: u64,
    pub total: u64,
    pub file_name: String,
    pub file_path: String,
}

type RespRouter = Arc<Mutex<HashMap<OutboundRequestId, oneshot::Sender<FileResponse>>>>;

// ---- NetworkBehaviour ----

#[derive(NetworkBehaviour)]
struct P2PBehaviour {
    mdns: mdns::tokio::Behaviour,
    file_exchange: request_response::cbor::Behaviour<FileRequest, FileResponse>,
}

// ---- start_p2p_node ----

pub async fn start_p2p_node(
    state: Arc<Mutex<P2PState>>,
    mut download_rx: UnboundedReceiver<DownloadRequest>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let id_keys = identity::Keypair::generate_ed25519();
    let peer_id = id_keys.public().to_peer_id();
    tracing::info!("P2P 节点: {}", peer_id);

    let state_handler = state.clone();
    let resp_router: RespRouter = Arc::new(Mutex::new(HashMap::new()));

    let mut swarm = SwarmBuilder::with_existing_identity(id_keys)
        .with_tokio()
        .with_tcp(tcp::Config::default(), noise::Config::new, yamux::Config::default)?
        .with_behaviour(|key| {
            let mdns = mdns::tokio::Behaviour::new(mdns::Config::default(), key.public().to_peer_id())?;
            let fe = request_response::cbor::Behaviour::new(
                [(StreamProtocol::new("/sovboard-file/2"), ProtocolSupport::Full)],
                request_response::Config::default(),
            );
            Ok(P2PBehaviour { mdns, file_exchange: fe })
        })?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;
    let swarm = Arc::new(Mutex::new(swarm));

    loop {
        let sw = swarm.clone();
        let fut = async move { sw.lock().await.select_next_some().await };

        tokio::select! {
            ev = fut => match ev {
                SwarmEvent::NewListenAddr { address, .. } => {
                    tracing::info!("监听: {}/p2p/{}", address, peer_id);
                }
                SwarmEvent::Behaviour(bev) => match bev {
                    P2PBehaviourEvent::Mdns(e) => match e {
                        mdns::Event::Discovered(list) => {
                            let mut st = state.lock().await;
                            for (pid, addr) in list { st.peers.entry(pid).or_default().push(addr); }
                        }
                        mdns::Event::Expired(list) => {
                            let mut st = state.lock().await;
                            for (pid, _) in list { st.peers.remove(&pid); }
                        }
                    },
                    P2PBehaviourEvent::FileExchange(
                        request_response::Event::Message { message, .. }
                    ) => match message {
                        request_response::Message::Request { request, channel, .. } => {
                            let resp = make_response(&state_handler, &request).await;
                            let mut s = swarm.lock().await;
                            let _ = s.behaviour_mut().file_exchange.send_response(channel, resp);
                        }
                        request_response::Message::Response { request_id, response } => {
                            if let Some(tx) = resp_router.lock().await.remove(&request_id) {
                                let _ = tx.send(response);
                            }
                        }
                    },
                    P2PBehaviourEvent::FileExchange(_) => {}
                },
                _ => {}
            },

            req = download_rx.recv() => {
                if let Some(r) = req {
                    let (local, peers, app_handle) = {
                        let s = state.lock().await;
                        (s.file_registry.contains_key(&r.hash),
                         s.peers.keys().cloned().collect::<Vec<_>>(),
                         s.app_handle.clone())
                    };
                    if local { tracing::info!("本地已有: {}", r.hash); continue; }
                    if let Some(tgt) = peers.first().cloned() {
                        let sw = swarm.clone();
                        let rr = resp_router.clone();
                        tokio::spawn(async move {
                            if let Err(e) = download_file(sw, rr, tgt, &r.hash, &r.save_dir, app_handle).await {
                                tracing::warn!("下载失败 [{}]: {}", r.hash, e);
                            }
                        });
                    } else {
                        tracing::warn!("无在线节点: {}", r.hash);
                        if let Some(ah) = &app_handle {
                            let _ = ah.emit("download:error", serde_json::json!({
                                "hash": r.hash, "error": "无在线节点"
                            }));
                        }
                    }
                }
            }
        }
    }
}

// ---- make_response（响应方） ----

async fn make_response(state: &Arc<Mutex<P2PState>>, req: &FileRequest) -> FileResponse {
    let entry = { state.lock().await.file_registry.get(&req.hash).cloned() };
    match entry {
        None => FileResponse {
            file_name: String::new(), file_size: 0, total_chunks: 0,
            chunk_index: req.chunk_index, chunk_data: vec![],
            error: Some("文件未找到".into()),
        },
        Some(e) => {
            let fs = e.file_size;
            let tc = (fs + CHUNK_SIZE - 1) / CHUNK_SIZE;
            let ci = req.chunk_index;
            if ci >= tc {
                FileResponse {
                    file_name: e.file_name, file_size: fs, total_chunks: tc,
                    chunk_index: ci, chunk_data: vec![],
                    error: Some("块索引超出范围".into()),
                }
            } else {
                match read_chunk_sync(&e.file_path, ci, fs) {
                    Ok(data) => FileResponse {
                        file_name: e.file_name, file_size: fs, total_chunks: tc,
                        chunk_index: ci, chunk_data: data, error: None,
                    },
                    Err(err) => FileResponse {
                        file_name: e.file_name, file_size: fs, total_chunks: tc,
                        chunk_index: ci, chunk_data: vec![], error: Some(err),
                    },
                }
            }
        }
    }
}

fn read_chunk_sync(path: &str, ci: u64, file_size: u64) -> Result<Vec<u8>, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut f = std::fs::File::open(path).map_err(|e| format!("open: {}", e))?;
    let offset = ci * CHUNK_SIZE;
    f.seek(SeekFrom::Start(offset)).map_err(|e| format!("seek: {}", e))?;
    let size = CHUNK_SIZE.min(file_size - offset) as usize;
    let mut buf = vec![0u8; size];
    f.read_exact(&mut buf).map_err(|e| format!("read: {}", e))?;
    Ok(buf)
}

// ---- download_file（请求方） ----

async fn download_file(
    swarm: Arc<Mutex<libp2p::Swarm<P2PBehaviour>>>,
    router: RespRouter,
    target: PeerId,
    hash: &str,
    save_dir: &str,
    app_handle: Option<tauri::AppHandle>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let report = |event: &str, payload: serde_json::Value| {
        if let Some(ah) = &app_handle {
            let _ = ah.emit(event, payload);
        }
    };

    // chunk 0 → 获取元数据
    let req0 = FileRequest { hash: hash.to_string(), chunk_index: 0 };
    let rid0 = { let mut s = swarm.lock().await; s.behaviour_mut().file_exchange.send_request(&target, req0) };
    let (tx, rx) = oneshot::channel();
    router.lock().await.insert(rid0, tx);
    let r0 = rx.await.map_err(|_| "响应超时")?;
    if let Some(e) = &r0.error {
        let msg = e.clone();
        report("download:error", serde_json::json!({ "hash": hash, "error": msg }));
        return Err(msg.into());
    }

    let fname = &r0.file_name;
    let fs = r0.file_size;
    let tc = r0.total_chunks;
    let save_path = format!("{}/{}", save_dir.trim_end_matches(&['/', '\\'][..]), fname);

    tracing::info!("下载: {} ({:.1} MB, {} chunks)", fname, fs as f64/1e6, tc);

    // 创建文件
    if let Some(p) = std::path::Path::new(&save_path).parent() {
        std::fs::create_dir_all(p).map_err(|e| format!("mkdir: {}", e))?;
    }
    let mut file = std::fs::File::create(&save_path).map_err(|e| format!("create: {}", e))?;
    use std::io::Write;
    file.write_all(&r0.chunk_data).map_err(|e| format!("write: {}", e))?;
    let mut recv = r0.chunk_data.len() as u64;

    report("download:progress", serde_json::json!({
        "hash": hash, "received": recv, "total": fs,
        "file_name": fname, "file_path": save_path,
    }));

    // 剩余块
    for ci in 1..tc {
        let req = FileRequest { hash: hash.to_string(), chunk_index: ci };
        let rid = { let mut s = swarm.lock().await; s.behaviour_mut().file_exchange.send_request(&target, req) };
        let (tx, rx) = oneshot::channel();
        router.lock().await.insert(rid, tx);
        let r = rx.await.map_err(|_| "响应超时")?;
        if let Some(e) = &r.error {
            let msg = e.clone();
            report("download:error", serde_json::json!({ "hash": hash, "error": msg }));
            return Err(msg.into());
        }
        file.write_all(&r.chunk_data).map_err(|e| format!("write: {}", e))?;
        recv += r.chunk_data.len() as u64;
        if ci % 10 == 0 || ci == tc - 1 {
            report("download:progress", serde_json::json!({
                "hash": hash, "received": recv, "total": fs,
                "file_name": fname, "file_path": save_path,
            }));
        }
    }

    file.flush().map_err(|e| format!("flush: {}", e))?;
    tracing::info!("完成: {} ({:.1} MB)", fname, fs as f64/1e6);
    report("download:done", serde_json::json!({
        "hash": hash, "file_name": fname, "file_path": save_path,
        "size": fs,
    }));
    Ok(())
}
