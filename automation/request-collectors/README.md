# Request Collectors

这条路线复用现有的 `storage-state.json`，但不再依赖打开课程页面做内容采集。

当前正式入口：

```powershell
npm run collect:all -- --concurrency 4
```

## 当前行为

1. 先复用现有 `courses:collect` 刷新课程列表。
2. 再用 request context 逐课解析：
   - `courseHomeUrl`
   - `materialsUrl`
   - `noticesUrl`
   - `assignmentsUrl`
3. 继续用 request context 抓取：
   - 资料树
   - 通知列表、详情、附件
   - 作业列表
4. 输出仍然写回原来的 `data/cache/*.json`，以便直接复用现有 Rust 导库逻辑。

## 已验证结果

- 新路线输出的 cache 文件名和结构与旧浏览器路线兼容。
- 对比基线目录 `data/cache-browser-baseline` 时：
  - `course-list.json` 语义一致
  - `full-collect-summary.json` 语义一致
  - 所有 `course-module / material-list / notice-list / assignment-list` 在忽略时间戳、artifact 路径和 `browserChannel` 后语义一致
- 现有 Rust 导库无需修改，已直接验证通过：

```powershell
npm run runtime:import
```

## 当前性能

2026-03-09 在当前开发机上的实测结果：

- 浏览器版全量内容采集：约 `51.27s`
- request-driven 全量内容采集：约 `5.43s`

当前内容采集阶段大约快 `9x+`。

## 当前边界

- `automation/auth` 没有改动。
- 课程列表刷新 `courses:collect` 仍复用现有浏览器链路。
- 这条路线目前已经覆盖：
  - 模块入口解析
  - 资料树递归
  - 通知详情与附件
  - 作业列表
