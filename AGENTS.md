# SovBoard — Agent Instructions

Tauri v2 + React + TypeScript 桌面应用，Rust 后端 + Vite 前端。

---

## 构建与开发命令

```bash
# 前端依赖安装
pnpm install

# 开发模式（启动 Vite 热更新 + Tauri 窗口）
pnpm tauri dev

# 构建生产版本
pnpm tauri build

# 仅前端预览
pnpm dev
pnpm preview

# Rust 后端检查
cd src-tauri && cargo check
cd src-tauri && cargo build
cd src-tauri && cargo fmt && cargo clippy

# 全栈类型检查
pnpm build
```

> 包管理使用 `pnpm`，不要用 npm/yarn 安装依赖。

---

## 网络代理

部分环境下载 Rust crate 或 npm 包可能因网络问题失败，遇到错误时在终端执行：

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:7890"
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
```

然后再重试安装/构建命令。

---

## 架构概述

```
SovBoard/
├── src/                  # React 前端 (TypeScript)
│   ├── App.tsx           # 主组件
│   ├── App.css
│   ├── main.tsx          # 入口
│   └── ...
├── src-tauri/            # Rust 后端
│   ├── src/
│   │   ├── main.rs       # 桌面入口
│   │   └── lib.rs        # Tauri plugin/command 注册
│   ├── Cargo.toml
│   └── tauri.conf.json   # Tauri 配置
├── public/               # 静态资源
├── package.json          # 前端依赖
├── vite.config.ts        # Vite 配置
└── tsconfig.json         # TypeScript 配置
```

### 关键组件

| 层     | 技术栈              | 职责                     |
|--------|-------------------|--------------------------|
| 前端   | React 19, TS 5.8  | UI 渲染、用户交互          |
| 构建   | Vite 7            | HMR、打包                |
| 桥接   | @tauri-apps/api 2 | 前后端 IPC 通信           |
| 后端   | Tauri 2, Rust     | 系统能力、文件操作、窗口管理 |

### 数据流

```
用户操作 → React 组件 → Tauri invoke() → Rust 命令 → 系统层
                                       ← 序列化返回
```

---

## 配置文件

| 文件                          | 用途                        |
|-------------------------------|-----------------------------|
| `tauri.conf.json`             | Tauri 窗口、bundle、安全策略 |
| `src-tauri/Cargo.toml`        | Rust 依赖和编译配置          |
| `package.json`                | 前端依赖和脚本               |
| `vite.config.ts`              | Vite 构建配置               |
| `tsconfig.json`               | TypeScript 编译选项          |

---

## 变更记录规范

每次 AI 会话做出的修改，**必须同步记录在 AGENTS.md 底部**。格式如下：

```markdown
### Session 2026-06-07 — 初始化项目
- 完善 `.gitignore`：补充 `.env`、构建产物、OS 文件等忽略规则
- 完善 `AGENTS.md`：补充架构说明、命令、代理设置、变更记录规范
```

每次新增功能、修复、重构后，在底部追加一条 session 记录。这样即使会话重置，下一个 agent 也能快速了解项目演变历史。

---

## Commit Message 规范

项目根目录有 `.gitmessage` 模板文件，已通过 `git config commit.template` 自动加载。
每次 `git commit` 时会自动展示模板，按模板填写即可。

```
feat      新功能
fix       修复
docs      AGENTS.md / README / 文档变更
refactor  重构（不修 bug 不加功能）
chore     构建、依赖、CI、配置变动
test      测试相关
style     代码格式（不影响逻辑）
perf      性能优化
```

完整格式: `<type>(<scope>): <subject>`

```
feat(cmd): 添加侧边栏折叠动画
fix(window): 修复窗口最小化后恢复白屏
chore: 升级 tauri 到 2.2.0
docs: 补充架构说明和开发命令
```

---

## 扩展点

- **Tauri 插件**：通过 `src-tauri/Cargo.toml` 添加社区插件，在前端用 `@tauri-apps/plugin-xxx` 调用
- **Rust 命令**：在 `lib.rs` 中注册 `#[tauri::command]`，前端通过 `invoke()` 调用
- **窗口配置**：修改 `tauri.conf.json` 的 `app.windows` 数组

---

## 变更记录

