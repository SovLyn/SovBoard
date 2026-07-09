mod p2p;

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::Arc;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;
use tauri::WebviewUrl;
use tauri::image::Image;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

// ========== QuickSelector 窗口状态 ==========

struct QuickSelectorState {
    entries_json: Mutex<String>,
}

// ========== 清理命令相关类型 ==========

#[derive(Debug, Deserialize)]
struct ImageEntry {
    id: u64,
    path: String,
}

#[derive(Debug, Serialize)]
struct CleanupResult {
    removed_files: Vec<String>,
    stale_entry_ids: Vec<u64>,
    errors: Vec<String>,
}

const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "bmp", "gif", "webp", "tiff", "tif", "svg", "ico", "avif",
];

fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

// ========== Tauri commands ==========

#[tauri::command]
fn cleanup_orphan_images(entries: Vec<ImageEntry>) -> Result<CleanupResult, String> {
    let mut removed_files: Vec<String> = Vec::new();
    let mut stale_entry_ids: Vec<u64> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    let known_paths: HashSet<String> = entries
        .iter()
        .map(|e| {
            Path::new(&e.path)
                .canonicalize()
                .unwrap_or_else(|_| Path::new(&e.path).to_path_buf())
                .to_string_lossy()
                .to_string()
        })
        .collect();

    let scan_dir = match entries.first() {
        Some(first) => match Path::new(&first.path).parent() {
            Some(parent) if parent.as_os_str().len() > 0 => parent.to_path_buf(),
            _ => return Err("无法从条目路径中推断图片保存目录".into()),
        },
        None => {
            return Ok(CleanupResult { removed_files, stale_entry_ids, errors });
        }
    };

    if !scan_dir.exists() {
        for entry in &entries {
            if !Path::new(&entry.path).exists() {
                stale_entry_ids.push(entry.id);
            }
        }
        return Ok(CleanupResult { removed_files, stale_entry_ids, errors });
    }

    match fs::read_dir(&scan_dir) {
        Ok(dir_entries) => {
            for dir_entry in dir_entries {
                let dir_entry = match dir_entry {
                    Ok(de) => de,
                    Err(e) => { errors.push(format!("读取目录条目失败: {}", e)); continue; }
                };
                let file_path = dir_entry.path();
                if !file_path.is_file() || !is_image_file(&file_path) { continue; }

                let canonical = file_path.canonicalize().unwrap_or_else(|_| file_path.clone());
                let canonical_str = canonical.to_string_lossy().to_string();

                if !known_paths.contains(&canonical_str) {
                    match fs::remove_file(&file_path) {
                        Ok(()) => { removed_files.push(file_path.to_string_lossy().to_string()); }
                        Err(e) => { errors.push(format!("删除孤儿文件 {} 失败: {}", file_path.display(), e)); }
                    }
                }
            }
        }
        Err(e) => { errors.push(format!("扫描图片目录 {} 失败: {}", scan_dir.display(), e)); }
    }

    for entry in &entries {
        if !Path::new(&entry.path).exists() { stale_entry_ids.push(entry.id); }
    }

    Ok(CleanupResult { removed_files, stale_entry_ids, errors })
}

fn get_quick_selector_url(_app: &tauri::AppHandle) -> WebviewUrl {
    if cfg!(debug_assertions) {
        WebviewUrl::External("http://localhost:1420/?window=quick-selector".parse().unwrap())
    } else {
        WebviewUrl::App("index.html?window=quick-selector".into())
    }
}

