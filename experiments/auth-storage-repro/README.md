# Auth Storage Repro

只验证一件事：

- 手动登录后导出的 `storageState.json`
- 能不能在下一次新浏览器上下文里恢复课程列表页登录态

## Commands

```powershell
npm run repro:auth:reset
npm run repro:auth:login
npm run repro:auth:check
```

如果想看可见浏览器验证：

```powershell
npm run repro:auth:check -- --headed
```

## Flow

1. 运行 `npm run repro:auth:reset`
2. 运行 `npm run repro:auth:login`
3. 在浏览器里手动登录
4. 手动打开课程列表页，确认当前页面已经是登录状态
5. 回到终端按回车，脚本会导出 `storageState.json`
6. 运行 `npm run repro:auth:check`

## Output

输出文件都在 `experiments/auth-storage-repro/data/`：

- `storage-state.json`
- `login-metadata.json`
- `artifacts/after-login-save.html`
- `artifacts/after-login-save.png`
- `artifacts/check-auth.html`
- `artifacts/check-auth.png`
