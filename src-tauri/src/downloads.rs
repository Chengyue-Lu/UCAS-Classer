use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::app_settings::load_app_settings;
use crate::paths::cache_dir;
use crate::script_runner::run_hidden_script;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtectedDownloadResult {
    pub saved_path: String,
    pub saved_file_name: String,
    pub output_dir: String,
    pub final_url: String,
    pub content_type: String,
    pub byte_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub url: String,
    pub suggested_name: Option<String>,
    pub referer: Option<String>,
    pub relative_subdir: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDownloadItemResult {
    pub ok: bool,
    pub suggested_name: Option<String>,
    pub saved_path: Option<String>,
    pub saved_file_name: Option<String>,
    pub relative_subdir: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchDownloadResult {
    pub total_count: usize,
    pub success_count: usize,
    pub failure_count: usize,
    pub items: Vec<BatchDownloadItemResult>,
}

pub async fn download_protected_file(
    url: String,
    suggested_name: Option<String>,
    referer: Option<String>,
    relative_subdir: Option<String>,
    conflict_policy: Option<String>,
) -> Result<ProtectedDownloadResult, String> {
    tokio::task::spawn_blocking(move || {
        download_protected_file_blocking(
            url,
            suggested_name,
            referer,
            relative_subdir,
            conflict_policy,
        )
    })
    .await
    .map_err(|error| format!("download task join failure: {error}"))?
}

pub async fn download_protected_files(requests: Vec<DownloadRequest>) -> Result<BatchDownloadResult, String> {
    tokio::task::spawn_blocking(move || download_protected_files_blocking(requests))
        .await
        .map_err(|error| format!("download batch task join failure: {error}"))?
}

fn download_protected_file_blocking(
    url: String,
    suggested_name: Option<String>,
    referer: Option<String>,
    relative_subdir: Option<String>,
    conflict_policy: Option<String>,
) -> Result<ProtectedDownloadResult, String> {
    let settings = load_app_settings()?;
    let mut owned_args = vec![
        "--url".to_string(),
        url,
        "--output-dir".to_string(),
        settings.download_dir.clone(),
    ];

    if let Some(name) = suggested_name.filter(|value| !value.trim().is_empty()) {
        owned_args.push("--suggested-name".to_string());
        owned_args.push(name);
    }

    if let Some(referer) = referer.filter(|value| !value.trim().is_empty()) {
        owned_args.push("--referer".to_string());
        owned_args.push(referer);
    }

    if let Some(relative_dir) = normalize_relative_subdir(relative_subdir.as_deref()) {
        owned_args.push("--relative-dir".to_string());
        owned_args.push(relative_dir);
    }

    owned_args.push("--conflict".to_string());
    owned_args.push(normalize_conflict_policy(conflict_policy.as_deref(), "rename"));

    let borrowed_args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_hidden_script("download:file", &borrowed_args)?;

    if !output.success {
        let error_output = if !output.stderr.is_empty() {
            output.stderr
        } else if !output.stdout.is_empty() {
            output.stdout
        } else {
            format!("download:file failed with exit code {}", output.exit_code)
        };
        return Err(error_output);
    }

    let json_line = output
        .stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "failed to parse download:file output: stdout was empty".to_string())?;

    serde_json::from_str::<ProtectedDownloadResult>(json_line)
        .map_err(|error| format!("failed to parse download:file output: {error}"))
}

fn download_protected_files_blocking(requests: Vec<DownloadRequest>) -> Result<BatchDownloadResult, String> {
    let settings = load_app_settings()?;
    if requests.is_empty() {
        return Ok(BatchDownloadResult {
            total_count: 0,
            success_count: 0,
            failure_count: 0,
            items: Vec::new(),
        });
    }

    fs::create_dir_all(cache_dir()).map_err(|error| {
        format!(
            "failed to create cache dir `{}` for batch downloads: {error}",
            cache_dir().display()
        )
    })?;

    let manifest_path = create_manifest_file_path();
    let resolved_requests = requests
        .into_iter()
        .map(|request| DownloadRequest {
            relative_subdir: normalize_relative_subdir(request.relative_subdir.as_deref()),
            ..request
        })
        .collect::<Vec<_>>();

    let manifest_json = serde_json::to_string_pretty(&resolved_requests)
        .map_err(|error| format!("failed to serialize download batch manifest: {error}"))?;
    fs::write(&manifest_path, manifest_json).map_err(|error| {
        format!(
            "failed to write download batch manifest `{}`: {error}",
            manifest_path.display()
        )
    })?;

    let owned_args = vec![
        "--manifest".to_string(),
        manifest_path.display().to_string(),
        "--output-dir".to_string(),
        settings.download_dir.clone(),
        "--conflict".to_string(),
        "overwrite".to_string(),
    ];
    let borrowed_args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
    let output = run_hidden_script("download:batch", &borrowed_args);
    let _ = fs::remove_file(&manifest_path);
    let output = output?;

    if !output.success {
        let error_output = if !output.stderr.is_empty() {
            output.stderr
        } else if !output.stdout.is_empty() {
            output.stdout
        } else {
            format!("download:batch failed with exit code {}", output.exit_code)
        };
        return Err(error_output);
    }

    let json_line = output
        .stdout
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .ok_or_else(|| "failed to parse download:batch output: stdout was empty".to_string())?;

    serde_json::from_str::<BatchDownloadResult>(json_line)
        .map_err(|error| format!("failed to parse download:batch output: {error}"))
}

fn normalize_relative_subdir(value: Option<&str>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }

    let normalized = trimmed.replace('\\', "/");
    if normalized.starts_with('/') {
        return None;
    }

    let segments = normalized
        .split('/')
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>();

    if segments.is_empty()
        || segments
            .iter()
            .any(|segment| *segment == ".." || segment.contains(':'))
    {
        return None;
    }

    Some(segments.join("/"))
}

fn normalize_conflict_policy(value: Option<&str>, fallback: &str) -> String {
    match value.map(str::trim) {
        Some("overwrite") => "overwrite".to_string(),
        Some("skip") => "skip".to_string(),
        Some("rename") => "rename".to_string(),
        _ => fallback.to_string(),
    }
}

fn create_manifest_file_path() -> PathBuf {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    cache_dir().join(format!(
        "download-batch-manifest-{}-{}.json",
        std::process::id(),
        now_ms
    ))
}
