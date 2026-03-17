# Rust 运行层审计

更新时间：2026-03-15  
审计范围：`src-tauri/src/*.rs`，重点关注 `main.rs`、`auth_runtime.rs`、`downloads.rs`、`script_runner.rs`。  
本轮目标：把 Rust 侧值得裁剪、值得收口、暂时不要动的部分分清楚，并先完成低风险减法与第一步结构拆分。

## 1. 结论摘要

当前 Rust 侧不是“功能失控型屎山”，而是典型的“核心逻辑可用，但外层包装开始变厚”：

- `main.rs` 同时承担了窗口/dock 几何、托盘行为、command 暴露、壳层初始化四种职责。
- `auth_runtime.rs` 的调度状态机仍然是系统核心，但它既承载 service 内核，也承载 Tauri command façade，边界已经开始发粘。
- `downloads.rs` 主线清楚，但脚本失败输出解析与 JSON 结果解析之前有重复实现，适合做轻量收口。
- `script_runner.rs` 是稳定桥接层，但 `npm run <script>` 的字符串协议仍然是隐式契约；重命名脚本时风险高。
- `db_import.rs` 还能工作，但仍带有旧 schema 迁移残留痕迹，不适合继续把历史兼容逻辑长期堆在初始化里。

这轮已经先完成两项低风险减法：

- 删除 `script_runner.rs` 中未被使用的 `run_visible_login_script(...)` wrapper。
- 收口 `downloads.rs` 中重复的脚本错误解析和 JSON 输出解析。

这轮还额外完成了一步结构拆分：

- `src-tauri/src/main.rs` 已从窗口/dock/tray 壳层逻辑中抽身。
- 新增 `src-tauri/src/desktop_shell.rs`，集中承载窗口创建、dock 状态机、托盘行为和相关 shell command。
- 当前 `main.rs` 已回落为 “Builder + command 注册入口”，约 `235` 行；`desktop_shell.rs` 负责壳层实现，约 `661` 行。

## 2. 主线分层

### 2.1 `main.rs`

当前职责：

- Tauri Builder 初始化
- runtime / data / download command 注册
- 应用退出拦截

当前问题：

- `#[tauri::command]` wrapper 数量仍偏多，且大部分只是把调用继续转发到 `auth_runtime.rs` / `downloads.rs`。
- UI command 和 debug/admin command 仍然混在同一个 `invoke_handler!` 里。

结论：

- 不能直接删。
- 第一轮结构拆分已经完成，下一步该从“继续搬文件”转到“收命令面”和“梳理 façade”。

建议路线：

1. 把 runtime/data/download command wrapper 再单列出 façade 模块。
2. 再决定是否把 debug/admin command 从 UI command 面中单列。

### 2.1.1 `desktop_shell.rs`

当前职责：

- 主窗口创建与恢复
- dock 状态机的窗口几何控制
- 托盘左键 / 菜单行为
- shell 相关 command：
  - `window_minimize`
  - `window_close`
  - `get_window_dock_state`
  - `expand_docked_window`
  - `collapse_docked_window`
  - `exit_dock_mode`
  - `open_external_url`
  - `pick_folder_path`

结论：

- 这一步拆分是值得保留的。
- 当前 `desktop_shell.rs` 仍然偏大，但职责已经单一，后续可以继续在这个边界内部做减法。

### 2.2 `auth_runtime.rs`

当前职责：

- runtime scheduler
- auth check / interrupt login / collect / db import 编排
- runtime snapshot 状态维护
- Tauri command façade

当前问题：

- service 内核和 command 导出写在同一个文件里，已经明显过长。
- `run_auth_check` 与 `run_explicit_auth_check` 对外并存，但当前都落到同一条 explicit check 行为。
- `mark_*_due / clear_*_due` 同时存在内部调度入口和外部 command 入口，阅读成本高。

结论：

- 是系统核心，不能按“死代码”处理。
- 适合下一轮按“service core / command façade / snapshot model”拆层。

建议路线：

1. 保留 `RuntimeService` 为核心。
2. 把底部 `#[tauri::command]` 导出段拆到单独 façade 文件。
3. 对 `run_auth_check` / `run_explicit_auth_check` 的命名语义再做一次统一，避免外部误判两者行为不同。

