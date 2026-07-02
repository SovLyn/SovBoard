import { useEffect, useRef, useCallback } from "react";
import { Tag } from "antd";
import type { ClipEntry } from "../App";
import { tagColor, getQuickPreview } from "../utils/clipboardPreview";

// ========== 组件 ==========

const MAX_VISIBLE = 8;

interface QuickSelectorProps {
  entries: ClipEntry[];
  visible: boolean;
  highlightIndex: number;
  onHighlightChange: (index: number) => void;
}

function QuickSelector({
  entries,
  visible,
  highlightIndex,
  onHighlightChange,
}: QuickSelectorProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(highlightIndex);
  indexRef.current = highlightIndex;

  const displayed = entries.slice(0, MAX_VISIBLE);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (displayed.length === 0) return;
      const delta = e.deltaY > 0 ? 1 : -1;
      const newIndex = Math.min(
        Math.max(0, indexRef.current + delta),
        displayed.length - 1,
      );
      onHighlightChange(newIndex);
    },
    [displayed.length, onHighlightChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (displayed.length === 0) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const newIndex = Math.min(
          Math.max(0, indexRef.current + delta),
          displayed.length - 1,
        );
        onHighlightChange(newIndex);
      }
    },
    [displayed.length, onHighlightChange],
  );

  // 滚轮监听
  useEffect(() => {
    if (!visible) return;
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [visible, handleWheel, handleKeyDown]);

  // 可见时锁定 body 滚动
  useEffect(() => {
    if (visible) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [visible]);

  if (!visible || displayed.length === 0) return null;

  return (
    <div className="quick-selector-overlay">
      <div className="quick-selector-panel" ref={listRef}>
        {displayed.map((entry, i) => {
          const p = getQuickPreview(entry);
          const isActive = i === highlightIndex;

          return (
            <div
              key={entry.id}
              className={`quick-selector-item ${isActive ? "active" : ""}`}
            >
              <span className="quick-selector-icon">{p.icon}</span>
              <span className="quick-selector-text">{p.text}</span>
              {p.tags.length > 0 && (
                <span className="quick-selector-tags">
                  {p.tags.map((t) => (
                    <Tag key={t} color={tagColor(t)}>
                      {t}
                    </Tag>
                  ))}
                </span>
              )}
            </div>
          );
        })}
        <div className="quick-selector-hint">
          滚轮 / ↑↓ 切换 · 松开快捷键复制
        </div>
      </div>
    </div>
  );
}

export default QuickSelector;
