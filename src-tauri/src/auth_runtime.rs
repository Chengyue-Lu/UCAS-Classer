use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::State;
use tokio::spawn;
use tokio::task::spawn_blocking;
use tokio::time::sleep;

use crate::app_settings::{load_app_settings, persist_runtime_markers, save_app_settings};
use crate::db_import::{
    import_latest_cache, last_imported_collect_finished_at, latest_collect_finished_at,
    read_latest_collect_summary,
};
use crate::paths::storage_state_file;
use crate::script_runner::{
    run_hidden_script, spawn_visible_login_script, storage_state_modified_ms,
    wait_for_script_child, ScriptOutput,
};

pub type SharedRuntimeService = Arc<RuntimeService>;

#[derive(Clone, Serialize)]
pub struct RuntimeSnapshot {
    pub scheduler_running: bool,
    pub interrupt_flag: bool,
    pub interrupt_reason: Option<String>,
    pub interrupt_since_ms: Option<u64>,
    pub interrupt_storage_mtime_ms: Option<u64>,
    pub auth_check_running: bool,
    pub explicit_check_running: bool,
    pub reset_running: bool,
    pub login_running: bool,
    pub hourly_refresh_due: bool,
    pub collect_refresh_due: bool,
    pub collect_refresh_running: bool,
    pub db_import_due: bool,
    pub db_import_running: bool,
    pub three_min_interval_secs: u64,
    pub one_hour_interval_secs: u64,
    pub collect_interval_secs: u64,
    pub last_three_min_tick_at_ms: Option<u64>,
    pub last_hourly_tick_at_ms: Option<u64>,
    pub last_auth_check_at_ms: Option<u64>,
    pub last_auth_check_ok: Option<bool>,
    pub last_auth_check_source: Option<String>,
    pub last_storage_mtime_ms: Option<u64>,
    pub last_reset_at_ms: Option<u64>,
    pub last_login_started_at_ms: Option<u64>,
    pub last_login_finished_at_ms: Option<u64>,
    pub last_interrupt_cleared_at_ms: Option<u64>,
    pub last_cookie_refresh_at_ms: Option<u64>,
    pub last_collect_due_at_ms: Option<u64>,
    pub last_collect_started_at_ms: Option<u64>,
    pub last_collect_finished_at_ms: Option<u64>,
    pub last_collect_ok: Option<bool>,
    pub last_db_import_due_at_ms: Option<u64>,
    pub last_db_import_started_at_ms: Option<u64>,
    pub last_db_import_finished_at_ms: Option<u64>,
    pub last_db_import_ok: Option<bool>,
    pub last_imported_collect_finished_at: Option<String>,
    pub last_stdout: Option<String>,
    pub last_stderr: Option<String>,
    pub last_error: Option<String>,
}

impl Default for RuntimeSnapshot {
    fn default() -> Self {
        let settings = load_app_settings().unwrap_or_default();
        Self {
            scheduler_running: false,
            interrupt_flag: false,
            interrupt_reason: None,
            interrupt_since_ms: None,
            interrupt_storage_mtime_ms: None,
            auth_check_running: false,
            explicit_check_running: false,
            reset_running: false,
            login_running: false,
            hourly_refresh_due: false,
            collect_refresh_due: false,
            collect_refresh_running: false,
            db_import_due: false,
            db_import_running: false,
            three_min_interval_secs: configured_interval_secs(
                "UCAS_AUTH_CHECK_INTERVAL_SECS",
                settings.auth_check_interval_secs,
            ),
            one_hour_interval_secs: configured_interval_secs(
                "UCAS_HOURLY_INTERVAL_SECS",
                settings.cookie_refresh_interval_secs,
            ),
            collect_interval_secs: settings.collect_interval_secs.max(1),
            last_three_min_tick_at_ms: None,
            last_hourly_tick_at_ms: None,
            last_auth_check_at_ms: settings.last_auth_check_at_ms,
            last_auth_check_ok: None,
            last_auth_check_source: None,
            last_storage_mtime_ms: storage_state_modified_ms(storage_state_file()),
            last_reset_at_ms: None,
            last_login_started_at_ms: None,
            last_login_finished_at_ms: None,
            last_interrupt_cleared_at_ms: None,
            last_cookie_refresh_at_ms: settings.last_cookie_refresh_at_ms,
            last_collect_due_at_ms: None,
            last_collect_started_at_ms: None,
            last_collect_finished_at_ms: settings.last_collect_finished_at_ms,
            last_collect_ok: None,
            last_db_import_due_at_ms: None,
            last_db_import_started_at_ms: None,
            last_db_import_finished_at_ms: None,
            last_db_import_ok: None,
            last_imported_collect_finished_at: last_imported_collect_finished_at().ok().flatten(),
            last_stdout: None,
            last_stderr: None,
            last_error: None,
        }
    }
}

