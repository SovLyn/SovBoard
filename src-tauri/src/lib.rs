use std::collections::HashSet;
use std::fs;
use std::path::Path;
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

/// 前端传来的图片条目（只传 id + 图片路径）
#[derive(Debug, Deserialize)]
struct ImageEntry {
    id: u64,
    path: String,
}

/// 清理结果，返回给前端
#[derive(Debug, Serialize)]
struct CleanupResult {
    /// 被删除的孤儿图片文件路径
    removed_files: Vec<String>,
    /// 条目存在但对应图片文件已丢失的条目 ID（前端应删除这些条目）
    stale_entry_ids: Vec<u64>,
    /// 删除过程中遇到的错误
    errors: Vec<String>,
}

/// 被认为是图片的扩展名
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

/// 清理孤立的剪贴板图片文件。
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
            _ => {
                return Err("无法从条目路径中推断图片保存目录".into());
            }
        },
        None => {
            return Ok(CleanupResult {
                removed_files,
                stale_entry_ids,
                errors,
            });
        }
    };

    if !scan_dir.exists() {
        for entry in &entries {
            if !Path::new(&entry.path).exists() {
                stale_entry_ids.push(entry.id);
            }
        }
        return Ok(CleanupResult {
            removed_files,
            stale_entry_ids,
            errors,
        });
    }

    match fs::read_dir(&scan_dir) {
        Ok(dir_entries) => {
            for dir_entry in dir_entries {
                let dir_entry = match dir_entry {
                    Ok(de) => de,
                    Err(e) => {
                        errors.push(format!("读取目录条目失败: {}", e));
                        continue;
                    }
                };

                let file_path = dir_entry.path();

                if !file_path.is_file() {
                    continue;
                }

                if !is_image_file(&file_path) {
                    continue;
                }

                let canonical = file_path
                    .canonicalize()
                    .unwrap_or_else(|_| file_path.clone());
                let canonical_str = canonical.to_string_lossy().to_string();

                if !known_paths.contains(&canonical_str) {
                    match fs::remove_file(&file_path) {
                        Ok(()) => {
                            removed_files.push(file_path.to_string_lossy().to_string());
                        }
                        Err(e) => {
                            errors.push(format!(
                                "删除孤儿文件 {} 失败: {}",
                                file_path.display(),
                                e
                            ));
                        }
                    }
                }
            }
        }
        Err(e) => {
            errors.push(format!("扫描图片目录 {} 失败: {}", scan_dir.display(), e));
        }
    }

    for entry in &entries {
        if !Path::new(&entry.path).exists() {
            stale_entry_ids.push(entry.id);
        }
    }

    Ok(CleanupResult {
        removed_files,
        stale_entry_ids,
        errors,
    })
}

/// 构建 QuickSelector 窗口的 URL。
/// 开发模式直连 Vite dev server，生产模式用 App 相对路径。
fn get_quick_selector_url(_app: &tauri::AppHandle) -> WebviewUrl {
    if cfg!(debug_assertions) {
        WebviewUrl::External(
            "http://localhost:1420/?window=quick-selector"
                .parse()
                .unwrap(),
        )
    } else {
        WebviewUrl::App("index.html?window=quick-selector".into())
    }
}

/// 显示 QuickSelector 窗口（预创建的隐藏窗口，只做 show + 发送数据）。
#[tauri::command]
fn show_quick_selector(app: tauri::AppHandle, entries_json: String) -> Result<(), String> {
    // 存储条目到全局状态
    let state = app.state::<QuickSelectorState>();
    *state.entries_json.lock().map_err(|e| e.to_string())? = entries_json;

    // 获取预创建的窗口
    let window = app
        .get_webview_window("quick-selector")
        .ok_or_else(|| "quick-selector 窗口未找到".to_string())?;

    // 先居中
    window.center().map_err(|e| e.to_string())?;

    // 通知 QS 窗口更新数据
    let json = state.entries_json.lock().map_err(|e| e.to_string())?.clone();
    window
        .emit("quick-selector:entries-updated", json)
        .map_err(|e| e.to_string())?;

    // 显示窗口
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    Ok(())
}

/// 隐藏 QuickSelector 窗口（不销毁，下次复用）。
#[tauri::command]
fn hide_quick_selector(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("quick-selector") {
        let _ = window.emit("quick-selector:close", ());
        std::thread::sleep(std::time::Duration::from_millis(50));
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// QuickSelector 窗口调用此命令获取条目数据。
#[tauri::command]
fn get_quick_selector_entries(app: tauri::AppHandle) -> Result<String, String> {
    let state = app.state::<QuickSelectorState>();
    let json = state
        .entries_json
        .lock()
        .map_err(|e| e.to_string())?
        .clone();
    Ok(json)
}

// ========== 应用入口 ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_x::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_denylist(&["quick-selector"])
                .build(),
        )
        .manage(QuickSelectorState {
            entries_json: Mutex::new("[]".into()),
        })
        .setup(|app| {
            // ---- 预创建 QuickSelector 窗口 ----
            let url = get_quick_selector_url(&app.handle());
            let _qs_window = tauri::WebviewWindowBuilder::new(app, "quick-selector", url)
                .title("QuickSelector")
                .inner_size(540.0, 420.0)
                .decorations(false)
                .always_on_top(true)
                .center()
                .skip_taskbar(true)
                .visible(false)
                .build()
                .expect("预创建 QuickSelector 窗口失败");

            // ---- 系统托盘 ----
            let icon = Image::from_bytes(include_bytes!("../icons/32x32.png"))
                .expect("加载托盘图标失败");

            let show_item = MenuItemBuilder::with_id("show", "显示主窗口")
                .build(app)
                .expect("创建托盘菜单项失败");
            let quit_item = MenuItemBuilder::with_id("quit", "退出")
                .build(app)
                .expect("创建托盘菜单项失败");
            let menu = MenuBuilder::new(app)
                .items(&[&show_item, &quit_item])
                .build()
                .expect("创建托盘菜单失败");

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("SovBoard")
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)
                .expect("创建托盘图标失败");

            // ---- 拦截关闭事件：隐藏窗口而不是退出 ----
            if let Some(window) = app.get_webview_window("main") {
                let win_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = win_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            cleanup_orphan_images,
            show_quick_selector,
            hide_quick_selector,
            get_quick_selector_entries,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}