# Tauri

桌面端已经恢复为当前主程序入口，负责把前端、运行时调度、Node 自动化脚本和 SQLite 展示串起来。

当前优先目标：

1. 运行时调度稳定
2. request 采集链稳定
3. SQLite 导库与展示稳定
4. 开发端与打包端同步稳定

当前主要模块：

- `src/main.rs`: Tauri 应用入口、窗口/托盘、command 暴露
- `src/auth_runtime.rs`: 调度、自动恢复、显式 check/collect/login、导库触发
- `src/app_settings.rs`: 应用设置与 runtime marker 持久化
- `src/db_import.rs`: 从 `data/cache/*.json` 导入 SQLite
- `src/app_data.rs`: 从 SQLite 读取 dashboard 数据给前端
- `src/downloads.rs`: 下载桥接
- `src/script_runner.rs`: Rust 调用 `npm run` 的执行桥
