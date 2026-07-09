import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, message, Tooltip } from "antd";
import { CopyOutlined, DeleteOutlined } from "@ant-design/icons";
import type { UnlistenFn } from "@tauri-apps/api/event";

// ========== 类型 ==========

interface SharedFile {
  hash: string;
  file_name: string;
  file_path: string;
  file_size: number;
  timestamp: number;
}

/** 格式化字节数 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 格式化时间戳 */
function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 截断哈希显示 */
function truncateHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

// ========== 组件 ==========

function FileSharePage() {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [isOver, setIsOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messageApi, contextHolder] = message.useMessage();

  // ---- 拖放监听 ----
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      try {
        unlisten = await getCurrentWindow().onDragDropEvent(async (event) => {
          if (event.payload.type === "over") {
            setIsOver(true);
          } else if (event.payload.type === "leave") {
            setIsOver(false);
          } else if (event.payload.type === "drop") {
            setIsOver(false);
            const paths = event.payload.paths;

            if (paths.length === 0) return;

            setLoading(true);
            let successCount = 0;
            let failCount = 0;

            for (const filePath of paths) {
              try {
                const result = await invoke<SharedFile>("register_file", {
                  path: filePath,
                });
                setFiles((prev) => [result, ...prev]);
                successCount++;
              } catch (err) {
                failCount++;
                const msg =
                  err instanceof Error ? err.message : String(err);
                messageApi.error(`注册失败: ${filePath}\n${msg}`);
              }
            }

            if (successCount > 0) {
              messageApi.success(
                `成功添加 ${successCount} 个文件` +
                  (failCount > 0 ? `，${failCount} 个失败` : ""),
              );
            }

            setLoading(false);
          }
        });
      } catch (err) {
        console.error("注册拖放监听失败:", err);
      }
    })();

    return () => {
      unlisten?.();
    };
  }, [messageApi]);

  // ---- 操作 ----

  const copyHash = async (hash: string) => {
    try {
      await navigator.clipboard.writeText(hash);
      messageApi.success("哈希已复制");
    } catch {
      messageApi.error("复制失败");
    }
  };

  const removeFile = (hash: string) => {
    setFiles((prev) => prev.filter((f) => f.hash !== hash));
  };

  // ---- 渲染 ----

  return (
    <div className="page file-share-page">
      {contextHolder}

      {/* 拖放区域 */}
      <div
        className={`drop-zone ${isOver ? "drop-zone-over" : ""} ${loading ? "drop-zone-loading" : ""}`}
      >
        <div className="drop-zone-icon">📁</div>
        <div className="drop-zone-text">
          {loading ? "正在注册文件..." : "拖放文件到此处分享"}
        </div>
        <div className="drop-zone-hint">
          支持单个或多个文件同时拖放
        </div>
      </div>

      {/* 文件列表 */}
      {files.length > 0 && (
        <div className="shared-files">
          {files.map((f) => (
            <div key={f.hash} className="shared-file-item">
              <div className="shared-file-info">
                <span className="shared-file-name">{f.file_name}</span>
                <span className="shared-file-meta">
                  {formatSize(f.file_size)} · {formatTime(f.timestamp)}
                </span>
                <Tooltip title={f.hash}>
                  <code className="shared-file-hash">
                    {truncateHash(f.hash)}
                  </code>
                </Tooltip>
              </div>
              <div className="shared-file-actions">
                <Tooltip title="复制哈希">
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => copyHash(f.hash)}
                  />
                </Tooltip>
                <Tooltip title="取消分享">
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeFile(f.hash)}
                  />
                </Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 空状态 */}
      {files.length === 0 && !loading && (
        <div className="share-empty">
          暂无分享文件，拖放文件到上方区域开始分享
        </div>
      )}
    </div>
  );
}

export default FileSharePage;
