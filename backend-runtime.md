# Backend Runtime Notes

This file is the single reference for the current backend/runtime behavior.

## 1. Scope

Current backend is split into 4 isolated layers:

1. `automation/auth`
   Source of truth for login, reset, auth check, and storage-state refresh.
2. `automation/collectors`
   Source of truth for course/module/material/notice/assignment scraping.
3. `src-tauri/src/auth_runtime.rs`
   Scheduler and flag orchestration. It does not reimplement auth logic.
4. `src-tauri/src/db_import.rs`
   Rust-side JSON -> SQLite import.

Important rule:

- Rust runtime only orchestrates existing auth/collector scripts.
- Auth scripts remain the only place that touches login logic.

## 2. Auth Scripts

Implemented in:

- [login-and-save.ts](/d:/lcy/ucasclasser-develop/automation/auth/login-and-save.ts)
- [check-auth.ts](/d:/lcy/ucasclasser-develop/automation/auth/check-auth.ts)
- [reset.ts](/d:/lcy/ucasclasser-develop/automation/auth/reset.ts)
- [webcheck.ts](/d:/lcy/ucasclasser-develop/automation/auth/webcheck.ts)

Commands:

```powershell
npm run auth:reset
npm run auth:login
npm run auth:check
npm run auth:check:headed
npm run webcheck
```

Behavior:

- `auth:login`
  Opens a visible browser.
  You manually log in.
  When the script detects the authenticated course list page, it automatically saves `storage-state.json` and closes the browser.
- `auth:check`
  Uses `storage-state.json` to create a fresh browser context and verify whether the course list page is still accessible.
- `auth:check -- --refresh-storage-on-success`
  Same as normal check, but if auth succeeds it re-exports the latest `storage-state.json`.
- `auth:reset`
  Deletes local auth state.
- `webcheck`
  Visible version of `auth:check`.

Auth data files:

- [storage-state.json](/d:/lcy/ucasclasser-develop/automation/auth/data/storage-state.json)
- [artifacts](/d:/lcy/ucasclasser-develop/automation/auth/data/artifacts)

## 3. Collector Scripts

Implemented in:

- [course-list.ts](/d:/lcy/ucasclasser-develop/automation/collectors/course-list.ts)
- [module-urls.ts](/d:/lcy/ucasclasser-develop/automation/collectors/module-urls.ts)
- [material-list.ts](/d:/lcy/ucasclasser-develop/automation/collectors/material-list.ts)
- [notice-list.ts](/d:/lcy/ucasclasser-develop/automation/collectors/notice-list.ts)
- [assignment-list.ts](/d:/lcy/ucasclasser-develop/automation/collectors/assignment-list.ts)
- [full-collect.ts](/d:/lcy/ucasclasser-develop/automation/collectors/full-collect.ts)

Commands:

```powershell
npm run courses:collect
npm run collect:all -- --concurrency 4
```

Collector output directory:

- [data/cache](/d:/lcy/ucasclasser-develop/data/cache)

Important final marker:

- [full-collect-summary.json](/d:/lcy/ucasclasser-develop/data/cache/full-collect-summary.json)

The database importer only trusts this file when:

- `failureCount == 0`
- `successCount == courseCount`

## 4. Runtime Scheduler

Implemented in:

- [auth_runtime.rs](/d:/lcy/ucasclasser-develop/src-tauri/src/auth_runtime.rs)
- [runtime_cli.rs](/d:/lcy/ucasclasser-develop/src-tauri/src/bin/runtime_cli.rs)

Tauri commands exported for later frontend use:

- `start_runtime_scheduler`
- `stop_runtime_scheduler`
- `get_runtime_status`
- `run_auth_check`
- `run_explicit_auth_check`
- `run_interrupt_login`
- `run_auth_clear`
- `acknowledge_hourly_refresh_due`
- `mark_hourly_refresh_due`
- `mark_collect_refresh_due`
- `clear_collect_refresh_due`
- `mark_db_import_due`
- `clear_db_import_due`
- `run_full_collect`
- `run_db_import`

Current intervals:

- `3min` auth check slot
- `1h` hourly slot

Override for testing:

```powershell
$env:UCAS_AUTH_CHECK_INTERVAL_SECS='15'
$env:UCAS_HOURLY_INTERVAL_SECS='90'
```

## 5. Automatic Closed Loop

Current closed loop is:

1. Scheduler starts.
2. Scheduler immediately attempts one auth check.
3. Every 3 minutes:
   Runtime attempts `auth:check`, unless blocked.
4. Every 1 hour:
   Runtime sets:
   - `hourly_refresh_due = true`
   - `collect_refresh_due = true`
5. On the next successful auth check:
   - if `hourly_refresh_due == true`, runtime runs:
     `auth:check -- --refresh-storage-on-success`
   - if `storage-state.json` was actually refreshed, runtime clears `hourly_refresh_due`
6. If auth is currently online and `collect_refresh_due == true`:
   - runtime starts full collection
7. After full collection succeeds:
   - runtime immediately imports the new JSON batch into SQLite
8. Import success clears `db_import_due`

Important import trigger:

- Import is not based on random JSON mtimes.
- Import compares:
  - latest `full-collect-summary.json.finishedAt`
  - database meta `last_imported_collect_finished_at`
- If they differ, import is due.

## 6. Interrupt Logic

Interrupt flow exists to stop repeated broken checks:

1. `auth:check` fails
2. runtime sets `interrupt_flag = true`
3. runtime runs `auth:reset`
4. runtime launches visible `auth:login`
5. login script saves a fresh `storage-state.json`
6. runtime runs a recovery auth check
7. interrupt is cleared only if:
   - recovery check succeeded
   - and `storage-state.json` is newer than the file version recorded when interrupt started

While `interrupt_flag == true`:

- normal scheduled check does not run
- explicit auth check does not run

## 7. Flags

Core boolean flags in `RuntimeSnapshot`:

- `scheduler_running`
  Scheduler loop is active.
- `interrupt_flag`
  Auth is interrupted and normal checking is blocked.
- `auth_check_running`
  Scheduled or recovery auth check is running.
- `explicit_check_running`
  Explicit/manual auth check is running.
- `reset_running`
  `auth:reset` is running.
- `login_running`
  Visible `auth:login` is running.
- `hourly_refresh_due`
  Next successful auth check should refresh `storage-state.json`.
- `collect_refresh_due`
  Full collection should run when allowed.
- `collect_refresh_running`
  Full collection is currently running.
- `db_import_due`
  SQLite import is pending for a newer collect batch.
- `db_import_running`
  SQLite import is currently running.

Important timestamp/status fields:

- `last_auth_check_ok`
- `last_auth_check_at_ms`
- `last_auth_check_source`
- `last_cookie_refresh_at_ms`
- `last_collect_due_at_ms`
- `last_collect_started_at_ms`
- `last_collect_finished_at_ms`
- `last_collect_ok`
- `last_db_import_due_at_ms`
- `last_db_import_started_at_ms`
- `last_db_import_finished_at_ms`
- `last_db_import_ok`
- `last_imported_collect_finished_at`

## 8. SQLite Import

Implemented in:

- [db_import.rs](/d:/lcy/ucasclasser-develop/src-tauri/src/db_import.rs)

Database file:

- [ucas-classer.sqlite](/d:/lcy/ucasclasser-develop/data/ucas-classer.sqlite)

Tables:

- `meta`
- `import_runs`
- `courses`
- `course_modules`
- `materials`
- `notices`
- `assignments`

Import behavior:

- Full rebuild of business tables on each successful import:
  - `courses`
  - `course_modules`
  - `materials`
  - `notices`
  - `assignments`
- Meta keeps:
  - `last_imported_collect_finished_at`
  - `last_imported_at_ms`

## 9. Runtime CLI Commands

Terminal commands:

```powershell
npm run runtime:watch
npm run runtime:status
npm run runtime:check
npm run runtime:clear
npm run runtime:login
npm run runtime:collect
npm run runtime:import
```

Notes:

- `runtime:watch`
  The main validation command.
  Starts one in-memory runtime instance and keeps it alive.
- `runtime:status`
  Prints the current snapshot of a new temporary runtime instance.
  Because it is not the long-running scheduler process, it can legitimately print `UNKNOWN`.

Interactive shortcuts inside `runtime:watch`:

- `r` + Enter
  Mark cookie refresh due.
- `c` + Enter
  Mark collect due.
- `g` + Enter
  Start full collect, then auto-import on success.
- `i` + Enter
  Start database import.

## 10. Watch Output

Normal one-line states:

- `UNKNOWN`
- `CHECKING`
- `ONLINE`
- `OFFLINE`
- `INTERRUPTED`
- `LOGIN_REQUIRED`
- `RESETTING`
- `COLLECTING`
- `IMPORTING`

Event lines:

- `COOKIE_REFRESH_DUE`
- `COOKIE_REFRESHED`
- `COLLECT_REFRESH_DUE`
- `COLLECT_STARTING`
- `COLLECT_REFRESHED`
- `COLLECT_FAILED`
- `DB_IMPORT_STARTING`
- `DB_IMPORTED`
- `DB_IMPORT_FAILED`

## 11. Recommended Validation Commands

### A. Minimal auth validation

```powershell
npm run auth:reset
npm run auth:login
npm run auth:check
npm run webcheck
```

### B. Scheduler validation

```powershell
$env:UCAS_AUTH_CHECK_INTERVAL_SECS='15'
$env:UCAS_HOURLY_INTERVAL_SECS='90'
npm run runtime:watch
```

Then test interactively:

- enter `r`
- enter `c`
- enter `g`
- enter `i`

### C. Manual collect + import

```powershell
npm run runtime:collect
```

Notes:

- `runtime:collect` now means `collect + auto import`.
- `runtime:import` is the standalone fallback/import-only command.

### D. Check SQLite row counts

```powershell
@'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/ucas-classer.sqlite');
for (const table of ['courses', 'course_modules', 'materials', 'notices', 'assignments', 'import_runs']) {
  const row = db.prepare(`select count(*) as count from ${table}`).get();
  console.log(`${table}=${row.count}`);
}
'@ | node --input-type=module -
```

## 12. Current Design Decisions

Why import should not be triggered by raw JSON mtimes:

- too loose
- easy to race on partially written files
- hard to distinguish a valid finished batch from stale leftovers

Why current trigger is better:

- `full-collect-summary.json` is the explicit end-of-batch marker
- it already contains success/failure counts
- `finishedAt` is a natural batch version
- comparing it to database meta gives a clean idempotent import decision

## 13. Current Known Boundaries

- Runtime state is process-local.
  A separate `npm run runtime:*` command does not mutate an already running `runtime:watch` process.
- Auth/runtime orchestration is stable for local development.
  Packaging/runtime bundling is a separate step.
- Importer currently trusts the JSON schema produced by the collector layer.
  If collector output changes, importer structs must be updated accordingly.
