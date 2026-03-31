# UCAS Classer 交接文档

更新时间：2026-03-17  
文档定位：当前项目的总交接入口。  
阅读建议：先看本文，再按需打开 [program-map.md](/d:/lcy/ucasclasser-develop/docs/program-map.md) 和 [v1.0.1-v1.1.0progress.md](/d:/lcy/ucasclasser-develop/docs/v1.0.1-v1.1.0progress.md)。

## 1. 项目一句话

`UCAS Classer` 是一个围绕国科大课程平台构建的 Windows 桌面助手。当前主线已经从“浏览器页面驱动”切到“`request/API + 本地 SQLite` 驱动”，浏览器只保留在登录和少量登录态维护环节。

## 2. 当前版本状态

- 当前开发 / 打包基线：`v1.1.0`
- 当前状态：`v1.1.0` 已作为当前发布基线
- 后续工作重点：发布后体验迭代、稳定性跟踪和局部精修

## 3. 当前稳定能力

### 3.1 登录与运行时

- SEP 登录与 `storage-state` 保存
- `auth:check` API 化
- 启动自动 `check + full collect`
- 后台调度拆分为 `check / collect / cookie refresh`
- 自动 collect 已分为 `summary / full`
- `summary` 只做粗采探测，不导库
- `summary` 发现 diff 后，下一次自动 collect 升级为 `full`

### 3.2 数据采集与展示

- 课程列表、模块入口、资料、通知、作业主线均为 request 采集
- SQLite 导库与 dashboard 展示已稳定
- 课程按 `全部 / 当前学期 / 以往学期` 分类展示
- 作业详情已支持“点开按需抓取 + 本地缓存”
- 新通知 / 新资料 / 新作业的系统提醒已接入桌面端

### 3.3 下载与目录

- 下载目录支持系统文件夹选择器
- 支持课程分目录
- 课程分目录弹窗支持 `全部 / 当前学期 / 以往学期` 过滤显示
- 资料支持批量下载
- 资料树中的子文件夹结构会在本地保留
- 下载状态栏支持 `Waiting / Downloading / Success / Fail`

### 3.4 桌面壳层

- 托盘常驻
- 单实例
- 自动侧收 MVP
- dock 收起与边缘展开态会置顶
- 关闭主窗口后可从托盘恢复

## 4. 当前目录职责

- `src/`
  - 前端页面与模块化 JS
  - `src/app.js` 现在只是 orchestration 入口
  - 具体逻辑已拆到 `src/app/*.js`
- `src-tauri/`
  - 开发端 Rust 运行层
  - `main.rs` 负责 Builder 和 command 注册
  - `desktop_shell.rs` 负责窗口、dock、tray
  - `auth_runtime.rs` 负责调度核心
- `automation/auth/`
  - 登录、登录态校验、打开已登录页面
- `automation/request-course-list/`
  - 课程列表采集
- `automation/request-collectors/`
  - 模块入口、资料、通知、作业、作业详情采集
- `automation/downloads/`
  - 受保护文件下载
- `automation/shared/`
  - request 主线共享工具
- `docs/`
  - 当前有效文档与归档文档
- `ucasclasser-package/`
  - 本地打包壳层目录
  - 继续走系统路径存储，不是主仓权威源码

## 5. 当前文档体系

### 5.1 当前有效

- [development-handoff.md](/d:/lcy/ucasclasser-develop/docs/development-handoff.md)
  - 当前交接入口
- [program-map.md](/d:/lcy/ucasclasser-develop/docs/program-map.md)
  - 主程序地图、入口、调用链、风险点
- [v1.0.1-v1.1.0progress.md](/d:/lcy/ucasclasser-develop/docs/v1.0.1-v1.1.0progress.md)
  - 版本进度与下阶段 focus
- [package-runtime-sync.md](/d:/lcy/ucasclasser-develop/docs/package-runtime-sync.md)
  - 主仓与 package 运行层同步规则

### 5.2 已归档

- [archive-completed/README.md](/d:/lcy/ucasclasser-develop/docs/archive-completed/README.md)
  - 已完成审计与临时文档索引
- [archive-plans](/d:/lcy/ucasclasser-develop/docs/archive-plans)
  - 旧计划与历史阶段文档

## 6. 当前常用命令

```powershell
# 开发端
npm run tauri:dev

# 登录与校验
npm run auth:reset
npm run auth:login
npm run auth:check

# 采集
npm run courses:collect
npm run collect:all -- --mode full --concurrency 4
npm run collect:all -- --mode summary --concurrency 4

# 作业详情单独抓取
npm run assignment:detail -- --course-id <id> --work-url <url>

# 导库
npm run runtime:import

# 下载
npm run download:file -- --url <url> --output-dir <dir>
npm run download:batch -- --manifest <path> --output-dir <dir> --conflict overwrite

# 检查
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
```

