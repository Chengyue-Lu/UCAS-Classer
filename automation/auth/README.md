# Auth

当前主线 auth 只保留 2 条正式链路：

1. `login-and-save-sep.ts`
   - 打开可见浏览器到 SEP 登录页
   - 登录成功后自动保存 `storage-state.json`
2. `check-api.ts`
   - 直接用 request context 检查登录态
   - 不再启动浏览器

当前可用命令：

```powershell
npm run auth:reset
npm run auth:login
npm run auth:check
```

补充说明：

- `auth:login` 和 `auth:open` 现在都走 SEP 版登录链。
- `auth:check` 是当前唯一主线校验入口。
- `auth:check -- --refresh-storage-on-success` 仍然可用，runtime 的 cookie refresh 继续复用这条命令。
- 旧的浏览器调试脚本已移出主仓跟踪，归档在本机 `.local-archive/automation/auth/`。
- 如需临时调试旧链，先确认 `.local-archive/automation/auth/` 下存在完整副本，再直接运行：

```powershell
tsx .local-archive/automation/auth/login-and-save.ts
tsx .local-archive/automation/auth/check-auth.ts --headed
tsx .local-archive/automation/auth/webcheck.ts
```
