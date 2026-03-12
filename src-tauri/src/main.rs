use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, State, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent,
};
use ucas_classer::app_data::{load_dashboard_data as load_dashboard_data_impl, DashboardData};
use ucas_classer::app_settings::{
    load_app_settings as load_app_settings_impl, save_app_settings as save_app_settings_impl,
    AppSettings,
};
use ucas_classer::auth_runtime::{
    acknowledge_hourly_refresh_due as acknowledge_hourly_refresh_due_impl,
    apply_runtime_settings as apply_runtime_settings_impl,
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

struct ExitGuard(AtomicBool);

fn create_main_window(app: &AppHandle) -> Result<(), String> {
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("UCAS Classer")
        .inner_size(480.0, 720.0)
        .min_inner_size(480.0, 720.0)
        .decorations(false)
        .resizable(true);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|error| error.to_string())?;
        if window.is_minimized().map_err(|error| error.to_string())? {
            let _ = window.unminimize();
        }
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    create_main_window(app)
}

fn destroy_main_window(window: &Window) -> Result<(), String> {
    window.destroy().map_err(|error| error.to_string())
}

fn build_tray(app: &AppHandle) -> Result<(), String> {
    let menu = MenuBuilder::new(app)
        .text("show", "显示主窗口")
        .text("quit", "退出应用")
        .build()
        .map_err(|error| error.to_string())?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("UCAS Classer")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                let _ = show_main_window(app);
            }
            "quit" => {
                app.state::<ExitGuard>().0.store(true, Ordering::Relaxed);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app).map_err(|error| error.to_string())?;
    Ok(())
}

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
fn window_minimize(window: Window) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn window_close(window: Window) -> Result<(), String> {
    destroy_main_window(&window)
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
        .manage(ExitGuard(AtomicBool::new(false)))
        .setup(|app| {
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = destroy_main_window(window);
                }
            }
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
            open_external_url,
            open_authenticated_url,
            download_protected_file,
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
