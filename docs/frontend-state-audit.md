# 前端状态流审计

更新时间：2026-03-15  
审计范围：`src/app.js` 为主，`src-tauri/src/main.rs` 仅用于核对 dock / tray 契约。  
本轮目标：产出“可执行的重构清单”，不直接改实现。

## 1. 结论摘要

当前前端主线没有明显“功能失效型”架构错误，但已经出现典型的补丁化增长：

- Tauri 调用链存在多层兜底，但没有统一的“失败语义”。
- dock 状态存在“事件 + 轮询 + 手动刷新”三套来源，前端不是单一状态源。
- 运行状态与下载状态共享一个状态框，但派生逻辑拆散在多处。
- 设置保存链存在“即时保存”和“底部保存”两种模式，成功/失败反馈也重复实现。
- 旧逻辑没有完全退出，导致阅读时很难判断哪条才是当前主线。

结论上，这不是“单个坏函数”的问题，而是 `src/app.js` 已经同时承担：

1. 页面状态容器  
2. Tauri 命令桥  
3. UI 渲染器  
4. modal 组装器  
5. 设置保存控制器  
6. 下载状态机

后续如果继续叠功能，不先收口这些边界，复杂度只会继续上升。

### 当前执行进度

- 第一批已完成：
  - Tauri bridge 错误语义收口
  - runtime/download 状态框派生收口
  - settings 保存入口收口
  - 已确认 legacy 删除
- 第二批已完成：
  - dock 状态改成事件主导、轮询兜底
  - dock 状态更新与 UI 副作用拆分
- 第三批已基本完成：
  - `src/app.js` 已回落为页面 orchestration 入口，当前约 `478` 行
  - `settings`、`download`、`detail`、`course render` 已迁入独立模块
  - 当前前端已经从“单文件控制器”转成“入口 + controller / renderer / ui helper”结构

## 2. 四条主线 Map

### 2.1 Tauri 调用链

主入口：

- `src/app/bridge.js`
  - `invokeTauriCommand()`
  - `invokeRequiredTauriCommand()`
  - `waitForTauriInvoke()`
- `src/app.js`
  - `initialize()`

当前状态源：

- 真正的桥接源只有 `window.__TAURI_INTERNALS__?.invoke ?? window.__TAURI__?.core?.invoke`

当前问题：

- `invokeTauriCommand()` 在桥不可用时返回 `null`，不是抛错。
- `waitForTauriInvoke()` 又单独实现了一套“等桥出现”的逻辑。
- 各业务函数对“`null` 表示环境不支持”各自解释，导致错误语义不统一。

重复/冗余点：

- “不在 Tauri 环境内”提示在下载、设置保存、批量下载等多处重复出现。
- 部分调用先 `waitForTauriInvoke()`，后续每次实际调用又再做一层 `invoke` 判空。

建议收口：

- 保留一个统一桥接入口，明确区分两类失败：
  - `bridge_unavailable`
  - `command_failed`
- 初始化阶段只判断一次桥是否存在。
- 业务函数不再自己解释 `null`，统一走桥接层错误包装。

### 2.2 dock / tray 状态链

主入口：

- `src/app/dock-controller.js`
  - `applyWindowDockState()`
  - `renderDockSurface()`
  - `bindDockInteractions()`
  - `initializeDockSync()`
  - `refreshWindowDockState()`
- Rust 契约：`emit_dock_state()` `src-tauri/src/main.rs:135`，`show_main_window()` `src-tauri/src/main.rs:604`

当前状态源：

- 理论主源是 Rust 发出的 `dock-state-changed`
- 实际上前端还依赖：
  - 初始化主动拉取一次
  - 定时轮询 `refreshWindowDockState()`
  - 调用 `expand/collapse` 后立即手动 refresh

当前问题：

- `state.windowDock` 不是纯事件驱动结果，而是三套机制共同维护的最终值。
- `syncDockSurface()` 同时负责：
  - DOM dataset 更新
  - dockHandle 显隐
  - modal 打开时强制关闭
- 这使 dock 状态同步和 UI 副作用绑在一起。

重复/冗余点：

- `refreshWindowDockState()` 在初始化、设置保存后、`expand/collapse` 之后、定时器里都被主动调用。
- 事件驱动已经存在，但仍保留较高频兜底轮询，说明边界还没彻底收口。

建议收口：

- 明确 Rust 事件为主源，前端轮询只保留低频兜底。
- 把 `applyWindowDockState()` 改成纯状态更新。
- 把 `syncDockSurface()` 的 UI 副作用拆成：
  - `renderDockSurface()`
  - `handleDockSideEffects()`
- 统一规定：只有初始化和事件丢失兜底才主动拉取状态。