#[derive(Copy, Clone)]
enum CheckSource {
    Scheduled,
    Explicit,
    Recovery,
}

impl CheckSource {
    fn as_str(self) -> &'static str {
        match self {
            CheckSource::Scheduled => "scheduled",
            CheckSource::Explicit => "explicit",
            CheckSource::Recovery => "recovery",
        }
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum CollectMode {
    Full,
    Summary,
}

impl CollectMode {
    fn as_str(self) -> &'static str {
        match self {
            CollectMode::Full => "full",
            CollectMode::Summary => "summary",
        }
    }
}

fn script_failure_message(script: &str, output: &ScriptOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return format!("{script} failed: {stderr}");
    }

    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return format!("{script} failed: {stdout}");
    }

    format!("{script} failed with exit code {}", output.exit_code)
}

pub struct RuntimeService {
    snapshot: Mutex<RuntimeSnapshot>,
    scheduler_stop: Mutex<Option<Arc<AtomicBool>>>,
    login_generation: Mutex<u64>,
    active_login_pid: Mutex<Option<u32>>,
    next_scheduled_collect_force_full: Mutex<bool>,
}

impl RuntimeService {
    pub fn new() -> SharedRuntimeService {
        Arc::new(Self {
            snapshot: Mutex::new(RuntimeSnapshot::default()),
            scheduler_stop: Mutex::new(None),
            login_generation: Mutex::new(0),
            active_login_pid: Mutex::new(None),
            next_scheduled_collect_force_full: Mutex::new(false),
        })
    }

    pub fn snapshot(&self) -> RuntimeSnapshot {
        self.snapshot.lock().expect("snapshot lock poisoned").clone()
    }

    fn update<F>(&self, updater: F) -> RuntimeSnapshot
    where
        F: FnOnce(&mut RuntimeSnapshot),
    {
        let mut snapshot = self.snapshot.lock().expect("snapshot lock poisoned");
        updater(&mut snapshot);
        let cloned = snapshot.clone();
        let _ = persist_runtime_markers(
            cloned.last_auth_check_at_ms,
            cloned.last_collect_finished_at_ms,
            cloned.last_cookie_refresh_at_ms,
        );
        cloned
    }

    fn next_login_generation(&self) -> u64 {
        let mut generation = self
            .login_generation
            .lock()
            .expect("login generation lock poisoned");
        *generation += 1;
        *generation
    }

    fn set_active_login_pid(&self, pid: Option<u32>) {
        let mut guard = self
            .active_login_pid
            .lock()
            .expect("active login pid lock poisoned");
        *guard = pid;
    }

    fn is_current_login(&self, generation: u64, pid: u32) -> bool {
        let current_generation = *self
            .login_generation
            .lock()
            .expect("login generation lock poisoned");
        let current_pid = *self
            .active_login_pid
            .lock()
            .expect("active login pid lock poisoned");

        current_generation == generation && current_pid == Some(pid)
    }

    fn set_interrupt(&self, reason: String) {
        let now = now_ms();
        let current_storage_mtime = storage_state_modified_ms(storage_state_file());

        self.update(|snapshot| {
            snapshot.interrupt_flag = true;
            snapshot.interrupt_reason = Some(reason.clone());
            if snapshot.interrupt_since_ms.is_none() {
                snapshot.interrupt_since_ms = Some(now);
            }
            if snapshot.interrupt_storage_mtime_ms.is_none() {
                snapshot.interrupt_storage_mtime_ms = current_storage_mtime;
            }
            snapshot.last_error = Some(reason);
        });
    }

    fn cancel_active_login(&self, reason: &str) -> Result<bool, String> {
        let pid = {
            let guard = self
                .active_login_pid
                .lock()
                .expect("active login pid lock poisoned");
            *guard
        };

        let Some(pid) = pid else {
            return Ok(false);
        };

        kill_login_process(pid)?;
        self.set_active_login_pid(None);
        self.update(|snapshot| {
            snapshot.login_running = false;
            snapshot.last_login_finished_at_ms = Some(now_ms());
            snapshot.last_error = Some(reason.to_string());
        });
        Ok(true)
    }

