use std::fs;
use std::path::{Component, Path};

use serde::{Deserialize, Serialize};

use crate::paths::{app_settings_file, data_dir, project_root};

const DEFAULT_AUTH_CHECK_INTERVAL_SECS: u64 = 3 * 60;
const DEFAULT_COLLECT_INTERVAL_SECS: u64 = 60 * 60;
const DEFAULT_COOKIE_REFRESH_INTERVAL_SECS: u64 = 60 * 60;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub download_dir: String,
    pub course_scope: String,
    pub course_download_subdirs: std::collections::BTreeMap<String, String>,
    pub auth_check_interval_secs: u64,
    pub collect_interval_secs: u64,
    pub cookie_refresh_interval_secs: u64,
    pub last_auth_check_at_ms: Option<u64>,
    pub last_collect_finished_at_ms: Option<u64>,
    pub last_cookie_refresh_at_ms: Option<u64>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_dir: project_root().display().to_string(),
            course_scope: "all".to_string(),
            course_download_subdirs: std::collections::BTreeMap::new(),
            auth_check_interval_secs: DEFAULT_AUTH_CHECK_INTERVAL_SECS,
            collect_interval_secs: DEFAULT_COLLECT_INTERVAL_SECS,
            cookie_refresh_interval_secs: DEFAULT_COOKIE_REFRESH_INTERVAL_SECS,
            last_auth_check_at_ms: None,
            last_collect_finished_at_ms: None,
            last_cookie_refresh_at_ms: None,
        }
    }
}

pub fn load_app_settings() -> Result<AppSettings, String> {
    let settings_path = app_settings_file();
    if !settings_path.exists() {
        return Ok(AppSettings::default());
    }

    let contents = fs::read_to_string(&settings_path).map_err(|error| {
        format!(
            "failed to read app settings `{}`: {error}",
            settings_path.display()
        )
    })?;

    let mut settings = serde_json::from_str::<AppSettings>(&contents)
        .map_err(|error| format!("failed to parse app settings `{}`: {error}", settings_path.display()))?;
    normalize_settings(&mut settings);
    Ok(settings)
}

pub fn save_app_settings(mut settings: AppSettings) -> Result<AppSettings, String> {
    normalize_settings(&mut settings);
    write_app_settings(&settings)?;
    Ok(settings)
}

pub fn persist_runtime_markers(
    last_auth_check_at_ms: Option<u64>,
    last_collect_finished_at_ms: Option<u64>,
    last_cookie_refresh_at_ms: Option<u64>,
) -> Result<(), String> {
    let mut settings = load_app_settings().unwrap_or_default();
    settings.last_auth_check_at_ms = last_auth_check_at_ms;
    settings.last_collect_finished_at_ms = last_collect_finished_at_ms;
    settings.last_cookie_refresh_at_ms = last_cookie_refresh_at_ms;
    write_app_settings(&settings)
}

fn normalize_settings(settings: &mut AppSettings) {
    let trimmed_download_dir = settings.download_dir.trim();
    settings.download_dir = if trimmed_download_dir.is_empty() {
        project_root().display().to_string()
    } else {
        trimmed_download_dir.to_string()
    };

    settings.course_scope = match settings.course_scope.trim() {
        "current" => "current".to_string(),
        "past" => "past".to_string(),
        _ => "all".to_string(),
    };

    settings.course_download_subdirs = settings
        .course_download_subdirs
        .iter()
        .filter_map(|(course_id, relative_dir)| {
            let normalized_key = course_id.trim();
            let normalized_value = normalize_relative_subdir(relative_dir);
            if normalized_key.is_empty() || normalized_value.is_empty() {
                return None;
            }

            Some((normalized_key.to_string(), normalized_value))
        })
        .collect();

    settings.auth_check_interval_secs =
        normalize_interval_secs(settings.auth_check_interval_secs, DEFAULT_AUTH_CHECK_INTERVAL_SECS);
    settings.collect_interval_secs =
        normalize_interval_secs(settings.collect_interval_secs, DEFAULT_COLLECT_INTERVAL_SECS);
    settings.cookie_refresh_interval_secs = normalize_interval_secs(
        settings.cookie_refresh_interval_secs,
        DEFAULT_COOKIE_REFRESH_INTERVAL_SECS,
    );
}

fn normalize_interval_secs(value: u64, default_value: u64) -> u64 {
    if value == 0 {
        default_value
    } else {
        value
    }
}

fn normalize_relative_subdir(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let candidate = trimmed.replace('\\', "/");
    let path = Path::new(&candidate);
    if path.is_absolute() {
        return String::new();
    }

    let mut segments = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => {
                let segment = part.to_string_lossy().trim().to_string();
                if segment.is_empty() {
                    continue;
                }
                if segment.contains(':') {
                    return String::new();
                }
                segments.push(segment);
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return String::new();
            }
        }
    }

    segments.join("/")
}

fn write_app_settings(settings: &AppSettings) -> Result<(), String> {
    fs::create_dir_all(data_dir())
        .map_err(|error| format!("failed to create data dir `{}`: {error}", data_dir().display()))?;

    let contents = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize app settings: {error}"))?;

    let settings_path = app_settings_file();
    fs::write(&settings_path, contents).map_err(|error| {
        format!(
            "failed to write app settings `{}`: {error}",
            settings_path.display()
        )
    })?;

    Ok(())
}
