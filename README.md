# SovBoard

Tauri v2 桌面工具箱 — 剪贴板历史管理 + P2P 局域网文件分享。

## 功能

- **剪贴板历史** — 自动捕获文本 / HTML / 图片 / 文件，收藏、搜索、持久化
- **P2P 文件分享** — 局域网内 QUIC 传输，mDNS 自动发现节点，分块并发下载
- **全局快捷键** — `Ctrl+Alt+Q` 唤起 QuickSelector 浮窗快速粘贴
- **暗色模式** — 亮色 / 暗色 / 跟随系统三态切换
- **系统托盘** — 关闭窗口最小化到托盘，后台运行

## 技术栈

| 层     | 技术                          |
|--------|-------------------------------|
| 框架   | Tauri 2                       |
| 前端   | React 19 + TypeScript + Vite  |
| 后端   | Rust                          |
| P2P    | libp2p (QUIC + mDNS)          |
| UI     | Ant Design 5                  |

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm tauri dev

# 构建
pnpm tauri build
```

## 许可证

[MIT](LICENSE)