    fn try_clear_interrupt_after_fresh_storage(&self) {
        let now = now_ms();
        let current_storage_mtime = storage_state_modified_ms(storage_state_file());

        self.update(|snapshot| {
            snapshot.last_storage_mtime_ms = current_storage_mtime;

            if !snapshot.interrupt_flag || snapshot.last_auth_check_ok != Some(true) {
                return;
            }

            match (snapshot.interrupt_storage_mtime_ms, current_storage_mtime) {
                (Some(previous), Some(current)) if current > previous => {
                    snapshot.interrupt_flag = false;
                    snapshot.interrupt_reason = None;
                    snapshot.interrupt_since_ms = None;
                    snapshot.interrupt_storage_mtime_ms = Some(current);
                    snapshot.last_interrupt_cleared_at_ms = Some(now);
                    snapshot.last_error = None;
                }
                (None, Some(current)) => {
                    snapshot.interrupt_flag = false;
                    snapshot.interrupt_reason = None;
                    snapshot.interrupt_since_ms = None;
                    snapshot.interrupt_storage_mtime_ms = Some(current);
                    snapshot.last_interrupt_cleared_at_ms = Some(now);
                    snapshot.last_error = None;
                }
                _ => {}
            }
        });
    }

    fn mark_hourly_due(&self) {
        let now = now_ms();
        self.update(|snapshot| {
            snapshot.last_hourly_tick_at_ms = Some(now);
            snapshot.hourly_refresh_due = true;
        });
    }

    fn mark_collect_due(&self) {
        let now = now_ms();
        self.update(|snapshot| {
            snapshot.collect_refresh_due = true;
            snapshot.last_collect_due_at_ms = Some(now);
        });
    }

    pub fn mark_hourly_refresh_due(&self) -> RuntimeSnapshot {
        let now = now_ms();
        self.update(|snapshot| {
            snapshot.last_hourly_tick_at_ms = Some(now);
            snapshot.hourly_refresh_due = true;
            snapshot.last_error = None;
        })
    }

    pub fn mark_collect_refresh_due(&self) -> RuntimeSnapshot {
        let now = now_ms();
        self.update(|snapshot| {
            snapshot.collect_refresh_due = true;
            snapshot.last_collect_due_at_ms = Some(now);
            snapshot.last_error = None;
        })
    }

    pub fn clear_collect_refresh_due(&self) -> RuntimeSnapshot {
        self.update(|snapshot| {
            snapshot.collect_refresh_due = false;
        })
    }

    pub fn mark_db_import_due(&self) -> RuntimeSnapshot {
        let now = now_ms();
        self.update(|snapshot| {
            snapshot.db_import_due = true;
            snapshot.last_db_import_due_at_ms = Some(now);
            snapshot.last_error = None;
        })
    }

    pub fn clear_db_import_due(&self) -> RuntimeSnapshot {
        self.update(|snapshot| {
            snapshot.db_import_due = false;
        })
    }

    fn clear_hourly_due(&self) -> RuntimeSnapshot {
        self.update(|snapshot| {
            snapshot.hourly_refresh_due = false;
        })
    }

    fn sync_db_import_due_from_cache(&self) -> Result<bool, String> {
        let latest_collect = latest_collect_finished_at()?;
        let imported_collect = last_imported_collect_finished_at()?;
        let now = now_ms();
        let due = match latest_collect.as_ref() {
            Some(latest) => imported_collect.as_ref() != Some(latest),
            None => false,
        };

        self.update(|snapshot| {
            snapshot.last_imported_collect_finished_at = imported_collect.clone();
            if due {
                snapshot.db_import_due = true;
                if snapshot.last_db_import_due_at_ms.is_none() {
                    snapshot.last_db_import_due_at_ms = Some(now);
                }
            } else {
                snapshot.db_import_due = false;
            }
        });

        Ok(due)
    }

    fn can_run_scheduled_collect(&self) -> bool {
        let snapshot = self.snapshot();
        !snapshot.collect_refresh_running
            && !snapshot.db_import_running
            && !snapshot.interrupt_flag
            && !snapshot.reset_running
            && !snapshot.login_running
            && snapshot.last_auth_check_ok == Some(true)
    }

    fn request_next_scheduled_collect_full(&self) {
        let mut guard = self
            .next_scheduled_collect_force_full
            .lock()
            .expect("next scheduled collect force-full lock poisoned");
        *guard = true;
    }

