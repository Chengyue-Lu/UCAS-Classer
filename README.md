<!-- markdownlint-disable MD033 MD041 -->

<div align="center">
  <h2>
    <img src=".\src-tauri\icons\UCAS Classer.square.png" alt="UCAS Classer Logo" width="30" style="vertical-align: middle; margin-right: 15px;">
    <span style="font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-weight: 800; font-size: 40px; vertical-align: middle;">UCAS Classer</span>
  </h2>

  <p><strong>一个围绕 UCAS 课程平台构建的轻量桌面助手。</strong></p>

  <p>
    <img src="https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white" alt="Platform" />
    <img src="https://img.shields.io/badge/Tauri-App-FFC131?logo=tauri&logoColor=white" alt="Tauri" />
  </p>

  <p><em>它的目标很简单：更快地看见课程、通知、资料和作业，把常用操作收进一个更顺手的小界面里。 ✨</em></p>
</div>
<br/>

## 这个项目在做什么

- 📚 聚合课程、通知、资料、作业
- 🔐 复用登录态，减少重复登录
- ⚡ 尽量用 API / request 路线完成刷新与采集
- 💾 本地落库，方便前端直接展示和后续扩展
- 📦 最终交付为可安装的桌面应用

## 当前进度

- ✅ 登录保存已切到 SEP 入口，`auth:check` 已改为 API 检查
- ✅ 课程列表、模块入口、通知 / 资料 / 作业采集主线已切到 request-driven
- ✅ 自动 collect 已拆成 `summary / full`
- ✅ 下载目录选择、课程分目录、资料批量下载已完成
- ✅ 作业详情已支持“点开按需抓取 + 本地缓存”
- ✅ 系统提醒已支持新通知 / 新资料 / 新作业按课程聚合提醒
- ✅ 桌面端已具备托盘常驻、单实例、自动侧收 MVP、启动自动 `check + full collect`
- 🚧 当前主要工作转向：体验打磨、双端回归、发布整理

## 仓库提示

- `automation/`：认证、采集、下载脚本
- `src-tauri/`：桌面端后端、运行时调度与数据库导入逻辑
- `src/`：当前桌面前端
- `docs/development-handoff.md`：当前交接入口
- `docs/program-map.md`：当前主线、入口、调用链与边界总图
- `docs/v1.0.1-v1.1.0progress.md`：版本进度
- `docs/archive-completed/`：已完成审计与临时文档归档
- `docs/archive-plans/`：历史计划与阶段文档

## 使用说明

- [使用说明](./使用说明.md)

## 开源协议

[GNU GPLv3](./LICENSE)