#[tauri::command]
fn show_quick_selector(app: tauri::AppHandle, entries_json: String) -> Result<(), String> {
    let state = app.state::<QuickSelectorState>();
    *state.entries_json.lock().map_err(|e| e.to_string())? = entries_json;
    let window = app.get_webview_window("quick-selector").ok_or_else(|| "quick-selector 窗口未找到".to_string())?;
    window.center().map_err(|e| e.to_string())?;
    let json = state.entries_json.lock().map_err(|e| e.to_string())?.clone();
    window.emit("quick-selector:entries-updated", json).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn hide_quick_selector(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick-selector") {
        let _ = window.emit("quick-selector:close", ());
        std::thread::sleep(std::time::Duration::from_millis(50));
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_quick_selector_entries(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<QuickSelectorState>();
    state.entries_json.lock().map_err(|e| e.to_string()).map(|j| j.clone())
}

// ========== P2P commands ==========

#[derive(Debug, Serialize)]
struct PeerInfo {
    peer_id: String,
    addresses: Vec<String>,
}

#[derive(Debug, Serialize)]
struct FileRegisterResult {
    hash: String,
    file_name: String,
    file_path: String,
    file_size: u64,
    timestamp: u64,
}

#[tauri::command]
fn get_default_peer_name() -> String {
    mac_address::get_mac_address()
        .ok().flatten()
        .map(|mac| mac.to_string())
        .unwrap_or_else(|| "Unknown".into())
}

#[tauri::command]
async fn register_file(
    path: String,
    state: tauri::State<'_, Arc<tokio::sync::Mutex<p2p::P2PState>>>,
) -> Result<FileRegisterResult, String> {
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};

    let file_path = std::path::Path::new(&path);
    if !file_path.exists() { return Err(format!("文件不存在: {}", path)); }
    if !file_path.is_file() { return Err(format!("路径不是文件: {}", path)); }

    let file_name = file_path.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let file_size = file_path.metadata().map_err(|e| format!("读取文件元数据失败: {}", e))?.len();
    let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| format!("系统时间错误: {}", e))?.as_secs();
    let mac = mac_address::get_mac_address().ok().flatten().map(|m| m.to_string()).unwrap_or_else(|| "00:00:00:00:00:00".into());

    let mut hasher = Sha256::new();
    let mut file = std::fs::File::open(file_path).map_err(|e| format!("打开文件失败: {}", e))?;
    std::io::copy(&mut file, &mut hasher).map_err(|e| format!("读取文件失败: {}", e))?;
    hasher.update(timestamp.to_string().as_bytes());
    hasher.update(path.as_bytes());
    hasher.update(mac.as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    let mut p2p = state.lock().await;
    p2p.file_registry.insert(hash.clone(), p2p::FileEntry {
        file_path: path.clone(), file_name: file_name.clone(),
        file_size, register_timestamp: timestamp,
    });

    Ok(FileRegisterResult { hash, file_name, file_path: path, file_size, timestamp })
}

/// 请求下载文件（发起 P2P 传输）。
#[tauri::command]
fn request_file(
    hash: String,
    save_path: String,
    state: tauri::State<'_, Arc<tokio::sync::Mutex<p2p::P2PState>>>,
) -> Result<(), String> {
    let p2p = state.try_lock().map_err(|e| format!("状态锁定失败: {}", e))?;
    match &p2p.download_tx {
        Some(tx) => {
            tx.send(p2p::DownloadRequest { hash, save_path })
                .map_err(|e| format!("发送下载请求失败: {}", e))
        }
        None => Err("P2P 节点未初始化".into()),
    }
}

#[tauri::command]
async fn get_peer_list(
    state: tauri::State<'_, Arc<tokio::sync::Mutex<p2p::P2PState>>>,
) -> Result<Vec<PeerInfo>, String> {
    let p2p = state.lock().await;
    Ok(p2p.peers.iter().map(|(id, addrs)| PeerInfo {
        peer_id: id.to_string(),
        addresses: addrs.iter().map(|a| a.to_string()).collect(),
    }).collect())
}

// ========== 应用入口 ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_x::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().with_denylist(&["quick-selector"]).build())
        .manage(QuickSelectorState { entries_json: Mutex::new("[]".into()) })
        .setup(|app| {
            let url = get_quick_selector_url(&app.handle());
            let _qs_window = tauri::WebviewWindowBuilder::new(app, "quick-selector", url)
                .title("QuickSelector").inner_size(540.0, 420.0)
                .decorations(false).always_on_top(true).center()
                .skip_taskbar(true).visible(false).build()
                .expect("预创建 QuickSelector 窗口失败");

            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png")).expect("加载托盘图标失败");
            let show_item = MenuItemBuilder::with_id("show", "显示主窗口").build(app).expect("创建托盘菜单项失败");
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app).expect("创建托盘菜单项失败");
            let menu = MenuBuilder::new(app).items(&[&show_item, &quit_item]).build().expect("创建托盘菜单失败");

            let _tray = TrayIconBuilder::new().icon(icon).menu(&menu).tooltip("SovBoard")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
                    "quit" => { app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                })
                .build(app).expect("创建托盘图标失败");

            if let Some(window) = app.get_webview_window("main") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close(); let _ = win_clone.hide();
                    }
                });
            }

            // ---- 启动 P2P 网络节点 ----
            let (download_tx, download_rx) = tokio::sync::mpsc::unbounded_channel();
            let p2p_state = Arc::new(tokio::sync::Mutex::new(p2p::P2PState {
                peers: std::collections::HashMap::new(),
                file_registry: std::collections::HashMap::new(),
                download_tx: Some(download_tx),
            }));
            app.manage(p2p_state.clone());

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = p2p::start_p2p_node(p2p_state, download_rx).await {
                    tracing::error!("P2P 节点异常退出: {}", e);
                    let _ = app_handle.emit("p2p:error", e.to_string());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cleanup_orphan_images, show_quick_selector, hide_quick_selector,
            get_quick_selector_entries, get_default_peer_name, register_file,
            request_file, get_peer_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
