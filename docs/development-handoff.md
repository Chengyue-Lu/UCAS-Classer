# UCAS Classer 开发交接表

## 2026-03-13 / v1.0.4 补充更新
- 自动侧收 MVP 已接入开发端与打包端壳层：当前只支持左右边缘，不做上下吸附。
- 侧收配置已进入 `app-settings.json`，会保存自动侧收开关、上次贴边方向、展开尺寸和普通窗口位置。
- 侧收判定已改为基于显示器 `work_area` 的窗口外框区间命中；贴边或越过边缘均可命中。
- 托盘重开窗口时会先恢复正常展开尺寸，再进入常规贴边判定。
- `v1.0.4` 当前已作为打包发版基线，系统路径存储约束保持不变。
<!-- markdownlint-disable -->

## 2026-03-12 / v1.0.3 补充更新
- 下载目录现已支持系统文件夹选择器。
- 课程分目录现已接入设置持久化与下载链路，下载目标为“主下载目录 / 课程子目录 / 资料树父级目录”。
- 资料模块现已支持批量下载，并保留资料树中的嵌套文件夹结构；批量重名文件按覆盖处理。
- 主界面新增下载状态行：`Waiting / Downloading / Success / Fail`，成功态 20 秒后自动回到 `Waiting`。
- 登录态存储路径已对齐；开发端兼容仓库内 `data/auth/`，打包端继续走系统路径，不做回退。
- `ucasclasser-package/` 继续只维护 package 壳层，运行共享层通过 `scripts/sync-package-runtime.mjs` 下发。
- collect 已分成 `summary / full`：启动首次 collect 与手动 Collect 固定走 `full`，后台自动 collect 默认走 `summary`，当 summary 发现摘要 diff 时，会挂起“下一次自动 full”标记。
## 项目现状
- 当前开发主线已经从页面驱动逐步迁到 `API / request` 路线。
- 登录仍保留浏览器参与，但登录后的绝大多数动作已经不再依赖可见页面。
- 桌面端基于 `Tauri 2 + Rust + 原生前端 JS`。
- 数据持久化使用 `SQLite`，前端通过 Tauri 命令读取。
- 打包实验与正式发布工作放在 `ucasclasser-package/`，开发目录与打包目录已分离。

## 当前已稳定能力
- SEP 登录保存 `storage-state`
- API 化 `auth:check`
- API 化课程列表刷新
- API 化模块入口解析
- API 化资料 / 通知 / 作业采集
- 资料树递归解析
- 通知详情与附件导入
- 受保护资源下载
- SQLite 导库与前端展示
- 学期分类过滤：`全部 / 当前学期 / 以前学期`
- 托盘常驻、关闭后保留应用
- 单实例运行

## 目录说明
- `automation/auth/`
  - 正式认证链
  - `auth:login` 当前走 `login-and-save-sep.ts`
  - `auth:check` 当前走 `check-api.ts`
- `automation/request-course-list/`
  - 课程列表 request 路线
- `automation/request-collectors/`
  - 模块入口刷新、通知/资料/作业内容采集主线
- `automation/downloads/`
  - 受保护文件下载
- `src-tauri/`
  - 开发端 Rust 后端
- `src/`
  - 开发端前端
- `ucasclasser-package/`
  - 打包专用副本
  - 包含路径迁移、runtime 资源、sidecar 与安装包配置
- `docs/archive-plans/`
  - 已完成阶段文档归档

## 当前常用命令
- 开发端运行
  - `npm run tauri:dev`
- 登录 / 校验
  - `npm run auth:reset`
  - `npm run auth:login`
  - `npm run auth:check`
- 下载
  - `npm run download:file -- --url <url> --output-dir <dir>`
  - `npm run download:batch -- --manifest <path> --output-dir <dir> --conflict overwrite`
- 采集 / 导库
  - `npm run courses:collect`
  - `npm run collect:all -- --mode full --concurrency 4`
  - `npm run collect:all -- --mode summary --concurrency 4`
  - `npm run runtime:import`
- 检查
  - `npm run check`
  - `cargo check --manifest-path src-tauri/Cargo.toml`

## 运行时调度现状
- `check`、`collect`、`cookie refresh` 已分离。
- `check` 与 `collect` 允许并行，不再沿用旧浏览器链路的互斥思路。
- 应用启动时会主动做一轮 `check + full collect`，规避“首轮 collect 计时基准不直观”的问题。
- 后台自动 collect 默认走 `summary`，不抓通知详情，也不触发导库。
- `summary` 发现课程摘要变化后，不在同轮补跑，而是把下一次自动 collect 升级为 `full`。
- `cookie refresh` 仍然单独存在，因为它仍需后台浏览器。

## 设置页现状
- 下载目录独立一行
- 课程范围切换点击即生效
- 自动侧收开关点击即生效
- `Check / Collect / Cookie` 时间输入压缩到一行
- 其余设置仍通过“保存设置”统一提交

## 打包端说明
- 正式发布时只改 `ucasclasser-package/`
- 需要同步的通常是：
  - `src/`
  - `src-tauri/`
  - `automation/`
- 不要轻易覆盖 package 端已存在的这些能力：
  - 资源路径迁移
  - runtime 资源打包
  - 单实例
  - 首次使用说明
  - 打包专用 Node runtime 调度

## 当前已知边界
- 登录完全去浏览器化仍未并入主线，只在测试目录做过探索。
- `cookie refresh` 仍然依赖后台浏览器，不是纯 API。
- 某些页面中文在终端里显示会乱码；读取中文文件时应优先按 UTF-8 理解内容，而不是依赖终端直接显示。

## 下一阶段建议
- 通知 / 作业详情内部展示继续完善
- 通知 / 作业附件是否要批量下载可以单独评估
- 继续验证托盘与调度在打包端的长期稳定性
