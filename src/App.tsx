import { useState, useEffect, useCallback, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { type ThemeMode, resolveIsDark, applyTheme } from "./utils/theme";
import { App as AntdApp } from "antd";
import { invoke } from "@tauri-apps/api/core";
import {
  startListening,
  onClipboardChange,
  writeText,
  writeHTML,
  writeImage,
  writeFiles,
  getDefaultSaveImagePath,
  type ReadClipboard,
} from "tauri-plugin-clipboard-x-api";
import {
  register,
  unregister,
  type ShortcutEvent,
} from "@tauri-apps/plugin-global-shortcut";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import ClipboardPage from "./components/ClipboardPage";
import SettingsPage from "./components/SettingsPage";
import "./App.css";

// ========== 类型定义 ==========

export interface ClipEntry {
  id: number;
  timestamp: number;
  favorite?: boolean;
  text?: string;
  html?: string;
  rtf?: string;
  image?: { path: string; width: number; height: number };
  files?: string[];
}

interface ClipboardStore {
  entries: ClipEntry[];
  maxEntries: number;
  nextId: number;
}

/** Rust 清理命令返回结果 */
interface CleanupResult {
  removed_files: string[];
  stale_entry_ids: number[];
  errors: string[];
}

type Tab = "clipboard" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "clipboard", label: "剪贴板" },
  { id: "settings", label: "设置" },
];

const SETTINGS_STORE = "settings.json";
const CLIPBOARD_STORE = "clipboard.json";
const THEME_MODE_KEY = "themeMode";
const LEGACY_DARK_MODE_KEY = "darkMode";
const MAX_CLIP_ENTRIES_KEY = "maxClipEntries";
const CLEANUP_INTERVAL_KEY = "cleanupInterval";
const CLIPBOARD_DATA_KEY = "clipboardData";
const SHORTCUT_KEY = "globalShortcut";
const DEFAULT_SHORTCUT = "Ctrl+Alt+Q";
const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_CLEANUP_INTERVAL = 60;

// ========== 工具函数 ==========

function isSameEntry(a: ClipEntry, b: ClipEntry): boolean {
  if (a.text !== b.text) return false;
  if (a.html !== b.html) return false;
  if (a.rtf !== b.rtf) return false;
  if (a.image?.path !== b.image?.path) return false;

  const aFiles = a.files;
  const bFiles = b.files;
  if (aFiles && bFiles) {
    if (aFiles.length !== bFiles.length) return false;
    return aFiles.every((f, i) => f === bFiles[i]);
  }
  if ((aFiles && !bFiles) || (!aFiles && bFiles)) return false;
  return true;
}

function buildEntry(
  result: ReadClipboard,
  nextIdRef: React.MutableRefObject<number>,
): ClipEntry {
  const entry: ClipEntry = {
    id: nextIdRef.current++,
    timestamp: Date.now(),
    favorite: false,
  };
  if (result.text) entry.text = result.text.value;
  if (result.html) entry.html = result.html.value;
  if (result.rtf) entry.rtf = result.rtf.value;
  if (result.image) {
    entry.image = {
      path: result.image.value,
      width: result.image.width,
      height: result.image.height,
    };
  }
  if (result.files) entry.files = result.files.value;
  return entry;
}

async function persistClipboard(
  entries: ClipEntry[],
  maxEntries: number,
  nextId: number,
) {
  try {
    const store = await load(CLIPBOARD_STORE, {
      autoSave: false,
      defaults: {},
    });
    await store.set(CLIPBOARD_DATA_KEY, {
      entries,
      maxEntries,
      nextId,
    } satisfies ClipboardStore);
    await store.save();
  } catch (err) {
    console.error("持久化剪贴板失败:", err);
  }
}

// ========== App 组件 ==========

