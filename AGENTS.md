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
