# Automation Shared

`automation/shared/` 承载当前仍被 request 主线复用的共享层。

当前保留内容：

- `cache-paths.ts`: cache 文件命名、artifacts 路径、目录初始化
- `collector-types.ts`: 课程、模块、通知、资料、作业快照协议
- `cache-utils.ts`: JSON 写入、cache 清理、并发工具

旧浏览器采集链已经移出主仓跟踪，仅保留在本机 `.local-archive/`。
