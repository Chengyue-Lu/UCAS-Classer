# UCAS Classer 交接文档

更新时间：2026-09-03
文档定位：当前项目的总交接入口。  
阅读建议：先看本文，再按需打开 [program-map.md](/d:/lcy/ucasclasser-develop/docs/program-map.md)、[v1.1.x-v1.3.0-roadmap.md](/d:/lcy/ucasclasser-develop/docs/v1.1.x-v1.3.0-roadmap.md)、[package-runtime-sync.md](/d:/lcy/ucasclasser-develop/docs/package-runtime-sync.md)；历史背景可回看 [archive-completed/v1.0.1-v1.1.0progress.md](/d:/lcy/ucasclasser-develop/docs/archive-completed/v1.0.1-v1.1.0progress.md)。

## 1. 项目一句话

`UCAS Classer` 是一个围绕国科大课程平台构建的 Windows 桌面助手。当前主线已经从“浏览器页面驱动”切到“`request/API + 本地 SQLite` 驱动”，浏览器只保留在登录和少量登录态维护环节。

## 2. 当前版本状态

- 当前开发 / 打包基线：`v1.2.1`
- 当前状态：`1.2.1` 修复新版 SEP 首次登录桥接，并将确认后的更新安装改为静默模式
- 当前工作重点：登录态稳定性、未读红点稳定性、作业详情体验与 `1.3.0` 课表 / 待办规划

## 3. 最近一轮有效变更

### 3.1 登录与运行时

- interrupt 期间允许手动 `check` 继续探测恢复
- `check` 失败后不再急于 `reset` 本地旧登录态
- 默认 cookie refresh 间隔已从 `720` 分钟调整为 `1440` 分钟
- 登录成功后仍由新 `storage-state` 覆写旧状态，不依赖预先清空目录
- 首次或新浏览器登录落到新版 SEP 工作台时，会自动补走“国科大在线” SSO 入口以建立 MOOC 会话
- 验证码和设备验证仍保留人工完成，自动桥接只在已认证的 SEP 落地页触发

### 3.2 作业与详情

- 作业详情支持按需抓取与本地缓存
- 作业列表解析已兼容“同页同时存在 `待做` / `待批阅` / 已提交入口”的课程
- 已提交作业详情入口与待做作业入口现在会分别保留正确 URL
- `1.1.2` 修复已提交且已截止作业从标题入口打开会“无权访问”的问题：列表解析会优先保留可访问的“查看”入口，并在详情打开前用 `workId / workAnswerId` 重新接上最新 URL
- 作业详情缓存版本已升级，避免旧错误 URL 或旧清洗结果继续命中
- 已批阅 / 已完成详情页支持更完整正文提取；无法构造真实下载 URL 的附件会至少保留为 `附件：文件名`
- 作业顶部总览已收敛为 `未交 X / 总 Y`，作业提醒去重改为优先基于 `courseId + workId`

### 3.3 下载与安装包

- 下载目录支持系统文件夹选择器
- 课程分目录仍由前端计算 `relativeSubdir`
- 新安装且没有历史路径时，package 侧默认下载目录改为系统 `Downloads\\UCAS Classer`

### 3.4 未读红点与自动更新

- 新通知 / 新资料 / 新作业会写入 SQLite `content_read_state`，课程卡、模块标题、条目行和托盘会显示未读提示
- `content_read_state` 已收敛为 `identity_key + is_read` 两列；点击条目或托盘清除后标记已读，下一次成功导库会清理已读与已不存在条目
- `1.2.0` 接入 Tauri 官方 updater，更新源为 GitHub Release 的 `latest.json`
- 设置页新增“检查更新”和“打开 GitHub 仓库”；启动时自动检查更新，发现新版本后由用户确认下载并安装
- `1.2.1` 起用户确认后使用当前用户级静默安装，并在完成后自动重启应用
- 版本变化后首次启动会显示一次应用内简短更新说明

## 4. 当前稳定能力

### 4.1 登录与调度

- SEP 登录与 `storage-state` 保存
- `auth:check` API 化
- 启动自动 `check + full collect`
- 后台调度拆分为 `check / collect / cookie refresh`
- 自动 collect 已分为 `summary / full`
- `summary` 只做粗采探测，不导库
- `summary` 发现 diff 后，下一次自动 collect 升级为 `full`

### 4.2 数据采集与展示

- 课程列表、模块入口、资料、通知、作业主线均为 request 采集
- SQLite 导库与 dashboard 展示已稳定
- 课程按 `全部 / 当前学期 / 以往学期` 分类展示
- 作业详情已支持“点开按需抓取 + 本地缓存”
- 新通知 / 新资料 / 新作业的系统提醒已接入桌面端
- 新内容未读红点已接入课程卡、模块标题、条目行和托盘

### 4.3 下载与目录

- 下载目录支持系统文件夹选择器
- 支持课程分目录
- 课程分目录弹窗支持 `全部 / 当前学期 / 以往学期` 过滤显示
- 资料支持批量下载
- 资料树中的子文件夹结构会在本地保留
- 下载状态栏支持 `Waiting / Downloading / Success / Fail`

### 4.4 桌面壳层

- 托盘常驻
- 单实例
- 自动侧收 MVP
- dock 收起与边缘展开态会置顶
- 关闭主窗口后可从托盘恢复
- 托盘右键可清除所有未读
- `1.2.0` 起支持 GitHub Release 自动更新检测与确认安装