## 7. 当前已知边界与风险

- 打包端仍是“主仓共享运行层 + package 壳层手工维护”的模式，不是完全单仓单入口。
- `scripts/sync-package-runtime.mjs --check` 仍可能出现少量误报；以实际同步结果和编译结果为准。
- 自动侧收已经可用，但仍有体验打磨空间，尤其是动画手感和窗口恢复细节。
- 作业详情第一版已经落地，但详情清洗与图片体验仍有优化空间。
- 独立图片预览窗口的尝试已回退，当前不属于稳定能力，不要按该方案继续叠改。

## 8. 接手时优先注意

### 8.1 开发与打包边界

- 主仓是运行主线唯一权威源码
- `ucasclasser-package/` 只维护 package 壳层
- 打包端系统路径存储约束不能改

### 8.1.1 哪些可以脚本同步

以下内容属于 `runtime-shared`，可通过 `node scripts/sync-package-runtime.mjs --write` 从主仓同步到本地 `ucasclasser-package/`：

- 前端共享层
  - `src/index.html`
  - `src/app.js`
  - `src/styles.css`
  - `src/app/*`
- TS 自动化共享层
  - `automation/request-course-list/*`
  - `automation/request-collectors/*`
  - `automation/downloads/*`
  - `automation/shared/*`
  - `automation/auth/{browser,check-api,config,login-and-save-sep,open-authenticated-url,paths,reset,utils}.ts`
  - `shared/runtime-paths.ts`
- Rust 运行共享层
  - `src-tauri/src/app_data.rs`
  - `src-tauri/src/assignment_details.rs`
  - `src-tauri/src/app_settings.rs`
  - `src-tauri/src/auth_runtime.rs`
  - `src-tauri/src/db_import.rs`
  - `src-tauri/src/downloads.rs`
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/reminders.rs`

说明：

- 这些文件默认以主仓为权威，不应先改 package 再反向搬回主仓。
- 同步前推荐先跑：
  - `npm run check`
  - `cargo check --manifest-path src-tauri/Cargo.toml`

### 8.1.2 哪些需要手动同步

以下内容属于 `package-shell`，因为开发端与打包端存在职责差异，需要人工维护，不能依赖同步脚本覆盖：

- package Rust 壳层
  - `ucasclasser-package/src-tauri/src/main.rs`
  - `ucasclasser-package/src-tauri/src/paths.rs`
  - `ucasclasser-package/src-tauri/src/script_runner.rs`
- package 打包链
  - `ucasclasser-package/package.json`
  - `ucasclasser-package/src-tauri/Cargo.toml`
  - `ucasclasser-package/src-tauri/tauri.conf.json`
  - `ucasclasser-package/scripts/prepare-runtime.mjs`
- package 资源与产物边界
  - `ucasclasser-package/src-tauri/resources/**`
  - `ucasclasser-package/runtime-dist/**`

这些文件之所以需要手动同步，主要是因为它们承载了开发端没有、但打包端必须保留的差异：

- 系统路径存储约束
- 打包时的 runtime 资源准备
- package 端的主窗口 / tray / shell 行为实现
- 安装包版本号与打包配置

### 8.1.3 同步时的实际建议

推荐顺序：

1. 先在主仓改共享运行层
2. 执行主仓检查
3. 运行 `node scripts/sync-package-runtime.mjs --write`
4. 再人工检查 package 壳层是否需要跟进改动
5. 在 `ucasclasser-package/` 内重新执行：
   - `npm run check`
   - `npm run build:runtime`
   - `cargo check --manifest-path src-tauri/Cargo.toml`

补充说明：

- `node scripts/sync-package-runtime.mjs --check` 目前仍可能出现少量误报，不能单靠它判断 package 侧不可用。
- 真正判断同步是否成功，应同时看：
  - 共享文件是否已实际覆盖
  - package 端 TS 检查
  - package 端 Rust 编译
  - 最终打包结果

### 8.2 中文文件

- 读取中文文档时按 UTF-8 处理
- 终端中出现中文乱码时，不要把乱码当成文件真实内容

### 8.3 下载链

- 现在统一规则是“前端负责计算最终 `relativeSubdir`，后端只按相对路径落盘”
- 不要再把课程分目录重复补到 Rust 层

## 9. 下一阶段建议

`v1.1.0` 发布后，建议按下面顺序继续：

1. 继续打磨自动侧收、托盘恢复和窗口手感
2. 精修作业详情内容清洗与图片体验
3. 持续观察通知 / 资料 / 作业提醒的真实使用反馈
4. 评估 `1.1.x` 维护修复与下一阶段功能优先级

## 10. 一句话结论

当前项目已经不是“探索期原型”，而是“主线已成型、模块边界已基本清楚、进入收口和发布整理期”的状态。后续工作重点不再是大规模重写，而是围绕体验、稳定性和发布流程继续做减法。
