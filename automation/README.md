# Automation

当前主线已经不是“恢复最小认证链”，而是“围绕已保存登录态的 request-driven 采集与桌面运行时”。

目录约定：

- `auth/`: 登录、登录态校验、登录态打开原页、人工调试
- `request-course-list/`: request 版课程列表刷新主入口
- `request-collectors/`: request 版模块入口、通知、资料、作业采集主线
- `downloads/`: 受保护文件下载
- `shared/`: 仍被 request 主线复用的路径、类型、cache 工具层

旧浏览器采集链与 legacy auth 调试脚本已经移出主仓跟踪，仅保留在本机 `.local-archive/` 作为代码参考。

当前主线命令：

```powershell
npm run auth:login
npm run auth:check
npm run courses:collect
npm run collect:all -- --concurrency 4
npm run download:file -- --url <url> --output-dir <dir>
```
