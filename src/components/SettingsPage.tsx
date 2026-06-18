import { InputNumber } from "antd";

type ThemeMode = "light" | "dark" | "system";

interface SettingsPageProps {
  themeMode: ThemeMode;
  onSetThemeMode: (mode: ThemeMode) => void;
  maxClipEntries: number;
  onSetMaxClipEntries: (max: number) => void;
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
    </div>
  );
}

export default SettingsPage;
