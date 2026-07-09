import { Button, Progress, Result } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import type { DownloadState } from "../App";

interface Props {
  download: DownloadState;
  onBack: () => void;
}

function DownloadPage({ download, onBack }: Props) {
  const { status, hash, fileName, filePath, received, total, error } = download;

  const pct = total && received != null && total > 0
    ? Math.round((received / total) * 100)
    : undefined;

  const truncHash = hash.length > 20 ? `${hash.slice(0, 8)}...${hash.slice(-8)}` : hash;

  return (
    <div className="page download-page">
      {status === "downloading" && (
        <div className="download-card">
          <div className="download-header">正在下载</div>
          <div className="download-hash">哈希: <code>{truncHash}</code></div>
          {fileName && <div className="download-name">文件: {fileName}</div>}
          <Progress
            percent={pct ?? 0}
            status="active"
            strokeColor={{ from: "#108ee9", to: "#87d068" }}
            style={{ marginTop: 16 }}
          />
          {pct != null && <div className="download-pct">{pct}%</div>}
          {received != null && total != null && (
            <div className="download-size">
              {formatSize(received)} / {formatSize(total)}
            </div>
          )}
          <div className="download-hint">下载进行中，请等待...</div>
        </div>
      )}

      {status === "done" && (
        <Result
          status="success"
          title="下载完成"
          subTitle={fileName ? `文件已保存: ${filePath || fileName}` : `哈希: ${truncHash}`}
          extra={[
            <Button key="back" icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>,
          ]}
        />
      )}

      {status === "error" && (
        <Result
          status="error"
          title="下载失败"
          subTitle={error || "未知错误"}
          extra={[
            <Button key="back" icon={<ArrowLeftOutlined />} onClick={onBack}>返回</Button>,
          ]}
        />
      )}
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
