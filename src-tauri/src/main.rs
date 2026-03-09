use std::process::Command;

use tauri::{State, Window};
use ucas_classer::app_data::{load_dashboard_data as load_dashboard_data_impl, DashboardData};
use ucas_classer::app_settings::{
    load_app_settings as load_app_settings_impl, save_app_settings as save_app_settings_impl,
    AppSettings,
};
use ucas_classer::auth_runtime::{
    acknowledge_hourly_refresh_due as acknowledge_hourly_refresh_due_impl,
    clear_db_import_due as clear_db_import_due_impl,
    clear_collect_refresh_due as clear_collect_refresh_due_impl,
    get_runtime_status as get_runtime_status_impl,
    mark_db_import_due as mark_db_import_due_impl,
    mark_collect_refresh_due as mark_collect_refresh_due_impl,
    mark_hourly_refresh_due as mark_hourly_refresh_due_impl,
    run_db_import as run_db_import_impl,
    run_full_collect as run_full_collect_impl,
    run_auth_check as run_auth_check_impl,
    run_auth_clear as run_auth_clear_impl,
    run_explicit_auth_check as run_explicit_auth_check_impl,
    run_interrupt_login as run_interrupt_login_impl,
    start_runtime_scheduler as start_runtime_scheduler_impl,
    stop_runtime_scheduler as stop_runtime_scheduler_impl,
    RuntimeService, RuntimeSnapshot, SharedRuntimeService,
};
use ucas_classer::downloads::{
    download_protected_file as download_protected_file_impl, ProtectedDownloadResult,
};
use ucas_classer::script_runner::spawn_hidden_background_script;

#[tauri::command]
fn load_dashboard_data() -> Result<DashboardData, String> {
    load_dashboard_data_impl()
}

#[tauri::command]
fn load_app_settings() -> Result<AppSettings, String> {
    load_app_settings_impl()
}

#[tauri::command]
fn save_app_settings(settings: AppSettings) -> Result<AppSettings, String> {
    save_app_settings_impl(settings)
}

#[tauri::command]
async fn get_runtime_status(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    get_runtime_status_impl(runtime).await
}

#[tauri::command]
async fn start_runtime_scheduler(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    start_runtime_scheduler_impl(runtime).await
}

#[tauri::command]
async fn stop_runtime_scheduler(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    stop_runtime_scheduler_impl(runtime).await
}

#[tauri::command]
async fn run_auth_check(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    run_auth_check_impl(runtime).await
}

#[tauri::command]
async fn run_explicit_auth_check(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    run_explicit_auth_check_impl(runtime).await
}

#[tauri::command]
async fn run_interrupt_login(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    run_interrupt_login_impl(runtime).await
}

#[tauri::command]
async fn run_auth_clear(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    run_auth_clear_impl(runtime).await
}

#[tauri::command]
async fn acknowledge_hourly_refresh_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    acknowledge_hourly_refresh_due_impl(runtime).await
}

#[tauri::command]
async fn mark_hourly_refresh_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    mark_hourly_refresh_due_impl(runtime).await
}

#[tauri::command]
async fn mark_collect_refresh_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    mark_collect_refresh_due_impl(runtime).await
}

#[tauri::command]
async fn clear_collect_refresh_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    clear_collect_refresh_due_impl(runtime).await
}

#[tauri::command]
async fn mark_db_import_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    mark_db_import_due_impl(runtime).await
}

#[tauri::command]
async fn clear_db_import_due(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    clear_db_import_due_impl(runtime).await
}

#[tauri::command]
async fn run_full_collect(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    run_full_collect_impl(runtime).await
}

#[tauri::command]
async fn run_db_import(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    run_db_import_impl(runtime).await
}

#[tauri::command]
fn window_minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn window_close(window: Window) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|error| format!("failed to open external url: {error}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Err("open_external_url is only implemented on Windows right now".to_string())
    }
}

#[tauri::command]
fn open_authenticated_url(url: String) -> Result<(), String> {
    let child = spawn_hidden_background_script("auth:open-url", &["--url", &url])?;
    let _ = child.id();
    Ok(())
}

#[tauri::command]
fn download_protected_file(
    url: String,
    suggested_name: Option<String>,
    referer: Option<String>,
) -> Result<ProtectedDownloadResult, String> {
    download_protected_file_impl(url, suggested_name, referer)
}

fn main() {
    tauri::Builder::default()
        .manage(RuntimeService::new())
        .invoke_handler(tauri::generate_handler![
            load_dashboard_data,
            load_app_settings,
            save_app_settings,
            get_runtime_status,
            start_runtime_scheduler,
            stop_runtime_scheduler,
            run_auth_check,
            run_explicit_auth_check,
            run_interrupt_login,
            run_auth_clear,
            acknowledge_hourly_refresh_due,
            mark_hourly_refresh_due,
            mark_collect_refresh_due,
            clear_collect_refresh_due,
            mark_db_import_due,
            clear_db_import_due,
            run_full_collect,
            run_db_import,
            window_minimize,
            window_close,
            open_external_url,
            open_authenticated_url,
            download_protected_file,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
