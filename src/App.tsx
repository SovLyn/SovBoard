import { useState, useEffect, useCallback, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { type ThemeMode, resolveIsDark, applyTheme } from "./utils/theme";
import { App as AntdApp } from "antd";
import { invoke } from "@tauri-apps/api/core";
import {
  startListening, onClipboardChange, writeText, writeHTML,
  writeImage, writeFiles, getDefaultSaveImagePath,
  type ReadClipboard,
} from "tauri-plugin-clipboard-x-api";
import { register, unregister, type ShortcutEvent } from "@tauri-apps/plugin-global-shortcut";
import { listen, emit, type UnlistenFn } from "@tauri-apps/api/event";
import { downloadDir } from "@tauri-apps/api/path";
import ClipboardPage from "./components/ClipboardPage";
import FileSharePage from "./components/FileSharePage";
import DownloadPage from "./components/DownloadPage";
import SettingsPage from "./components/SettingsPage";
import "./App.css";

// ========== 类型 ==========

export interface ClipEntry {
  id: number; timestamp: number; favorite?: boolean;
  text?: string; html?: string; rtf?: string;
  image?: { path: string; width: number; height: number };
  files?: string[];
}

interface ClipboardStore { entries: ClipEntry[]; maxEntries: number; nextId: number; }
interface CleanupResult { removed_files: string[]; stale_entry_ids: number[]; errors: string[]; }

export interface DownloadState {
  hash: string;
  status: "downloading" | "done" | "error";
  fileName?: string;
  filePath?: string;
  received?: number;
  total?: number;
  error?: string;
  /** 对等节点的 PeerId（用于展示设备名称） */
  targetPeerId?: string;
}

type Tab = "clipboard" | "fileshare" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "clipboard", label: "剪贴板" },
  { id: "fileshare", label: "文件分享" },
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
const DOWNLOAD_DIR_KEY = "downloadDir";
const DEFAULT_SHORTCUT = "Ctrl+Alt+Q";
const DEFAULT_MAX_ENTRIES = 32;
const DEFAULT_CLEANUP_INTERVAL = 60;

// ========== 工具 ==========

function isSameEntry(a: ClipEntry, b: ClipEntry): boolean {
  if (a.text !== b.text) return false;
  if (a.html !== b.html) return false;
  if (a.rtf !== b.rtf) return false;
  if (a.image?.path !== b.image?.path) return false;
  const aF = a.files, bF = b.files;
  if (aF && bF) return aF.length === bF.length && aF.every((f, i) => f === bF[i]);
  return !aF === !bF;
}

function buildEntry(result: ReadClipboard, nextIdRef: React.MutableRefObject<number>): ClipEntry {
  const e: ClipEntry = { id: nextIdRef.current++, timestamp: Date.now(), favorite: false };
  if (result.text) e.text = result.text.value;
  if (result.html) e.html = result.html.value;
  if (result.rtf) e.rtf = result.rtf.value;
  if (result.image) e.image = { path: result.image.value, width: result.image.width, height: result.image.height };
  if (result.files) e.files = result.files.value;
  return e;
}

async function persistClipboard(entries: ClipEntry[], maxEntries: number, nextId: number) {
  try {
    const s = await load(CLIPBOARD_STORE, { autoSave: false, defaults: {} });
    await s.set(CLIPBOARD_DATA_KEY, { entries, maxEntries, nextId } satisfies ClipboardStore);
    await s.save();
  } catch (e) { console.error("持久化剪贴板失败:", e); }
}

// ========== App ==========

