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

// ========== QuickSelector ==========

struct QuickSelectorState { entries_json: Mutex<String> }

#[derive(Debug, Deserialize)] struct ImageEntry { id: u64, path: String }

#[derive(Debug, Serialize)]
struct CleanupResult { removed_files: Vec<String>, stale_entry_ids: Vec<u64>, errors: Vec<String> }

const IMAGE_EXTENSIONS: &[&str] = &["png","jpg","jpeg","bmp","gif","webp","tiff","tif","svg","ico","avif"];

fn is_image_file(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str())).unwrap_or(false)
}

// ========== Tauri commands ==========

#[tauri::command]
fn cleanup_orphan_images(entries: Vec<ImageEntry>) -> Result<CleanupResult, String> {
    let mut removed = vec![];
    let mut stale = vec![];
    let mut errors = vec![];

    let known: HashSet<String> = entries.iter().map(|e| {
        Path::new(&e.path).canonicalize().unwrap_or_else(|_| Path::new(&e.path).to_path_buf())
            .to_string_lossy().to_string()
    }).collect();

    let scan_dir = match entries.first() {
        Some(f) => match Path::new(&f.path).parent() {
            Some(p) if p.as_os_str().len() > 0 => p.to_path_buf(),
            _ => return Err("无法推断图片目录".into()),
        },
        None => return Ok(CleanupResult { removed_files: removed, stale_entry_ids: stale, errors }),
    };

    if !scan_dir.exists() {
        for e in &entries { if !Path::new(&e.path).exists() { stale.push(e.id); } }
        return Ok(CleanupResult { removed_files: removed, stale_entry_ids: stale, errors });
    }

    if let Ok(dir) = fs::read_dir(&scan_dir) {
        for de in dir {
            let de = match de { Ok(d) => d, Err(e) => { errors.push(format!("{:?}", e)); continue; } };
            let fp = de.path();
            if !fp.is_file() || !is_image_file(&fp) { continue; }
            let canon = fp.canonicalize().unwrap_or_else(|_| fp.clone()).to_string_lossy().to_string();
            if !known.contains(&canon) {
                match fs::remove_file(&fp) {
                    Ok(()) => { removed.push(fp.to_string_lossy().to_string()); }
                    Err(e) => { errors.push(format!("删除 {}: {}", fp.display(), e)); }
                }
            }
        }
    } else {
        errors.push(format!("扫描失败"));
    }

    for e in &entries { if !Path::new(&e.path).exists() { stale.push(e.id); } }
    Ok(CleanupResult { removed_files: removed, stale_entry_ids: stale, errors })
}

fn get_quick_selector_url(_app: &tauri::AppHandle) -> WebviewUrl {
    if cfg!(debug_assertions) {
        WebviewUrl::External("http://localhost:1420/?window=quick-selector".parse().unwrap())
    } else {
        WebviewUrl::App("index.html?window=quick-selector".into())
    }
}

#[tauri::command] fn show_quick_selector(app: tauri::AppHandle, entries_json: String) -> Result<(), String> {
    let st = app.state::<QuickSelectorState>();
    *st.entries_json.lock().map_err(|e| e.to_string())? = entries_json;
    let w = app.get_webview_window("quick-selector").ok_or("qs 窗口未找到")?;
    w.center().map_err(|e| e.to_string())?;
    let json = st.entries_json.lock().map_err(|e| e.to_string())?.clone();
    w.emit("quick-selector:entries-updated", json).map_err(|e| e.to_string())?;
    w.show().map_err(|e| e.to_string())?; w.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command] fn hide_quick_selector(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("quick-selector") {
        let _ = w.emit("quick-selector:close", ());
        std::thread::sleep(std::time::Duration::from_millis(50));
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command] fn get_quick_selector_entries(app: tauri::AppHandle) -> Result<String, String> {
    app.state::<QuickSelectorState>().entries_json.lock().map_err(|e| e.to_string()).map(|j| j.clone())
}

// ========== P2P commands ==========

#[derive(Debug, Serialize)] struct PeerInfo { peer_id: String, addresses: Vec<String> }

#[derive(Debug, Serialize)]
struct FileRegisterResult { hash: String, file_name: String, file_path: String, file_size: u64, timestamp: u64 }

#[tauri::command]
async fn get_local_peer_id(state: tauri::State<'_, Arc<tokio::sync::Mutex<p2p::P2PState>>>) -> Result<String, String> {
    let s = state.lock().await;
    s.local_peer_id.clone().ok_or_else(|| "P2P 节点尚未初始化".into())
}

#[tauri::command]
async fn register_file(path: String, state: tauri::State<'_, Arc<tokio::sync::Mutex<p2p::P2PState>>>) -> Result<FileRegisterResult, String> {
    use sha2::{Digest, Sha256};
    use std::time::{SystemTime, UNIX_EPOCH};
    let fp = Path::new(&path);
    if !fp.exists() { return Err("文件不存在".into()); }
    if !fp.is_file() { return Err("不是文件".into()); }
    let fname = fp.file_name().and_then(|n| n.to_str()).unwrap_or("unknown").to_string();
    let fsize = fp.metadata().map_err(|e| format!("{}", e))?.len();
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| format!("{}", e))?.as_secs();
    let mac = mac_address::get_mac_address().ok().flatten().map(|m| m.to_string()).unwrap_or_else(|| "00:00:00:00:00:00".into());
    let mut h = Sha256::new();
    let mut f = std::fs::File::open(fp).map_err(|e| format!("open: {}", e))?;
    std::io::copy(&mut f, &mut h).map_err(|e| format!("read: {}", e))?;
    h.update(ts.to_string().as_bytes()); h.update(path.as_bytes()); h.update(mac.as_bytes());
    let hash = format!("{:x}", h.finalize());
    let mut s = state.lock().await;
    s.file_registry.insert(hash.clone(), p2p::FileEntry { file_path: path.clone(), file_name: fname.clone(), file_size: fsize, register_timestamp: ts });
    Ok(FileRegisterResult { hash, file_name: fname, file_path: path, file_size: fsize, timestamp: ts })
}

