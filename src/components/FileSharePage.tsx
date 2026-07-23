import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Input, Tooltip, App, Spin, Empty } from "antd";
import { CopyOutlined, DeleteOutlined, SearchOutlined } from "@ant-design/icons";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface SharedFile {
  hash: string; file_name: string; file_path: string; file_size: number; timestamp: number;
}

interface PeerInfo {
  peer_id: string;
  addresses: string[];
}

interface SearchResult {
  hash: string;
  file_name: string;
  file_size: number;
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
/** 将哈希按子序列匹配拆分为 token，标记哪些字符被匹配 */
function highlightMatch(
  hash: string,
  query: string,
): { char: string; match: boolean }[] {
  const ql = query.toLowerCase();
  const hl = hash.toLowerCase();
  const tokens: { char: string; match: boolean }[] = [];
  let qi = 0;
  for (const ch of hash) {
    if (qi < ql.length && hl[tokens.length] === ql[qi]) {
      tokens.push({ char: ch, match: true });
      qi++;
    } else {
      tokens.push({ char: ch, match: false });
    }
  }
  return tokens;
}

function extractIpPort(addr: string): string | null {
  const m = addr.match(/\/ip[46]\/([^/]+)\/(?:tcp|udp)\/(\d+)/);
  return m ? `${m[1]}:${m[2]}` : null;
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
  const { message: messageApi } = App.useApp();
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const peerListRef = useRef<HTMLDivElement>(null);

  // ---- 搜索状态 ----
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchState, setSearchState] = useState<"idle" | "busy" | "results" | "empty">("idle");

  // 拖放文件
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

  // 定时刷新节点列表
  useEffect(() => {
    const fetchPeers = async () => {
      try {
        const list = await invoke<PeerInfo[]>("get_peer_list");
        setPeers(list);
      } catch {}
    };
    fetchPeers();
    const timer = setInterval(fetchPeers, 5000);
    return () => clearInterval(timer);
  }, []);

  // 竖向滚轮 → 横向滚动
  const handlePeerListWheel = useCallback((e: React.WheelEvent) => {
    if (e.deltaY !== 0) {
      e.currentTarget.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, []);

  // 子序列搜索（debounce 300ms）
  useEffect(() => {
    const q = hashInput.trim();
    if (q.length < 4 || q.length >= 64) {
      setSearchState("idle");
      setSearchResults([]);
      return;
    }

    setSearchState("busy");

    const timer = setTimeout(async () => {
      try {
        const results = await invoke<SearchResult[]>("search_files", { query: q });
        setSearchResults(results);
        setSearchState(results.length > 0 ? "results" : "empty");
      } catch {
        setSearchState("idle");
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [hashInput]);

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
    setSearchState("idle");
    onStartDownload(h);
    setSearching(false);
  }, [hashInput, downloadDir, onStartDownload, messageApi]);

  const handleResultClick = useCallback((hash: string) => {
    setHashInput(hash);
    setSearchState("idle");
  }, []);

  return (
    <div className="page file-share-page">
      {/* 哈希查找 */}
      <div className="hash-lookup-wrapper">
        <div className="hash-lookup">
          <Input
            variant="filled"
            placeholder="输入文件哈希查找下载..."
            value={hashInput}
            onChange={(e) => setHashInput(e.target.value)}
            onPressEnter={handleSearch}
            style={{ flex: 1 }}
          />
          <Button type="primary" icon={<SearchOutlined />} loading={searching}
            onClick={handleSearch}>查找</Button>
        </div>

        {/* 搜索下拉 */}
        {searchState !== "idle" && (
          <div className="search-dropdown">
            {searchState === "busy" && (
              <div className="search-dropdown-status">
                <Spin size="small" /> <span style={{ marginLeft: 8 }}>搜索中...</span>
              </div>
            )}
            {searchState === "empty" && (
              <div className="search-dropdown-status">
                <Empty description="无匹配结果" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </div>
            )}
            {searchState === "results" &&
              searchResults.map((r) => (
                <div
                  key={r.hash}
                  className="search-result-item"
                  onClick={() => handleResultClick(r.hash)}
                >
                  <span className="search-result-name">{r.file_name}</span>
                  <span className="search-result-size">{formatSize(r.file_size)}</span>
                  <code className="search-result-hash">
                    {(() => {
                      const tokens = highlightMatch(r.hash, hashInput.trim());
                      // 只显示前 24 + 后 8 截断，但确保高亮保留
                      if (tokens.length <= 32) {
                        return tokens.map((t, i) => (
                          <span key={i} className={t.match ? "search-result-highlight" : undefined}>{t.char}</span>
                        ));
                      }
                      const head = tokens.slice(0, 24);
                      const tail = tokens.slice(-8);
                      return (
                        <>
                          {head.map((t, i) => (
                            <span key={i} className={t.match ? "search-result-highlight" : undefined}>{t.char}</span>
                          ))}
                          <span className="search-result-ellipsis">...</span>
                          {tail.map((t, i) => (
                            <span key={`t${i}`} className={t.match ? "search-result-highlight" : undefined}>{t.char}</span>
                          ))}
                        </>
                      );
                    })()}
                  </code>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* 局域网节点列表 */}
      <div className="peer-list-wrapper">
        <div className="peer-list-label">局域网节点</div>
        <div
          className="peer-list"
          ref={peerListRef}
          onWheel={handlePeerListWheel}
        >
          {peers.length === 0 ? (
            <span className="peer-list-empty">未发现其他节点</span>
          ) : (
            peers.map((p) => {
              const ip = p.addresses.map(extractIpPort).find(Boolean)
                ?? p.peer_id.slice(0, 12) + "...";
              return (
                <Tooltip key={p.peer_id} title={p.peer_id} placement="bottom">
                  <div className="peer-chip">{ip}</div>
                </Tooltip>
              );
            })
          )}
        </div>
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