function App() {
  const { notification } = AntdApp.useApp();
  const [activeTab, setActiveTab] = useState<Tab>("clipboard");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [themeReady, setThemeReady] = useState(false);
  const [clipEntries, setClipEntries] = useState<ClipEntry[]>([]);
  const [maxEntries, setMaxEntries] = useState(DEFAULT_MAX_ENTRIES);
  const [clipReady, setClipReady] = useState(false);
  const [cleanupInterval, setCleanupInterval] = useState(DEFAULT_CLEANUP_INTERVAL);
  const [shortcut, setShortcut] = useState(DEFAULT_SHORTCUT);
  const [localPeerId, setLocalPeerId] = useState("");
  const [downloadDirState, setDownloadDirState] = useState("");
  const [download, setDownload] = useState<DownloadState | null>(null);

  const skipNextChangeRef = useRef(false);
  const nextIdRef = useRef(1);
  const maxEntriesRef = useRef(DEFAULT_MAX_ENTRIES);
  const listeningStartedRef = useRef(false);
  const cleanupTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipEntriesRef = useRef<ClipEntry[]>([]);

  useEffect(() => { clipEntriesRef.current = clipEntries; }, [clipEntries]);

  // ===== 主题 =====
  useEffect(() => {
    (async () => {
      let mode: ThemeMode = "light";
      try {
        const s = await load(SETTINGS_STORE, { autoSave: false, defaults: {} });
        const saved = await s.get<string>(THEME_MODE_KEY);
        if (saved === "light" || saved === "dark" || saved === "system") mode = saved;
        else { const legacy = await s.get<boolean>(LEGACY_DARK_MODE_KEY); mode = legacy ? "dark" : "light"; }
      } catch { mode = "light"; }
      applyTheme(resolveIsDark(mode)); setThemeMode(mode); setThemeReady(true);
    })();
  }, []);
  useEffect(() => { if (!themeReady) return; applyTheme(resolveIsDark(themeMode)); }, [themeMode, themeReady]);
  useEffect(() => {
    if (themeMode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(mq.matches);
    const h = (e: MediaQueryListEvent) => applyTheme(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [themeMode]);

  const setThemeModePersist = useCallback(async (next: ThemeMode) => {
    setThemeMode(next);
    try {
      const s = await load(SETTINGS_STORE, { autoSave: false, defaults: {} });
      await s.set(THEME_MODE_KEY, next); await s.save();
    } catch (e) { console.error(e); }
  }, []);

  // ===== 剪贴板 =====
  useEffect(() => {
    let unlisten: UnlistenFn | undefined; let cancelled = false;
    (async () => {
      let savedEntries: ClipEntry[] = []; let savedMax = DEFAULT_MAX_ENTRIES; let savedNextId = 1;
      try {
        const s = await load(CLIPBOARD_STORE, { autoSave: false, defaults: {} });
        const d = await s.get<ClipboardStore>(CLIPBOARD_DATA_KEY);
        if (d) { savedEntries = d.entries ?? []; savedMax = d.maxEntries ?? DEFAULT_MAX_ENTRIES; savedNextId = d.nextId ?? 1; }
      } catch {}
      try {
        const ss = await load(SETTINGS_STORE, { autoSave: false, defaults: {} });
        const m = await ss.get<number>(MAX_CLIP_ENTRIES_KEY);
        if (typeof m === "number") savedMax = Math.min(1024, Math.max(8, m));
        const ci = await ss.get<number>(CLEANUP_INTERVAL_KEY);
        if (typeof ci === "number") setCleanupInterval(Math.min(3600, Math.max(10, ci)));
        const sc = await ss.get<string>(SHORTCUT_KEY);
        if (typeof sc === "string" && sc.trim().length > 0) setShortcut(sc.trim());
        const dd = await ss.get<string>(DOWNLOAD_DIR_KEY);
        if (typeof dd === "string" && dd.trim().length > 0) setDownloadDirState(dd.trim());
        else { try { setDownloadDirState(await downloadDir()); } catch { setDownloadDirState(""); } }
      } catch {}
      if (cancelled) return;
      setClipEntries(savedEntries); setMaxEntries(savedMax); maxEntriesRef.current = savedMax;
      nextIdRef.current = savedNextId; setClipReady(true);
      if (listeningStartedRef.current) return;
      listeningStartedRef.current = true;
      try {
        const savePath = await getDefaultSaveImagePath();
        await startListening();
        unlisten = await onClipboardChange((result) => {
          if (skipNextChangeRef.current) { skipNextChangeRef.current = false; return; }
          if (!result || Object.keys(result).length === 0) return;
          const entry = buildEntry(result, nextIdRef);
          setClipEntries((prev) => {
            if (prev[0] && isSameEntry(prev[0], entry)) { nextIdRef.current = Math.min(nextIdRef.current - 1, nextIdRef.current); return prev; }
            const comb = [entry, ...prev];
            const favs = comb.filter((e) => e.favorite);
            const non = comb.filter((e) => !e.favorite);
            return [...favs, ...non.slice(0, Math.max(0, maxEntriesRef.current - favs.length))];
          });
        }, { saveImagePath: savePath });
      } catch (e) { console.error("剪贴板监听失败:", e); }
    })();
    return () => { cancelled = true; unlisten?.(); listeningStartedRef.current = false; };
  }, []);
  useEffect(() => { if (!clipReady) return; persistClipboard(clipEntries, maxEntries, nextIdRef.current); }, [clipEntries, clipReady]);

  // ===== 清理 =====
  const runCleanup = useCallback(async () => {
    const entries = clipEntriesRef.current;
    const imgs = entries.filter((e): e is ClipEntry & { image: NonNullable<ClipEntry["image"]> } => !!e.image)
      .map((e) => ({ id: e.id, path: e.image.path }));
    if (imgs.length === 0) return;
    try {
      const r = await invoke<CleanupResult>("cleanup_orphan_images", { entries: imgs });
      if (r.stale_entry_ids.length > 0) {
        const set = new Set(r.stale_entry_ids);
        setClipEntries((prev) => prev.filter((e) => !set.has(e.id)));
      }
    } catch (e) { console.error("清理失败:", e); }
  }, []);
  useEffect(() => {
    if (!clipReady) return; runCleanup();
    cleanupTimerRef.current = setInterval(runCleanup, cleanupInterval * 1000);
    return () => { if (cleanupTimerRef.current) clearInterval(cleanupTimerRef.current); };
  }, [cleanupInterval, clipReady, runCleanup]);

  // ===== 剪贴板操作 =====
  const handleCopy = useCallback(async (entry: ClipEntry) => {
    skipNextChangeRef.current = true;
    try {
      if (entry.text) { if (entry.html) await writeHTML(entry.text, entry.html); else await writeText(entry.text); }
      else if (entry.image) await writeImage(entry.image.path);
      else if (entry.html) await writeHTML(entry.html.replace(/<[^>]*>/g, ""), entry.html);
      else if (entry.files) await writeFiles(entry.files);
    } catch (e) { skipNextChangeRef.current = false; console.error(e); }
  }, []);
  const handleDelete = useCallback(async (id: number) => {
    setClipEntries((prev) => prev.find((e) => e.id === id)?.favorite ? prev : prev.filter((e) => e.id !== id));
  }, []);
  const handleToggleFavorite = useCallback(async (id: number) => {
    setClipEntries((prev) => prev.map((e) => e.id === id ? { ...e, favorite: !e.favorite } : e));
    emit("quick-selector:entries-updated", null).catch(() => {});
  }, []);
  const handleClear = useCallback(async () => { setClipEntries([]); }, []);
  const handleSetMaxEntries = useCallback(async (max: number) => {
    const c = Math.min(1024, Math.max(8, max)); setMaxEntries(c); maxEntriesRef.current = c;
    try { const s = await load(SETTINGS_STORE, { autoSave: false, defaults: {} }); await s.set(MAX_CLIP_ENTRIES_KEY, c); await s.save(); } catch {}
    setClipEntries((prev) => { const favs = prev.filter((e) => e.favorite); const non = prev.filter((e) => !e.favorite); return [...favs, ...non.slice(0, Math.max(0, c - favs.length))]; });
  }, []);
  const handleSetCleanupInterval = useCallback(async (sec: number) => {
    const c = Math.min(3600, Math.max(10, sec)); setCleanupInterval(c);
    try { const s = await load(SETTINGS_STORE, { autoSave: false, defaults: {} }); await s.set(CLEANUP_INTERVAL_KEY, c); await s.save(); } catch {}
  }, []);
  const handleSetShortcut = useCallback(async (sc: string) => {
    const t = sc.trim(); if (!t) return; setShortcut(t);
    try { const s = await load(SETTINGS_STORE, { autoSave: false, defaults: {} }); await s.set(SHORTCUT_KEY, t); await s.save(); } catch {}
  }, []);
  const handleSetDownloadDir = useCallback(async (d: string) => {
    const t = d.trim(); if (!t) return; setDownloadDirState(t);
    try { const s = await load(SETTINGS_STORE, { autoSave: false, defaults: {} }); await s.set(DOWNLOAD_DIR_KEY, t); await s.save(); } catch {}
  }, []);

  // ===== 全局快捷键 =====
  useEffect(() => {
    if (!clipReady || !shortcut) return; const cur = shortcut;
    (async () => {
      try {
        await register(cur, (e: ShortcutEvent) => {
          if (e.state === "Pressed") invoke("show_quick_selector", { entriesJson: JSON.stringify(clipEntriesRef.current) }).catch(() => {});
          else if (e.state === "Released") invoke("hide_quick_selector").catch(() => {});
        });
      } catch (e) { notification.error({ title: "快捷键注册失败", description: `${cur} 已被占用。${e}`, placement: "bottomRight" }); }
    })();
    return () => { unregister(cur).catch(() => {}); };
  }, [shortcut, clipReady]);

  // ===== QuickSelector 事件 =====
  useEffect(() => {
    let ul: UnlistenFn | undefined;
    (async () => {
      try { ul = await listen("quick-selector:favorite-changed", async () => {
        try { const s = await load(CLIPBOARD_STORE, { autoSave: false, defaults: {} }); const d = await s.get<ClipboardStore>(CLIPBOARD_DATA_KEY); if (d) { setClipEntries(d.entries); nextIdRef.current = d.nextId; } } catch {}
      }); } catch {}
    })();
    return () => { ul?.(); };
  }, []);
  useEffect(() => {
    let ul: UnlistenFn | undefined;
    (async () => {
      try { ul = await listen<number>("quick-selector:result", (e) => {
        const idx = e.payload; const entries = clipEntriesRef.current;
        if (idx >= 0 && idx < entries.length) {
          const entry = entries[idx]; skipNextChangeRef.current = true;
          (async () => {
            try {
              if (entry.text) { if (entry.html) await writeHTML(entry.text, entry.html); else await writeText(entry.text); }
              else if (entry.image) await writeImage(entry.image.path);
              else if (entry.html) await writeHTML(entry.html.replace(/<[^>]*>/g, ""), entry.html);
              else if (entry.files) await writeFiles(entry.files);
            } catch { skipNextChangeRef.current = false; }
          })();
        }
      }); } catch {}
    })();
    return () => { ul?.(); };
  }, []);

  // ===== 本机 PeerId =====
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval>;
    const fetch = async () => {
      try {
        const pid = await invoke<string>("get_local_peer_id");
        if (!cancelled && pid) { setLocalPeerId(pid); clearInterval(timer); }
      } catch {}
    };
    fetch();
    timer = setInterval(fetch, 1500);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  // ===== 下载事件监听 =====
  useEffect(() => {
    const handles: UnlistenFn[] = [];
    (async () => {
      handles.push(await listen<any>("download:progress", (e) => {
        const p = e.payload;
        setDownload({
          hash: p.hash, status: "downloading",
          fileName: p.file_name, filePath: p.file_path,
          received: p.received, total: p.total,
          targetPeerId: p.target_peer_id,
        });
      }));
      handles.push(await listen<any>("download:done", (e) => {
        const p = e.payload;
        setDownload({
          hash: p.hash, status: "done",
          fileName: p.file_name, filePath: p.file_path,
          received: p.size, total: p.size,
          targetPeerId: p.target_peer_id,
        });
      }));
      handles.push(await listen<any>("download:error", (e) => {
        const p = e.payload;
        setDownload({ hash: p.hash, status: "error", error: p.error, targetPeerId: p.target_peer_id });
      }));
    })();
    return () => { handles.forEach((h) => h()); };
  }, []);

  // ===== 哈希查找下载 =====
  const handleStartDownload = useCallback(async (hash: string) => {
    if (!downloadDirState) {
      notification.error({ message: "请先在设置中配置下载路径", placement: "bottomRight" });
      return;
    }
    try {
      await invoke("request_file", { hash, saveDir: downloadDirState });
      setDownload({ hash, status: "downloading" });
    } catch (e) {
      notification.error({ message: `请求失败: ${e}`, placement: "bottomRight" });
    }
  }, [downloadDirState, notification]);

  // ===== 取消下载 =====
  const handleCancelDownload = useCallback(async (hash: string) => {
    try {
      await invoke("cancel_download", { hash });
    } catch (e) {
      notification.error({ message: `取消失败: ${e}`, placement: "bottomRight" });
    }
  }, [notification]);

  // ===== 渲染 =====

  return (
    <div className="app-container">
      <main className="tab-content">
        {download && activeTab !== "settings" ? (
          <DownloadPage
            download={download}
            onBack={() => setDownload(null)}
            onCancel={() => handleCancelDownload(download.hash)}
          />
        ) : (
          <>
            <div style={{ display: activeTab === "clipboard" ? undefined : "none" }}>
              {clipReady && (
                <ClipboardPage entries={clipEntries} onCopy={handleCopy} onDelete={handleDelete}
                  onToggleFavorite={handleToggleFavorite} onClear={handleClear} />
              )}
            </div>
            <div style={{ display: activeTab === "fileshare" ? undefined : "none" }}>
              <FileSharePage downloadDir={downloadDirState} onStartDownload={handleStartDownload} />
            </div>
            <div style={{ display: activeTab === "settings" ? undefined : "none" }}>
              <SettingsPage themeMode={themeMode} onSetThemeMode={setThemeModePersist}
                maxClipEntries={maxEntries} onSetMaxClipEntries={handleSetMaxEntries}
                cleanupInterval={cleanupInterval} onSetCleanupInterval={handleSetCleanupInterval}
                shortcut={shortcut} onSetShortcut={handleSetShortcut}
                localPeerId={localPeerId}
                downloadDir={downloadDirState} onSetDownloadDir={handleSetDownloadDir}
                ready={themeReady} />
            </div>
          </>
        )}
      </main>
      <nav className="tab-bar">
        {TABS.map((tab) => (
          <button key={tab.id} className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => { setActiveTab(tab.id); }}>
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
