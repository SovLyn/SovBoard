import { InputNumber, Input } from "antd";
import type { ThemeMode } from "../utils/theme";

interface SettingsPageProps {
  themeMode: ThemeMode;
  onSetThemeMode: (mode: ThemeMode) => void;
  maxClipEntries: number;
  onSetMaxClipEntries: (max: number) => void;
  cleanupInterval: number;
  onSetCleanupInterval: (seconds: number) => void;
  shortcut: string;
  onSetShortcut: (shortcut: string) => void;
  ready: boolean;
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "亮色" },
  { value: "dark", label: "暗色" },
  { value: "system", label: "遵循系统" },
];

function SettingsPage({
  themeMode,
  onSetThemeMode,
  maxClipEntries,
  onSetMaxClipEntries,
  cleanupInterval,
  onSetCleanupInterval,
  shortcut,
  onSetShortcut,
  ready,
}: SettingsPageProps) {
  if (!ready) {
    return <div className="page settings-page">加载中...</div>;
  }

  return (
    <div className="page settings-page">
      <h2>设置</h2>

      <div className="setting-item">
        <span className="setting-label">主题</span>
        <div className="theme-options">
          {THEME_OPTIONS.map((opt) => (
            <label key={opt.value} className="radio-label">
              <input
                type="radio"
                name="themeMode"
                value={opt.value}
                checked={themeMode === opt.value}
                onChange={() => onSetThemeMode(opt.value)}
              />
              <span className="radio-indicator" />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      <div className="setting-item">
        <span className="setting-label">最大保存条数</span>
        <InputNumber
          min={8}
          max={1024}
          step={8}
          value={maxClipEntries}
          onChange={(v) => v !== null && onSetMaxClipEntries(v)}
          style={{ width: 120 }}
        />
      </div>

      <div className="setting-item">
        <span className="setting-label">清理间隔（秒）</span>
        <InputNumber
          min={10}
          max={3600}
          step={10}
          value={cleanupInterval}
          onChange={(v) => v !== null && onSetCleanupInterval(v)}
          style={{ width: 120 }}
        />
      </div>

      <div className="setting-item">
        <span className="setting-label">全局快捷键</span>
        <Input
          value={shortcut}
          onChange={(e) => onSetShortcut(e.target.value)}
          placeholder="例如 Ctrl+Alt+Q"
          style={{ width: 220 }}
        />
      </div>
    </div>
  );
}

export default SettingsPage;