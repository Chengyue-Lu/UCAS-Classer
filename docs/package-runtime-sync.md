# 打包端运行层同步说明

更新时间：2026-09-03
文档定位：说明主仓运行层与本地 `ucasclasser-package/` 的同步边界。

## 1. 基本原则

- 主仓是运行主线唯一权威源码
- `ucasclasser-package/` 只保留 package 壳层和打包侧专属逻辑
- 打包端继续走系统路径存储
- 同步方向固定为：主仓 -> package

## 2. 当前同步命令

```powershell
node scripts/sync-package-runtime.mjs --check
node scripts/sync-package-runtime.mjs --write
```

## 3. 当前 `runtime-shared`

### 单文件

- `src/index.html`
- `src/app.js`
- `src/styles.css`
- `shared/runtime-paths.ts`
- `automation/auth/{browser,check-api,config,login-and-save-sep,open-authenticated-url,paths,reset,utils}.ts`
- `src-tauri/src/app_data.rs`
- `src-tauri/src/app_release.rs`
- `src-tauri/src/assignment_details.rs`
- `src-tauri/src/app_settings.rs`
- `src-tauri/src/auth_runtime.rs`
- `src-tauri/src/db_import.rs`
- `src-tauri/src/downloads.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/reminders.rs`

### 目录

- `src/app/`
- `automation/downloads/`
- `automation/request-course-list/`
- `automation/request-collectors/`
- `automation/shared/`

## 4. 当前 `package-shell`

这些内容继续只在 `ucasclasser-package/` 手工维护：

- `ucasclasser-package/src-tauri/src/main.rs`
- `ucasclasser-package/src-tauri/src/paths.rs`
- `ucasclasser-package/src-tauri/src/script_runner.rs`
- `ucasclasser-package/scripts/prepare-runtime.mjs`
- `ucasclasser-package/scripts/generate-update-manifest.mjs`
- `ucasclasser-package/package.json`
- `ucasclasser-package/src-tauri/resources/**`
- `ucasclasser-package/runtime-dist/**`

说明：

- 自动侧收、tray、系统路径解析都属于 package 壳层的一部分
- updater 插件初始化、安装包版本号、签名配置和 release manifest 生成属于 package 发布链路，需要人工复核
- 不要把 package 壳层逻辑反向当成主仓权威版本

## 5. 当前 `debug/archive`

这部分不再参与主线构建：

- 旧浏览器 collectors
- legacy auth 调试脚本
- 本地实验性 auth repro

本地归档位置：

- `.local-archive/automation/**`
- `.local-archive/ucasclasser-package/**`

## 6. 推荐流程

1. 先在主仓修改运行主线
2. 运行主仓检查
3. 执行同步
4. 在 package 端重建 runtime 并检查

推荐命令：

```powershell
npm run check
cargo check --manifest-path src-tauri/Cargo.toml
node scripts/sync-package-runtime.mjs --check
node scripts/sync-package-runtime.mjs --write
```

package 端：

```powershell
npm run check
npm run build:runtime
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build
```

自动更新发布注意：

- `1.2.0` 起需要对 NSIS 安装包签名后生成 `latest.json`
- 私钥不要提交，当前本机建议放在被忽略的 `temp/` 目录
- GitHub Release 需要上传 NSIS 安装包、对应 `.sig` 和 `latest.json`
- 如果 `tauri build` 在自动签名阶段卡住，使用主仓命令手动签名：
  `npx tauri signer sign --private-key-path (Resolve-Path "temp\ucas-classer-updater.key").Path --password= "ucasclasser-package\src-tauri\target\release\bundle\nsis\UCAS Classer_1.2.1_x64-setup.exe"`
- 生成 manifest：
  `node scripts/generate-update-manifest.mjs --package-root=ucasclasser-package`

## 7. 当前已知边界

- `scripts/sync-package-runtime.mjs --check` 仍可能出现少量误报，不能单靠它判断 package 运行层不可用。
- package 端是否可用，应同时看：
  - 同步结果
  - package 端 `npm run check`
  - package 端 `cargo check`
  - 真实打包结果
