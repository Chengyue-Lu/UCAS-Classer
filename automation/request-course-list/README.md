# Request Course List

这条路线只负责课程列表刷新。

当前入口：

```powershell
npm run courses:collect
```

当前行为：

1. 使用现有 `storage-state.json`
2. 直接 request 拉取课程列表主页
3. 同时拉取：
   - 全部课程
   - 当前学期课程
4. 在输出里切成三块：
   - `courses`：全部
   - `currentCourses`：当前学期
   - `pastCourses`：以前学期
4. 输出仍写回：
   - `data/cache/course-list.json`
   - `data/cache/course-list.html`

补充结论：

- 课程列表刷新已经可以纳入 request/API 路线
- 学期切换接口是 `/fyportal/courselist/getStudyCourse`
- 当前页面能直接解析出：
  - 当前 `sectionId`
  - 当前 `semesterNum`
  - 学期选项列表
- 课程卡本身不带单独学期字段，因此“以前学期”是通过：
  - 全部课程
  - 当前学期课程
  做差集得到的
