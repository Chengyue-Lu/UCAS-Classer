# Auth

当前主认证链直接复制自 `experiments/auth-storage-repro/`。

可用命令：

```powershell
npm run auth:reset
npm run auth:login
npm run auth:check
npm run webcheck
```

如果想用可见浏览器验证：

```powershell
npm run auth:check:headed
```

流程：

1. `npm run auth:reset`
2. `npm run auth:login`
3. 在浏览器里手动登录，并手动打开课程列表页
4. 回终端按回车导出 `storageState`
5. `npm run auth:check`

`npm run webcheck` 会用保存下来的 `storageState` 打开一个可见浏览器，并直接进入课程列表页，方便肉眼确认。
