//! On-demand assignment detail loading and local cache persistence.
//! This keeps assignment summaries cheap during collect while still allowing
//! the desktop app to show richer content when a user opens one item.

use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tokio::task::spawn_blocking;

use crate::paths::{data_dir, database_file};
use crate::script_runner::{run_hidden_script, ScriptOutput};

const ASSIGNMENT_DETAIL_CACHE_VERSION: u32 = 2;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentDetailRequest {
    pub course_id: String,
    pub assignments_url: Option<String>,
    pub work_url: String,
    pub title: String,
    pub status: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub raw_text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentDetailLink {
    pub title: String,
    pub url: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AssignmentDetailScriptPayload {
    work_url: String,
    final_url: String,
    detail_text: String,
    detail_html: Option<String>,
    detail_collected_at: String,
    #[serde(default)]
    links: Vec<AssignmentDetailLink>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssignmentDetailResponse {
    pub work_url: String,
    pub final_url: String,
    pub detail_text: String,
    pub detail_html: Option<String>,
    pub detail_collected_at: String,
    pub links: Vec<AssignmentDetailLink>,
    pub cached: bool,
}

pub async fn load_assignment_detail(
    request: AssignmentDetailRequest,
) -> Result<AssignmentDetailResponse, String> {
    let course_id = request.course_id.trim().to_string();
    let work_url = request.work_url.trim().to_string();
    if course_id.is_empty() {
        return Err("assignment detail requires a course id".to_string());
    }
    if work_url.is_empty() {
        return Err("assignment detail requires a work url".to_string());
    }

    let summary_fingerprint = build_summary_fingerprint(&request);

    if let Some(cached) =
        load_cached_assignment_detail(&course_id, &work_url, &summary_fingerprint)?
    {
        return Ok(cached);
    }

    let output = spawn_blocking(move || {
        let mut owned_args = vec![
            "--work-url".to_string(),
            work_url.clone(),
            "--title".to_string(),
            request.title.clone(),
        ];

        if let Some(assignments_url) = request
            .assignments_url
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            owned_args.push("--assignments-url".to_string());
            owned_args.push(assignments_url.to_string());
        }

        if let Some(start_time) = request
            .start_time
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            owned_args.push("--start-time".to_string());
            owned_args.push(start_time.to_string());
        }

        if let Some(end_time) = request
            .end_time
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            owned_args.push("--end-time".to_string());
            owned_args.push(end_time.to_string());
        }

        let borrowed_args = owned_args.iter().map(String::as_str).collect::<Vec<_>>();
        run_hidden_script("assignment:detail", &borrowed_args)
    })
    .await
    .map_err(|error| format!("failed to join assignment:detail task: {error}"))??;

    if !output.success {
        return Err(script_failure_message("assignment:detail", &output));
    }

    let payload = parse_assignment_detail_payload(&output.stdout)?;
    let response = AssignmentDetailResponse {
        work_url: payload.work_url,
        final_url: payload.final_url,
        detail_text: payload.detail_text,
        detail_html: payload.detail_html,
        detail_collected_at: payload.detail_collected_at,
        links: payload.links,
        cached: false,
    };

    save_cached_assignment_detail(&course_id, &summary_fingerprint, &response)?;
    Ok(response)
}

