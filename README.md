# UCAS Classer Develop

当前仓库先按“后端优先”重建。

现阶段已恢复的主路径是认证最小链：

```powershell
npm run auth:reset
npm run auth:login
npm run auth:check
```

说明：

- `auth:login` 会打开浏览器让你手动登录。
- 登录后请在同一个浏览器里手动打开课程列表页。
- 回到终端按回车，脚本会导出 `storageState`。
- `auth:check` 会用这份 `storageState` 在新上下文里验证课程列表页是否仍然可访问。

实验版原始目录保留在 `experiments/auth-storage-repro/`，主认证目录复制到 `automation/auth/`。
