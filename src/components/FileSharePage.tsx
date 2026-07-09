import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Input, message, Tooltip } from "antd";
import { CopyOutlined, DeleteOutlined, SearchOutlined } from "@ant-design/icons";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface SharedFile {
  hash: string; file_name: string; file_path: string; file_size: number; timestamp: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function truncateHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

interface Props {
  downloadDir: string;
  onStartDownload: (hash: string) => void;
}

function FileSharePage({ downloadDir, onStartDownload }: Props) {
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [isOver, setIsOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hashInput, setHashInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [messageApi, ctx] = message.useMessage();

  useEffect(() => {
    let ul: UnlistenFn | undefined;
    (async () => {
      try {
        ul = await getCurrentWindow().onDragDropEvent(async (ev) => {
          if (ev.payload.type === "over") setIsOver(true);
          else if (ev.payload.type === "leave") setIsOver(false);
          else if (ev.payload.type === "drop") {
            setIsOver(false); setLoading(true);
            let ok = 0, fail = 0;
            for (const p of ev.payload.paths) {
              try { const r = await invoke<SharedFile>("register_file", { path: p }); setFiles((prev) => [r, ...prev]); ok++; }
              catch (e) { fail++; messageApi.error(`注册失败: ${p}\n${e}`); }
            }
            if (ok > 0) messageApi.success(`成功添加 ${ok} 个文件` + (fail > 0 ? `，${fail} 个失败` : ""));
            setLoading(false);
          }
        });
      } catch (e) { console.error("拖放监听失败:", e); }
    })();
    return () => { ul?.(); };
  }, [messageApi]);

  const handleSearch = useCallback(async () => {
    const h = hashInput.trim();
    if (!h) return;
    if (h.length !== 64 || !/^[0-9a-f]+$/i.test(h)) {
      messageApi.warning("请输入有效的 64 位 SHA-256 哈希值");
      return;
    }
    if (!downloadDir) {
      messageApi.warning("请先在设置中配置下载路径");
      return;
    }
    setSearching(true);
    onStartDownload(h);
    setSearching(false);
  }, [hashInput, downloadDir, onStartDownload, messageApi]);

  return (
    <div className="page file-share-page">
      {ctx}

      {/* 哈希查找 */}
      <div className="hash-lookup">
        <Input
          placeholder="输入文件哈希值查找下载..."
          value={hashInput}
          onChange={(e) => setHashInput(e.target.value)}
          onPressEnter={handleSearch}
          style={{ flex: 1 }}
        />
        <Button type="primary" icon={<SearchOutlined />} loading={searching}
          onClick={handleSearch}>查找</Button>
      </div>

      {/* 拖放区域 */}
      <div className={`drop-zone ${isOver ? "drop-zone-over" : ""} ${loading ? "drop-zone-loading" : ""}`}>
        <div className="drop-zone-icon">📁</div>
        <div className="drop-zone-text">{loading ? "注册中..." : "拖放文件分享"}</div>
        <div className="drop-zone-hint">支持单个或多个文件</div>
      </div>

      {files.length > 0 && (
        <div className="shared-files">
          {files.map((f) => (
            <div key={f.hash} className="shared-file-item">
              <div className="shared-file-info">
                <span className="shared-file-name">{f.file_name}</span>
                <span className="shared-file-meta">{formatSize(f.file_size)} · {formatTime(f.timestamp)}</span>
                <Tooltip title={f.hash}><code className="shared-file-hash">{truncateHash(f.hash)}</code></Tooltip>
              </div>
              <div className="shared-file-actions">
                <Tooltip title="复制哈希"><Button type="text" size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(f.hash); messageApi.success("已复制"); }} /></Tooltip>
                <Tooltip title="取消分享"><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => setFiles((prev) => prev.filter((x) => x.hash !== f.hash))} /></Tooltip>
              </div>
            </div>
          ))}
        </div>
      )}
      {files.length === 0 && !loading && <div className="share-empty">暂无分享文件</div>}
    </div>
  );
}

export default FileSharePage;
