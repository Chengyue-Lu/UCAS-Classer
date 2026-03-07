# Collectors

Collectors are rebuilt on top of the verified `storageState` auth flow in `automation/auth/`.

Available command:

```powershell
npm run courses:collect
npm run collect:all
```

Outputs:
- `data/cache/course-list.json`
- `data/cache/course-list.html`
- `data/cache/course-list.png`
- `data/cache/course-module-<courseId>.json`
- `data/cache/material-list-<courseId>.json`
- `data/cache/notice-list-<courseId>.json`
- `data/cache/assignment-list-<courseId>.json`
- `data/cache/full-collect-summary.json`

`collect:all` supports `--concurrency`, for example:

```powershell
npm run collect:all -- --concurrency 4
```

The collectors only read `automation/auth/data/storage-state.json`. They do not modify the auth scripts.