### Session 2026-06-07 — 初始化项目配置
- 完善 `.gitignore`：补充 `build`、`.env`、`Thumbs.db`、`Desktop.ini`、`pnpm-lock.yaml`、`*.tsbuildinfo` 等忽略规则
- 完善 `AGENTS.md`：补充架构概述、构建命令、网络代理方案、配置文件说明、变更记录规范、扩展点
- 约定包管理使用 `pnpm`，不用 npm/yarn
- 约定每次修改后需在 AGENTS.md 底部追加变更记录
- 创建 `.gitmessage` 提交模板，配置 `git config commit.template` 自动加载

### Session 2026-06-09 — 标签页导航 + 暗黑模式设置持久化
- **Rust 后端**
  - 添加 `tauri-plugin-store` v2 依赖（`Cargo.toml`），在 `lib.rs` 中注册插件
  - 更新 `capabilities/default.json`，添加 `store:default` 权限
- **前端**
  - 安装 `@tauri-apps/plugin-store` v2.4.3
  - 拆分组件：`src/components/HomePage.tsx`（原有 Greet 功能）、`src/components/SettingsPage.tsx`（暗黑模式开关）
  - 重构 `App.tsx`：标签页容器，含「主页」和「设置」两个 Tab
  - 设置持久化：使用 `@tauri-apps/plugin-store` 的 `load`/`get`/`set`/`save` API，启动时加载、切换时保存
  - 暗黑模式：通过 `data-theme="dark"` 属性驱动 CSS 变量切换，同步调用 Rust 命令切换原生窗口主题
- **CSS 重构**
  - 将硬编码颜色全部改为 CSS 自定义属性，支持 `[data-theme="dark"]` 覆盖
  - 新增标签栏样式、设置页布局、toggle switch 样式
- **修复**：暗黑模式初始化逻辑从 `SettingsPage` 提升到 `App.tsx`，确保启动时（无需切换到设置页）立即应用已保存的主题

### Session 2026-06-09 — 右侧导航 + 主题三态（亮色/暗色/遵循系统）
- **布局**：导航从顶部标签栏改为右侧竖排导航栏（flex-direction: row，内容在左，导航在右）
- **主题模式**：从二态 toggle 改为三选一 radio（亮色 / 暗色 / 遵循系统）
  - themeMode 存入 store（"light" | "dark" | "system"），兼容旧版 darkMode: boolean
  - "遵循系统"：选择时/启动时读取 prefers-color-scheme，并监听系统主题变化实时切换
  - 切换为其它模式时自动停止系统监听

### Session 2026-06-09 — 主题方案修复 + 美化
- **主题切换方案变更**：从 `data-theme` 属性改为 CSS class `.theme-dark` / `.theme-light`，避免潜在兼容问题
- **移除 `set_dark_mode` invoke**：`window.set_theme()` 会修改 webview 内部的 `prefers-color-scheme`，导致"遵循系统"模式下读取系统设置不准；现仅通过 CSS class 切换主题，不再触碰原生窗口主题
- **代码清理**：移除 `load()` 调用的无效 `defaults` 参数、`console.log` 调试代码、未使用的 `invoke` 导入
- **美化**：`main.tsx` 移除 `React.StrictMode` 包裹和 `React` 导入

### Session 2026-06-18 — 剪贴板历史管理功能
- **依赖**：安装并配置 `tauri-plugin-clipboard-x` v2.0.2（Rust plugin + 前端 API），注册 `clipboard-x:default` 权限
- **后端**：无需 Rust 代码改动——`tauri-plugin-clipboard-x` 提供原生剪贴板监听 (`onClipboardChange`) 和读写 API
- **前端 App.tsx**
  - 将模块顶层 demo 代码重构为 useEffect 中的剪贴板监听生命周期
  - 实现 `ClipEntry` 数据结构，支持 text / html / rtf / image / files 五种内容类型
  - 实现自排除机制（`skipNextChangeRef`）：从历史面板复制时不产生新记录
  - 实现去重：连续复制相同内容只保留一条
  - 持久化：使用 `tauri-plugin-store` 的独立 `clipboard.json` 文件，entries 变化时自动保存
  - 标签页导航新增「剪贴板」入口