### 2.3 `downloads.rs`

当前职责：

- 从设置读取下载目录
- 规范化 `relative_subdir`
- 调 Node 下载脚本
- 解析单文件和批量下载输出

当前问题：

- 相对目录规范化与前端有跨语言重复，但这属于安全边界重复，不建议去掉。
- 这轮之前单文件/批量下载的脚本失败输出解析与 JSON 行解析是重复的。

当前结论：

- 模块本身职责相对干净。
- 适合做轻量重构，不适合大拆。

本轮已完成：

- 新增统一 helper：
  - `extract_script_error(...)`
  - `parse_script_json_output(...)`

后续建议：

- 保持 Rust 只认“最终 `relative_subdir`”，不要再回退到按课程规则补路径。
- 如后续恢复后端批量桥接，应优先复用当前 helper，不要再复制一份解析逻辑。

### 2.4 `script_runner.rs`

当前职责：

- 调用 `npm run <script>`
- 区分 hidden / console 窗口模式
- 统一脚本 stdout / stderr / exit code 收集

当前问题：

- script id 仍是字符串协议，Rust 与 `package.json` 之间缺少集中常量。
- `run_visible_login_script(...)` 只是 `spawn + wait` 的薄 wrapper，且当前无引用。

本轮已完成：

- 删除未被使用的 `run_visible_login_script(...)`。

后续建议：

- 增加一组集中常量或轻量 enum，至少收口这些 script id：
  - `auth:check`
  - `auth:reset`
  - `auth:login`
  - `auth:open-url`
  - `collect:all`
  - `download:file`
  - `download:batch`

### 2.5 `db_import.rs`

当前职责：

- 读取 collect cache JSON
- 校验 full collect 完整性
- 建表、清表、导入业务表
- 记录导入版本

当前问题：

- `init_schema()` 里仍保留 `DROP TABLE IF EXISTS materials` / `DROP TABLE IF EXISTS notices` 这类旧表清理残留。
- 这类逻辑如果继续堆在 schema 初始化里，后续很难判断哪些是长期 schema，哪些只是历史迁移残影。

结论：

- 暂时不要删。
- 但应该标记成“历史迁移清理”，后续择机转成一次性迁移说明或专门迁移步骤。

### 2.6 `app_settings.rs` / `paths.rs`

结论：

- 当前边界清晰，暂时不是主要问题源。
- `normalize_relative_subdir(...)` 与前端重复属于合理防线，不建议为了“少几行”去掉。
- `paths.rs` 的开发端路径逻辑要继续保持与 package 壳层隔离，不要轻易合并。

## 3. 当前可直接下刀的点

### 3.1 已执行

- 删除 `script_runner.rs` 中未使用的 `run_visible_login_script(...)`
- 合并 `downloads.rs` 中重复的脚本输出解析

### 3.2 下一轮可直接做

1. 为 `script_runner.rs` 引入脚本名常量，减少字符串散落。
2. 给 `db_import.rs` 中旧表清理残留加明确注释，标出其历史迁移身份。
3. 把 `main.rs` 中剩余的 command wrapper 按 runtime/data/download façade 继续拆开。

## 4. 暂时不要直接做的事

1. 不要直接删除 `main.rs` 中 UI 未用的 runtime command。
2. 不要把 `auth_runtime.rs` 中内部 `mark_*_due` 与对外 command 同名函数粗暴合并。
3. 不要尝试去掉 Rust 侧的路径规范化，只保留前端一层校验。
4. 不要现在就碰 package 壳层 `main.rs / script_runner.rs` 的专属逻辑边界。

## 5. 下一步建议顺序

1. 先继续收口 `main.rs` 中剩余 command façade：
   - `src-tauri/src/main.rs`
2. 再做下载桥轻量整理：
   - `src-tauri/src/downloads.rs`
   - `src-tauri/src/script_runner.rs`
3. 再进入 TS request 主线：
   - `automation/request-collectors/common.ts`
   - `automation/request-collectors/full-collect.ts`