### 2.3 运行状态与下载状态显示链

主入口：

- `src/app/state-models.js`
  - `getStatusSurfaceModel()`
  - `createIdleDownloadProgress()`
  - `createFallbackRuntimeSnapshot()`
- `src/app.js`
  - `syncRuntimePanel()`
  - `syncDownloadStatus()`
  - `setDownloadProgress()`

当前状态源：

- 运行状态源：`state.runtime`
- 下载状态源：`state.downloadProgress`
- 最终都汇总到同一个 `#download-status`

当前问题：

- UI 展示模型没有独立实体，而是每次渲染时临时拼。
- `getRuntimeTone()` 依赖 `getRuntimeLabel()` 的字符串结果，再做二次派生。
- `syncRuntimePanel()` 和 `syncDownloadStatus()` 有交叉依赖，运行状态变化会触发下载状态框重绘。

重复/冗余点：

- “运行 label -> tone -> text”是两段派生，不是单一模型。
- `setDownloadProgress()` 里手动重置 idle 状态，与 `syncDownloadStatus()` 的 idle fallback 叠加。
- `WAITING` 是 UI 特判，不是状态模型的正式值。

建议收口：

- 增加一个单一派生函数，例如 `getStatusSurfaceModel()`。
- 输出固定结构：
  - `kind`
  - `tone`
  - `text`
  - `clickable`
- `syncRuntimePanel()` 不再知道下载框细节，只消费这个模型。

### 2.4 设置保存与反馈链

主入口：

- `src/app/settings-controller.js`
  - `openSettingsModal()`
  - `openCourseSubdirModal()`
- `src/app/settings-save.js`
  - `createSettingsSaver()`
- `src/app.js`
  - `setModalFeedback()`

当前状态源：

- 设置源：`state.settings`
- 但存在若干局部 draft：
  - `draftSubdirs`
  - `dockEnabled`
  - `selectedScope`
  - 表单 input 当前值

当前问题：

- 保存策略不统一：
  - 课程分目录支持自动保存，也保留“保存分目录”按钮。
  - 课程范围点击即保存。
  - 自动侧收点击即保存。
  - 其余全局设置走底部“保存设置”。
- `save_app_settings` 调用被复制到多个 handler 内，每处自己做：
  - 拼新 settings
  - 判空
  - 回写 `state.settings`
  - 反馈
  - 可能还要 `renderCourses()` / `refreshWindowDockState()`

重复/冗余点：

- `persistCourseSubdirs()` 与“保存分目录”按钮存在重复。
- dock toggle、scope toggle、底部保存按钮三处都手写了一套保存后副作用。
- 很多保存路径都带有“当前不在 Tauri 环境内，无法保存设置”同类提示。

建议收口：

- 抽一个统一的 `saveSettingsPatch(patch, options)` 内部接口。
- 由它统一负责：
  - 调 `save_app_settings`
  - 回写 `state.settings`
  - 错误包装
  - 可选副作用：
    - `renderCourses`
    - `refreshDockState`
    - `syncSettingsMeta`
- 课程分目录既然已经自动保存，就不应再保留“保存分目录”按钮。

## 3. 坏味道清单

### 3.1 可直接判定为冗余或历史遗留

| 项目 | 证据 | 结论 |
| --- | --- | --- |
| `downloadMaterialBatchLegacy()` | 当前主线按钮调用 `downloadMaterialBatch()`，全仓无其他入口 | 可删候选 |
| 课程分目录 modal 内“保存分目录”按钮 | 行选择/清空已自动保存，同一数据再次提供手动保存 | 明显重复 |
| 多处“当前不在 Tauri 环境内...”文案 | 同类错误由业务层重复解释 | 应下沉到统一桥接/保存层 |

### 3.2 必须合并，但不能直接删

| 项目 | 证据 | 风险 | 结论 |
| --- | --- | --- | --- |
| `getRuntimeLabel()` + `getRuntimeTone()` | tone 依赖 label 字符串再二次派生 | 文案一改，颜色规则也易漂 | 应合并成单一状态模型 |
| `subscribeDockStateEvents()` + `refreshWindowDockState()` + 手动 refresh | 同一 `windowDock` 被三种机制维护 | 状态漂移、难定位 | 应定主次，不应直接删任一方 |
| 多个 `save_app_settings` handler | 每处副作用不完全相同 | 粗暴合并易引入回归 | 先抽公共保存助手，再迁移 |

### 3.3 目前不是坏代码，但已经职责过重