    fn take_scheduled_collect_mode(&self) -> CollectMode {
        let mut guard = self
            .next_scheduled_collect_force_full
            .lock()
            .expect("next scheduled collect force-full lock poisoned");
        if *guard {
            *guard = false;
            return CollectMode::Full;
        }

        let settings = load_app_settings().unwrap_or_default();
        if settings.pending_full_collect_after_diff {
            CollectMode::Full
        } else {
            CollectMode::Summary
        }
    }

    fn maybe_spawn_collect_if_due(self: &Arc<Self>) -> bool {
        let snapshot = self.snapshot();
        if !snapshot.collect_refresh_due || !self.can_run_scheduled_collect() {
            return false;
        }

        let collect_mode = self.take_scheduled_collect_mode();
        let service = Arc::clone(self);
        spawn(async move {
            let _ = service.run_collect(collect_mode).await;
        });

        true
    }

    fn maybe_spawn_db_import_if_due(self: &Arc<Self>) -> Result<bool, String> {
        let due = self.sync_db_import_due_from_cache()?;
        let snapshot = self.snapshot();
        if !due || snapshot.collect_refresh_running || snapshot.db_import_running {
            return Ok(false);
        }

        let service = Arc::clone(self);
        spawn(async move {
            let _ = service.run_db_import_inner().await;
        });

        Ok(true)
    }

    fn handle_missing_storage(self: &Arc<Self>, source: CheckSource, auto_recover: bool) -> String {
        let now = now_ms();
        let reason = "storage state is missing".to_string();

        self.update(|snapshot| {
            snapshot.last_auth_check_at_ms = Some(now);
            snapshot.last_auth_check_ok = Some(false);
            snapshot.last_auth_check_source = Some(source.as_str().to_string());
            snapshot.last_storage_mtime_ms = None;
            snapshot.last_error = Some(reason.clone());
            snapshot.auth_check_running = false;
            snapshot.explicit_check_running = false;
        });

        if auto_recover {
            self.set_interrupt(reason.clone());
            let _ = self.spawn_interrupt_login();
        }

        reason
    }

    fn should_skip_scheduled_check(&self) -> bool {
        let snapshot = self.snapshot();
        snapshot.interrupt_flag
            || snapshot.auth_check_running
            || snapshot.explicit_check_running
            || snapshot.reset_running
            || snapshot.login_running
    }

    async fn handle_three_min_tick(self: &Arc<Self>) {
        let now = now_ms();
        self.update(|snapshot| {
            snapshot.last_three_min_tick_at_ms = Some(now);
        });

        if !storage_state_exists() {
            let _ = self.handle_missing_storage(CheckSource::Scheduled, true);
            return;
        }

        if self.should_skip_scheduled_check() {
            return;
        }

        let _ = self
            .run_auth_check(CheckSource::Scheduled, true)
            .await;
    }

    async fn handle_hourly_tick(self: &Arc<Self>) {
        self.mark_hourly_due();
    }

    async fn handle_collect_tick(self: &Arc<Self>) {
        self.mark_collect_due();
        if !self.can_run_scheduled_collect() {
            return;
        }

        let collect_mode = self.take_scheduled_collect_mode();
        let service = Arc::clone(self);
        spawn(async move {
            let _ = service.run_collect(collect_mode).await;
        });
    }

    pub fn apply_settings(self: &Arc<Self>) -> RuntimeSnapshot {
        let settings = load_app_settings().unwrap_or_default();
        let was_running = self.snapshot().scheduler_running;

        self.update(|snapshot| {
            snapshot.three_min_interval_secs = settings.auth_check_interval_secs.max(1);
            snapshot.one_hour_interval_secs = settings.cookie_refresh_interval_secs.max(1);
            snapshot.collect_interval_secs = settings.collect_interval_secs.max(1);
        });

        if was_running {
            self.stop_scheduler();
            self.start_scheduler_with_options(false, false)
        } else {
            self.snapshot()
        }
    }

    pub fn start_scheduler(self: &Arc<Self>) -> RuntimeSnapshot {
        self.start_scheduler_with_options(true, true)
    }

