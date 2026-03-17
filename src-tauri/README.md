# Rust Runtime Layer

这里是开发端桌面壳层与运行时桥接的 Rust 代码。

当前目标不是继续把功能堆进 `main.rs`，而是维持几条边界清楚：

- 桌面壳层
- runtime 调度
- 下载桥接
- SQLite 读写
- 路径与设置契约

## 当前结构

- `src/main.rs`
  - Tauri 开发端入口。
  - 负责 Builder、state 注册、command 注册。
  - 现在应尽量保持薄，不再承载具体窗口/dock/tray 实现。

- `src/desktop_shell.rs`
  - 桌面壳层实现。
  - 负责主窗口创建、dock 状态机、托盘、窗口事件、文件夹选择器、外链打开。

- `src/auth_runtime.rs`
  - runtime scheduler 核心。
  - 负责 `auth check / interrupt login / collect / db import` 的编排与状态快照。

- `src/app_settings.rs`
  - 应用设置持久化。
  - 负责下载目录、课程范围、课程分目录、dock 设置和 runtime marker。

- `src/app_data.rs`
  - 从 SQLite 读取 dashboard 数据给前端。

- `src/db_import.rs`
  - 从 `data/cache/*.json` 导入 SQLite。
  - 只接受完整的 `full` collect 结果作为导库输入。

- `src/downloads.rs`
  - 下载桥接层。
  - 负责读取设置、规范化相对路径，并调用 Node 下载脚本。

- `src/script_runner.rs`
  - Rust 调 Node 自动化脚本的统一执行桥。
  - 当前仍基于 `npm run <script>` 协议。

- `src/paths.rs`
  - 开发端路径契约。
  - 这里只处理开发端 `data/`、`cache/`、SQLite 和 auth storage-state 路径。

- `src/lib.rs`
  - 供桌面端和 `runtime_cli` 共享的模块导出。

- `src/bin/runtime_cli.rs`
  - runtime 调试入口。
  - 主要用于本地观察 scheduler、手动触发 check / collect / import。

## 当前约定

- `main.rs` 是入口，不是实现仓库。
- 窗口、dock、tray 相关逻辑优先放进 `desktop_shell.rs`。
- runtime 调度相关逻辑优先放进 `auth_runtime.rs`。
- 路径安全和设置规范化不要只信前端，Rust 侧要保留最后一道校验。
- `script_runner.rs` 只做执行桥，不混入业务判断。

## 后续建议

按当前优先级，下一步适合继续做：

1. 继续压缩 `main.rs`
   - 把剩余 command wrapper 按 `runtime / data / download façade` 继续拆开。
2. 收 `script_runner.rs`
   - 把脚本名从散落字符串收成常量或轻量 enum。
3. 审计 TS request 主线
   - `automation/request-collectors/common.ts`
   - `automation/request-collectors/full-collect.ts`

## 验证

这层改动后，至少要跑：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```