fn load_cached_assignment_detail(
    course_id: &str,
    work_url: &str,
    summary_fingerprint: &str,
) -> Result<Option<AssignmentDetailResponse>, String> {
    let database_path = database_file();
    if !database_path.exists() {
        return Ok(None);
    }

    let connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "failed to open assignment detail database `{}`: {error}",
            database_path.display()
        )
    })?;
    init_assignment_detail_schema(&connection)?;

    connection
        .query_row(
            "
            SELECT
              summary_fingerprint,
              final_url,
              detail_text,
              detail_html,
              links_json,
              detail_collected_at
            FROM assignment_detail_cache
            WHERE course_id = ?1
              AND work_url = ?2
            LIMIT 1
            ",
            params![course_id, work_url],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to query assignment detail cache: {error}"))?
        .map_or(Ok(None), |row| {
            let (
                cached_fingerprint,
                final_url,
                detail_text,
                detail_html,
                links_json,
                detail_collected_at,
            ) = row;

            if cached_fingerprint != summary_fingerprint {
                return Ok(None);
            }

            let links = serde_json::from_str::<Vec<AssignmentDetailLink>>(&links_json).map_err(
                |error| format!("failed to parse cached assignment detail links: {error}"),
            )?;

            Ok(Some(AssignmentDetailResponse {
                work_url: work_url.to_string(),
                final_url,
                detail_text,
                detail_html,
                detail_collected_at,
                links,
                cached: true,
            }))
        })
}

fn save_cached_assignment_detail(
    course_id: &str,
    summary_fingerprint: &str,
    detail: &AssignmentDetailResponse,
) -> Result<(), String> {
    fs::create_dir_all(data_dir()).map_err(|error| {
        format!(
            "failed to create data dir `{}` for assignment cache: {error}",
            data_dir().display()
        )
    })?;

    let database_path = database_file();
    let connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "failed to open assignment detail database `{}`: {error}",
            database_path.display()
        )
    })?;
    init_assignment_detail_schema(&connection)?;

    let links_json = serde_json::to_string(&detail.links)
        .map_err(|error| format!("failed to serialize assignment detail links: {error}"))?;

    connection
        .execute(
            "
            INSERT INTO assignment_detail_cache (
              course_id,
              work_url,
              summary_fingerprint,
              final_url,
              detail_text,
              detail_html,
              links_json,
              detail_collected_at,
              cached_at_ms
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(course_id, work_url) DO UPDATE SET
              summary_fingerprint = excluded.summary_fingerprint,
              final_url = excluded.final_url,
              detail_text = excluded.detail_text,
              detail_html = excluded.detail_html,
              links_json = excluded.links_json,
              detail_collected_at = excluded.detail_collected_at,
              cached_at_ms = excluded.cached_at_ms
            ",
            params![
                course_id,
                detail.work_url,
                summary_fingerprint,
                detail.final_url,
                detail.detail_text,
                detail.detail_html,
                links_json,
                detail.detail_collected_at,
                now_ms() as i64,
            ],
        )
        .map_err(|error| format!("failed to write assignment detail cache: {error}"))?;

    Ok(())
}

fn init_assignment_detail_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS assignment_detail_cache (
              course_id TEXT NOT NULL,
              work_url TEXT NOT NULL,
              summary_fingerprint TEXT NOT NULL,
              final_url TEXT NOT NULL,
              detail_text TEXT NOT NULL,
              detail_html TEXT,
              links_json TEXT NOT NULL,
              detail_collected_at TEXT NOT NULL,
              cached_at_ms INTEGER NOT NULL,
              PRIMARY KEY(course_id, work_url)
            );
            ",
        )
        .map_err(|error| format!("failed to initialize assignment detail schema: {error}"))
}

fn build_summary_fingerprint(request: &AssignmentDetailRequest) -> String {
    serde_json::json!({
        "cacheVersion": ASSIGNMENT_DETAIL_CACHE_VERSION,
        "title": request.title,
        "status": request.status,
        "startTime": request.start_time,
        "endTime": request.end_time,
        "rawText": request.raw_text,
        "workUrl": request.work_url,
    })
    .to_string()
}

fn parse_assignment_detail_payload(stdout: &str) -> Result<AssignmentDetailScriptPayload, String> {
    serde_json::from_str(stdout)
        .map_err(|error| format!("failed to parse assignment detail output: {error}"))
}

fn script_failure_message(script: &str, output: &ScriptOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return format!("{script} failed: {stderr}");
    }

    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return format!("{script} failed: {stdout}");
    }

    format!("{script} failed with exit code {}", output.exit_code)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