- **前端 ClipboardPage.tsx**（新建）
  - 手风琴折叠列表：同一时间只展开一个条目，折叠态显示 emoji 类型图标 + 截断预览 + YYYY/MM/DD HH:MM:SS 时间
  - 展开态根据类型渲染：文本用 `<pre>` 块（最大 300px 可滚动）、HTML 源码折叠 + 可选预览、图片用 `convertFileSrc` 显示缩略图、文件显示路径列表
  - 操作按钮：复制（根据类型调用 writeText/writeHTML/writeImage/writeFiles）、删除（Popconfirm）、清空全部
  - 空状态提示
- **前端 SettingsPage.tsx**：新增「最大保存条数」设置项（antd InputNumber，范围 8-1024，步长 8，默认 32），存入 settings.json
- **前端 App.css**：新增剪贴板页面全套样式（`.clipboard-page` / `.clip-entry` / `.clip-text-content` / `.clip-image` 等），复用 CSS 变量体系适配亮色/暗色主题，条目 hover/accent 边框高亮
- **验证**：`cargo check` + `pnpm build`（tsc + vite）均编译通过

### Session 2026-06-18 — 修复剪贴板图片预览权限
- 在 `tauri.conf.json` 的 `app.security` 中添加 `assetProtocol: { enable: true, scope: ["**"] }`，允许 asset protocol 访问 app data 中的图片文件，修复 `ERR_CONNECTION_REFUSED` 报错

### Session 2026-06-18 — 移除主页
- 从 `App.tsx` 移除 HomePage 导入、标签页和渲染分支，默认 Tab 改为「剪贴板」
- 清空 `HomePage.tsx` 组件（保留占位避免 tsc `isolatedModules` 报错）
- 从 `App.css` 移除 `.logo-*`、`.home-page`、`.greet-form`、`#greet-input` 等主页专用样式

### Session 2026-06-22 — 剪贴板图片孤儿文件定时清理
- **Rust 后端**
  - 在 `lib.rs` 中注册 `cleanup_orphan_images` Tauri command，接收前端图片条目列表
  - 从条目路径推断图片保存目录，扫描目录中所有图片文件（按扩展名过滤）
  - 双向清理：删除"磁盘有但条目没引用"的孤儿图片，返回"条目有但文件已丢失"的脏条目 ID
  - 路径标准化（canonicalize）确保跨平台对比正确
- **前端 SettingsPage.tsx**
  - 新增「清理间隔」设置项（antd InputNumber，范围 10-3600 秒，步长 10，默认 60）
- **前端 App.tsx**
  - 新增 `cleanupInterval` 状态和 `handleSetCleanupInterval` 持久化回调（存入 settings.json）
  - 新增 `runCleanup` 函数：收集所有含 image 的条目 → `invoke("cleanup_orphan_images")` → 根据返回的 `stale_entry_ids` 过滤前端条目
  - 新增 `useEffect` 定时器：依赖 `cleanupInterval` 和 `clipReady`，间隔变化时清除旧定时器 → 立即执行一次 → 启动新定时器
  - 使用 `clipEntriesRef` 同步最新条目列表，避免定时器因条目变化频繁重建
  - 启动时从 settings store 加载已保存的清理间隔
- **验证**：`cargo check` + `pnpm build` 均编译通过

### Session 2026-06-22 — 剪贴板 Tag 完善 + 全局快捷键快速选择器
- **Tag 完善**：`ClipboardPage.tsx` 的 `getPreview()` 重写，所有类型（文本/HTML/图片/文件/RTF）均有独立 tag，按类型分配不同颜色（文本 blue、HTML orange、图片 purple、文件 cyan、RTF red）
- **全局快捷键基础设施**
  - 添加 `tauri-plugin-global-shortcut` v2 Rust 依赖 + `@tauri-apps/plugin-global-shortcut` v2.3.2 前端依赖
  - 更新 `capabilities/default.json` 添加 `global-shortcut:default` 权限
  - 在 `lib.rs` 中注册 `tauri_plugin_global_shortcut` plugin
- **QuickSelector 浮层组件**（`src/components/QuickSelector.tsx` 新建）
  - 半透明模糊遮罩 + 居中面板，最多显示 8 条剪贴板条目
  - 滚轮（↑↓）和键盘（ArrowUp/ArrowDown）切换高亮项
  - 高亮项用 accent 色背景突出，底部操作提示
  - 复用 `getQuickPreview` + `tagColor` 与主界面一致的预览逻辑
