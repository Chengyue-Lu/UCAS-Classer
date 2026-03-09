# Package Lab

这个目录专门用来做打包实验，不直接污染主开发目录。

当前目标：

- 路径迁移
- 去掉运行时对 `npm run` 的依赖
- 后续接入 Node sidecar / runtime
- 最后再做 Tauri `bundle.resources` 和安装包验证

当前已经迁入的内容：

- `automation/`
- `shared/`
- `src/`
- `src-tauri/`
- `db/`
- `tests/`
- 根目录必要配置和说明文件

当前故意不迁入的内容：

- `.git/`
- `node_modules/`
- `data/`
- `automation/auth/data/`
- `src-tauri/target/`

这样做的目的：

- 保持打包实验目录干净
- 明确区分“源码运行态”和“安装态”
- 方便随时回滚到主目录当前稳定状态

当前进度：

1. 路径系统已迁移
   - 数据默认写入 `%APPDATA%\\UCAS Classer`
   - 缓存默认写入 `%LOCALAPPDATA%\\UCAS Classer\\cache`
2. Rust 运行器已去掉 `npm run`
   - 现在直接调用 `node runtime-dist/.../*.js`
   - 运行前需要先编译 `runtime-dist`

当前验证命令：

```powershell
npx tsc -p d:\lcy\ucasclasser-develop\ucasclasser-package\tsconfig.runtime.json
cargo run --quiet --manifest-path d:\lcy\ucasclasser-develop\ucasclasser-package\src-tauri\Cargo.toml --bin runtime_cli -- check
cargo run --quiet --manifest-path d:\lcy\ucasclasser-develop\ucasclasser-package\src-tauri\Cargo.toml --bin runtime_cli -- collect
```

下一步优先级：

1. 受控 Node runtime / sidecar
2. Tauri `bundle.resources`
3. 安装态路径验证
4. 安装包构建与回归测试
