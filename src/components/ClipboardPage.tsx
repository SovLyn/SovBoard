import { useState, useMemo } from "react";
import { Popconfirm, Tag, Tooltip, BorderBeam } from "antd";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ClipEntry } from "../App";
import { BEAM_COLORS } from "../utils/clipboardPreview";

interface ClipboardPageProps {
  entries: ClipEntry[];
  onCopy: (entry: ClipEntry) => void;
  onDelete: (id: number) => void;
  onToggleFavorite: (id: number) => void;
  onClear: () => void;
}

// ========== 时间格式化 ==========

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ========== 预览信息提取 ==========

interface PreviewInfo {
  text: string;
  icon: string;
  tags: string[];
}

/** 根据 tag 标签名返回对应的 antd Tag 颜色 */
function tagColor(label: string): string {
  if (label.startsWith("文本")) return "blue";
  if (label.startsWith("HTML")) return "orange";
  if (label.startsWith("图片")) return "purple";
  if (label.startsWith("文件")) return "cyan";
  if (label.startsWith("RTF")) return "red";
  return "default";
}

function getPreview(entry: ClipEntry): PreviewInfo {
  const tags: string[] = [];

  // 按存在性收集 tag
  if (entry.text) tags.push("文本");
  if (entry.html) tags.push("HTML");
  if (entry.image) tags.push("图片");
  if (entry.files) tags.push(`文件 ×${entry.files.length}`);
  if (entry.rtf) tags.push("RTF");

  // text — 最高优先级
  if (entry.text) {
    const singleLine = entry.text.replace(/\n/g, " ");
    const preview =
      singleLine.length > 40 ? singleLine.substring(0, 40) + "…" : singleLine;
    return { text: preview, icon: entry.image ? "🖼️" : "📄", tags };
  }

  // 图片（无 text 时优先于 html——网页图片的 html 只是 img 标签，无实际内容）
  if (entry.image) {
    const size = `${entry.image.width}×${entry.image.height}`;
    return { text: `图片 ${size}`, icon: "🖼️", tags };
  }

  // html（无 text 且无图片）
  if (entry.html) {
    const stripped = entry.html.replace(/<[^>]*>/g, "").trim();
    const preview =
      stripped.length > 40
        ? stripped.substring(0, 40) + "…"
        : stripped || "(空HTML)";
    return { text: preview, icon: "🌐", tags };
  }

  // 文件
  if (entry.files) {
    const count = entry.files.length;
    const preview =
      count === 1 ? entry.files[0] : `${count} 个文件`;
    return { text: preview, icon: "📁", tags };
  }

  // rtf
  if (entry.rtf) {
    const preview =
      entry.rtf.length > 40
        ? entry.rtf.substring(0, 40) + "…"
        : entry.rtf;
    return { text: preview, icon: "📄", tags };
  }

  return { text: "(空)", icon: "📄", tags };
}

// ========== 组件 ==========

