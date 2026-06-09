import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import HomePage from "./components/HomePage";
import SettingsPage from "./components/SettingsPage";
import "./App.css";

type Tab = "home" | "settings";
type ThemeMode = "light" | "dark" | "system";

const TABS: { id: Tab; label: string }[] = [
  { id: "home", label: "主页" },
  { id: "settings", label: "设置" },
];

const STORE_PATH = "settings.json";
const THEME_MODE_KEY = "themeMode";
const LEGACY_DARK_MODE_KEY = "darkMode";

/** 解析系统当前是否为暗色 */
function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 根据 ThemeMode 计算出实际是否暗色 */
function resolveIsDark(mode: ThemeMode): boolean {
  if (mode === "system") return systemPrefersDark();
  return mode === "dark";
}

/** 将暗黑模式应用到 DOM（class 切换） */
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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [themeReady, setThemeReady] = useState(false);

  // 启动时加载主题设置（直接应用避免闪烁）
  useEffect(() => {
    async function init() {
      let mode: ThemeMode = "light";
      try {
        const store = await load(STORE_PATH, { autoSave: false });
        const saved = await store.get<string>(THEME_MODE_KEY);
        if (saved === "light" || saved === "dark" || saved === "system") {
          mode = saved;
        } else {
          // 兼容旧版 darkMode (boolean)
          const legacy = await store.get<boolean>(LEGACY_DARK_MODE_KEY);
          mode = legacy ? "dark" : "light";
        }
      } catch {
        mode = "light";
      }
      // 在 state 更新之前直接应用，避免亮→暗闪烁
      applyTheme(resolveIsDark(mode));
      setThemeMode(mode);
      setThemeReady(true);
    }
    init();
  }, []);

  // themeMode 变化时立即应用主题（处理亮色/暗色/系统 的切换）
  useEffect(() => {
    if (!themeReady) return;
    applyTheme(resolveIsDark(themeMode));
  }, [themeMode, themeReady]);

  // 当 mode 为 "system" 时，监听系统主题变化并立即应用
  useEffect(() => {
    if (themeMode !== "system") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    applyTheme(mq.matches);

    const handler = (e: MediaQueryListEvent) => {
      applyTheme(e.matches);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [themeMode]);

  // 设置主题模式并持久化
  const setThemeModePersist = useCallback(async (next: ThemeMode) => {
    setThemeMode(next);

    try {
      const store = await load(STORE_PATH, { autoSave: false });
      await store.set(THEME_MODE_KEY, next);
      await store.save();
    } catch (err) {
      console.error("保存设置失败:", err);
    }
  }, []);

  return (
    <div className="app-container">
      <main className="tab-content">
        {activeTab === "home" && <HomePage />}
        {activeTab === "settings" && (
          <SettingsPage
            themeMode={themeMode}
            onSetThemeMode={setThemeModePersist}
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
