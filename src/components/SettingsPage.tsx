import { useState, useRef, useCallback } from "react";
import { InputNumber, Input, Radio, App } from "antd";
import type { ThemeMode } from "../utils/theme";

interface Props {
  themeMode: ThemeMode; onSetThemeMode: (m: ThemeMode) => void;
  maxClipEntries: number; onSetMaxClipEntries: (m: number) => void;
  cleanupInterval: number; onSetCleanupInterval: (s: number) => void;
  shortcut: string; onSetShortcut: (s: string) => void;
  peerName: string; onSetPeerName: (n: string) => void;
  downloadDir: string; onSetDownloadDir: (d: string) => void;
  ready: boolean;
}

const MOD_ORDER: Record<string, number> = { Control: 0, Alt: 1, Shift: 2 };
function modToLabel(k: string) { switch (k) { case "Control": return "Ctrl"; case "Alt": return "Alt"; case "Shift": return "Shift"; default: return k; } }

function SettingsPage({ themeMode, onSetThemeMode, maxClipEntries, onSetMaxClipEntries, cleanupInterval, onSetCleanupInterval, shortcut, onSetShortcut, peerName, onSetPeerName, downloadDir, onSetDownloadDir, ready }: Props) {
  const { notification } = App.useApp();
  const [capturing, setCapturing] = useState(false);
  const [capturedMods, setCapturedMods] = useState<string[]>([]);
  const inputRef = useRef<any>(null);

  const handleFocus = useCallback(() => { setCapturing(true); setCapturedMods([]); }, []);
  const handleBlur = useCallback(() => { setCapturing(false); setCapturedMods([]); }, []);
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault(); const key = e.key;
    if (key === "Escape") { setCapturing(false); setCapturedMods([]); inputRef.current?.blur(); return; }
    const mods: string[] = [];
    if (e.ctrlKey) mods.push("Control");
    if (e.altKey) mods.push("Alt");
    if (e.shiftKey) mods.push("Shift");
    if (key === "Control" || key === "Alt" || key === "Shift") { setCapturedMods(mods); return; }
    if (!/^[a-zA-Z0-9]$/.test(key)) { notification.warning({ message: "无效按键", description: "需 Ctrl/Alt/Shift + 字母或数字", placement: "bottomRight" }); setCapturing(false); inputRef.current?.blur(); return; }
    if (mods.length === 0) { notification.warning({ message: "无效快捷键", description: "至少需要一个修饰键", placement: "bottomRight" }); setCapturing(false); inputRef.current?.blur(); return; }
    const sorted = [...mods].sort((a, b) => (MOD_ORDER[a] ?? 99) - (MOD_ORDER[b] ?? 99));
    onSetShortcut([...sorted, key.toUpperCase()].map(modToLabel).join("+"));
    setCapturing(false); setCapturedMods([]); inputRef.current?.blur();
  }, [onSetShortcut, notification]);

  if (!ready) return <div className="page settings-page">加载中...</div>;

  const displayVal = capturing ? (capturedMods.length > 0 ? capturedMods.map(modToLabel).join("+") + "+..." : "按下快捷键...") : shortcut;

  return (
    <div className="page settings-page">
      <div className="setting-item"><span className="setting-label">主题</span>
        <Radio.Group value={themeMode} onChange={(e) => onSetThemeMode(e.target.value)} optionType="button" buttonStyle="solid">
          <Radio.Button value="light">亮色</Radio.Button><Radio.Button value="dark">暗色</Radio.Button><Radio.Button value="system">遵循系统</Radio.Button>
        </Radio.Group></div>
      <div className="setting-item"><span className="setting-label">最大保存条数</span>
        <InputNumber variant="filled" min={8} max={1024} step={8} value={maxClipEntries} onChange={(v) => v !== null && onSetMaxClipEntries(v)} style={{ width: 120 }} /></div>
      <div className="setting-item"><span className="setting-label">清理间隔（秒）</span>
        <InputNumber variant="filled" min={10} max={3600} step={10} value={cleanupInterval} onChange={(v) => v !== null && onSetCleanupInterval(v)} style={{ width: 120 }} /></div>
      <div className="setting-item"><span className="setting-label">P2P 节点名称</span>
        <Input variant="filled" value={peerName} onChange={(e) => onSetPeerName(e.target.value)} placeholder="局域网中的发现名称" style={{ width: 220 }} /></div>
      <div className="setting-item"><span className="setting-label">下载路径</span>
        <Input variant="filled" value={downloadDir} onChange={(e) => onSetDownloadDir(e.target.value)} placeholder="文件下载保存目录" style={{ width: 300 }} /></div>
      <div className="setting-item"><span className="setting-label">全局快捷键</span>
        <Input variant="filled" ref={inputRef} value={displayVal} readOnly={capturing} onFocus={handleFocus} onBlur={handleBlur}
          onKeyDown={handleKeyDown} placeholder="点击后按下快捷键" className={capturing ? "shortcut-capturing" : ""}
          style={{ width: 220, cursor: "pointer" }} /></div>
    </div>
  );
}

export default SettingsPage;