    fn start_scheduler_with_options(
        self: &Arc<Self>,
        run_initial_check: bool,
        run_initial_collect: bool,
    ) -> RuntimeSnapshot {
        let mut stop_guard = self.scheduler_stop.lock().expect("scheduler stop lock poisoned");
        if stop_guard.is_some() {
            return self.snapshot();
        }

        let stop = Arc::new(AtomicBool::new(false));
        *stop_guard = Some(stop.clone());

        self.update(|snapshot| {
            snapshot.scheduler_running = true;
            snapshot.last_error = None;
        });

        if run_initial_collect {
            self.request_next_scheduled_collect_full();
            self.mark_collect_due();
        }

        let _ = self.sync_db_import_due_from_cache();
        let _ = self.maybe_spawn_db_import_if_due();

        let intervals = self.snapshot();
        let three_min_interval_secs = intervals.three_min_interval_secs;
        let one_hour_interval_secs = intervals.one_hour_interval_secs;
        let collect_interval_secs = intervals.collect_interval_secs;

        if run_initial_check && !storage_state_exists() {
            let _ = self.handle_missing_storage(CheckSource::Scheduled, true);
        } else if run_initial_check && !self.should_skip_scheduled_check() {
            let initial_check_service = Arc::clone(self);
            spawn(async move {
                let _ = initial_check_service
                    .run_auth_check(CheckSource::Scheduled, true)
                    .await;
            });
        }

        let three_min_service = Arc::clone(self);
        let three_min_stop = stop.clone();
        spawn(async move {
            loop {
                sleep(Duration::from_secs(three_min_interval_secs)).await;
                if three_min_stop.load(Ordering::SeqCst) {
                    break;
                }
                three_min_service.handle_three_min_tick().await;
            }
        });

        let hourly_service = Arc::clone(self);
        let hourly_stop = stop.clone();
        spawn(async move {
            loop {
                sleep(Duration::from_secs(one_hour_interval_secs)).await;
                if hourly_stop.load(Ordering::SeqCst) {
                    break;
                }
                hourly_service.handle_hourly_tick().await;
            }
        });

        let collect_service = Arc::clone(self);
        spawn(async move {
            loop {
                sleep(Duration::from_secs(collect_interval_secs)).await;
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                collect_service.handle_collect_tick().await;
            }
        });
        self.snapshot()
    }

    pub fn stop_scheduler(&self) -> RuntimeSnapshot {
        if let Some(stop) = self
            .scheduler_stop
            .lock()
            .expect("scheduler stop lock poisoned")
            .take()
        {
            stop.store(true, Ordering::SeqCst);
        }

        self.update(|snapshot| {
            snapshot.scheduler_running = false;
        })
    }

    pub async fn run_explicit_check(self: &Arc<Self>) -> Result<RuntimeSnapshot, String> {
        if self.snapshot().interrupt_flag {
            return Err(
                "interrupt flag is set; auth check is blocked until fresh storage state is saved"
                    .to_string(),
            );
        }
        if self.snapshot().reset_running || self.snapshot().login_running {
            return Err("auth state is being reset or refreshed; auth check is temporarily blocked".to_string());
        }
        self.run_auth_check(CheckSource::Explicit, true).await?;
        Ok(self.snapshot())
    }

    pub async fn run_clear(self: &Arc<Self>) -> Result<RuntimeSnapshot, String> {
        self.run_reset().await?;
        self.set_interrupt("auth state cleared".to_string());
        Ok(self.snapshot())
    }

    pub async fn trigger_interrupt_login(self: &Arc<Self>) -> Result<RuntimeSnapshot, String> {
        self.spawn_interrupt_login()?;
        Ok(self.snapshot())
    }