- **App.tsx 集成**
  - 快捷键注册 useEffect：依赖 `shortcut` + `clipReady`，自动注册/注销
  - `Pressed` 事件：`focus()` 窗口 → 显示 QuickSelector → 高亮 index 归零
  - `Released` 事件：隐藏 QuickSelector → 根据 `clipEntriesRef` + `highlightIndexRef` 复制选中条目到剪贴板 → 自排除跳过监听
  - `handleSetShortcut`：持久化到 `settings.json`（key: `globalShortcut`）
  - 启动时从 settings store 加载已保存的快捷键，默认 `Ctrl+Alt+Q`
- **设置页更新**：新增「全局快捷键」输入框（antd Input），支持自由编辑快捷键组合
- **CSS**：`App.css` 追加 `.quick-selector-*` 全套样式（overlay 模糊背景 / panel 圆角阴影 / item hover+active 状态 / tags / hint 提示）
- **验证**：`cargo check` + `tsc --noEmit` + `pnpm build` 均通过
- **修复**：`global-shortcut:default` 权限不包含 `register`/`unregister` 命令，改为显式添加 `global-shortcut:allow-register` + `global-shortcut:allow-unregister`

### Session 2026-07-02 — QuickSelector 改为独立 Tauri 窗口
- **架构重构**：将主窗口内嵌浮层改为独立 Tauri 窗口（无边框、居中、置顶、skip_taskbar）
- **预创建策略**：在 `lib.rs` 的 `setup()` 中预创建隐藏窗口，按快捷键时 `show()`/`hide()` 复用，避免每次 `build()` 阻塞
- **URL 修复**：`get_quick_selector_url()` 改为根据 `cfg!(debug_assertions)` 直接构造，不依赖主窗口 URL（`setup()` 时主窗口为 `about:blank`）
- **权限修复**：`capabilities/default.json` 的 `windows` 数组添加 `"quick-selector"`，允许 QS 窗口使用 store
- **数据读取**：`QuickSelectorApp` 直接从 `clipboard.json` store 读取数据，通过 `entries-updated` 事件触发刷新
- **前端入口分流**：`main.tsx` 根据 `?window=quick-selector` query 参数分流渲染 `QuickSelectorApp`
- **共用模块**：抽取 `src/utils/clipboardPreview.ts`（`tagColor` / `getQuickPreview`），`QuickSelector.tsx` 和 `QuickSelectorApp.tsx` 共用
- **新增命令**：`show_quick_selector` / `hide_quick_selector` / `get_quick_selector_entries`（Rust）
- **新增样式**：`.quick-selector-window` 独立窗口专用样式
- **交互增强**：条目全部显示（移除 8 条限制）、`scrollIntoView` 自动跟随高亮项、Esc 键关闭窗口
- **验证**：`cargo check` + `pnpm build` 均通过

### Session 2026-07-06 — 快捷键注册通知 + 收藏功能 + 系统托盘 & 窗口状态记忆
**任务一：快捷键注册失败通知**
- `App.tsx`：导入 `notification` from `"antd"`，快捷键注册失败的 `catch` 块中弹出 `notification.error` 提示用户

**任务二：剪贴板收藏功能**
- `App.tsx`：`ClipEntry` 接口新增 `favorite?: boolean` 字段，新条目默认 `false`
- `App.tsx`：`handleDelete` 拒绝删除收藏项；新增 `handleToggleFavorite` 切换收藏状态
- `App.tsx`：`runCleanup` 孤儿图片清理跳过收藏项（`!staleSet.has(e.id) || e.favorite`）
- `ClipboardPage.tsx`：新增 `onToggleFavorite` prop；列表按收藏优先排序（收藏项置顶，各自按时间倒序）
- `ClipboardPage.tsx`：每条目头部新增 ⭐/☆ 收藏按钮；收藏项的删除按钮变为 disabled + Tooltip 提示
- `QuickSelectorApp.tsx`：数据读取后按收藏优先排序；收藏项显示 ⭐ emoji 标记
- `App.css`：新增 `.btn-favorite`、`.btn-disabled`、`.quick-selector-favorite` 样式
- `src/utils/clipboardPreview.ts`：无需修改（已由 `ClipboardPage` 内部处理）

