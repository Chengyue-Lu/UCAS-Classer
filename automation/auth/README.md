# Auth

当前主线 auth 只保留 2 条正式链路：

1. `login-and-save-sep.ts`
   - 使用 UCAS Classer 专用的持久化浏览器 profile 打开 SEP 登录页
   - 从应用设置读取并填充 SEP 用户名；密码始终由用户手动输入且不保存
   - 首次 / 新设备登录落到新版 SEP 工作台时，自动补走“国科大在线” SSO 入口
   - 登录成功后自动保存 `storage-state.json`
2. `check-api.ts`
   - 直接用 request context 检查登录态
   - 不再启动浏览器

当前可用命令：

```powershell
npm run auth:reset
npm run auth:reset-browser
npm run auth:login
npm run auth:check
npm run test:auth
```

补充说明：

- `auth:login` 和 `auth:open` 现在都走 SEP 版登录链。
- `auth:reset` 只清理导出的登录会话，不会删除专用浏览器的设备与会话资料。
- `auth:reset-browser` 会删除 UCAS Classer 专用浏览器 profile，应在登录窗口关闭后使用。
- 不复用日常 Edge/Chrome profile，避免暴露其他站点资料或与已运行浏览器发生锁冲突。
- 图形验证码、设备验证仍由用户在可见浏览器中完成；脚本不会识别或代答验证码。
- `auth:check` 是当前唯一主线校验入口。
- `auth:check -- --refresh-storage-on-success` 仍然可用，runtime 的 cookie refresh 继续复用这条命令。
- 旧的浏览器调试脚本已移出主仓跟踪，归档在本机 `.local-archive/automation/auth/`。
- 如需临时调试旧链，先确认 `.local-archive/automation/auth/` 下存在完整副本，再直接运行：

```powershell
tsx .local-archive/automation/auth/login-and-save.ts
tsx .local-archive/automation/auth/check-auth.ts --headed
tsx .local-archive/automation/auth/webcheck.ts
```