    async fn run_auth_check(
        self: &Arc<Self>,
        source: CheckSource,
        auto_recover: bool,
    ) -> Result<ScriptOutput, String> {
        if !matches!(source, CheckSource::Recovery) && self.snapshot().interrupt_flag {
            return Err(
                "interrupt flag is set; auth check is blocked until fresh storage state is saved"
                    .to_string(),
            );
        }
        if !matches!(source, CheckSource::Recovery)
            && (self.snapshot().reset_running || self.snapshot().login_running)
        {
            return Err("auth state is being reset or refreshed; auth check is temporarily blocked".to_string());
        }

        if !storage_state_exists() {
            return Err(self.handle_missing_storage(source, auto_recover));
        }

        let started_at = now_ms();
        let refresh_due = self.snapshot().hourly_refresh_due;
        let previous_storage_mtime = storage_state_modified_ms(storage_state_file());
        self.update(|snapshot| {
            snapshot.last_auth_check_source = Some(source.as_str().to_string());
            snapshot.last_error = None;
            match source {
                CheckSource::Explicit => snapshot.explicit_check_running = true,
                _ => snapshot.auth_check_running = true,
            }
        });

        let result = spawn_blocking(move || {
            if refresh_due {
                run_hidden_script("auth:check", &["--refresh-storage-on-success"])
            } else {
                run_hidden_script("auth:check", &[])
            }
        })
            .await
            .map_err(|error| format!("failed to join auth:check task: {error}"))??;

        let current_storage_mtime = storage_state_modified_ms(storage_state_file());
        let finished_at = now_ms();
        self.update(|snapshot| {
            snapshot.last_auth_check_at_ms = Some(started_at);
            snapshot.last_auth_check_ok = Some(result.success);
            snapshot.last_storage_mtime_ms = current_storage_mtime;
            snapshot.last_stdout = if result.stdout.is_empty() {
                None
            } else {
                Some(result.stdout.clone())
            };
            snapshot.last_stderr = if result.stderr.is_empty() {
                None
            } else {
                Some(result.stderr.clone())
            };
            match source {
                CheckSource::Explicit => snapshot.explicit_check_running = false,
                _ => snapshot.auth_check_running = false,
            }

            if result.success && refresh_due {
                match (previous_storage_mtime, current_storage_mtime) {
                    (Some(previous), Some(current)) if current > previous => {
                        snapshot.hourly_refresh_due = false;
                        snapshot.last_cookie_refresh_at_ms = Some(finished_at);
                        snapshot.last_error = None;
                    }
                    (None, Some(_)) => {
                        snapshot.hourly_refresh_due = false;
                        snapshot.last_cookie_refresh_at_ms = Some(finished_at);
                        snapshot.last_error = None;
                    }
                    _ => {
                        snapshot.last_error = Some(
                            "auth check succeeded but storage state was not refreshed".to_string(),
                        );
                    }
                }
            }
        });

        if result.success {
            self.try_clear_interrupt_after_fresh_storage();
            let collect_started = self.maybe_spawn_collect_if_due();
            if !collect_started {
                let _ = self.maybe_spawn_db_import_if_due();
            }
            return Ok(result);
        }

        self.update(|snapshot| {
            snapshot.last_error = Some(script_failure_message("auth:check", &result));
        });

        if auto_recover {
            self.set_interrupt("auth:check failed".to_string());
            self.run_reset().await?;
            let _ = self.spawn_interrupt_login();
        }

        Ok(result)
    }

    async fn run_reset(self: &Arc<Self>) -> Result<ScriptOutput, String> {
        {
            let snapshot = self.snapshot();
            if snapshot.reset_running {
                return Err("auth reset is already running".to_string());
            }
        }

        self.update(|snapshot| {
            snapshot.reset_running = true;
            snapshot.last_error = None;
        });

        let result = spawn_blocking(|| run_hidden_script("auth:reset", &[]))
            .await
            .map_err(|error| format!("failed to join auth:reset task: {error}"))??;

        let now = now_ms();
        self.update(|snapshot| {
            snapshot.reset_running = false;
            snapshot.last_reset_at_ms = Some(now);
            snapshot.last_stdout = if result.stdout.is_empty() {
                snapshot.last_stdout.clone()
            } else {
                Some(result.stdout.clone())
            };
            snapshot.last_stderr = if result.stderr.is_empty() {
                snapshot.last_stderr.clone()
            } else {
                Some(result.stderr.clone())
            };
            snapshot.last_storage_mtime_ms = storage_state_modified_ms(storage_state_file());
            if !result.success {
                snapshot.last_error = Some(script_failure_message("auth:reset", &result));
            }
        });

        if result.success {
            Ok(result)
        } else {
            Err(format!("auth:reset failed with exit code {}", result.exit_code))
        }
    }

