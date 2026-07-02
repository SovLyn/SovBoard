import { useState, useEffect, useRef, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tag } from "antd";
import type { ClipEntry } from "../App";
import { tagColor, getQuickPreview } from "../utils/clipboardPreview";
import "../App.css";

// ========== 常量 ==========

const CLIPBOARD_STORE = "clipboard.json";
const CLIPBOARD_DATA_KEY = "clipboardData";

interface ClipboardStore {
  entries: ClipEntry[];
  maxEntries: number;
  nextId: number;
}

// ========== 组件 ==========

function QuickSelectorApp() {
  const [entries, setEntries] = useState<ClipEntry[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const highlightIndexRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    highlightIndexRef.current = highlightIndex;
  }, [highlightIndex]);

  // 高亮项变化时自动滚动到可见区域
  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-index="${highlightIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex]);

  const fetchFromStore = useCallback(async () => {
    try {
      const store = await load(CLIPBOARD_STORE, {
        autoSave: false,
        defaults: {},
      });
      const data = await store.get<ClipboardStore>(CLIPBOARD_DATA_KEY);
      const list = data?.entries ?? [];
      setEntries(list);
      setHighlightIndex(0);
    } catch (err) {
      console.error("[QS-App] 从 store 读取失败:", err);
    }
  }, []);

  useEffect(() => {
    fetchFromStore();
  }, [fetchFromStore]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      try {
        unlisten = await listen("quick-selector:entries-updated", () => {
          fetchFromStore();
        });
      } catch (err) {
        console.error("[QS-App] 监听 entries-updated 失败:", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [fetchFromStore]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      try {
        unlisten = await listen("quick-selector:close", () => {
          const idx = highlightIndexRef.current;
          emit("quick-selector:result", idx).catch((e) =>
            console.error("[QS-App] emit result 失败:", e),
          );
          getCurrentWindow().close().catch(() => {});
        });
      } catch (err) {
        console.error("[QS-App] 监听 quick-selector:close 失败:", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      if (entries.length === 0) return;
      const delta = e.deltaY > 0 ? 1 : -1;
      const newIdx = Math.min(
        Math.max(0, highlightIndexRef.current + delta),
        entries.length - 1,
      );
      setHighlightIndex(newIdx);
    },
    [entries.length],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        emit("quick-selector:result", highlightIndexRef.current).catch(() => {});
        getCurrentWindow().close().catch(() => {});
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (entries.length === 0) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const newIdx = Math.min(
          Math.max(0, highlightIndexRef.current + delta),
          entries.length - 1,
        );
        setHighlightIndex(newIdx);
      }
    },
    [entries.length],
  );

  useEffect(() => {
    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [handleWheel, handleKeyDown]);

  return (
    <div className="quick-selector-window" ref={listRef}>
      {entries.length === 0 ? (
        <div className="quick-selector-hint">没有剪贴板条目</div>
      ) : (
        entries.map((entry, i) => {
          const p = getQuickPreview(entry);
          const isActive = i === highlightIndex;
          return (
            <div
              key={entry.id}
              data-index={i}
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
        })
      )}
      <div className="quick-selector-hint">
        滚轮 / ↑↓ 切换 · 松开快捷键复制 · Esc 关闭
      </div>
    </div>
  );
}

export default QuickSelectorApp;
