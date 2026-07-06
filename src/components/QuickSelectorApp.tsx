import { useState, useEffect, useRef, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tag, BorderBeam } from "antd";
import type { ClipEntry } from "../App";
import { tagColor, getQuickPreview, BEAM_COLORS } from "../utils/clipboardPreview";
import { type ThemeMode, resolveIsDark, applyTheme } from "../utils/theme";
import "../App.css";

// ========== 常量 ==========

const SETTINGS_STORE = "settings.json";
const THEME_MODE_KEY = "themeMode";
const LEGACY_DARK_MODE_KEY = "darkMode";
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
      // 收藏项置顶
      const sorted = [...list].sort(
        (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0),
      );
      setEntries(sorted);
      setHighlightIndex(0);
    } catch (err) {
      console.error("[QS-App] 从 store 读取失败:", err);
    }
  }, []);

  // 切换收藏
  const handleToggleFavorite = useCallback(
    async (id: number) => {
      try {
        const store = await load(CLIPBOARD_STORE, {
          autoSave: false,
          defaults: {},
        });
        const data = await store.get<ClipboardStore>(CLIPBOARD_DATA_KEY);
        if (!data) return;
        const updated = data.entries.map((e) =>
          e.id === id ? { ...e, favorite: !e.favorite } : e,
        );
        await store.set(CLIPBOARD_DATA_KEY, { ...data, entries: updated });
        await store.save();
        // 通知主窗口同步
        emit("quick-selector:favorite-changed", null).catch(() => {});
        // 刷新本窗口列表
        await fetchFromStore();
      } catch (err) {
        console.error("[QS-App] 切换收藏失败:", err);
      }
    },
    [fetchFromStore],
  );

  useEffect(() => {
    fetchFromStore();
  }, [fetchFromStore]);

  // ---- 主题同步 ----
  const fetchTheme = useCallback(async () => {
    try {
      const store = await load(SETTINGS_STORE, {
        autoSave: false,
        defaults: {},
      });
      let mode: ThemeMode = "light";
      const saved = await store.get<string>(THEME_MODE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") {
        mode = saved;
      } else {
        const legacy = await store.get<boolean>(LEGACY_DARK_MODE_KEY);
        mode = legacy ? "dark" : "light";
      }
      applyTheme(resolveIsDark(mode));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      try {
        unlisten = await listen("quick-selector:entries-updated", () => {
          fetchTheme();
          fetchFromStore();
        });
      } catch (err) {
        console.error("[QS-App] 监听 entries-updated 失败:", err);
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [fetchFromStore, fetchTheme]);

  // 挂载时读取主题
  useEffect(() => {
    fetchTheme();
  }, [fetchTheme]);

  // 系统主题变化监听
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      fetchTheme();
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [fetchTheme]);

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

          const itemClass = `quick-selector-item ${isActive ? "active" : ""}`;

          const body = (
            <>
              <button
                className="quick-selector-favorite"
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleFavorite(entry.id);
                }}
                title={entry.favorite ? "取消收藏" : "收藏"}
              >
                {entry.favorite ? "⭐" : "☆"}
              </button>
              {entry.image && (
                <img
                  src={convertFileSrc(entry.image.path)}
                  alt=""
                  className="quick-selector-thumb"
                  style={{ height: 24, width: "auto", borderRadius: 2, flexShrink: 0 }}
                />
              )}
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
            </>
          );

          return entry.favorite ? (
            <BorderBeam key={entry.id} color={BEAM_COLORS}>
              <div data-index={i} className={itemClass}>
                {body}
              </div>
            </BorderBeam>
          ) : (
            <div key={entry.id} data-index={i} className={itemClass}>
              {body}
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
