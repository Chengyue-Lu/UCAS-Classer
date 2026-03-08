use serde::{Deserialize, Serialize};

use crate::app_settings::load_app_settings;
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

pub fn download_protected_file(
    url: String,
    suggested_name: Option<String>,
    referer: Option<String>,
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