function ClipboardPage({
  entries,
  onCopy,
  onDelete,
  onToggleFavorite,
  onClear,
}: ClipboardPageProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // 排序：收藏项置顶，各自按时间倒序
  const sortedEntries = useMemo(() => {
    const fav = entries.filter((e) => e.favorite);
    const nonFav = entries.filter((e) => !e.favorite);
    return [...fav, ...nonFav];
  }, [entries]);

  const previews = useMemo(
    () => sortedEntries.map((e) => ({ id: e.id, ...getPreview(e) })),
    [sortedEntries],
  );

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  // ---- 空状态 ----
  if (entries.length === 0) {
    return (
      <div className="page clipboard-page">
        <div className="clipboard-header">
          <h2>剪贴板历史</h2>
        </div>
        <div className="clipboard-empty">暂无剪贴板历史，开始复制吧</div>
      </div>
    );
  }

  // ---- 列表 ----
  return (
    <div className="page clipboard-page">
      <div className="clipboard-header">
        <Popconfirm
          title="确定要清空全部剪贴板历史吗？"
          onConfirm={onClear}
          okText="确定"
          cancelText="取消"
        >
          <button className="btn-clear">清空全部</button>
        </Popconfirm>
      </div>

      <div className="clipboard-list">
        {sortedEntries.map((entry) => {
          const expanded = expandedId === entry.id;
          const preview = previews.find((p) => p.id === entry.id)!;

          const clipClass = `clip-entry ${expanded ? "expanded" : ""} ${entry.favorite ? "clip-entry-favorite" : ""}`;

          const body = (
            <>
              {/* ---- 头部（折叠切换） ---- */}
              <div
                className="clip-entry-header"
                onClick={() => toggleExpand(entry.id)}
              >
                <span className="clip-expand-arrow">
                  {expanded ? "▾" : "▸"}
                </span>
                {entry.image && (
                  <img
                    src={convertFileSrc(entry.image.path)}
                    alt=""
                    className="clip-entry-thumb"
                    onClick={(e) => e.stopPropagation()}
                    style={{ height: 28, width: "auto", borderRadius: 3 }}
                  />
                )}
                <span className="clip-entry-preview">{preview.text}</span>
                <button
                  className="btn-favorite"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(entry.id);
                  }}
                  title={entry.favorite ? "取消收藏" : "收藏"}
                >
                  {entry.favorite ? "⭐" : "☆"}
                </button>
                {preview.tags.length > 0 && (
                  <span className="clip-entry-tags">
                    {preview.tags.map((t) => (
                      <Tag key={t} color={tagColor(t)}>
                        {t}
                      </Tag>
                    ))}
                  </span>
                )}
              </div>

              {/* ---- 元信息 + 操作 ---- */}
              <div className="clip-entry-meta">
                <span className="clip-entry-time">
                  {formatTime(entry.timestamp)}
                </span>
                <div className="clip-entry-actions">
                  <button
                    className="btn-action"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCopy(entry);
                    }}
                  >
                    复制
                  </button>
                  {entry.favorite ? (
                    <Tooltip title="收藏项不可删除">
                      <button
                        className="btn-action btn-delete btn-disabled"
                        onClick={(e) => e.stopPropagation()}
                        disabled
                      >
                        删除
                      </button>
                    </Tooltip>
                  ) : (
                  <Popconfirm
                    title="确定删除该条记录？"
                    onConfirm={() => onDelete(entry.id)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <button
                      className="btn-action btn-delete"
                      onClick={(e) => e.stopPropagation()}
                    >
                      删除
                    </button>
                  </Popconfirm>
                  )}
                </div>
              </div>

              {/* ---- 展开内容区 ---- */}
              {expanded && (
                <div className="clip-entry-body">
                  {entry.text && (
                    <pre className="clip-text-content">{entry.text}</pre>
                  )}
                  {entry.html && !entry.text && (
                    <pre className="clip-text-content">
                      <code>{entry.html}</code>
                    </pre>
                  )}
                  {entry.html && entry.text && (
                    <details className="clip-html-details">
                      <summary>HTML 源码</summary>
                      <pre className="clip-text-content">
                        <code>{entry.html}</code>
                      </pre>
                    </details>
                  )}
                  {entry.image && (
                    <div className="clip-image-content">
                      <img
                        src={convertFileSrc(entry.image.path)}
                        alt="剪贴板图片"
                        className="clip-image"
                      />
                      <div className="clip-image-info">
                        {entry.image.width} × {entry.image.height}
                      </div>
                    </div>
                  )}
                  {entry.files && (
                    <ul className="clip-files-list">
                      {entry.files.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                  {entry.rtf && !entry.text && (
                    <pre className="clip-text-content">{entry.rtf}</pre>
                  )}
                </div>
              )}
            </>
          );

          return entry.favorite ? (
            <BorderBeam key={entry.id} color={BEAM_COLORS}>
              <div className={clipClass}>{body}</div>
            </BorderBeam>
          ) : (
            <div key={entry.id} className={clipClass}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ClipboardPage;
