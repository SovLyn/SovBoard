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
