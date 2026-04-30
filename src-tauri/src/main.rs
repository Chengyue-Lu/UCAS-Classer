#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

//! Desktop entrypoint for the development shell.
//! Keep this file thin: builder wiring, state registration, and command registration.

mod desktop_shell;

use std::sync::atomic::{AtomicBool, Ordering};

use desktop_shell::{
    build_tray, collapse_docked_window, exit_dock_mode, expand_docked_window,
    get_window_dock_state, handle_main_window_event, open_external_url, pick_folder_path,
    publish_content_unread_state, window_close, window_minimize, DockManager, ExitGuard,
};
use tauri::{AppHandle, Manager, RunEvent, State};
use ucas_classer::app_data::{load_dashboard_data as load_dashboard_data_impl, DashboardData};
use ucas_classer::app_settings::{
    load_app_settings as load_app_settings_impl, save_app_settings as save_app_settings_impl,
    AppSettings,
};
use ucas_classer::assignment_details::{
    load_assignment_detail as load_assignment_detail_impl, AssignmentDetailRequest,
    AssignmentDetailResponse,
};
use ucas_classer::auth_runtime::{
    acknowledge_hourly_refresh_due as acknowledge_hourly_refresh_due_impl,
    apply_runtime_settings as apply_runtime_settings_impl,
    clear_collect_refresh_due as clear_collect_refresh_due_impl,
    clear_db_import_due as clear_db_import_due_impl, get_runtime_status as get_runtime_status_impl,
    mark_collect_refresh_due as mark_collect_refresh_due_impl,
    mark_db_import_due as mark_db_import_due_impl,
    mark_hourly_refresh_due as mark_hourly_refresh_due_impl, run_auth_check as run_auth_check_impl,
    run_auth_clear as run_auth_clear_impl, run_db_import as run_db_import_impl,
    run_explicit_auth_check as run_explicit_auth_check_impl,
    run_full_collect as run_full_collect_impl, run_interrupt_login as run_interrupt_login_impl,
    start_runtime_scheduler as start_runtime_scheduler_impl,
    stop_runtime_scheduler as stop_runtime_scheduler_impl, RuntimeService, RuntimeSnapshot,
    SharedRuntimeService,
};
use ucas_classer::content_state::{
    mark_all_content_viewed as mark_all_content_viewed_impl,
    mark_content_item_viewed as mark_content_item_viewed_impl, ContentReadUpdateResult,
};
use ucas_classer::downloads::{
    download_protected_file as download_protected_file_impl,
    download_protected_files as download_protected_files_impl, BatchDownloadResult,
    DownloadRequest, ProtectedDownloadResult,
};
use ucas_classer::reminders::{
    sync_post_import_reminders as sync_post_import_reminders_impl, ReminderSyncResult,
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
async fn save_app_settings(
    settings: AppSettings,
    runtime: State<'_, SharedRuntimeService>,
) -> Result<AppSettings, String> {
    let saved = save_app_settings_impl(settings)?;
    let _ = apply_runtime_settings_impl(runtime).await?;
    Ok(saved)
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
async fn apply_runtime_settings(
    runtime: State<'_, SharedRuntimeService>,
) -> Result<RuntimeSnapshot, String> {
    apply_runtime_settings_impl(runtime).await
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
fn open_authenticated_url(
    url: String,
    assignments_url: Option<String>,
    work_id: Option<String>,
    work_answer_id: Option<String>,
) -> Result<(), String> {
    let mut owned_args = vec!["--url".to_string(), url];
    if let Some(assignments_url) = assignments_url
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        owned_args.push("--assignments-url".to_string());
        owned_args.push(assignments_url.to_string());
    }
    if let Some(work_id) = work_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        owned_args.push("--work-id".to_string());
        owned_args.push(work_id.to_string());
    }
    if let Some(work_answer_id) = work_answer_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        owned_args.push("--work-answer-id".to_string());
        owned_args.push(work_answer_id.to_string());
    }

    let borrowed_args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    let child = spawn_hidden_background_script("auth:open-url", &borrowed_args)?;
    let _ = child.id();
    Ok(())
}

#[tauri::command]
async fn download_protected_file(
    url: String,
    suggested_name: Option<String>,
    referer: Option<String>,
    relative_subdir: Option<String>,
    conflict_policy: Option<String>,
) -> Result<ProtectedDownloadResult, String> {
    download_protected_file_impl(
        url,
        suggested_name,
        referer,
        relative_subdir,
        conflict_policy,
    )
    .await
}

#[tauri::command]
async fn download_protected_files(
    requests: Vec<DownloadRequest>,
) -> Result<BatchDownloadResult, String> {
    download_protected_files_impl(requests).await
}

#[tauri::command]
async fn load_assignment_detail(
    request: AssignmentDetailRequest,
) -> Result<AssignmentDetailResponse, String> {
    load_assignment_detail_impl(request).await
}

#[tauri::command]
fn sync_post_import_reminders(app: tauri::AppHandle) -> Result<ReminderSyncResult, String> {
    let result = sync_post_import_reminders_impl(&app)?;
    publish_content_unread_state(&app, result.unread_count)?;
    Ok(result)
}

#[tauri::command]
fn mark_content_item_viewed(
    app: AppHandle,
    kind: String,
    course_id: String,
    identity_key: String,
) -> Result<ContentReadUpdateResult, String> {
    let result = mark_content_item_viewed_impl(kind, course_id, identity_key)?;
    publish_content_unread_state(&app, result.unread_count)?;
    Ok(result)
}

#[tauri::command]
fn mark_all_content_viewed(app: AppHandle) -> Result<ContentReadUpdateResult, String> {
    let result = mark_all_content_viewed_impl()?;
    publish_content_unread_state(&app, result.unread_count)?;
    Ok(result)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(RuntimeService::new())
        .manage(ExitGuard(AtomicBool::new(false)))
        .manage(DockManager::default())
        .setup(|app| {
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            handle_main_window_event(window, event);
        })
        .invoke_handler(tauri::generate_handler![
            load_dashboard_data,
            load_app_settings,
            save_app_settings,
            get_runtime_status,
            start_runtime_scheduler,
            stop_runtime_scheduler,
            apply_runtime_settings,
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
            get_window_dock_state,
            expand_docked_window,
            collapse_docked_window,
            exit_dock_mode,
            open_external_url,
            open_authenticated_url,
            pick_folder_path,
            download_protected_file,
            download_protected_files,
            load_assignment_detail,
            sync_post_import_reminders,
            mark_content_item_viewed,
            mark_all_content_viewed,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if !app.state::<ExitGuard>().0.load(Ordering::Relaxed) {
                    api.prevent_exit();
                }
            }
        });
}