function App() {
  const { notification } = AntdApp.useApp();
  const [activeTab, setActiveTab] = useState<Tab>("clipboard");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [themeReady, setThemeReady] = useState(false);

  // 剪贴板状态
  const [clipEntries, setClipEntries] = useState<ClipEntry[]>([]);
  const [maxEntries, setMaxEntries] = useState(DEFAULT_MAX_ENTRIES);
  const [clipReady, setClipReady] = useState(false);

  // 清理间隔（秒）
  const [cleanupInterval, setCleanupInterval] = useState(DEFAULT_CLEANUP_INTERVAL);

  // 全局快捷键
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);

  // refs
  const skipNextChangeRef = useRef(false);
  const nextIdRef = useRef(1);
  const maxEntriesRef = useRef(DEFAULT_MAX_ENTRIES);
  const listeningStartedRef = useRef(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipEntriesRef = useRef<ClipEntry[]>([]);

  // 同步最新的 clipEntries 到 ref（供定时器回调使用，避免重建定时器）
  useEffect(() => {
    clipEntriesRef.current = clipEntries;
  }, [clipEntries]);

  // ===== 主题初始化 =====
  useEffect(() => {
    async function init() {
      let mode: ThemeMode = "light";
      try {
        const store = await load(SETTINGS_STORE, {
          autoSave: false,
          defaults: {},
        });
        const saved = await store.get<string>(THEME_MODE_KEY);
        if (saved === "light" || saved === "dark" || saved === "system") {
          mode = saved;
        } else {
          const legacy = await store.get<boolean>(LEGACY_DARK_MODE_KEY);
          mode = legacy ? "dark" : "light";
        }
      } catch {
        mode = "light";
      }
      applyTheme(resolveIsDark(mode));
      setThemeMode(mode);
      setThemeReady(true);
    }
    init();
  }, []);

  // 主题应用
  useEffect(() => {
    if (!themeReady) return;
    applyTheme(resolveIsDark(themeMode));
  }, [themeMode, themeReady]);

  // 系统主题监听
  useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(mq.matches);
    const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode]);

  const setThemeModePersist = useCallback(async (next: ThemeMode) => {
    setThemeMode(next);
    try {
      const store = await load(SETTINGS_STORE, {
        autoSave: false,
        defaults: {},
      });
      await store.set(THEME_MODE_KEY, next);
      await store.save();
    } catch (err) {
      console.error("保存设置失败:", err);
    }
  }, []);

  // ===== 剪贴板初始化 =====
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    async function initClipboard() {
      // 从 store 加载历史
      let savedEntries: ClipEntry[] = [];
      let savedMax = DEFAULT_MAX_ENTRIES;
      let savedNextId = 1;

      try {
        const store = await load(CLIPBOARD_STORE, {
          autoSave: false,
          defaults: {},
        });
        const data = await store.get<ClipboardStore>(CLIPBOARD_DATA_KEY);
        if (data) {
          savedEntries = data.entries ?? [];
          savedMax = data.maxEntries ?? DEFAULT_MAX_ENTRIES;
          savedNextId = data.nextId ?? 1;
        }
      } catch {
        // 首次使用
      }

      // 从 settings store 读取配置（maxEntries 和 cleanupInterval）
      try {
        const settingsStore = await load(SETTINGS_STORE, {
          autoSave: false,
          defaults: {},
        });
        const maxFromSettings =
          await settingsStore.get<number>(MAX_CLIP_ENTRIES_KEY);
        if (typeof maxFromSettings === "number") {
          savedMax = Math.min(1024, Math.max(8, maxFromSettings));
        }

        const savedInterval =
          await settingsStore.get<number>(CLEANUP_INTERVAL_KEY);
        if (typeof savedInterval === "number") {
          setCleanupInterval(Math.min(3600, Math.max(10, savedInterval)));
        }

        const savedShortcut =
          await settingsStore.get<string>(SHORTCUT_KEY);
        if (typeof savedShortcut === "string" && savedShortcut.trim().length > 0) {
          setShortcut(savedShortcut.trim());
        }
      } catch {
        // ignore
      }

      if (cancelled) return;

      setClipEntries(savedEntries);
      setMaxEntries(savedMax);
      maxEntriesRef.current = savedMax;
      nextIdRef.current = savedNextId;
      setClipReady(true);

      // 开始监听
      if (listeningStartedRef.current) return;
      listeningStartedRef.current = true;

      try {
        const saveImagePath = await getDefaultSaveImagePath();
        await startListening();

        unlisten = await onClipboardChange(
          (result) => {
            if (skipNextChangeRef.current) {
              skipNextChangeRef.current = false;
              return;
            }
            if (!result || Object.keys(result).length === 0) return;

            const entry = buildEntry(result, nextIdRef);

            setClipEntries((prev) => {
              const newest = prev[0];
              if (newest && isSameEntry(newest, entry)) {
                // 回退 ID
                nextIdRef.current = Math.min(
                  nextIdRef.current - 1,
                  nextIdRef.current,
                );
                return prev;
              }
              const combined = [entry, ...prev];
              const favs = combined.filter((e) => e.favorite);
              const nonFavs = combined.filter((e) => !e.favorite);
              const max = maxEntriesRef.current;
              const keepNonFavs = Math.max(0, max - favs.length);
              return [...favs, ...nonFavs.slice(0, keepNonFavs)];
            });
          },
          { saveImagePath },
        );
      } catch (err) {
        console.error("剪贴板监听启动失败:", err);
      }
    }

    initClipboard();

    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
        listeningStartedRef.current = false;
      }
    };
  }, []);

  // 持久化：entries 变化时自动保存
  useEffect(() => {
    if (!clipReady) return;
    persistClipboard(clipEntries, maxEntries, nextIdRef.current);
  }, [clipEntries, clipReady]);

  // ===== 清理孤儿图片 =====

  const runCleanup = useCallback(async () => {
    const entries = clipEntriesRef.current;
    const imageEntries = entries
      .filter((e): e is ClipEntry & { image: NonNullable<ClipEntry["image"]> } =>
        e.image !== undefined,
      )
      .map((e) => ({ id: e.id, path: e.image.path }));

    if (imageEntries.length === 0) return;

    try {
      const result = await invoke<CleanupResult>("cleanup_orphan_images", {
        entries: imageEntries,
      });

      // 删除前端"脏条目"（条目存在但图片文件已丢失）
      if (result.stale_entry_ids.length > 0) {
        const staleSet = new Set(result.stale_entry_ids);
        setClipEntries((prev) =>
          prev.filter((e) => !staleSet.has(e.id)),
        );
      }
    } catch (err) {
      console.error("清理孤儿图片失败:", err);
    }
  }, []);

  // 定时清理（间隔变化时：清除旧定时器 → 立即执行一次 → 启动新定时器）
  useEffect(() => {
    if (!clipReady) return;

    // 立即执行一次
    runCleanup();

    // 启动新定时器
    cleanupTimerRef.current = setInterval(() => {
      runCleanup();
    }, cleanupInterval * 1000);

    return () => {
      if (cleanupTimerRef.current !== null) {
        clearInterval(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    };
  }, [cleanupInterval, clipReady, runCleanup]);

  // ===== 剪贴板操作 =====

  const handleCopy = useCallback(async (entry: ClipEntry) => {
    skipNextChangeRef.current = true;
    try {
      if (entry.text) {
        if (entry.html) {
          await writeHTML(entry.text, entry.html);
        } else {
          await writeText(entry.text);
        }
      } else if (entry.image) {
        await writeImage(entry.image.path);
      } else if (entry.html) {
        const stripped = entry.html.replace(/<[^>]*>/g, "");
        await writeHTML(stripped, entry.html);
      } else if (entry.files) {
        await writeFiles(entry.files);
      }
    } catch (err) {
      skipNextChangeRef.current = false;
      console.error("复制到剪贴板失败:", err);
    }
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    // 收藏项不允许删除
    setClipEntries((prev) => {
      const entry = prev.find((e) => e.id === id);
      if (entry?.favorite) return prev;
      return prev.filter((e) => e.id !== id);
    });
  }, []);

  const handleToggleFavorite = useCallback(async (id: number) => {
    setClipEntries((prev) =>
      prev.map((e) =>
        e.id === id ? { ...e, favorite: !e.favorite } : e,
      ),
    );
    // 通知 QuickSelector 窗口同步
    emit("quick-selector:entries-updated", null).catch(() => {});
  }, []);

  const handleClear = useCallback(async () => {
    setClipEntries([]);
  }, []);

  const handleSetMaxEntries = useCallback(async (max: number) => {
    const clamped = Math.min(1024, Math.max(8, max));
    setMaxEntries(clamped);
    maxEntriesRef.current = clamped;

    // 持久化到 settings store
    try {
      const store = await load(SETTINGS_STORE, {
        autoSave: false,
        defaults: {},
      });
      await store.set(MAX_CLIP_ENTRIES_KEY, clamped);
      await store.save();
    } catch (err) {
      console.error("保存设置失败:", err);
    }

    // trim 现有条目
    setClipEntries((prev) => {
      const favs = prev.filter((e) => e.favorite);
      const nonFavs = prev.filter((e) => !e.favorite);
      const keepNonFavs = Math.max(0, clamped - favs.length);
      return [...favs, ...nonFavs.slice(0, keepNonFavs)];
    });
  }, []);

  const handleSetCleanupInterval = useCallback(async (seconds: number) => {
    const clamped = Math.min(3600, Math.max(10, seconds));
    setCleanupInterval(clamped);

    // 持久化到 settings store
    try {
      const store = await load(SETTINGS_STORE, {
        autoSave: false,
        defaults: {},
      });
      await store.set(CLEANUP_INTERVAL_KEY, clamped);
      await store.save();
    } catch (err) {
      console.error("保存清理间隔失败:", err);
    }
  }, []);

  const handleSetShortcut = useCallback(async (newShortcut: string) => {
    const trimmed = newShortcut.trim();
    if (trimmed.length === 0) return;
    setShortcut(trimmed);

    try {
      const store = await load(SETTINGS_STORE, {
        autoSave: false,
        defaults: {},
      });
      await store.set(SHORTCUT_KEY, trimmed);
      await store.save();
    } catch (err) {
      console.error("保存快捷键失败:", err);
    }
  }, []);

  // ===== 全局快捷键注册 =====
  useEffect(() => {
    if (!clipReady || shortcut.length === 0) return;

    const current = shortcut;

    async function setup() {
      try {
        await register(current, (event: ShortcutEvent) => {
          if (event.state === "Pressed") {
            const json = JSON.stringify(clipEntriesRef.current);
            invoke("show_quick_selector", { entriesJson: json }).catch((err) =>
              console.error("[快捷键] 打开 QuickSelector 窗口失败:", err),
            );
          } else if (event.state === "Released") {
            invoke("hide_quick_selector").catch((err) =>
              console.error("[快捷键] 关闭 QuickSelector 窗口失败:", err),
            );
          }
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : String(err);
        notification.error({
          title: "全局快捷键注册失败",
          description: `${current} 已被占用或不被系统支持。\n${message}`,
          placement: "bottomRight",
        });
      }
    }

    setup();

    return () => {
      unregister(current).catch(() => {});
    };
  }, [shortcut, clipReady]);

  // ===== QuickSelector 收藏同步监听 =====
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      try {
        unlisten = await listen("quick-selector:favorite-changed", async () => {
          // QuickSelector 修改了 store，从 store 重新加载
          try {
            const store = await load(CLIPBOARD_STORE, {
              autoSave: false,
              defaults: {},
            });
            const data = await store.get<ClipboardStore>(CLIPBOARD_DATA_KEY);
            if (data) {
              setClipEntries(data.entries);
              nextIdRef.current = data.nextId;
            }
          } catch (err) {
            console.error("从 store 同步收藏状态失败:", err);
          }
        });
      } catch (err) {
        console.error("监听 quick-selector:favorite-changed 失败:", err);
      }
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  // ===== QuickSelector 结果监听 =====
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    (async () => {
      try {
        unlisten = await listen<number>("quick-selector:result", (event) => {
          const idx = event.payload;
          const entries = clipEntriesRef.current;
          if (idx >= 0 && idx < entries.length) {
            const entry = entries[idx];
            skipNextChangeRef.current = true;
            (async () => {
              try {
                if (entry.text) {
                  if (entry.html) {
                    await writeHTML(entry.text, entry.html);
                  } else {
                    await writeText(entry.text);
                  }
                } else if (entry.image) {
                  await writeImage(entry.image.path);
                } else if (entry.html) {
                  const stripped = entry.html.replace(/<[^>]*>/g, "");
                  await writeHTML(stripped, entry.html);
                } else if (entry.files) {
                  await writeFiles(entry.files);
                }
              } catch (err) {
                skipNextChangeRef.current = false;
                console.error("快速选择器复制失败:", err);
              }
            })();
          }
        });
      } catch (err) {
        console.error("监听 quick-selector:result 失败:", err);
      }
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  // ===== 渲染 =====

  return (
    <div className="app-container">
      <main className="tab-content">
        {activeTab === "clipboard" && clipReady && (
          <ClipboardPage
            entries={clipEntries}
            onCopy={handleCopy}
            onDelete={handleDelete}
            onToggleFavorite={handleToggleFavorite}
            onClear={handleClear}
          />
        )}
        {activeTab === "settings" && (
          <SettingsPage
            themeMode={themeMode}
            onSetThemeMode={setThemeModePersist}
            maxClipEntries={maxEntries}
            onSetMaxClipEntries={handleSetMaxEntries}
            cleanupInterval={cleanupInterval}
            onSetCleanupInterval={handleSetCleanupInterval}
            shortcut={shortcut}
            onSetShortcut={handleSetShortcut}
            ready={themeReady}
          />
        )}
      </main>
      <nav className="tab-bar">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;