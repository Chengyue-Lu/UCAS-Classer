use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, Position, RunEvent, Size,
    State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use ucas_classer::app_data::{load_dashboard_data as load_dashboard_data_impl, DashboardData};
use ucas_classer::app_settings::{
    load_app_settings as load_app_settings_impl, save_app_settings as save_app_settings_impl,
    AppSettings,
};
use ucas_classer::auth_runtime::{
    acknowledge_hourly_refresh_due as acknowledge_hourly_refresh_due_impl,
    apply_runtime_settings as apply_runtime_settings_impl,
    clear_collect_refresh_due as clear_collect_refresh_due_impl,
    clear_db_import_due as clear_db_import_due_impl,
    get_runtime_status as get_runtime_status_impl,
    mark_collect_refresh_due as mark_collect_refresh_due_impl,
    mark_db_import_due as mark_db_import_due_impl,
    mark_hourly_refresh_due as mark_hourly_refresh_due_impl,
    run_auth_check as run_auth_check_impl, run_auth_clear as run_auth_clear_impl,
    run_db_import as run_db_import_impl, run_explicit_auth_check as run_explicit_auth_check_impl,
    run_full_collect as run_full_collect_impl, run_interrupt_login as run_interrupt_login_impl,
    start_runtime_scheduler as start_runtime_scheduler_impl,
    stop_runtime_scheduler as stop_runtime_scheduler_impl, RuntimeService, RuntimeSnapshot,
    SharedRuntimeService,
};
use ucas_classer::downloads::{
    download_protected_file as download_protected_file_impl,
    download_protected_files as download_protected_files_impl, BatchDownloadResult, DownloadRequest,
    ProtectedDownloadResult,
};
use ucas_classer::script_runner::spawn_hidden_background_script;

const DEFAULT_WINDOW_WIDTH: u32 = 480;
const DEFAULT_WINDOW_HEIGHT: u32 = 720;
const DOCK_STRIP_WIDTH: u32 = 56;
const DOCK_STRIP_HEIGHT: u32 = 188;
const DOCK_EDGE_THRESHOLD: i32 = 28;
const DOCK_CHECK_DELAY_MS: u64 = 520;
const MOVE_SUPPRESSION_MS: u64 = 420;
const WINDOW_ANIMATION_STEPS: i32 = 6;
const WINDOW_ANIMATION_STEP_MS: u64 = 18;

struct ExitGuard(AtomicBool);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DockSide {
    Left,
    Right,
}

impl DockSide {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Left => "left",
            Self::Right => "right",
        }
    }

    fn from_option(value: Option<&str>) -> Option<Self> {
        match value {
            Some("left") => Some(Self::Left),
            Some("right") => Some(Self::Right),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DockVisualState {
    Normal,
    Collapsed,
    Expanded,
}

impl DockVisualState {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Collapsed => "collapsed",
            Self::Expanded => "expanded",
        }
    }
}

#[derive(Default)]
struct DockManager(Mutex<DockRuntimeState>);

#[derive(Debug)]
struct DockRuntimeState {
    state: DockVisualState,
    side: Option<DockSide>,
    geometry_token: u64,
    suppress_moved_until_ms: u64,
}