**任务三：系统托盘 + 窗口状态记忆**
- `Cargo.toml`：添加 `tauri-plugin-window-state = "2"`；tauri features 添加 `tray-icon`、`image-png`
- `capabilities/default.json`：添加 `window-state:default` 权限
- `lib.rs`：注册 `tauri_plugin_window_state` plugin
- `lib.rs`：在 `setup()` 中创建系统托盘（`TrayIconBuilder`），菜单含「显示主窗口」和「退出」；右键菜单/左键单击均可显示窗口
- `lib.rs`：拦截主窗口 `CloseRequested` 事件（`api.prevent_close()` + `hide()`），关闭窗口时最小化到托盘而非退出
- window-state 插件自动保存/恢复窗口位置和大小

- **验证**：`cargo check` + `pnpm build` 均通过

### Session 2026-07-06 — QuickSelector 主题同步修复
- **问题**：QuickSelector 独立窗口配色不跟随主窗口亮色/暗色主题变化
- **修复**：抽取 `src/utils/theme.ts`（`ThemeMode`、`systemPrefersDark`、`resolveIsDark`、`applyTheme`）
- **修复**：`App.tsx` 和 `SettingsPage.tsx` 改为从 `utils/theme` 导入类型和工具函数
- **修复**：`QuickSelectorApp.tsx` 新增 `fetchTheme` 回调，挂载时读取 `settings.json` 主题配置并应用 CSS class；接收 `entries-updated` 事件时同步刷新主题；监听 `prefers-color-scheme` 系统主题变化
- **验证**：`tsc --noEmit` + `pnpm build` 均通过

### Session 2026-07-06 — 修复 QuickSelector 启动时意外显示
- **问题**：window-state 插件启动时恢复窗口状态，导致 QuickSelector 窗口在应用打开后一并弹出
- **修复**：`lib.rs` 中 window-state 插件注册时添加 `.with_denylist(&["quick-selector"])`，排除 QS 窗口的状态追踪
- **验证**：`cargo check` 通过

### Session 2026-07-07 — 全局快捷键设置改为按键捕捉
- **SettingsPage.tsx**：替换文本 `Input` 为按键捕捉模式
  - 点击输入框进入捕捉状态（`onFocus`），失去焦点/Esc 退出
  - `onKeyDown` 中实时收集 `e.ctrlKey`/`e.altKey`/`e.shiftKey` 修饰键状态
  - 非字母/数字键弹出 `notification.warning("无效按键")` 并退出
  - 没有修饰键时按字母/数字键弹出 `notification.warning("无效快捷键")` 并退出
  - 成功捕捉后按 Ctrl→Alt→Shift→Key 排序构造 `Ctrl+Alt+Q` 格式字符串，调用 `onSetShortcut`
  - 捕捉中 `readOnly` 防止文本输入，实时显示 `Ctrl+Alt+...` 预览
- **App.css**：新增 `.shortcut-capturing` 样式（accent 边框 + 发光阴影 + 背景高亮 + 隐藏光标）
- **验证**：`tsc --noEmit` 编译通过

### Session 2026-07-07 — 应用图标替换为 galaxy.svg
- 将 `index.html` + `dist/index.html` 的 favicon 引用从 `/vite.svg` 改为 `/galaxy.svg`
- 删除 `public/tauri.svg`、`public/vite.svg`、`dist/tauri.svg`、`dist/vite.svg`
- 安装 `@resvg/resvg-js` v2.6.2（devDependencies），编写 `convert_icons.cjs` 脚本
- 将 `src-tauri/icons/` 下全部 16 个图标文件（PNG/ICO/ICNS）替换为基于 `galaxy.svg` 渲染的新图标
- **验证**：图标生成成功，共 14 个 PNG + 1 个 ICO + 1 个 ICNS

### Session 2026-07-09 — P2P 局域网文件分享功能规划
- 创建功能分支 `feat/p2p-file-share`（从 `main` 分出）
- 在 AGENTS.md 中新增功能规划章节，列出完整 todo 清单
- 功能稳定后再合入主干

