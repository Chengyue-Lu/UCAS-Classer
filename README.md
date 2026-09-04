<!-- markdownlint-disable MD033 MD041 -->

<div align="center">
  <h2>
    <img src="./src-tauri/icons/UCAS Classer.square.png" alt="UCAS Classer Logo" width="30" style="vertical-align: middle; margin-right: 15px;">
    <span style="font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-weight: 800; font-size: 40px; vertical-align: middle;">UCAS Classer</span>
  </h2>

  <p><strong>一个围绕 UCAS 课程平台构建的轻量桌面助手。</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white" alt="Platform" />
    <img src="https://img.shields.io/badge/Tauri-App-FFC131?logo=tauri&logoColor=white" alt="Tauri" />
    <img src="https://img.shields.io/badge/Baseline-1.2.2-2f855a" alt="Baseline" />
  </p>

  <p><em>更快看到课程、通知、资料和作业，把常用操作收进一个更顺手的小界面。</em></p>
</div>

## 项目目标

- 聚合课程、通知、资料和作业信息。
- 复用登录态，减少重复登录。
- 尽量使用 request/API 路线完成刷新与采集。
- 使用本地 SQLite 支撑 dashboard、未读红点、作业详情缓存和后续扩展。
- 交付为 Windows 可安装桌面应用。

## 当前能力

- 登录态保存与 `auth:check` API 校验。
- 启动自动 `check + full collect`，后台 collect 支持 `summary / full`。
- 课程列表、模块入口、通知、资料、作业主线已切到 request-driven。
- 作业详情支持点开按需抓取、本地缓存、已提交/已截止入口修正。
- 通知、资料、作业支持系统提醒和应用内未读红点。
- 下载目录选择、课程分目录、资料批量下载。
- 托盘常驻、单实例、自动侧收 MVP。
- `1.2.0` 起接入 GitHub Release 自动更新检测；`1.2.1` 起用户确认后静默安装并自动重启。

## 版本状态

- 当前发布基线：`1.2.2`
- `1.1.x` 主线：作业详情与稳定性维护。
- `1.2.0` 主线：自动更新、应用内版本提醒、发布流程收口。
- `1.2.1` 修复：新版 SEP 首次登录桥接与静默更新安装。
- `1.2.2` 修复：持久化登录环境、窗口侧收稳定性与界面细节。
- `1.3.0` 规划：课表与待办整合。

## 仓库结构

- `automation/`：认证、采集、下载脚本。
- `src/`：桌面端前端页面与模块化 JS。
- `src-tauri/`：开发端 Rust 后端、调度、数据库导入和 Tauri command。
- `docs/development-handoff.md`：当前交接入口。
- `docs/program-map.md`：主程序地图、入口、调用链与风险点。
- `docs/package-runtime-sync.md`：主仓与 package 运行层同步规则。
- `ucasclasser-package/`：本地打包壳层目录，保留 package 侧差异。

## 常用命令

```powershell
npm run check
cargo check --manifest-path src-tauri/Cargo.toml

node scripts/sync-package-runtime.mjs --check
node scripts/sync-package-runtime.mjs --write
```

package 侧：

```powershell
cd ucasclasser-package
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
cd ..
npx tauri signer sign --private-key-path (Resolve-Path "temp\ucas-classer-updater.key").Path --password= "ucasclasser-package\src-tauri\target\release\bundle\nsis\UCAS Classer_1.2.2_x64-setup.exe"
node scripts/generate-update-manifest.mjs --package-root=ucasclasser-package
```

## 自动更新发布提示

`1.2.0` 之前的版本不包含 updater，需要用户手动安装一次 `1.2.0`。从 `1.2.0` 开始，只要后续 release 使用同一把 updater 私钥签名，并上传 NSIS 安装包、对应 `.sig` 和 `latest.json`，应用即可自动检测并提示安装新版本。

发布时不要提交 updater 私钥；本地私钥默认放在被忽略的 `temp/` 目录。打包时将 `TAURI_SIGNING_PRIVATE_KEY` 设置为私钥文件路径或私钥内容。

## 使用说明

- [使用说明](./使用说明.md)

## 开源协议

[GNU GPLv3](./LICENSE)
