use tauri::State;
use ucas_classer::auth_runtime::{
    acknowledge_hourly_refresh_due as acknowledge_hourly_refresh_due_impl,
    get_runtime_status as get_runtime_status_impl,
    run_auth_check as run_auth_check_impl,
    run_auth_clear as run_auth_clear_impl,
    run_explicit_auth_check as run_explicit_auth_check_impl,
    run_interrupt_login as run_interrupt_login_impl,
    start_runtime_scheduler as start_runtime_scheduler_impl,
    stop_runtime_scheduler as stop_runtime_scheduler_impl,
    RuntimeService, RuntimeSnapshot, SharedRuntimeService,
};

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

fn main() {
    tauri::Builder::default()
        .manage(RuntimeService::new())
        .invoke_handler(tauri::generate_handler![
            get_runtime_status,
            start_runtime_scheduler,
            stop_runtime_scheduler,
            run_auth_check,
            run_explicit_auth_check,
            run_interrupt_login,
            run_auth_clear,
            acknowledge_hourly_refresh_due,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri application");
}
