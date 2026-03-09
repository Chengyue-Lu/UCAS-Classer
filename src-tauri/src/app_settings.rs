use std::fs;

use serde::{Deserialize, Serialize};

use crate::paths::{app_settings_file, data_dir, project_root};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub download_dir: String,
    pub course_scope: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            download_dir: project_root().display().to_string(),
            course_scope: "all".to_string(),
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

    serde_json::from_str::<AppSettings>(&contents)
        .map_err(|error| format!("failed to parse app settings `{}`: {error}", settings_path.display()))
}

pub fn save_app_settings(mut settings: AppSettings) -> Result<AppSettings, String> {
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

    fs::create_dir_all(data_dir())
        .map_err(|error| format!("failed to create data dir `{}`: {error}", data_dir().display()))?;

    let contents = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("failed to serialize app settings: {error}"))?;

    let settings_path = app_settings_file();
    fs::write(&settings_path, contents).map_err(|error| {
        format!(
            "failed to write app settings `{}`: {error}",
            settings_path.display()
        )
    })?;

    Ok(settings)
}