| 项目 | 证据 | 结论 |
| --- | --- | --- |
| `openSettingsModal()` | 同时负责表单构造、即时保存项、底部保存项、子 modal 跳转、反馈布局 | 应拆成 settings view builder + save controller |
| `downloadMaterialBatch()` | 同时负责请求组装、进度状态机、逐项 invoke、modal feedback 汇总 | 应保留行为，但拆内部职责 |
| `initialize()` | 同时负责绑定事件、桥接等待、首次数据加载、轮询启动、dock 订阅 | 应拆成 boot phases |

## 4. 分批重构路线

### 4.1 第一批：低风险直接收口

目标：减少重复代码，不改功能模型。

实施项：

1. 收口 Tauri 内部桥接：
   - 一个统一 invoke helper
   - 一个统一错误语义
2. 收口状态框派生：
   - 合并 runtime/download 状态文案、tone、clickable 派生
3. 收口设置保存助手：
   - 统一保存 patch、统一回写、统一反馈
4. 删除已确认冗余：
   - `downloadMaterialBatchLegacy()`
   - 课程分目录 modal 的“保存分目录”按钮

先后顺序：

1. bridge helper
2. status surface model
3. settings save helper
4. 删除 legacy

验证点：

- `Check / Collect / Login` 按钮行为不变
- 失败提示文案仍可见
- 下载状态行行为不变
- 课程分目录选择/清空仍会即时保存

### 4.2 第二批：状态源收口

目标：把“多源状态”压成“单主源 + 低频兜底”。

实施项：

1. dock 状态改成事件主导
2. `applyWindowDockState()` 纯化
3. UI 副作用与状态更新拆开
4. 初始化阶段拆成：
   - bridge ready
   - settings/runtime load
   - dock subscribe
   - periodic refresh

验证点：

- 侧收展开/收起/托盘恢复不回归
- modal 打开时侧收状态变化仍正确处理
- 没有事件时低频轮询仍可兜底

### 4.3 第三批：职责拆分

目标：把 `src/app.js` 从“大一统控制器”拆成几个内部模块。

建议拆分方向：

- `tauri-bridge`
- `dock-controller`
- `status-surface`
- `settings-controller`
- `download-controller`

当前已落地的拆分：

- `src/app/bridge.js`
- `src/app/course-renderer.js`
- `src/app/detail-controller.js`
- `src/app/download-controller.js`
- `src/app/formatters.js`
- `src/app/modal-ui.js`
- `src/app/state-models.js`
- `src/app/path-utils.js`
- `src/app/settings-controller.js`
- `src/app/settings-save.js`
- `src/app/dock-controller.js`

当前已完成的冗余消除：

- 删除 `downloadMaterialBatchLegacy()`
- 删除课程分目录 modal 中重复的“保存分目录”按钮
- 删除未使用的 `getCourseScopeLabel()`
- 删除 `app.js` 中已迁入 settings/download/detail/course renderer 的本地 helper 定义

当前阶段结论：

- “先拆分”这一步已经完成主要目标，`app.js` 已不再是巨型控制器。
- 后续前端再动刀，重点应从“继续拆文件”切换为“按模块逐个删冗余、收状态、压总量”。

验证点：

- 文件总行数和跨段引用下降
- 主要 UI 行为保持一致
- 新增功能时不再需要在 3 到 4 处同步改同一状态

## 5. 审计模板

后续复用到 `src-tauri/src/main.rs` 或下载链时，固定按以下模板审：

1. 这条主线的单一状态源是什么  
2. 谁能改这个状态  
3. 谁在消费这个状态  
4. 哪些地方在重复推导同一结果  
5. 哪些 fallback 是兼容层，哪些其实是历史补丁  
6. 哪些能直接删  
7. 哪些必须先抽象再删  
8. 重构顺序和验证点是什么

## 6. 本轮建议的落地顺序

如果下一轮继续前端减法，建议严格按下面顺序来：

1. 先删确认无入口的 legacy
2. 再抽 `saveSettingsPatch`
3. 再抽 `getStatusSurfaceModel`
4. 再收口 dock 状态同步
5. 再压缩 detail / modal builder 的重复组装

原因：

- 前三步收益高、风险低。
- dock 状态是最容易把 UI 搞回归的部分，应放在已有公共层之后再动。
- 物理拆分现在已经完成主要目标，后续该进入“按模块减法”的阶段。

## 7. JS 后的下一站

当前前端已经适合把焦点转向另外两条关键线：

1. Rust 壳层：
   - `src-tauri/src/main.rs`
   - 重点看 dock / tray / window command 是否还有重复判断和职责混杂
2. Rust 下载桥：
   - `src-tauri/src/downloads.rs`
   - 重点看单文件/批量下载桥接是否还能继续收口
3. TS request 主线：
   - `automation/request-collectors/common.ts`
   - `automation/request-collectors/full-collect.ts`
   - 重点看 full / summary 双模式和通知/资料/作业解析的重复逻辑
