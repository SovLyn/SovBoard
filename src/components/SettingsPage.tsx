import { useState, useRef, useCallback } from "react";
import { InputNumber, Input, Radio, App } from "antd";
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

/** 修饰键排序权重 */
const MOD_ORDER: Record<string, number> = {
  Control: 0,
  Alt: 1,
  Shift: 2,
};

/** KeyboardEvent.key → 用户可读标签 */
function modToLabel(key: string): string {
  switch (key) {
    case "Control":
      return "Ctrl";
    case "Alt":
      return "Alt";
    case "Shift":
      return "Shift";
    default:
      return key;
  }
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
  const { notification } = App.useApp();

  // 捕捉状态
  const [capturing, setCapturing] = useState(false);
  const [capturedMods, setCapturedMods] = useState<string[]>([]);

  const inputRef = useRef<any>(null);

  /** 进入捕捉模式 */
  const handleFocus = useCallback(() => {
    setCapturing(true);
    setCapturedMods([]);
  }, []);

  /** 退出捕捉模式 */
  const handleBlur = useCallback(() => {
    setCapturing(false);
    setCapturedMods([]);
  }, []);

  /** 按键捕捉 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.preventDefault();
      const key = e.key;

      // Esc 取消捕捉
      if (key === "Escape") {
        setCapturing(false);
        setCapturedMods([]);
        inputRef.current?.blur();
        return;
      }

      // 从事件属性收集当前按下的修饰键
      const currentMods: string[] = [];
      if (e.ctrlKey) currentMods.push("Control");
      if (e.altKey) currentMods.push("Alt");
      if (e.shiftKey) currentMods.push("Shift");

      const isModKey =
        key === "Control" || key === "Alt" || key === "Shift";

      if (isModKey) {
        // 修饰键本身：更新显示
        setCapturedMods(currentMods);
        return;
      }

      // 非修饰键 — 必须是字母或数字
      const isAlphaNum = /^[a-zA-Z0-9]$/.test(key);
      if (!isAlphaNum) {
        notification.warning({
          message: "无效按键",
          description:
            "快捷键需由 Ctrl / Alt / Shift 加字母或数字键组成",
          placement: "bottomRight",
        });
        setCapturing(false);
        setCapturedMods([]);
        inputRef.current?.blur();
        return;
      }

      // 字母/数字键 — 必须至少有一个修饰键
      if (currentMods.length === 0) {
        notification.warning({
          message: "无效快捷键",
          description: "至少需要一个修饰键（Ctrl / Alt / Shift）",
          placement: "bottomRight",
        });
        setCapturing(false);
        setCapturedMods([]);
        inputRef.current?.blur();
        return;
      }

      // 构造快捷键字符串
      const sorted = [...currentMods].sort(
        (a, b) => (MOD_ORDER[a] ?? 99) - (MOD_ORDER[b] ?? 99),
      );
      const combined = [...sorted, key.toUpperCase()].map(modToLabel).join("+");
      onSetShortcut(combined);

      setCapturing(false);
      setCapturedMods([]);
      inputRef.current?.blur();
    },
    [onSetShortcut, notification],
  );

  if (!ready) {
    return <div className="page settings-page">加载中...</div>;
  }

  // 显示的文本：捕捉中 vs 已设置
  const displayValue = capturing
    ? capturedMods.length > 0
      ? capturedMods.map(modToLabel).join("+") + "+..."
      : "按下快捷键..."
    : shortcut;

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
          ref={inputRef}
          value={displayValue}
          readOnly={capturing}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="点击后按下快捷键"
          className={capturing ? "shortcut-capturing" : ""}
          style={{ width: 220, cursor: "pointer" }}
        />
      </div>
    </div>
  );
}

export default SettingsPage;