    fn spawn_interrupt_login(self: &Arc<Self>) -> Result<(), String> {
        let snapshot = self.snapshot();
        if snapshot.login_running {
            let _ = self.cancel_active_login("previous login canceled; restarting login");
        }

        if !snapshot.interrupt_flag {
            self.set_interrupt("manual login requested".to_string());
        }

        let child = spawn_visible_login_script("auth:login", &[])?;
        let pid = child.id();
        let generation = self.next_login_generation();
        self.set_active_login_pid(Some(pid));

        self.update(|state| {
            state.login_running = true;
            state.last_login_started_at_ms = Some(now_ms());
            state.last_error = None;
        });

        let service = Arc::clone(self);
        spawn(async move {
            let result = spawn_blocking(move || wait_for_script_child(child, "auth:login")).await;

            match result {
                Ok(Ok(output)) => {
                    if !service.is_current_login(generation, pid) {
                        return;
                    }
                    service.set_active_login_pid(None);
                    service.update(|snapshot| {
                        snapshot.login_running = false;
                        snapshot.last_login_finished_at_ms = Some(now_ms());
                        snapshot.last_storage_mtime_ms =
                            storage_state_modified_ms(storage_state_file());
                        snapshot.last_stdout = if output.stdout.is_empty() {
                            snapshot.last_stdout.clone()
                        } else {
                            Some(output.stdout.clone())
                        };
                        snapshot.last_stderr = if output.stderr.is_empty() {
                            snapshot.last_stderr.clone()
                        } else {
                            Some(output.stderr.clone())
                        };
                        if !output.success {
                            snapshot.last_error = Some(script_failure_message("auth:login", &output));
                        }
                    });

                    if output.success {
                        let _ = service
                            .run_auth_check(CheckSource::Recovery, false)
                            .await;
                    }
                }
                Ok(Err(error)) => {
                    if !service.is_current_login(generation, pid) {
                        return;
                    }
                    service.set_active_login_pid(None);
                    service.update(|snapshot| {
                        snapshot.login_running = false;
                        snapshot.last_login_finished_at_ms = Some(now_ms());
                        snapshot.last_error = Some(error);
                    });
                }
                Err(error) => {
                    if !service.is_current_login(generation, pid) {
                        return;
                    }
                    service.set_active_login_pid(None);
                    service.update(|snapshot| {
                        snapshot.login_running = false;
                        snapshot.last_login_finished_at_ms = Some(now_ms());
                        snapshot.last_error =
                            Some(format!("failed to join auth:login task: {error}"));
                    });
                }
            }
        });

        Ok(())
    }

    pub async fn run_full_collect(self: &Arc<Self>) -> Result<RuntimeSnapshot, String> {
        self.run_collect(CollectMode::Full).await
    }

    async fn run_collect(self: &Arc<Self>, collect_mode: CollectMode) -> Result<RuntimeSnapshot, String> {
        {
            let snapshot = self.snapshot();
            if snapshot.collect_refresh_running {
                return Err("collect refresh is already running".to_string());
            }
            if snapshot.db_import_running {
                return Err("database import is running; collect refresh is temporarily blocked".to_string());
            }
        }

        let started_at = now_ms();
        self.update(|snapshot| {
            snapshot.collect_refresh_running = true;
            snapshot.last_collect_started_at_ms = Some(started_at);
            snapshot.last_collect_ok = None;
            snapshot.last_error = None;
        });

        let mode_arg = collect_mode.as_str().to_string();
        let result = spawn_blocking(move || {
            run_hidden_script("collect:all", &["--mode", &mode_arg, "--concurrency", "4"])
        })
        .await
        .map_err(|error| format!("failed to join collect:all task: {error}"))??;

        let collect_summary = read_latest_collect_summary()?;
        let collect_ok = result.success
            && collect_summary.as_ref().is_some_and(|summary| {
                summary.mode == collect_mode.as_str()
                    && summary.failure_count == 0
                    && summary.success_count == summary.course_count
            });
        let finished_at = now_ms();
        self.update(|snapshot| {
            snapshot.collect_refresh_running = false;
            snapshot.last_collect_finished_at_ms = Some(finished_at);
            snapshot.last_collect_ok = Some(collect_ok);
            snapshot.last_stdout = if result.stdout.is_empty() {
                snapshot.last_stdout.clone()
            } else {
                Some(result.stdout.clone())
            };
            snapshot.last_stderr = if result.stderr.is_empty() {
                snapshot.last_stderr.clone()
            } else {
                Some(result.stderr.clone())
            };

            if collect_ok {
                snapshot.collect_refresh_due = false;
                snapshot.last_error = None;
            } else if result.success {
                snapshot.last_error =
                    Some("collect:all finished but full-collect-summary.json is incomplete".to_string());
            } else {
                snapshot.last_error = Some(script_failure_message("collect:all", &result));
            }
        });

        if collect_ok {
            self.apply_collect_follow_up(collect_mode, collect_summary.as_ref())?;
            if collect_mode == CollectMode::Full {
                self.run_db_import_inner().await?;
            } else {
                let _ = self.sync_db_import_due_from_cache();
            }
            Ok(self.snapshot())
        } else {
            Err(
                self.snapshot()
                    .last_error
                    .unwrap_or_else(|| "collect refresh failed".to_string()),
            )
        }
    }

