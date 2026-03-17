# TS Request 主线审计

更新时间：2026-03-15  
审计范围：`automation/request-collectors/*.ts`、`automation/request-course-list/*.ts`、`automation/shared/collector-types.ts`。  
本轮目标：梳理 request 采集主线的职责边界、重复逻辑和下一步重构顺序，并先完成少量低风险去重。

## 1. 结论摘要

当前 TS 采集主线不是“架构失控”，而是进入了“主线清楚，第一轮解析域拆分已完成，下一步该继续做减法”的阶段：

- `full-collect.ts` 已经承担了三件事：
  - per-course 编排
  - `full / summary` 模式切换
  - diff / fingerprint 输出
- `common.ts` 现在已经回落为 compatibility barrel。
- 解析实现已拆到：
  - `request-core.ts`
  - `material-parser.ts`
  - `notice-parser.ts`
  - `assignment-parser.ts`
- `course-list.ts` 仍然是清楚的入口，但里面保留了一小部分和 `request-core.ts` 相似的 HTML/URL 处理 helper。

这条线当前最需要的不是“大拆重写”，而是：

1. 明确 `full-collect.ts` 只做编排
2. 明确 `common.ts` 只保留兼容出口，不再继续承载实现
3. 逐步把跨文件的小型重复 helper 收拢

## 2. 当前主线分层

### 2.1 `automation/request-course-list/course-list.ts`

职责：

- 拉课程列表页
- 拉 `getStudyCourse`
- 归一化课程列表
- 计算 current / past term 分类

当前结论：

- 入口清楚，职责相对单一。
- 仍保留少量本地 helper：
  - `resolveUrl`
  - `decodeHtml`
  - `matchAttribute`
- 这些 helper 和 `request-core.ts` 中的 URL / attribute 处理有轻微重复，但当前不建议强行抽并，避免把 course-list 也拖进更重的解析依赖。

### 2.2 `automation/request-collectors/full-collect.ts`

职责：

- 按课程并发编排 collect
- 按 `full / summary` 选择通知详情采集策略
- 生成 per-course summary fingerprint
- 写 `full-collect-summary.json`
- 写 `collect-fingerprint-state.json`

当前问题：

- 之前对“成功且带 fingerprint 的结果”做了两次重复过滤。
- fingerprint / summary 写出段和结果映射仍然可以继续压缩。

本轮已完成：

- 提取 `CollectCourseResult` / `SuccessfulFingerprintResult`
- 提取 `getSuccessfulFingerprintResults(...)`
- 统一了成功结果过滤逻辑
- 把 `full-collect.ts` 对解析逻辑的依赖改为直接引用解析域模块
- 提取课程汇总项映射和三类空快照 helper

当前结论：

- 这一步已经比之前更像 orchestrator。
- 下一轮更适合继续压缩 fingerprint / summary 写出这段的职责。

### 2.3 `automation/request-collectors/common.ts`

职责：

- 兼容导出层
- 旧调用面的稳定入口

当前问题：

- 如果长期继续把实现留在这里，会再次回到单文件工具箱。

当前结论：

- 这一层现在已经收成 compatibility barrel。
- 新增的解析域拆分为：
  - `request-core.ts`
  - `material-parser.ts`
  - `notice-parser.ts`
  - `assignment-parser.ts`
- 后续新代码应优先直接依赖解析域模块，而不是继续把实现堆回 `common.ts`。

## 3. 当前已确认的重复点

### 3.1 已处理

- `full-collect.ts` 中成功 fingerprint 结果的重复过滤已收口。
- `full-collect.ts` 中 materials / notices / assignments 的空快照分支已抽成 helper。
- `full-collect.ts` 已不再通过 `common.ts` 间接引用解析逻辑。

### 3.2 已确认但暂未处理

- `course-list.ts` 与 `request-core.ts` 都存在 HTML decode / URL resolve / attribute match 类 helper。
- `request-core.ts` 内部有多组字符串清洗 helper，部分语义接近：
  - `normalizeText`
  - `normalizeTextLikeBrowser`
  - `stripTags`
  - `stripTagsLikeBrowser`

这些目前还不建议直接硬并，因为它们虽然相似，但用途并不完全一致。

## 4. 当前不要直接做的事

1. 不要现在就把 `course-list.ts` 的 helper 全部并进 `request-core.ts`。
2. 不要为了“减少行数”合并 `normalizeText` 和 `normalizeTextLikeBrowser`。
3. 不要直接把通知详情采集从 `full` 模式里拿掉；这会影响当前 collect / import 契约。

## 5. 下一步建议顺序

1. 继续把调用点从 `common.ts` 迁到解析域模块
2. 再看 `full-collect.ts`
   - 是否继续把 fingerprint / summary 写出段拆成 helper
3. 最后再决定
   - `course-list.ts` 的小 helper 是否要和 `request-core.ts` 共享
