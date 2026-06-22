use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

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

// ========== Tauri command ==========

/// 清理孤立的剪贴板图片文件。
///
/// - 接收前端当前所有拥有 image 的条目列表。
/// - 从第一条路径推断图片保存目录。
/// - 扫描目录中所有图片文件，删除"磁盘有但条目没引用"的孤儿文件。
/// - 检查每条条目的图片文件是否存在，返回"条目有但文件丢了"的 ID 列表。
#[tauri::command]
fn cleanup_orphan_images(entries: Vec<ImageEntry>) -> Result<CleanupResult, String> {
    let mut removed_files: Vec<String> = Vec::new();
    let mut stale_entry_ids: Vec<u64> = Vec::new();
    let mut errors: Vec<String> = Vec::new();

    // ---- 收集已知路径集合 (标准化) ----
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

    // ---- 推断图片目录 ----
    let scan_dir = match entries.first() {
        Some(first) => match Path::new(&first.path).parent() {
            Some(parent) if parent.as_os_str().len() > 0 => parent.to_path_buf(),
            _ => {
                return Err("无法从条目路径中推断图片保存目录".into());
            }
        },
        None => {
            // 没有图片条目，无需清理
            return Ok(CleanupResult {
                removed_files,
                stale_entry_ids,
                errors,
            });
        }
    };

    if !scan_dir.exists() {
        // 目录不存在，但需要检查条目路径是否有效
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

    // ---- 扫描目录，删除孤儿图片 ----
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

                // 只处理文件（不递归子目录）
                if !file_path.is_file() {
                    continue;
                }

                // 只处理图片文件
                if !is_image_file(&file_path) {
                    continue;
                }

                let canonical = file_path
                    .canonicalize()
                    .unwrap_or_else(|_| file_path.clone());
                let canonical_str = canonical.to_string_lossy().to_string();

                if !known_paths.contains(&canonical_str) {
                    // 孤儿图片：磁盘有但条目没引用 → 删除
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

    // ---- 检查条目路径是否仍存 ----
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

// ========== 应用入口 ==========

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_clipboard_x::init())
        .invoke_handler(tauri::generate_handler![cleanup_orphan_images])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
