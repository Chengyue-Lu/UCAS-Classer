# Frontend App Modules

这部分是当前桌面前端的模块边界说明。目标不是解释每个按钮怎么用，而是帮助后续继续重构时，先知道代码应该落在哪一层。

## 入口

- `src/app.js`
  - 页面编排入口。
  - 负责拿 DOM、组装 controller、绑定页面事件、启动初始化流程。
  - 不再承载 settings / download / detail / course render 的具体实现。

## 模块分工

- `src/app/bridge.js`
  - Tauri bridge 访问层。
  - 统一 `invoke`、事件监听和 bridge-unavailable 错误语义。

- `src/app/state-models.js`
  - 运行状态和下载状态的纯派生模型。
  - UI 状态框文案和颜色应优先从这里派生。

- `src/app/formatters.js`
  - 时间、数量、设置摘要等纯格式化工具。

- `src/app/path-utils.js`
  - 下载目录、课程子目录、相对路径规范化。
  - 路径安全规则集中在这里，不要在业务代码里重复实现。

- `src/app/dock-controller.js`
  - dock 状态同步、转换互斥、resize 冷却与 hover 收回行为。
  - 主源是 Rust 侧 `dock-state-changed` 事件，轮询只是兜底。

- `src/app/settings-save.js`
  - 统一 settings 保存管线。
  - 任何设置写回都应优先走 `saveSettingsPatch(...)`。

- `src/app/settings-controller.js`
  - 设置 modal 和课程分目录 modal 的 UI 组装。

- `src/app/download-controller.js`
  - 单文件下载、资料批量下载、下载相对路径计算。

- `src/app/modal-ui.js`
  - 通用 modal UI builder。
  - 例如 chip、action button、text block、attachment list。

- `src/app/detail-controller.js`
  - 通知 / 资料 / 作业详情弹窗的组装与打开关闭行为。

- `src/app/course-renderer.js`
  - 课程卡片、模块卡片、分页和标题溢出滚动。

## 当前约定

- `app.js` 是 orchestration，不是工具箱。
- 纯规则尽量放进 `formatters.js`、`path-utils.js`、`state-models.js`。
- 一个模块只负责一条主线，不要再把“状态更新 + invoke + DOM 拼装 + 反馈提示”混回同一个函数。
- 需要改设置写回时，优先改 `settings-save.js` 和 `settings-controller.js`，不要在 `app.js` 里重新拼保存逻辑。
- 需要改下载路径规则时，优先看 `path-utils.js` 和 `download-controller.js`。
- 需要改 dock / tray 前端响应时，优先看 `dock-controller.js`。

## 后续建议

- 前端下一步不再以“继续拆文件”为主，而是按模块做减法。
- 优先级建议：
  1. `detail-controller.js` + `modal-ui.js`：继续合并重复 builder。
  2. `settings-controller.js`：压缩表单构建样板代码。
  3. `download-controller.js`：确认前端串行批量下载是否继续保留。
