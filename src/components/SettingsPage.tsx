import { InputNumber, Input, Radio } from "antd";
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
      <div className="setting-item">
        <span className="setting-label">主题</span>
        <Radio.Group
          value={themeMode}
          onChange={(e) => onSetThemeMode(e.target.value)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="light">亮色</Radio.Button>
          <Radio.Button value="dark">暗色</Radio.Button>
          <Radio.Button value="system">遵循系统</Radio.Button>
        </Radio.Group>
      </div>

      <div className="setting-item">
        <span className="setting-label">最大保存条数</span>
        <InputNumber
          variant="filled"
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
          variant="filled"
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