#[tauri::command]
fn request_file(hash: String, save_dir: String, state: tauri::State<'_, Arc<tokio::sync::Mutex<p2p::P2PState>>>) -> Result<(), String> {
    let p2p = state.try_lock().map_err(|e| format!("{}", e))?;
    match &p2p.download_tx {
        Some(tx) => tx.send(p2p::DownloadRequest { hash, save_dir }).map_err(|e| format!("{}", e)),
        None => Err("P2P 未初始化".into()),
    }
}

#[tauri::command]
async fn cancel_download(hash: String, state: tauri::State<'_, Arc<tokio::sync::Mutex<p2p::P2PState>>>) -> Result<(), String> {
    let p2p = state.lock().await;
    match &p2p.cmd_tx {
        Some(tx) => tx.send(p2p::Command::CancelDownload { hash }).map_err(|e| format!("{}", e)),
        None => Err("P2P 未初始化".into()),
    }
}

#[tauri::command]
async fn get_peer_list(state: tauri::State<'_, Arc<tokio::sync::Mutex<p2p::P2PState>>>) -> Result<Vec<PeerInfo>, String> {
    let s = state.lock().await;
    Ok(s.peers.iter().map(|(id, a)| PeerInfo { peer_id: id.to_string(), addresses: a.iter().map(|x| x.to_string()).collect() }).collect())
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
            let _ = tauri::WebviewWindowBuilder::new(app, "quick-selector", url)
                .title("QuickSelector").inner_size(540.0, 420.0)
                .decorations(false).always_on_top(true).center()
                .skip_taskbar(true).visible(false).build()
                .expect("qs 窗口失败");

            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png")).expect("图标失败");
            let show = MenuItemBuilder::with_id("show", "显示主窗口").build(app).unwrap();
            let quit = MenuItemBuilder::with_id("quit", "退出").build(app).unwrap();
            let menu = MenuBuilder::new(app).items(&[&show, &quit]).build().unwrap();
            let _ = TrayIconBuilder::new().icon(icon).menu(&menu).tooltip("SovBoard")
                .on_menu_event(|app, e| match e.id().as_ref() {
                    "show" => { if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); } }
                    "quit" => { app.exit(0); }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        if let Some(w) = tray.app_handle().get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                }).build(app).unwrap();

            if let Some(w) = app.get_webview_window("main") {
                let wc = w.clone();
                w.on_window_event(move |e| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = e { api.prevent_close(); let _ = wc.hide(); }
                });
            }

            // P2P
            let (download_tx, download_rx) = tokio::sync::mpsc::unbounded_channel();
            let p2p_state = Arc::new(tokio::sync::Mutex::new(p2p::P2PState {
                peers: std::collections::HashMap::new(),
                file_registry: std::collections::HashMap::new(),
                local_peer_id: None,  // 由 start_p2p_node 设置
                download_tx: Some(download_tx),
                cmd_tx: None,  // 由 start_p2p_node 设置
                cancel_tokens: std::collections::HashMap::new(),
                app_handle: Some(app.handle().clone()),
            }));
            app.manage(p2p_state.clone());

            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = p2p::start_p2p_node(p2p_state, download_rx).await {
                    tracing::error!("P2P 异常: {}", e);
                    let _ = app_handle.emit("p2p:error", e.to_string());
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cleanup_orphan_images, show_quick_selector, hide_quick_selector,
            get_quick_selector_entries, get_local_peer_id, register_file,
            request_file, cancel_download, get_peer_list,
        ])
        .run(tauri::generate_context!())
        .expect("启动失败");
}
