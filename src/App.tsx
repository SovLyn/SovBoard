import { useState, useEffect, useCallback, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
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
import type { UnlistenFn } from "@tauri-apps/api/event";
import ClipboardPage from "./components/ClipboardPage";
import SettingsPage from "./components/SettingsPage";
import "./App.css";

// ========== 类型定义 ==========

export interface ClipEntry {
  id: number;
  timestamp: number;
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

type Tab = "clipboard" | "settings";
type ThemeMode = "light" | "dark" | "system";

const TABS: { id: Tab; label: string }[] = [
  { id: "clipboard", label: "剪贴板" },
  { id: "settings", label: "设置" },
];

const SETTINGS_STORE = "settings.json";
const CLIPBOARD_STORE = "clipboard.json";
const THEME_MODE_KEY = "themeMode";
const LEGACY_DARK_MODE_KEY = "darkMode";
const MAX_CLIP_ENTRIES_KEY = "maxClipEntries";
const CLIPBOARD_DATA_KEY = "clipboardData";
const DEFAULT_MAX_ENTRIES = 32;

// ========== 工具函数 ==========

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "system") return systemPrefersDark();
  return mode === "dark";
}

function applyTheme(dark: boolean) {
  const root = document.documentElement;
  if (dark) {
    root.classList.add("theme-dark");
    root.classList.remove("theme-light");
  } else {
    root.classList.add("theme-light");
    root.classList.remove("theme-dark");
  }
}

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
  const [activeTab, setActiveTab] = useState<Tab>("clipboard");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [themeReady, setThemeReady] = useState(false);

  // 剪贴板状态
  const [clipEntries, setClipEntries] = useState<ClipEntry[]>([]);
  const [maxEntries, setMaxEntries] = useState(DEFAULT_MAX_ENTRIES);
  const [clipReady, setClipReady] = useState(false);

  // refs
  const skipNextChangeRef = useRef(false);
  const nextIdRef = useRef(1);
  const maxEntriesRef = useRef(DEFAULT_MAX_ENTRIES);
  const listeningStartedRef = useRef(false);

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

      // 从 settings store 读取 maxEntries（优先级更高）
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
              return [entry, ...prev].slice(0, maxEntriesRef.current);
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
      } else if (entry.html) {
        const stripped = entry.html.replace(/<[^>]*>/g, "");
        await writeHTML(stripped, entry.html);
      } else if (entry.image) {
        await writeImage(entry.image.path);
      } else if (entry.files) {
        await writeFiles(entry.files);
      }
    } catch (err) {
      skipNextChangeRef.current = false;
      console.error("复制到剪贴板失败:", err);
    }
  }, []);

  const handleDelete = useCallback(async (id: number) => {
    setClipEntries((prev) => prev.filter((e) => e.id !== id));
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
    setClipEntries((prev) => prev.slice(0, clamped));
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
            onClear={handleClear}
          />
        )}
        {activeTab === "settings" && (
          <SettingsPage
            themeMode={themeMode}
            onSetThemeMode={setThemeModePersist}
            maxClipEntries={maxEntries}
            onSetMaxClipEntries={handleSetMaxEntries}
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