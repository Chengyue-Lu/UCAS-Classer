# Auth

当前正式认证链分成两部分：

1. `login-and-save-sep.ts`
   - 打开可见浏览器到 SEP 登录页
   - 手动完成登录
   - 一旦当前内存态 `storageState` 已能访问课程列表，就自动保存 `storage-state.json`
   - 不需要手动点击到新版课程列表页
2. `check-api.ts`
   - 直接用 request context 检查登录态
   - 不再启动浏览器

可用命令：
```powershell
npm run auth:reset
npm run auth:login
npm run auth:check
npm run webcheck
```

补充说明：
- `auth:login` 和 `auth:open` 现在都走 SEP 版本的新登录链。
- 老的浏览器登录脚本仍保留，可通过 `npm run auth:login:legacy` 手动回退测试。
- `auth:check` 现在是 API 版检查。
- `auth:check:headed` 仍保留旧的浏览器版可见检查，仅用于人工对照。
- `webcheck` 会用当前 `storage-state.json` 打开可见浏览器，方便肉眼确认。
- `auth:check -- --refresh-storage-on-success` 仍然可用，runtime 的 1h cookie 刷新逻辑继续复用这条命令。