impl Default for DockRuntimeState {
    fn default() -> Self {
        Self {
            state: DockVisualState::Normal,
            side: None,
            geometry_token: 0,
            suppress_moved_until_ms: 0,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WindowDockSnapshot {
    enabled: bool,
    state: String,
    side: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn default_expanded_size() -> PhysicalSize<u32> {
    PhysicalSize::new(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
}

fn normalized_expanded_size(settings: &AppSettings) -> PhysicalSize<u32> {
    PhysicalSize::new(
        settings
            .dock_expanded_width
            .unwrap_or(DEFAULT_WINDOW_WIDTH)
            .max(DEFAULT_WINDOW_WIDTH),
        settings
            .dock_expanded_height
            .unwrap_or(DEFAULT_WINDOW_HEIGHT)
            .max(DEFAULT_WINDOW_HEIGHT),
    )
}

fn load_settings_fallback() -> AppSettings {
    load_app_settings_impl().unwrap_or_default()
}

fn save_settings_direct(settings: AppSettings) -> Result<AppSettings, String> {
    save_app_settings_impl(settings)
}

fn with_dock_state<R>(
    app: &AppHandle,
    operation: impl FnOnce(&mut DockRuntimeState) -> R,
) -> Result<R, String> {
    let dock = app.state::<DockManager>();
    let mut guard = dock
        .0
        .lock()
        .map_err(|_| "failed to lock dock manager".to_string())?;
    Ok(operation(&mut guard))
}

fn set_move_suppression(app: &AppHandle, duration_ms: u64) -> Result<(), String> {
    with_dock_state(app, |state| {
        state.suppress_moved_until_ms = now_ms() + duration_ms;
    })
}

fn is_move_suppressed(app: &AppHandle) -> bool {
    with_dock_state(app, |state| state.suppress_moved_until_ms > now_ms()).unwrap_or(false)
}

fn next_geometry_token(app: &AppHandle) -> Result<u64, String> {
    with_dock_state(app, |state| {
        state.geometry_token += 1;
        state.geometry_token
    })
}

fn current_dock_visual_state(app: &AppHandle) -> (DockVisualState, Option<DockSide>) {
    with_dock_state(app, |state| (state.state, state.side)).unwrap_or((DockVisualState::Normal, None))
}

fn resolve_main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window("main")
        .ok_or_else(|| "main window is not available".to_string())
}

fn resolve_monitor(window: &WebviewWindow) -> Result<tauri::Monitor, String> {
    if let Some(monitor) = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
    {
        return Ok(monitor);
    }

    Err("failed to resolve current monitor".to_string())
}

fn window_geometry(
    window: &WebviewWindow,
) -> Result<(PhysicalPosition<i32>, PhysicalSize<u32>, PhysicalRect<i32, u32>), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let work_area = *resolve_monitor(window)?.work_area();
    Ok((position, size, work_area))
}

fn detect_dock_side(
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    work_area: PhysicalRect<i32, u32>,
) -> Option<DockSide> {
    let left_distance = position.x - work_area.position.x;
    let right_edge = work_area.position.x + work_area.size.width as i32;
    let right_distance = right_edge - (position.x + size.width as i32);

    if left_distance <= DOCK_EDGE_THRESHOLD {
        return Some(DockSide::Left);
    }

    if right_distance <= DOCK_EDGE_THRESHOLD {
        return Some(DockSide::Right);
    }

    None
}

fn clamp_position_y(work_area: PhysicalRect<i32, u32>, height: u32, candidate: i32) -> i32 {
    let min_y = work_area.position.y;
    let max_y = work_area.position.y + work_area.size.height as i32 - height as i32;
    if max_y < min_y {
        min_y
    } else {
        candidate.clamp(min_y, max_y)
    }
}

fn centered_strip_y(work_area: PhysicalRect<i32, u32>) -> i32 {
    clamp_position_y(
        work_area,
        DOCK_STRIP_HEIGHT,
        work_area.position.y + ((work_area.size.height as i32 - DOCK_STRIP_HEIGHT as i32) / 2),
    )
}

fn dock_position(side: DockSide, work_area: PhysicalRect<i32, u32>) -> PhysicalPosition<i32> {
    let x = match side {
        DockSide::Left => work_area.position.x,
        DockSide::Right => work_area.position.x + work_area.size.width as i32 - DOCK_STRIP_WIDTH as i32,
    };
    PhysicalPosition::new(x, centered_strip_y(work_area))
}

fn expanded_position(
    side: DockSide,
    work_area: PhysicalRect<i32, u32>,
    size: PhysicalSize<u32>,
    preferred_y: Option<i32>,
) -> PhysicalPosition<i32> {
    let x = match side {
        DockSide::Left => work_area.position.x,
        DockSide::Right => work_area.position.x + work_area.size.width as i32 - size.width as i32,
    };
    let preferred = preferred_y.unwrap_or_else(|| {
        work_area.position.y + ((work_area.size.height as i32 - size.height as i32) / 2)
    });
    PhysicalPosition::new(x, clamp_position_y(work_area, size.height, preferred))
}

fn persist_normal_geometry(window: &WebviewWindow, settings: &mut AppSettings) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = window.outer_size().map_err(|error| error.to_string())?;
    settings.dock_last_x = Some(position.x);
    settings.dock_last_y = Some(position.y);
    settings.dock_expanded_width = Some(size.width.max(DEFAULT_WINDOW_WIDTH));
    settings.dock_expanded_height = Some(size.height.max(DEFAULT_WINDOW_HEIGHT));
    Ok(())
}

fn set_window_rect(
    window: &WebviewWindow,
    app: &AppHandle,
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    min_size: Option<PhysicalSize<u32>>,
) -> Result<(), String> {
    set_move_suppression(app, MOVE_SUPPRESSION_MS)?;
    window
        .set_min_size(None::<Size>)
        .map_err(|error| error.to_string())?;
    let start_position = window.outer_position().map_err(|error| error.to_string())?;
    let start_size = window.outer_size().map_err(|error| error.to_string())?;

    for step in 1..=WINDOW_ANIMATION_STEPS {
        let progress = step as f32 / WINDOW_ANIMATION_STEPS as f32;
        let eased = 1.0 - (1.0 - progress) * (1.0 - progress);
        let next_width = start_size.width as f32 + (size.width as f32 - start_size.width as f32) * eased;
        let next_height =
            start_size.height as f32 + (size.height as f32 - start_size.height as f32) * eased;
        let next_x = start_position.x as f32 + (position.x as f32 - start_position.x as f32) * eased;
        let next_y = start_position.y as f32 + (position.y as f32 - start_position.y as f32) * eased;

        window
            .set_size(Size::Physical(PhysicalSize::new(
                next_width.round().max(1.0) as u32,
                next_height.round().max(1.0) as u32,
            )))
            .map_err(|error| error.to_string())?;
        window
            .set_position(Position::Physical(PhysicalPosition::new(
                next_x.round() as i32,
                next_y.round() as i32,
            )))
            .map_err(|error| error.to_string())?;

        if step < WINDOW_ANIMATION_STEPS {
            std::thread::sleep(Duration::from_millis(WINDOW_ANIMATION_STEP_MS));
        }
    }

    window
        .set_size(Size::Physical(size))
        .map_err(|error| error.to_string())?;
    window
        .set_position(Position::Physical(position))
        .map_err(|error| error.to_string())?;
    window
        .set_min_size(min_size.map(Size::Physical))
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn enter_dock_mode(window: &WebviewWindow, side: DockSide) -> Result<(), String> {
    let app = window.app_handle();
    let (_, _, work_area) = window_geometry(window)?;
    let mut settings = load_settings_fallback();
    persist_normal_geometry(window, &mut settings)?;
    settings.dock_side = Some(side.as_str().to_string());
    save_settings_direct(settings)?;

    set_window_rect(
        window,
        &app,
        PhysicalSize::new(DOCK_STRIP_WIDTH, DOCK_STRIP_HEIGHT),
        dock_position(side, work_area),
        Some(PhysicalSize::new(DOCK_STRIP_WIDTH, DOCK_STRIP_HEIGHT)),
    )?;

    with_dock_state(&app, |state| {
        state.state = DockVisualState::Collapsed;
        state.side = Some(side);
    })?;
    Ok(())
}

fn expand_dock_mode(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let (_, _, work_area) = window_geometry(window)?;
    let settings = load_settings_fallback();
    let side = current_dock_visual_state(&app)
        .1
        .or_else(|| DockSide::from_option(settings.dock_side.as_deref()))
        .ok_or_else(|| "window is not docked".to_string())?;
    let expanded_size = normalized_expanded_size(&settings);
    let position = expanded_position(side, work_area, expanded_size, settings.dock_last_y);

    set_window_rect(
        window,
        &app,
        expanded_size,
        position,
        Some(default_expanded_size()),
    )?;

    with_dock_state(&app, |state| {
        state.state = DockVisualState::Expanded;
        state.side = Some(side);
    })?;
    Ok(())
}

fn collapse_dock_mode(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let side = current_dock_visual_state(&app)
        .1
        .or_else(|| {
            let settings = load_settings_fallback();
            DockSide::from_option(settings.dock_side.as_deref())
        })
        .or_else(|| {
            window_geometry(window)
                .ok()
                .and_then(|(position, size, work_area)| detect_dock_side(position, size, work_area))
        })
        .ok_or_else(|| "window is not docked".to_string())?;

    enter_dock_mode(window, side)
}

fn undock_in_place(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let mut settings = load_settings_fallback();
    persist_normal_geometry(window, &mut settings)?;
    settings.dock_side = None;
    save_settings_direct(settings)?;
    window
        .set_min_size(Some(Size::Physical(default_expanded_size())))
        .map_err(|error| error.to_string())?;
    with_dock_state(&app, |state| {
        state.state = DockVisualState::Normal;
        state.side = None;
    })?;
    Ok(())
}

fn exit_dock_mode_impl(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let (visual_state, current_side) = current_dock_visual_state(&app);
    if visual_state == DockVisualState::Normal {
        let mut settings = load_settings_fallback();
        persist_normal_geometry(window, &mut settings)?;
        settings.dock_side = None;
        save_settings_direct(settings)?;
        with_dock_state(&app, |state| {
            state.side = None;
        })?;
        return Ok(());
    }

    let (_, _, work_area) = window_geometry(window)?;
    let mut settings = load_settings_fallback();
    let side = current_side.or_else(|| DockSide::from_option(settings.dock_side.as_deref()));
    let expanded_size = normalized_expanded_size(&settings);
    let position = if let Some(side) = side {
        expanded_position(side, work_area, expanded_size, settings.dock_last_y)
    } else {
        PhysicalPosition::new(
            settings.dock_last_x.unwrap_or(work_area.position.x),
            clamp_position_y(
                work_area,
                expanded_size.height,
                settings.dock_last_y.unwrap_or(work_area.position.y),
            ),
        )
    };

    set_window_rect(
        window,
        &app,
        expanded_size,
        position,
        Some(default_expanded_size()),
    )?;

    settings.dock_side = None;
    settings.dock_last_x = Some(position.x);
    settings.dock_last_y = Some(position.y);
    save_settings_direct(settings)?;

    with_dock_state(&app, |state| {
        state.state = DockVisualState::Normal;
        state.side = None;
    })?;
    Ok(())
}

fn persist_geometry_after_idle(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let (position, size, work_area) = window_geometry(window)?;
    let mut settings = load_settings_fallback();
    let (visual_state, _) = current_dock_visual_state(&app);

    match visual_state {
        DockVisualState::Normal => {
            persist_normal_geometry(window, &mut settings)?;
            save_settings_direct(settings.clone())?;

            if settings.enable_auto_dock_collapse {
                if let Some(side) = detect_dock_side(position, size, work_area) {
                    enter_dock_mode(window, side)?;
                }
            }
        }
        DockVisualState::Expanded => {
            if let Some(side) = detect_dock_side(position, size, work_area) {
                persist_normal_geometry(window, &mut settings)?;
                settings.dock_side = Some(side.as_str().to_string());
                save_settings_direct(settings)?;
                with_dock_state(&app, |state| {
                    state.side = Some(side);
                })?;
            } else {
                undock_in_place(window)?;
            }
        }
        DockVisualState::Collapsed => {}
    }

    Ok(())
}

fn schedule_geometry_check(app: AppHandle, label: String) {
    let token = match next_geometry_token(&app) {
        Ok(value) => value,
        Err(_) => return,
    };

    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(DOCK_CHECK_DELAY_MS)).await;

        let current_token = with_dock_state(&app, |state| state.geometry_token).unwrap_or_default();
        if current_token != token || is_move_suppressed(&app) {
            return;
        }

        if let Some(window) = app.get_webview_window(&label) {
            let _ = persist_geometry_after_idle(&window);
        }
    });
}