### Session 2026-07-09 — P2P 阶段一：基础设施搭建
- **Cargo.toml**：添加 `libp2p` 0.54（features: tokio/tcp/noise/yamux/mdns/request-response/cbor/macros）、`tokio`、`futures`、`tracing`
- **新建 `src-tauri/src/p2p.rs`**
  - 定义协议数据类型 `FileRequest` / `FileResponse`（CBOR 序列化）
  - 定义共享状态 `P2PState`（`peers: HashMap<PeerId, Vec<Multiaddr>>` + `file_registry`）
  - 定义组合 `NetworkBehaviour`：`mdns::tokio::Behaviour` + `request_response::cbor::Behaviour<FileRequest, FileResponse>`
  - 实现 `start_p2p_node()`：Ed25519 密钥 → TCP + Noise + Yamux → 监听 `/ip4/0.0.0.0/tcp/0` → 事件循环（mDNS 发现/过期 + FileExchange 占位）
- **修改 `lib.rs`**
  - 添加 `mod p2p;` 和 `use std::sync::Arc;`
  - 在 `setup()` 末尾创建 `Arc<tokio::sync::Mutex<P2PState>>`，`app.manage()` 注册为全局状态
  - `tauri::async_runtime::spawn` 启动 `start_p2p_node` 后台循环
  - 异常退出时通过 `app_handle.emit("p2p:error", ...)` 通知前端
- **验证**：`cargo check` 编译通过（仅 2 个 dead_code 警告，阶段二~四消除）

### Session 2026-07-09 — P2P 阶段二：mDNS 发现
- **Cargo.toml**：添加 `mac_address` v1.1 依赖，用于获取本机 MAC 地址作为默认节点名
- **lib.rs**
  - 新增 `PeerInfo` 结构体（`peer_id` + `addresses`），实现 `Serialize`
  - 新增 `get_default_peer_name` command：调用 `mac_address::get_mac_address()`，失败 fallback `"Unknown"`
  - 新增 `get_peer_list` async command：从 `P2PState` 读取在线节点列表，通过 `tokio::sync::Mutex::lock().await` 安全读取
  - 两个新命令注册到 `invoke_handler`
- **App.tsx**
  - 新增 `PEER_NAME_KEY = "peerName"` 常量、`peerName` 状态、`handleSetPeerName` 持久化回调
  - 启动时从 settings store 加载已保存名称；若无则 `invoke("get_default_peer_name")` 获取 MAC 地址
- **SettingsPage.tsx**
  - 接口新增 `peerName` / `onSetPeerName` props
  - 新增「P2P 节点名称」Input 设置项，placeholder `"局域网中的发现名称"`
- **验证**：`cargo check` + `tsc --noEmit` 均通过

### Session 2026-07-09 — P2P 阶段三：文件注册与哈希
- **Cargo.toml**：添加 `sha2 = "0.10"` 依赖
- **p2p.rs**：`FileEntry` 新增 `register_timestamp: u64` 字段
- **lib.rs**
  - 新增 `FileRegisterResult` 结构体（`hash` + `file_name` + `file_path` + `file_size` + `timestamp`）
  - 新增 `register_file` async command：
    - 验证文件存在性
    - 流式计算 SHA-256（`std::io::copy` 将文件内容管道到 `Sha256` hasher）
    - 哈希混合防冲突信息：**文件内容 + 注册时间戳 + 文件全路径 + 本机 MAC 地址**
    - 写入 `P2PState.file_registry`
  - 注册到 `invoke_handler`
- **前端 FileSharePage.tsx**（新建）
  - Tauri `onDragDropEvent` 监听文件拖放（over / leave / drop）
  - 拖放时逐个调用 `invoke("register_file", { path })` 注册文件
  - 文件列表展示：文件名、大小（B/KB/MB/GB）、注册时间、哈希（前8后8截断 + Tooltip 完整值）
  - 操作：复制哈希（`navigator.clipboard.writeText`）、取消分享
  - 空状态占位
- **App.tsx**：新增 `fileshare` Tab、导入 `FileSharePage`、渲染分支
- **App.css**：新增 `.file-share-page` / `.drop-zone` / `.shared-files` / `.shared-file-item` 等全套样式
- **验证**：`cargo check`（仅 1 个 `FileEntry` dead_code 警告）+ `tsc --noEmit` 均通过

