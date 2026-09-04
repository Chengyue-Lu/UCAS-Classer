//! Desktop shell behaviors that are specific to the Tauri windowed app:
//! main-window lifecycle, dock geometry, tray integration, and shell-only commands.

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{
    image::Image,
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalRect, PhysicalSize, Position, Size,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use ucas_classer::app_settings::{
    load_app_settings as load_app_settings_impl, save_app_settings as save_app_settings_impl,
    AppSettings,
};
use ucas_classer::content_state::{
    count_current_unread_from_database, mark_all_content_viewed, ContentReadUpdateResult,
};

const DEFAULT_WINDOW_WIDTH: u32 = 480;
const DEFAULT_WINDOW_HEIGHT: u32 = 720;
const MAX_WINDOW_WIDTH: u32 = 720;
const MAX_WINDOW_HEIGHT: u32 = 960;
const DOCK_STRIP_WIDTH: u32 = 56;
const DOCK_STRIP_HEIGHT: u32 = 188;
const DOCK_EDGE_THRESHOLD: i32 = 28;
const DOCK_CHECK_DELAY_MS: u64 = 520;
const MOVE_SUPPRESSION_MS: u64 = 420;
const WINDOW_ANIMATION_STEPS: i32 = 12;
const WINDOW_ANIMATION_STEP_MS: u64 = 14;
const DOCK_STATE_EVENT: &str = "dock-state-changed";
const CONTENT_UNREAD_CHANGED_EVENT: &str = "content-unread-changed";

pub struct ExitGuard(pub AtomicBool);

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

fn should_enter_dock_mode(state: DockVisualState) -> bool {
    state != DockVisualState::Collapsed
}

fn should_expand_dock_mode(state: DockVisualState) -> bool {
    state == DockVisualState::Collapsed
}

fn should_collapse_dock_mode(state: DockVisualState) -> bool {
    state == DockVisualState::Expanded
}

#[derive(Default)]
pub struct DockManager(Mutex<DockRuntimeState>);

#[derive(Debug)]
struct DockRuntimeState {
    state: DockVisualState,
    side: Option<DockSide>,
    geometry_token: u64,
    suppress_moved_until_ms: u64,
    transition_in_progress: bool,
}

impl Default for DockRuntimeState {
    fn default() -> Self {
        Self {
            state: DockVisualState::Normal,
            side: None,
            geometry_token: 0,
            suppress_moved_until_ms: 0,
            transition_in_progress: false,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowDockSnapshot {
    enabled: bool,
    state: String,
    side: Option<String>,
    transitioning: bool,
}

// The front-end listens for this snapshot and treats it as the single
// source of truth for dock-related UI state.
fn build_window_dock_snapshot(app: &AppHandle) -> WindowDockSnapshot {
    let settings = load_settings_fallback();
    let (state, side) = current_dock_visual_state(app);
    WindowDockSnapshot {
        enabled: settings.enable_auto_dock_collapse,
        state: state.as_str().to_string(),
        side: side.map(|value| value.as_str().to_string()),
        transitioning: is_dock_transition_in_progress(app),
    }
}

fn emit_dock_state(app: &AppHandle) -> Result<(), String> {
    app.emit(DOCK_STATE_EVENT, build_window_dock_snapshot(app))
        .map_err(|error| format!("failed to emit dock state: {error}"))
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

fn maximum_expanded_size() -> PhysicalSize<u32> {
    PhysicalSize::new(MAX_WINDOW_WIDTH, MAX_WINDOW_HEIGHT)
}

fn clamp_expanded_size(size: PhysicalSize<u32>) -> PhysicalSize<u32> {
    PhysicalSize::new(
        size.width.clamp(DEFAULT_WINDOW_WIDTH, MAX_WINDOW_WIDTH),
        size.height.clamp(DEFAULT_WINDOW_HEIGHT, MAX_WINDOW_HEIGHT),
    )
}

fn normalized_expanded_size(settings: &AppSettings) -> PhysicalSize<u32> {
    clamp_expanded_size(PhysicalSize::new(
        settings.dock_expanded_width.unwrap_or(DEFAULT_WINDOW_WIDTH),
        settings
            .dock_expanded_height
            .unwrap_or(DEFAULT_WINDOW_HEIGHT),
    ))
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

fn is_dock_transition_in_progress(app: &AppHandle) -> bool {
    with_dock_state(app, |state| state.transition_in_progress).unwrap_or(false)
}

fn run_dock_transition(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    let started = with_dock_state(app, |state| {
        if state.transition_in_progress {
            return false;
        }
        state.transition_in_progress = true;
        true
    })?;

    if !started {
        return Ok(());
    }

    let result = emit_dock_state(app).and_then(|_| operation());
    let finish_result = with_dock_state(app, |state| {
        state.transition_in_progress = false;
    });
    let emit_result = emit_dock_state(app);

    result?;
    finish_result?;
    emit_result
}

fn next_geometry_token(app: &AppHandle) -> Result<u64, String> {
    with_dock_state(app, |state| {
        state.geometry_token += 1;
        state.geometry_token
    })
}

fn current_dock_visual_state(app: &AppHandle) -> (DockVisualState, Option<DockSide>) {
    with_dock_state(app, |state| (state.state, state.side))
        .unwrap_or((DockVisualState::Normal, None))
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
) -> Result<
    (
        PhysicalPosition<i32>,
        PhysicalSize<u32>,
        PhysicalRect<i32, u32>,
    ),
    String,
> {
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
        DockSide::Right => {
            work_area.position.x + work_area.size.width as i32 - DOCK_STRIP_WIDTH as i32
        }
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

fn persist_normal_geometry(
    window: &WebviewWindow,
    settings: &mut AppSettings,
) -> Result<(), String> {
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let size = clamp_expanded_size(window.inner_size().map_err(|error| error.to_string())?);
    settings.dock_last_x = Some(position.x);
    settings.dock_last_y = Some(position.y);
    settings.dock_expanded_width = Some(size.width);
    settings.dock_expanded_height = Some(size.height);
    Ok(())
}

fn should_skip_geometry_tracking(window: &WebviewWindow) -> Result<bool, String> {
    if window.is_minimized().map_err(|error| error.to_string())? {
        return Ok(true);
    }

    let is_visible = window.is_visible().map_err(|error| error.to_string())?;
    Ok(!is_visible)
}

fn apply_window_constraints(
    window: &WebviewWindow,
    min_size: Option<PhysicalSize<u32>>,
    max_size: Option<PhysicalSize<u32>>,
    resizable: bool,
) -> Result<(), String> {
    window
        .set_min_size(min_size.map(Size::Physical))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(max_size.map(Size::Physical))
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(resizable)
        .map_err(|error| error.to_string())
}

fn set_window_rect(
    window: &WebviewWindow,
    app: &AppHandle,
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
    min_size: Option<PhysicalSize<u32>>,
    max_size: Option<PhysicalSize<u32>>,
    resizable: bool,
) -> Result<(), String> {
    set_move_suppression(app, MOVE_SUPPRESSION_MS)?;

    let geometry_result = (|| -> Result<(), String> {
        window
            .set_resizable(false)
            .map_err(|error| error.to_string())?;
        window
            .set_min_size(None::<Size>)
            .map_err(|error| error.to_string())?;
        window
            .set_max_size(None::<Size>)
            .map_err(|error| error.to_string())?;

        let start_position = window.outer_position().map_err(|error| error.to_string())?;
        let start_size = window.inner_size().map_err(|error| error.to_string())?;

        if start_position != position || start_size != size {
            for step in 1..=WINDOW_ANIMATION_STEPS {
                let progress = step as f32 / WINDOW_ANIMATION_STEPS as f32;
                let eased = progress * progress * (3.0 - 2.0 * progress);
                let next_width =
                    start_size.width as f32 + (size.width as f32 - start_size.width as f32) * eased;
                let next_height = start_size.height as f32
                    + (size.height as f32 - start_size.height as f32) * eased;
                let next_x =
                    start_position.x as f32 + (position.x as f32 - start_position.x as f32) * eased;
                let next_y =
                    start_position.y as f32 + (position.y as f32 - start_position.y as f32) * eased;

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
        }

        window
            .set_size(Size::Physical(size))
            .map_err(|error| error.to_string())?;
        window
            .set_position(Position::Physical(position))
            .map_err(|error| error.to_string())?;
        Ok(())
    })();

    let constraints_result = apply_window_constraints(window, min_size, max_size, resizable);
    geometry_result?;
    constraints_result
}

fn set_window_topmost(window: &WebviewWindow, enabled: bool) -> Result<(), String> {
    window
        .set_always_on_top(enabled)
        .map_err(|error| format!("failed to update window topmost state: {error}"))
}

fn enter_dock_mode(window: &WebviewWindow, side: DockSide) -> Result<(), String> {
    let app = window.app_handle();
    if !should_enter_dock_mode(current_dock_visual_state(app).0) {
        return Ok(());
    }

    run_dock_transition(app, || {
        let (_, _, work_area) = window_geometry(window)?;
        let mut settings = load_settings_fallback();
        persist_normal_geometry(window, &mut settings)?;
        settings.dock_side = Some(side.as_str().to_string());
        save_settings_direct(settings)?;

        let strip_size = PhysicalSize::new(DOCK_STRIP_WIDTH, DOCK_STRIP_HEIGHT);
        set_window_rect(
            window,
            app,
            strip_size,
            dock_position(side, work_area),
            Some(strip_size),
            Some(strip_size),
            false,
        )?;
        set_window_topmost(window, true)?;

        with_dock_state(app, |state| {
            state.state = DockVisualState::Collapsed;
            state.side = Some(side);
        })?;
        Ok(())
    })
}

fn expand_dock_mode(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    if !should_expand_dock_mode(current_dock_visual_state(app).0) {
        return Ok(());
    }

    run_dock_transition(app, || {
        let (_, _, work_area) = window_geometry(window)?;
        let settings = load_settings_fallback();
        let side = current_dock_visual_state(app)
            .1
            .or_else(|| DockSide::from_option(settings.dock_side.as_deref()))
            .ok_or_else(|| "window is not docked".to_string())?;
        let expanded_size = normalized_expanded_size(&settings);
        let position = expanded_position(side, work_area, expanded_size, settings.dock_last_y);

        set_window_rect(
            window,
            app,
            expanded_size,
            position,
            Some(default_expanded_size()),
            Some(maximum_expanded_size()),
            true,
        )?;
        set_window_topmost(window, true)?;

        with_dock_state(app, |state| {
            state.state = DockVisualState::Expanded;
            state.side = Some(side);
        })?;
        Ok(())
    })
}

fn collapse_dock_mode(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let (visual_state, current_side) = current_dock_visual_state(app);
    if !should_collapse_dock_mode(visual_state) {
        return Ok(());
    }

    let side = current_side
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
    if current_dock_visual_state(app).0 != DockVisualState::Expanded {
        return Ok(());
    }

    run_dock_transition(app, || {
        let mut settings = load_settings_fallback();
        persist_normal_geometry(window, &mut settings)?;
        settings.dock_side = None;
        save_settings_direct(settings)?;
        apply_window_constraints(
            window,
            Some(default_expanded_size()),
            Some(maximum_expanded_size()),
            true,
        )?;
        set_window_topmost(window, false)?;
        with_dock_state(app, |state| {
            state.state = DockVisualState::Normal;
            state.side = None;
        })?;
        Ok(())
    })
}

fn exit_dock_mode_impl(window: &WebviewWindow) -> Result<(), String> {
    let app = window.app_handle();
    let (visual_state, current_side) = current_dock_visual_state(app);
    if visual_state == DockVisualState::Normal {
        let mut settings = load_settings_fallback();
        persist_normal_geometry(window, &mut settings)?;
        settings.dock_side = None;
        save_settings_direct(settings)?;
        apply_window_constraints(
            window,
            Some(default_expanded_size()),
            Some(maximum_expanded_size()),
            true,
        )?;
        set_window_topmost(window, false)?;
        with_dock_state(app, |state| {
            state.side = None;
        })?;
        emit_dock_state(app)?;
        return Ok(());
    }

    run_dock_transition(app, || {
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
            app,
            expanded_size,
            position,
            Some(default_expanded_size()),
            Some(maximum_expanded_size()),
            true,
        )?;
        set_window_topmost(window, false)?;

        settings.dock_side = None;
        settings.dock_last_x = Some(position.x);
        settings.dock_last_y = Some(position.y);
        save_settings_direct(settings)?;

        with_dock_state(app, |state| {
            state.state = DockVisualState::Normal;
            state.side = None;
        })?;
        Ok(())
    })
}

fn persist_geometry_after_idle(window: &WebviewWindow) -> Result<(), String> {
    if should_skip_geometry_tracking(window)? {
        return Ok(());
    }

    let app = window.app_handle();
    if is_dock_transition_in_progress(app) {
        return Ok(());
    }
    let (position, size, work_area) = window_geometry(window)?;
    let mut settings = load_settings_fallback();
    let (visual_state, _) = current_dock_visual_state(app);

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
                with_dock_state(app, |state| {
                    state.side = Some(side);
                })?;
                emit_dock_state(app)?;
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
        .max_inner_size(MAX_WINDOW_WIDTH as f64, MAX_WINDOW_HEIGHT as f64)
        .visible(false)
        .decorations(false)
        .resizable(true);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon).map_err(|error| error.to_string())?;
    }

    let window = builder.build().map_err(|error| error.to_string())?;
    apply_window_constraints(
        &window,
        Some(default_expanded_size()),
        Some(maximum_expanded_size()),
        true,
    )?;
    set_window_topmost(&window, false)?;
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

    emit_dock_state(app)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn reveal_window(window: &WebviewWindow) -> Result<(), String> {
    if window.is_minimized().map_err(|error| error.to_string())? {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        reveal_window(&window)?;

        let (visual_state, _) = current_dock_visual_state(app);
        if visual_state == DockVisualState::Collapsed {
            expand_dock_mode(&window)?;
        } else {
            emit_dock_state(app)?;
        }

        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    create_main_window(app)
}

fn destroy_main_window(window: &WebviewWindow) -> Result<(), String> {
    window.destroy().map_err(|error| error.to_string())
}

pub fn build_tray(app: &AppHandle) -> Result<(), String> {
    let menu = MenuBuilder::new(app)
        .text("show", "显示主窗口")
        .text("clear-unread", "清除所有未读")
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
            "clear-unread" => {
                if let Ok(result) = mark_all_content_viewed() {
                    let _ = publish_content_unread_state(app, result.unread_count);
                }
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
    let unread_count = count_current_unread_from_database().unwrap_or_default();
    update_tray_unread_state(app, unread_count)?;
    Ok(())
}

pub fn publish_content_unread_state(app: &AppHandle, unread_count: usize) -> Result<(), String> {
    update_tray_unread_state(app, unread_count)?;
    app.emit(
        CONTENT_UNREAD_CHANGED_EVENT,
        ContentReadUpdateResult { unread_count },
    )
    .map_err(|error| format!("failed to emit content unread state: {error}"))
}

pub fn update_tray_unread_state(app: &AppHandle, unread_count: usize) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("main-tray") else {
        return Ok(());
    };

    if unread_count > 0 {
        if let Some(icon) = app.default_window_icon().cloned() {
            tray.set_icon(Some(build_unread_tray_icon(&icon)))
                .map_err(|error| error.to_string())?;
        }
        tray.set_tooltip(Some("UCAS Classer · 有未查看内容"))
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    if let Some(icon) = app.default_window_icon().cloned() {
        tray.set_icon(Some(icon))
            .map_err(|error| error.to_string())?;
    }
    tray.set_tooltip(Some("UCAS Classer"))
        .map_err(|error| error.to_string())
}

fn build_unread_tray_icon(base: &Image<'_>) -> Image<'static> {
    let width = base.width();
    let height = base.height();
    let mut rgba = base.rgba().to_vec();
    let min_side = width.min(height).max(1) as f32;
    let red_radius = (min_side * 0.16).max(4.0);
    let border_radius = red_radius + (min_side * 0.035).max(1.0);
    let center_x = width as f32 - border_radius - 1.0;
    let center_y = border_radius + 1.0;

    for y in 0..height {
        for x in 0..width {
            let dx = x as f32 + 0.5 - center_x;
            let dy = y as f32 + 0.5 - center_y;
            let distance = (dx * dx + dy * dy).sqrt();
            let offset = ((y * width + x) * 4) as usize;
            if distance <= red_radius {
                rgba[offset] = 222;
                rgba[offset + 1] = 47;
                rgba[offset + 2] = 49;
                rgba[offset + 3] = 255;
            } else if distance <= border_radius {
                rgba[offset] = 255;
                rgba[offset + 1] = 255;
                rgba[offset + 2] = 255;
                rgba[offset + 3] = 245;
            }
        }
    }

    Image::new_owned(rgba, width, height)
}

pub fn handle_main_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != "main" {
        return;
    }

    match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Ok(main_window) = resolve_main_window(window.app_handle()) {
                let _ = destroy_main_window(&main_window);
            }
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let app = window.app_handle();
            if is_move_suppressed(app) || is_dock_transition_in_progress(app) {
                return;
            }

            if let Ok(main_window) = resolve_main_window(app) {
                if should_skip_geometry_tracking(&main_window).unwrap_or(false) {
                    return;
                }

                // If the user drags the expanded docked window away from the edge,
                // return to normal mode immediately instead of waiting for the
                // delayed geometry check.
                let (visual_state, _) = current_dock_visual_state(app);
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
}

#[tauri::command]
pub fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn window_close(window: WebviewWindow) -> Result<(), String> {
    destroy_main_window(&window)
}

#[tauri::command]
pub fn get_window_dock_state(app: AppHandle) -> Result<WindowDockSnapshot, String> {
    Ok(build_window_dock_snapshot(&app))
}

#[tauri::command]
pub fn expand_docked_window(window: WebviewWindow) -> Result<(), String> {
    expand_dock_mode(&window)
}

#[tauri::command]
pub fn collapse_docked_window(window: WebviewWindow) -> Result<(), String> {
    collapse_dock_mode(&window)
}

#[tauri::command]
pub fn exit_dock_mode(window: WebviewWindow) -> Result<(), String> {
    exit_dock_mode_impl(&window)
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|error| format!("failed to open external url: {error}"))?;
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
        Err("open_external_url is only implemented on Windows right now".to_string())
    }
}

#[tauri::command]
pub fn pick_folder_path(
    app: AppHandle,
    initial_path: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = app.dialog().file();
    if let Some(path) = initial_path.filter(|value| !value.trim().is_empty()) {
        builder = builder.set_directory(path);
    }

    Ok(builder
        .blocking_pick_folder()
        .and_then(|path| path.into_path().ok())
        .map(|path| path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expanded_size_rejects_strip_and_oversized_geometry() {
        assert_eq!(
            clamp_expanded_size(PhysicalSize::new(DOCK_STRIP_WIDTH, DOCK_STRIP_HEIGHT)),
            default_expanded_size()
        );
        assert_eq!(
            clamp_expanded_size(PhysicalSize::new(u32::MAX, u32::MAX)),
            maximum_expanded_size()
        );
    }

    #[test]
    fn expanded_size_preserves_values_inside_the_supported_range() {
        let expected = PhysicalSize::new(640, 840);
        assert_eq!(clamp_expanded_size(expected), expected);
    }

    #[test]
    fn dock_commands_only_run_from_valid_source_states() {
        assert!(should_enter_dock_mode(DockVisualState::Normal));
        assert!(should_enter_dock_mode(DockVisualState::Expanded));
        assert!(!should_enter_dock_mode(DockVisualState::Collapsed));

        assert!(should_expand_dock_mode(DockVisualState::Collapsed));
        assert!(!should_expand_dock_mode(DockVisualState::Expanded));
        assert!(should_collapse_dock_mode(DockVisualState::Expanded));
        assert!(!should_collapse_dock_mode(DockVisualState::Collapsed));
    }
}
