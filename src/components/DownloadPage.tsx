import { Button, Progress } from "antd";
import { ArrowLeftOutlined, StopOutlined } from "@ant-design/icons";
import type { DownloadState } from "../App";

interface Props {
  download: DownloadState;
  onBack: () => void;
  onCancel: () => void;
}

/** 截断 PeerId 用于显示（前8后6） */
function truncPeerId(peerId: string): string {
  if (peerId.length <= 18) return peerId;
  return `${peerId.slice(0, 8)}...${peerId.slice(-6)}`;
}

function DownloadPage({ download, onBack, onCancel }: Props) {
  const { status, hash, fileName, filePath, received, total, error, targetPeerId } = download;

  const truncHash = hash.length > 20 ? `${hash.slice(0, 8)}...${hash.slice(-8)}` : hash;

  // ── 下载中 ──
  if (status === "downloading") {
    const pct = total && received != null && total > 0
      ? Math.round((received / total) * 100)
      : undefined;

    return (
      <div className="page download-page">
        <div className="download-card">
          <div className="download-status-icon downloading">⬇</div>
          <div className="download-header">正在下载</div>

          <div className="download-meta">
            {fileName && <div className="download-meta-row"><span className="dl-label">文件</span><span className="dl-value">{fileName}</span></div>}
            <div className="download-meta-row"><span className="dl-label">哈希</span><code className="dl-value mono">{truncHash}</code></div>
            {targetPeerId && <div className="download-meta-row"><span className="dl-label">来源</span><code className="dl-value mono">{truncPeerId(targetPeerId)}</code></div>}
          </div>

          <Progress
            percent={pct ?? 0}
            status="active"
            strokeColor={{ from: "#108ee9", to: "#87d068" }}
          />
          <div className="download-stats">
            {pct != null && <span className="download-pct">{pct}%</span>}
            {received != null && total != null && (
              <span className="download-size">{formatSize(received)} / {formatSize(total)}</span>
            )}
          </div>

          <div className="download-actions">
            <Button danger icon={<StopOutlined />} onClick={onCancel}>停止下载</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── 下载完成 ──
  if (status === "done") {
    return (
      <div className="page download-page">
        <div className="download-card">
          <div className="download-status-icon done">✓</div>
          <div className="download-header">下载完成</div>

          <div className="download-meta">
            {fileName && <div className="download-meta-row"><span className="dl-label">文件</span><span className="dl-value">{filePath || fileName}</span></div>}
            <div className="download-meta-row"><span className="dl-label">哈希</span><code className="dl-value mono">{truncHash}</code></div>
            {targetPeerId && <div className="download-meta-row"><span className="dl-label">来源</span><code className="dl-value mono">{truncPeerId(targetPeerId)}</code></div>}
          </div>

          <div className="download-actions">
            <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>
          </div>
        </div>
      </div>
    );
  }

  // ── 下载失败 ──
  return (
    <div className="page download-page">
      <div className="download-card">
        <div className="download-status-icon error">✕</div>
        <div className="download-header">下载失败</div>

        <div className="download-error-msg">{error || "未知错误"}</div>

        <div className="download-meta">
          <div className="download-meta-row"><span className="dl-label">哈希</span><code className="dl-value mono">{truncHash}</code></div>
          {targetPeerId && <div className="download-meta-row"><span className="dl-label">来源</span><code className="dl-value mono">{truncPeerId(targetPeerId)}</code></div>}
        </div>

        <div className="download-actions">
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default DownloadPage;
