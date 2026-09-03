//! Application release metadata, update checks, and one-time version prompts.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::app_settings::{load_app_settings, save_app_settings};

pub const REPOSITORY_URL: &str = "https://github.com/Chengyue-Lu/UCAS-Classer";
pub const LATEST_RELEASE_URL: &str = "https://github.com/Chengyue-Lu/UCAS-Classer/releases/latest";

const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppReleaseState {
    pub current_version: String,
    pub repository_url: String,
    pub latest_release_url: String,
    pub last_seen_app_version: Option<String>,
    pub last_prompted_update_version: Option<String>,
    pub should_show_post_update_notice: bool,
    pub release_notes: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResult {
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub body: Option<String>,
    pub release_url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInstallResult {
    pub installed: bool,
    pub version: Option<String>,
}

pub fn get_app_release_state() -> Result<AppReleaseState, String> {
    let settings = load_app_settings().unwrap_or_default();
    let current_version = CURRENT_VERSION.to_string();
    let should_show_post_update_notice = settings
        .last_seen_app_version
        .as_deref()
        .is_some_and(|last_seen| last_seen != CURRENT_VERSION)
        && settings.last_prompted_update_version.as_deref() != Some(CURRENT_VERSION);

    Ok(AppReleaseState {
        current_version,
        repository_url: REPOSITORY_URL.to_string(),
        latest_release_url: LATEST_RELEASE_URL.to_string(),
        last_seen_app_version: settings.last_seen_app_version,
        last_prompted_update_version: settings.last_prompted_update_version,
        should_show_post_update_notice,
        release_notes: current_release_notes(),
    })
}

pub fn mark_app_version_seen() -> Result<AppReleaseState, String> {
    let mut settings = load_app_settings().unwrap_or_default();
    settings.last_seen_app_version = Some(CURRENT_VERSION.to_string());
    settings.last_prompted_update_version = Some(CURRENT_VERSION.to_string());
    save_app_settings(settings)?;
    get_app_release_state()
}

pub async fn check_app_update(app: AppHandle) -> Result<AppUpdateCheckResult, String> {
    let update = app
        .updater()
        .map_err(|error| format!("failed to initialize updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("failed to check app update: {error}"))?;

    if let Some(update) = update {
        return Ok(AppUpdateCheckResult {
            available: true,
            current_version: CURRENT_VERSION.to_string(),
            version: Some(update.version),
            body: update.body,
            release_url: LATEST_RELEASE_URL.to_string(),
        });
    }

    Ok(AppUpdateCheckResult {
        available: false,
        current_version: CURRENT_VERSION.to_string(),
        version: None,
        body: None,
        release_url: LATEST_RELEASE_URL.to_string(),
    })
}

pub async fn install_app_update(app: AppHandle) -> Result<AppUpdateInstallResult, String> {
    let update = app
        .updater()
        .map_err(|error| format!("failed to initialize updater: {error}"))?
        .check()
        .await
        .map_err(|error| format!("failed to check app update before install: {error}"))?;

    let Some(update) = update else {
        return Ok(AppUpdateInstallResult {
            installed: false,
            version: None,
        });
    };

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|error| format!("failed to download and install app update: {error}"))?;

    app.restart();
}

fn current_release_notes() -> Vec<String> {
    vec![
        "修复首次或新浏览器登录进入新版 SEP 工作台后，无法自动建立课程平台会话的问题。".to_string(),
        "用户确认更新后改为静默安装并自动重启，减少安装过程中的额外窗口。".to_string(),
    ]
}