### Session 2026-07-09 — P2P 阶段四：请求-响应传输
- **架构**：`request_response::cbor` 块级流式传输，单块 ≤ 64KB，防 OOM
- **p2p.rs 重写**
  - `FileRequest`：`hash` + `chunk_index`（按块请求）
  - `FileResponse`：`file_name` + `file_size` + `total_chunks` + `chunk_index` + `chunk_data` + `error`
  - 新增 `RespRouter`（`Arc<Mutex<HashMap<OutboundRequestId, oneshot::Sender<FileResponse>>>>`）将异步响应路由到下载任务
  - `make_response`：同步 `std::io::Read` 读取 64KB 块并通过 `behaviour.send_response()` 发送
  - `download_file`：通过 oneshot channel 接收响应，逐块写入本地文件
  - 事件循环：`tokio::select!` 同时处理 swarm 事件 + 下载请求
  - Swarm 包裹在 `Arc<Mutex<>>` 中允许多任务安全访问
- **lib.rs**：新增 `request_file` Tauri command，通过 channel 发送下载请求
- **FileSharePage.tsx**：通知文字「成功分享」→「成功添加」
- **验证**：`cargo check`（仅 1 个 `FileEntry.register_timestamp` dead_code 警告）+ `tsc --noEmit` 均通过

### Session 2026-07-09 — P2P 阶段五：下载界面
- **p2p.rs**
  - `P2PState` 新增 `app_handle: Option<tauri::AppHandle>` 用于发送 Tauri 事件
  - `DownloadRequest.save_path` → `save_dir`（文件名由对等节点提供）
  - `download_file` 改为接收 `save_dir`，从 chunk 0 响应获取文件名构建完整路径
  - 下载中每 10 块发送 `download:progress` 事件，完成发 `download:done`，失败发 `download:error`
- **lib.rs**
  - `request_file` 参数 `save_path` → `save_dir`
  - setup 中设置 `app_handle` 到 P2PState
- **前端 App.tsx**
  - 新增 `downloadDir` 状态和持久化（默认系统下载路径通过 `@tauri-apps/api/path` 获取）
  - 新增 `download` 状态（DownloadState）管理下载视图
  - 监听 `download:progress` / `download:done` / `download:error` 事件更新进度
  - `handleStartDownload` 校验下载路径后调用 `invoke("request_file")`
  - 下载中切换为 DownloadPage 覆盖 Tab 内容区
- **FileSharePage.tsx**：新增 Props（`downloadDir` / `onStartDownload`）；新增哈希查找输入框 + "查找"按钮（校验 64 位 SHA-256）
- **DownloadPage.tsx**（新建）：下载中显示 antd Progress + 百分比 + 大小；完成/失败显示 Result 组件 + 返回按钮
- **SettingsPage.tsx**：新增「下载路径」Input 设置项
- **App.css**：新增 `.hash-lookup` / `.download-page` / `.download-card` 等样式
- **验证**：`cargo check`（仅 `FileEntry` 死代码 + `DownloadProgress` 未使用 2 个警告）+ `tsc --noEmit` 均通过

### Session 2026-07-09 — P2P 阶段六：设置与集成
- **SettingsPage.tsx**：所有 `Input` 组件添加 `variant="filled"`，与 `InputNumber` 配色统一（亮色/暗色主题下自动适配填充背景色）
- **capabilities**：P2P 使用 Rust 原生 TCP（libp2p + tokio），文件拖放由 `core:default` 覆盖，无需额外权限声明
- **验收测试**：规划完成——需两台设备在同一局域网下手动测试发现、注册、下载全流程
- **验证**：`tsc --noEmit` 通过

### Session 2026-07-10 — 日志落盘
- **Cargo.toml**：添加 `tauri-plugin-log = "2"` 依赖
- **main.rs**：移除 `env_logger` 手动初始化（`tauri-plugin-log` 自动接管 log 系统初始化）
- **lib.rs**：注册 `tauri_plugin_log` 插件，配置 `TargetKind::LogDir { file_name: Some("logs") }`，日志按平台写入：
  - Windows → `%LOCALAPPDATA%/com.SovLyn.SovBoard/logs/`
  - macOS → `~/Library/Logs/com.SovLyn.SovBoard/`
  - Linux → `$XDG_DATA_HOME/com.SovLyn.SovBoard/logs/`（fallback `~/.local/share/...`）
- 现有 `log::info!`/`warn!`/`error!` 调用（p2p.rs 等）无需改动，自动双输出（控制台 + 文件）
- **验证**：`cargo check` 通过