fn create_main_window(app: &AppHandle) -> Result<(), String> {
    let settings = load_settings_fallback();
    let expanded_size = normalized_expanded_size(&settings);
    let mut builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("UCAS Classer")
        .inner_size(expanded_size.width as f64, expanded_size.height as f64)
        .min_inner_size(DEFAULT_WINDOW_WIDTH as f64, DEFAULT_WINDOW_HEIGHT as f64)
        .decorations(false)
        .resizable(true);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(Size::Physical(default_expanded_size())))
        .map_err(|error| error.to_string())?;
    window
        .set_size(Size::Physical(expanded_size))
        .map_err(|error| error.to_string())?;

    if let (Some(x), Some(y)) = (settings.dock_last_x, settings.dock_last_y) {
        window
            .set_position(Position::Physical(PhysicalPosition::new(x, y)))
            .map_err(|error| error.to_string())?;
    }

    with_dock_state(app, |state| {
        state.state = DockVisualState::Normal;
        state.side = DockSide::from_option(settings.dock_side.as_deref());
    })?;

    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        let _ = exit_dock_mode_impl(&window);
        window.show().map_err(|error| error.to_string())?;
        if window.is_minimized().map_err(|error| error.to_string())? {
            let _ = window.unminimize();
        }
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    create_main_window(app)
}

