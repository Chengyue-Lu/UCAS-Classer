# 打包端运行层同步说明

## 2026-03-12 当前补充

- 当前运行共享层已覆盖下载目录选择、课程分目录、资料批量下载和下载状态显示。
- package 端仍保留系统路径存储约束；同步脚本不会覆盖 package 壳层中的系统路径解析逻辑。
- 发布前推荐流程已固定为：`--check -> --write -> package build`。

## 1. 目标

主仓是运行主线的唯一权威源码。  
`ucasclasser-package/` 只保留打包壳层和本地打包实验内容，运行主线通过同步脚本单向下发。

## 2. 三层边界

### `runtime-shared`

这部分只能在主仓编辑，再同步到本地 package：

- `src/index.html`
- `src/app.js`
- `src/styles.css`
- `shared/runtime-paths.ts`
- `automation/request-course-list/*`
- `automation/request-collectors/*`
- `automation/downloads/*`
- `automation/shared/*`
- `automation/auth/{browser,check-api,config,login-and-save-sep,open-authenticated-url,paths,reset,utils}.ts`
- `src-tauri/src/{app_data,app_settings,auth_runtime,db_import,downloads,lib}.rs`

### `package-shell`

这部分只允许在 `ucasclasser-package/` 手工维护，不由同步脚本覆盖：

- `ucasclasser-package/src-tauri/src/main.rs`
- `ucasclasser-package/src-tauri/src/paths.rs`
- `ucasclasser-package/src-tauri/src/script_runner.rs`
- `ucasclasser-package/scripts/prepare-runtime.mjs`
- `ucasclasser-package/package.json`
- `ucasclasser-package/src-tauri/resources/**`
- `ucasclasser-package/runtime-dist/**`

### `debug/archive`

这部分不再参与主线构建，也不再留在 package 主路径：

- 旧浏览器 collectors
- legacy auth 可见检查与旧登录脚本
- 仅用于本地对照的 auth repro/实验脚本

本地保留位置：

- `.local-archive/automation/**`
- `.local-archive/ucasclasser-package/**`

## 3. 同步命令

```powershell
node scripts/sync-package-runtime.mjs --check
node scripts/sync-package-runtime.mjs --write
```

约束：

- 目标目录固定为仓库根下本地 `ucasclasser-package/`
- 目录不存在时直接报错，不会自动创建外部路径
- `--write` 会清理 package 中 allowlist 范围内已经废弃的旧 collectors / debug auth 文件

## 4. package 侧约定

- package 端 `script_runner.rs` 只保留运行主线脚本入口：
  - `auth:reset`
  - `auth:open`
  - `auth:login`
  - `auth:check`
  - `auth:open-url`
  - `download:file`
  - `courses:collect`
  - `collect:all`
- `auth:check:headed`、`webcheck`、`auth:login:legacy` 不再出现在 package 主路径和打包产物中
- package 运行产物通过 `npm run build:runtime` 和 `npm run prepare:runtime` 重建，不手工修补 `runtime-dist`

## 5. 推荐流程

1. 先在主仓修改运行主线。
2. 运行主仓检查：
   - `npm run check`
   - `cargo check --manifest-path src-tauri/Cargo.toml`
3. 执行同步：
   - `node scripts/sync-package-runtime.mjs --check`
   - `node scripts/sync-package-runtime.mjs --write`
4. 在 package 端重建并检查：
   - `npm run check`
   - `npm run build:runtime`
   - `npm run tauri:build`
   - `cargo check --manifest-path src-tauri/Cargo.toml`

## 6. 禁止事项

- 不要直接把 package 端运行逻辑改成新的权威版本，再反向手工搬回主仓。
- 不要把 package 壳层逻辑混进同步脚本的 allowlist。
- 不要把 `.local-archive/` 里的旧逻辑重新接回构建链，除非明确做一次临时 debug 回切。