### Session 2026-07-12 — 开机自启动功能
- **Rust 后端**
  - `Cargo.toml`：添加 `tauri-plugin-autostart = "2"` 依赖
  - `lib.rs`：注册 `tauri_plugin_autostart` 插件
- **前端**
  - `package.json`：添加 `@ant-design/icons` + `@tauri-apps/plugin-autostart` 依赖
- **权限**：新建 `src-tauri/capabilities/desktop.json`，添加 `autostart:default` 权限

### Session 2026-07-23 — P2P 迁移 QUIC + 局域网子序列搜索
- **QUIC 迁移**
  - `Cargo.toml`：libp2p features 从 `tcp/noise/yamux` 替换为 `quic`
  - `p2p.rs`：`SwarmBuilder` 从 `.with_tcp()` 改为 `.with_quic()`，监听地址从 `/tcp/0` 改为 `/udp/0/quic-v1`
  - QUIC 原生 TLS 1.3 加密 + 多路复用，不再需要 Noise + Yamux
- **子序列搜索**
  - 新增 `/sovboard-search/1` request_response 协议：`SearchRequest` / `SearchResponse` / `SearchResult`
  - `Command` 枚举新增 `SearchQuery` 变体；主事件循环新增搜索请求/响应处理
  - `is_subsequence_match()`：O(n) 子序列匹配（如 `abcd` 可匹配 `fafbfcfdf`）
  - `search_files` Tauri command：广播搜索到所有在线节点，5s 超时聚合结果
- **前端**
  - `FileSharePage.tsx`：输入 ≥4 且 <64 字符时自动 debounce 300ms 触发搜索
  - 下拉菜单三种状态：`busy`（antd `Spin`）、`empty`（antd `Empty`）、结果列表
  - 点击结果自动填入完整哈希到输入框
  - `App.css`：新增 `.hash-lookup-wrapper` / `.search-dropdown` / `.search-result-item` 样式
- **验证**：`cargo check`（零 warning）+ `tsc --noEmit` 均通过

## P2P 文件分享

> 状态：已完成 | 分支：`feat/p2p-file-share`（已合入 main）

基于 libp2p + mDNS 的局域网文件分享功能，无需中央服务器。

### 技术选型

| 层       | 技术                    | 用途                       |
|----------|------------------------|----------------------------|
| 网络传输 | `rust-libp2p`          | P2P 网络栈（QUIC） |
| 服务发现 | libp2p-mDNS            | 局域网自动发现对等节点       |
| 内容寻址 | SHA-256                | 文件哈希，作为内容标识符     |
| 文件传输 | libp2p-request-response | 请求/响应模式，单块 ≤ 64KB |
| 后端集成 | Rust (Tauri)           | `src-tauri/src/p2p.rs`      |
| 前端集成 | React + invoke()       | `FileSharePage` + `DownloadPage` |

### 功能

- **节点发现**：mDNS 自动发现局域网内其他 SovBoard 节点，文件分享页显示横向节点列表
- **本机 PeerID**：设置页展示本机 libp2p PeerID（只读）
- **文件分享**：拖放文件到应用，Rust 后端计算 SHA-256 并注册
- **文件下载**：输入 64 位 SHA-256 哈希，对等节点分块传输（16 路并发滑动窗口）
- **取消下载**：下载中可随时停止，自动清理部分文件
- **下载界面**：自定义卡片布局，显示进度、设备来源，暗色主题适配

### 架构要点

- **Command channel**（`p2p::Command`）：业务层通过 `mpsc` 向主循环发送 `SendRequest` / `CancelDownload`，Swarm 由主循环独占，消除锁竞争
- **并发下载**：`buffer_unordered(16)` + `Semaphore`，块可能乱序到达，用 `tokio::fs::File::seek` 写入正确偏移
- **异步 IO**：文件读写全程 `tokio::fs`，不阻塞事件循环
- **取消**：`AtomicBool` 令牌按哈希索引，每块请求前后检查

### 注意事项

- libp2p 编译时间较长，首次 `cargo build` 需耐心等待
- mDNS 仅在同一子网内有效，不支持跨子网发现
- 文件传输不实现断点续传（v1 范围外）
- 哈希值展示截断为前 8 位 + "..." + 后 6 位