fn destroy_main_window(window: &WebviewWindow) -> Result<(), String> {
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
fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn window_close(window: WebviewWindow) -> Result<(), String> {
    destroy_main_window(&window)
}

#[tauri::command]
fn get_window_dock_state(app: AppHandle) -> Result<WindowDockSnapshot, String> {
    let settings = load_settings_fallback();
    let (state, side) = current_dock_visual_state(&app);
    Ok(WindowDockSnapshot {
        enabled: settings.enable_auto_dock_collapse,
        state: state.as_str().to_string(),
        side: side.map(|value| value.as_str().to_string()),
    })
}

#[tauri::command]
fn expand_docked_window(window: WebviewWindow) -> Result<(), String> {
    expand_dock_mode(&window)
}

#[tauri::command]
fn collapse_docked_window(window: WebviewWindow) -> Result<(), String> {
    collapse_dock_mode(&window)
}

#[tauri::command]
fn exit_dock_mode(window: WebviewWindow) -> Result<(), String> {
    exit_dock_mode_impl(&window)
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
fn pick_folder_path(app: AppHandle, initial_path: Option<String>) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(path) = initial_path.filter(|value| !value.trim().is_empty()) {
        builder = builder.set_directory(path);
    }

    Ok(builder
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.display().to_string()))
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
async fn download_protected_files(requests: Vec<DownloadRequest>) -> Result<BatchDownloadResult, String> {
    download_protected_files_impl(requests).await
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(RuntimeService::new())
        .manage(ExitGuard(AtomicBool::new(false)))
        .manage(DockManager::default())
        .setup(|app| {
            build_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    if let Ok(main_window) = resolve_main_window(&window.app_handle()) {
                        let _ = destroy_main_window(&main_window);
                    }
                }
                WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
                    let app = window.app_handle();
                    if is_move_suppressed(&app) {
                        return;
                    }

                    if let Ok(main_window) = resolve_main_window(&app) {
                        let (visual_state, _) = current_dock_visual_state(&app);
                        if visual_state == DockVisualState::Expanded {
                            if let Ok((position, size, work_area)) = window_geometry(&main_window) {
                                if detect_dock_side(position, size, work_area).is_none() {
                                    let _ = undock_in_place(&main_window);
                                }
                            }
                        }
                    }

                    schedule_geometry_check(app.clone(), "main".to_string());
                }
                _ => {}
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
            get_window_dock_state,
            expand_docked_window,
            collapse_docked_window,
            exit_dock_mode,
            open_external_url,
            open_authenticated_url,
            pick_folder_path,
            download_protected_file,
            download_protected_files,
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