    fn apply_collect_follow_up(
        &self,
        collect_mode: CollectMode,
        collect_summary: Option<&crate::db_import::FullCollectSummary>,
    ) -> Result<(), String> {
        let mut settings = load_app_settings().unwrap_or_default();

        match collect_mode {
            CollectMode::Full => {
                settings.pending_full_collect_after_diff = false;
            }
            CollectMode::Summary => {
                settings.pending_full_collect_after_diff =
                    collect_summary.is_some_and(|summary| summary.has_diff);
            }
        }

        save_app_settings(settings)?;
        Ok(())
    }

    pub async fn run_db_import(self: &Arc<Self>) -> Result<RuntimeSnapshot, String> {
        self.run_db_import_inner().await?;
        Ok(self.snapshot())
    }

    async fn run_db_import_inner(self: &Arc<Self>) -> Result<(), String> {
        {
            let snapshot = self.snapshot();
            if snapshot.collect_refresh_running {
                return Err("collect refresh is running; database import is temporarily blocked".to_string());
            }
            if snapshot.db_import_running {
                return Err("database import is already running".to_string());
            }
        }

        let _ = self.sync_db_import_due_from_cache();

        let started_at = now_ms();
        self.update(|snapshot| {
            snapshot.db_import_running = true;
            snapshot.last_db_import_started_at_ms = Some(started_at);
            snapshot.last_db_import_ok = None;
            snapshot.last_error = None;
        });

        let result = spawn_blocking(import_latest_cache)
            .await
            .map_err(|error| format!("failed to join db import task: {error}"))?;

        let finished_at = now_ms();
        match result {
            Ok(import_result) => {
                self.update(|snapshot| {
                    snapshot.db_import_running = false;
                    snapshot.db_import_due = false;
                    snapshot.last_db_import_finished_at_ms = Some(finished_at);
                    snapshot.last_db_import_ok = Some(true);
                    snapshot.last_imported_collect_finished_at =
                        Some(import_result.collect_finished_at.clone());
                    snapshot.last_error = None;
                });
                Ok(())
            }
            Err(error) => {
                self.update(|snapshot| {
                    snapshot.db_import_running = false;
                    snapshot.last_db_import_finished_at_ms = Some(finished_at);
                    snapshot.last_db_import_ok = Some(false);
                    snapshot.db_import_due = true;
                    snapshot.last_error = Some(error.clone());
                });
                Err(error)
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn configured_interval_secs(name: &str, default_value: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default_value)
}

fn storage_state_exists() -> bool {
    storage_state_file().is_file()
}

#[cfg(target_os = "windows")]
fn kill_login_process(pid: u32) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|error| format!("failed to cancel existing login process {pid}: {error}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "failed to cancel existing login process {pid}: taskkill exited with {:?}",
            status.code()
        ))
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_login_process(_pid: u32) -> Result<(), String> {
    Err("login process cancel is only implemented on Windows right now".to_string())
}

#[tauri::command]
pub async fn get_runtime_status(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().snapshot())
}

#[tauri::command]
pub async fn start_runtime_scheduler(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().start_scheduler())
}

#[tauri::command]
pub async fn stop_runtime_scheduler(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().stop_scheduler())
}

#[tauri::command]
pub async fn apply_runtime_settings(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().apply_settings())
}

#[tauri::command]
pub async fn run_auth_check(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    runtime.inner().run_explicit_check().await
}

#[tauri::command]
pub async fn run_explicit_auth_check(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    runtime.inner().run_explicit_check().await
}

#[tauri::command]
pub async fn run_interrupt_login(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    runtime.inner().trigger_interrupt_login().await
}

#[tauri::command]
pub async fn run_auth_clear(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    runtime.inner().run_clear().await
}

#[tauri::command]
pub async fn acknowledge_hourly_refresh_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().clear_hourly_due())
}

#[tauri::command]
pub async fn mark_hourly_refresh_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().mark_hourly_refresh_due())
}

#[tauri::command]
pub async fn mark_collect_refresh_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().mark_collect_refresh_due())
}

#[tauri::command]
pub async fn clear_collect_refresh_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().clear_collect_refresh_due())
}

#[tauri::command]
pub async fn mark_db_import_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().mark_db_import_due())
}

#[tauri::command]
pub async fn clear_db_import_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    Ok(runtime.inner().clear_db_import_due())
}

#[tauri::command]
pub async fn run_full_collect(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    runtime.inner().run_full_collect().await
}

#[tauri::command]
pub async fn run_db_import(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    runtime.inner().run_db_import().await
}
