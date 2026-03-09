<!-- markdownlint-disable MD033 MD041 -->

<div align="center">
  <h2>
    <img src="./ucasclasser-package/UCAS%20Classer.png" alt="UCAS Classer Logo" width="120" style="vertical-align: middle; margin-right: 15px;">
    <span style="font-family: 'Helvetica Neue', Helvetica, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-weight: 800; font-size: 36px; vertical-align: middle;">UCAS Classer</span>
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

- ✅ 登录保存已切到 SEP 入口，停在 portal 也可自动保存
- ✅ `auth:check` 已改为 API 检查
- ✅ 课程列表、模块入口、通知/资料/作业采集已大部分切到 request-driven
- ✅ 资料树递归、通知详情、受保护下载、本地 SQLite 导库已跑通
- ✅ 打包版已支持单实例、首次说明文件、已登录 Edge 打开通知原始页
- 🚧 当前主要工作转向：稳定性验证、发布整理

## 仓库提示

- `automation/`：认证、采集、下载脚本
- `src-tauri/`：桌面端后端与数据库导入逻辑
- `src/`：当前桌面前端
- `docs/archive-plans/`：已完成的计划与阶段性文档
