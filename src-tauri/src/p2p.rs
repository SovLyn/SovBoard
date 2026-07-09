//! P2P 局域网文件分享 — libp2p 节点模块。
//!
//! 职责：
//! - 通过 mDNS 在局域网中自动发现对等节点
//! - 维护在线节点列表
//! - 维护本地分享文件的注册表（哈希 → 文件信息）
//! - 处理文件请求/响应（阶段四实现）

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use futures::StreamExt;
use libp2p::{
    identity, mdns, noise,
    request_response::{self, ProtocolSupport},
    swarm::{NetworkBehaviour, SwarmEvent},
    tcp, yamux, Multiaddr, PeerId, StreamProtocol, SwarmBuilder,
};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

// ============================================================================
// 协议数据类型
// ============================================================================

/// 文件请求 —— 请求方发出，携带目标文件的 SHA-256 哈希。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileRequest {
    pub hash: String,
}

/// 文件响应 —— 分享方返回，包含文件名、大小和分块数据。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileResponse {
    pub file_name: String,
    pub file_size: u64,
    pub chunk_data: Vec<u8>,
    pub chunk_index: u64,
    pub total_chunks: u64,
}

// ============================================================================
// 共享状态
// ============================================================================

/// P2P 节点间共享的应用状态。
///
/// 存放在 `Arc<tokio::sync::Mutex<>>` 中，由 swarm 事件循环写入，
/// 由 Tauri command 通过 `.lock().await` 读取。
pub struct P2PState {
    /// 当前在线的对等节点及其已知地址。
    pub peers: HashMap<PeerId, Vec<Multiaddr>>,
    /// 本地分享的文件注册表（哈希 → 文件元信息）。
    pub file_registry: HashMap<String, FileEntry>,
}

/// 已注册的分享文件元信息。
#[derive(Debug, Clone)]
pub struct FileEntry {
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
}

// ============================================================================
// NetworkBehaviour
// ============================================================================

/// 组合 mDNS 发现 + 文件请求/响应。
#[derive(NetworkBehaviour)]
struct P2PBehaviour {
    mdns: mdns::tokio::Behaviour,
    file_exchange: request_response::cbor::Behaviour<FileRequest, FileResponse>,
}

// ============================================================================
// Swarm 启动逻辑
// ============================================================================

/// 启动 libp2p swarm 后台循环。
///
/// - 生成 Ed25519 密钥对
/// - 配置 TCP + Noise 加密 + Yamux 多路复用
/// - 监听随机端口
/// - 持续处理 mDNS 发现事件和文件请求事件
pub async fn start_p2p_node(
    state: Arc<Mutex<P2PState>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let id_keys = identity::Keypair::generate_ed25519();
    let peer_id = id_keys.public().to_peer_id();
    tracing::info!("本地 P2P 节点 ID: {}", peer_id);

    let mut swarm = SwarmBuilder::with_existing_identity(id_keys)
        .with_tokio()
        .with_tcp(
            tcp::Config::default(),
            noise::Config::new,
            yamux::Config::default,
        )?
        .with_behaviour(|key| {
            let mdns = mdns::tokio::Behaviour::new(
                mdns::Config::default(),
                key.public().to_peer_id(),
            )?;

            let file_exchange = request_response::cbor::Behaviour::new(
                [(
                    StreamProtocol::new("/sovboard-file/1"),
                    ProtocolSupport::Full,
                )],
                request_response::Config::default(),
            );

            Ok(P2PBehaviour {
                mdns,
                file_exchange,
            })
        })?
        .with_swarm_config(|cfg| cfg.with_idle_connection_timeout(Duration::from_secs(60)))
        .build();

    // 监听所有网卡的随机端口。局域网中的其他节点通过 mDNS 发现此地址。
    swarm.listen_on("/ip4/0.0.0.0/tcp/0".parse()?)?;

    loop {
        match swarm.select_next_some().await {
            // ---- 监听地址就绪 ----
            SwarmEvent::NewListenAddr { address, .. } => {
                tracing::info!("P2P 监听地址: {}/p2p/{}", address, peer_id);
            }

            // ---- mDNS 事件 ----
            SwarmEvent::Behaviour(P2PBehaviourEvent::Mdns(event)) => match event {
                mdns::Event::Discovered(list) => {
                    let mut state = state.lock().await;
                    for (peer_id, addr) in list {
                        state
                            .peers
                            .entry(peer_id)
                            .or_default()
                            .push(addr);
                        tracing::info!("发现节点: {}", peer_id);
                    }
                }
                mdns::Event::Expired(list) => {
                    let mut state = state.lock().await;
                    for (peer_id, _addr) in list {
                        state.peers.remove(&peer_id);
                        tracing::info!("节点离线: {}", peer_id);
                    }
                }
            },

            // ---- 文件请求/响应事件 ----
            SwarmEvent::Behaviour(P2PBehaviourEvent::FileExchange(event)) => {
                tracing::debug!("FileExchange 事件: {:?}", event);
                // TODO: 阶段四实现请求处理
            }

            _ => {}
        }
    }
}