## 5. 当前目录职责

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

## 6. 当前文档体系

### 6.1 当前有效

- [development-handoff.md](/d:/lcy/ucasclasser-develop/docs/development-handoff.md)
  - 当前交接入口
- [program-map.md](/d:/lcy/ucasclasser-develop/docs/program-map.md)
  - 主程序地图、入口、调用链、风险点
- [v1.1.x-v1.3.0-roadmap.md](/d:/lcy/ucasclasser-develop/docs/v1.1.x-v1.3.0-roadmap.md)
  - `1.1.x -> 1.3.0` 路线
- [package-runtime-sync.md](/d:/lcy/ucasclasser-develop/docs/package-runtime-sync.md)
  - 主仓与 package 运行层同步规则

### 6.2 已归档

- [archive-completed/v1.0.1-v1.1.0progress.md](/d:/lcy/ucasclasser-develop/docs/archive-completed/v1.0.1-v1.1.0progress.md)
  - `1.0.1 -> 1.1.0` 阶段进度
- [archive-completed/README.md](/d:/lcy/ucasclasser-develop/docs/archive-completed/README.md)
  - 已完成审计与临时文档索引
- [archive-plans](/d:/lcy/ucasclasser-develop/docs/archive-plans)
  - 旧计划与历史阶段文档

## 7. 当前常用命令

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
npm run assignment:detail -- --course-id <id> --work-id <workId> --work-answer-id <workAnswerId> --work-url <url>

# 导库
npm run runtime:import

# 下载
npm run download:file -- --url <url> --output-dir <dir>
npm run download:batch -- --manifest <path> --output-dir <dir> --conflict overwrite

# 检查
npm run check
cargo check --manifest-path src-tauri/Cargo.toml

# package 发布辅助
cd ucasclasser-package
npm run tauri:build
cd ..
npx tauri signer sign --private-key-path (Resolve-Path "temp\ucas-classer-updater.key").Path --password= "ucasclasser-package\src-tauri\target\release\bundle\nsis\UCAS Classer_1.2.1_x64-setup.exe"
node scripts/generate-update-manifest.mjs --package-root=ucasclasser-package
```

## 8. 当前已知边界与风险

- 打包端仍是“主仓共享运行层 + package 壳层手工维护”的模式，不是完全单仓单入口。
- `1.2.0` 之前的安装包没有 updater，用户需要手动安装一次 `1.2.0`，后续版本才可自动更新。
- updater 私钥必须长期保存且不能提交；若私钥丢失或更换，已安装的 `1.2.0` 将无法信任后续更新包。
- `scripts/sync-package-runtime.mjs --check` 仍可能出现少量误报；以实际同步结果和编译结果为准。
- 登录失败原因目前仍需谨慎区分“cookie 失效”和“临时离线 / 网络异常”；不要轻易把失败等同于应清空本地状态。
- 自动侧收已经可用，但仍有体验打磨空间，尤其是动画手感和窗口恢复细节。
- 作业详情 `1.1.2` 已修复已截止已提交入口错链问题，但图片体验、真实附件下载链接覆盖率和复杂正文可读性仍有优化空间。
- 独立图片预览窗口的尝试已回退，当前不属于稳定能力，不要按该方案继续叠改。

## 9. 接手时优先注意

### 9.1 开发与打包边界

- 主仓是运行主线唯一权威源码
- `ucasclasser-package/` 只维护 package 壳层
- 打包端系统路径存储约束不能改

### 9.1.1 哪些可以脚本同步

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
  - `src-tauri/src/app_release.rs`
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

### 9.1.2 哪些需要手动同步

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
  - `ucasclasser-package/scripts/generate-update-manifest.mjs`
- package 资源与产物边界
  - `ucasclasser-package/src-tauri/resources/**`
  - `ucasclasser-package/runtime-dist/**`

这些文件之所以需要手动同步，主要是因为它们承载了开发端没有、但打包端必须保留的差异：

- 系统路径存储约束
- 打包时的 runtime 资源准备
- package 端的主窗口 / tray / shell 行为实现
- 安装包版本号与打包配置
- updater 签名、公钥、发布 manifest 生成

### 9.1.3 同步时的实际建议

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

### 9.2 中文文件

- 读取中文文档时按 UTF-8 处理
- 终端中出现中文乱码时，不要把乱码当成文件真实内容

### 9.3 下载链

- 现在统一规则是“前端负责计算最终 `relativeSubdir`，后端只按相对路径落盘”
- 不要再把课程分目录重复补到 Rust 层

## 10. 下一阶段建议

- `1.2.x` 继续验证自动更新链路、未读红点和登录态稳定性。
- `1.3.0` 可以把课表整合进主程序，并围绕课表逐步吸纳待办等时间组织能力。
- 路线细化见 [v1.1.x-v1.3.0-roadmap.md](/d:/lcy/ucasclasser-develop/docs/v1.1.x-v1.3.0-roadmap.md)。

## 11. 一句话结论

当前项目已经不是“探索期原型”，而是“主线已成型、模块边界已基本清楚、进入维护收口和发布整理期”的状态。后续工作重点不再是大规模重写，而是围绕体验、稳定性和发布流程继续做减法。
