use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::paths::{
    assignment_list_file, course_list_file, course_module_file, data_dir, database_file,
    full_collect_summary_file, material_list_file, notice_list_file,
};

#[derive(Clone, Debug, Serialize)]
pub struct DatabaseImportResult {
    pub collect_finished_at: String,
    pub imported_at_ms: u64,
    pub course_count: usize,
    pub material_count: usize,
    pub notice_count: usize,
    pub assignment_count: usize,
    pub database_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FullCollectSummary {
    finished_at: String,
    course_count: usize,
    success_count: usize,
    failure_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseListSnapshot {
    collected_at: String,
    course_count: usize,
    courses: Vec<CourseRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseRecord {
    course_id: String,
    clazz_id: String,
    cpi: String,
    ckenc: String,
    course_url: String,
    role: Option<String>,
    name: String,
    teacher: Option<String>,
    state: Option<String>,
    source: Option<String>,
    kcenc: Option<String>,
    clazzenc: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CourseModuleSnapshot {
    collected_at: String,
    course_id: String,
    clazz_id: String,
    cpi: String,
    ckenc: String,
    name: String,
    teacher: Option<String>,
    course_url: String,
    course_home_url: String,
    page_title: String,
    materials_url: Option<String>,
    notices_url: Option<String>,
    assignments_url: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaterialListSnapshot {
    collected_at: String,
    course_id: String,
    course_name: String,
    item_count: usize,
    #[serde(rename = "fileCount")]
    _file_count: usize,
    #[serde(rename = "folderCount")]
    _folder_count: usize,
    items: Vec<MaterialRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaterialRecord {
    node_id: String,
    parent_node_id: Option<String>,
    node_type: String,
    item_index: usize,
    path: String,
    depth: usize,
    data_id: Option<String>,
    folder_id: Option<String>,
    name: String,
    r#type: Option<String>,
    object_id: Option<String>,
    uploader: Option<String>,
    size: Option<String>,
    created_at: Option<String>,
    download_url: Option<String>,
    read_url: Option<String>,
    open_url: Option<String>,
    source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoticeListSnapshot {
    collected_at: String,
    course_id: String,
    course_name: String,
    item_count: usize,
    items: Vec<NoticeRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoticeRecord {
    notice_id: String,
    notice_enc: Option<String>,
    title: String,
    detail_url: Option<String>,
    published_at: Option<String>,
    publisher: Option<String>,
    raw_text: String,
    detail_text: Option<String>,
    detail_html: Option<String>,
    detail_collected_at: Option<String>,
    attachments: Vec<NoticeAttachmentRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NoticeAttachmentRecord {
    name: String,
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssignmentListSnapshot {
    collected_at: String,
    course_id: String,
    course_name: String,
    item_count: usize,
    items: Vec<AssignmentRecord>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssignmentRecord {
    title: String,
    work_url: Option<String>,
    status: Option<String>,
    start_time: Option<String>,
    end_time: Option<String>,
    raw_text: String,
}

pub fn latest_collect_finished_at() -> Result<Option<String>, String> {
    let summary_path = full_collect_summary_file();
    if !summary_path.exists() {
        return Ok(None);
    }

    let summary: FullCollectSummary = read_json_file(&summary_path)?;
    if summary.failure_count > 0 || summary.success_count != summary.course_count {
        return Ok(None);
    }

    Ok(Some(summary.finished_at))
}

pub fn last_imported_collect_finished_at() -> Result<Option<String>, String> {
    let database_path = database_file();
    if !database_path.exists() {
        return Ok(None);
    }

    let connection = Connection::open(&database_path)
        .map_err(|error| format!("failed to open database `{}`: {error}", database_path.display()))?;
    init_schema(&connection)?;

    connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'last_imported_collect_finished_at'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to read database meta: {error}"))
}

pub fn import_latest_cache() -> Result<DatabaseImportResult, String> {
    let summary_path = full_collect_summary_file();
    if !summary_path.exists() {
        return Err(format!(
            "collect summary file does not exist: {}",
            summary_path.display()
        ));
    }

    let summary: FullCollectSummary = read_json_file(&summary_path)?;
    if summary.failure_count > 0 || summary.success_count != summary.course_count {
        return Err(format!(
            "full collect summary is incomplete: success={} failure={} course_count={}",
            summary.success_count, summary.failure_count, summary.course_count
        ));
    }

    let course_list: CourseListSnapshot = read_json_file(&course_list_file())?;
    if course_list.course_count != course_list.courses.len() {
        return Err(format!(
            "course list count mismatch: declared {} but found {}",
            course_list.course_count,
            course_list.courses.len()
        ));
    }

    fs::create_dir_all(data_dir())
        .map_err(|error| format!("failed to create data dir `{}`: {error}", data_dir().display()))?;

    let database_path = database_file();
    let mut connection = Connection::open(&database_path)
        .map_err(|error| format!("failed to open database `{}`: {error}", database_path.display()))?;
    init_schema(&connection)?;

    let transaction = connection
        .transaction()
        .map_err(|error| format!("failed to start database transaction: {error}"))?;

    clear_tables(&transaction)?;

    let mut material_count = 0usize;
    let mut notice_count = 0usize;
    let mut assignment_count = 0usize;

    for course in &course_list.courses {
        insert_course(&transaction, &course_list.collected_at, course)?;

        if let Some(module_snapshot) = read_optional_json::<CourseModuleSnapshot>(&course_module_file(&course.course_id))? {
            insert_course_module(&transaction, &module_snapshot)?;
        }

        if let Some(material_snapshot) =
            read_optional_json::<MaterialListSnapshot>(&material_list_file(&course.course_id))?
        {
            material_count += material_snapshot.item_count;
            insert_materials(&transaction, &material_snapshot)?;
        }

        if let Some(notice_snapshot) =
            read_optional_json::<NoticeListSnapshot>(&notice_list_file(&course.course_id))?
        {
            notice_count += notice_snapshot.item_count;
            insert_notices(&transaction, &notice_snapshot)?;
        }

        if let Some(assignment_snapshot) =
            read_optional_json::<AssignmentListSnapshot>(&assignment_list_file(&course.course_id))?
        {
            assignment_count += assignment_snapshot.item_count;
            insert_assignments(&transaction, &assignment_snapshot)?;
        }
    }

    let imported_at_ms = now_ms();
    upsert_meta(
        &transaction,
        "last_imported_collect_finished_at",
        &summary.finished_at,
    )?;
    upsert_meta(
        &transaction,
        "last_imported_at_ms",
        &imported_at_ms.to_string(),
    )?;

    transaction
        .execute(
            "INSERT OR REPLACE INTO import_runs (
                collect_finished_at,
                imported_at_ms,
                course_count,
                success_count,
                failure_count,
                material_count,
                notice_count,
                assignment_count
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                summary.finished_at,
                imported_at_ms as i64,
                course_list.course_count as i64,
                summary.success_count as i64,
                summary.failure_count as i64,
                material_count as i64,
                notice_count as i64,
                assignment_count as i64,
            ],
        )
        .map_err(|error| format!("failed to write import run: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("failed to commit database import: {error}"))?;

    Ok(DatabaseImportResult {
        collect_finished_at: summary.finished_at,
        imported_at_ms,
        course_count: course_list.course_count,
        material_count,
        notice_count,
        assignment_count,
        database_path: database_path.display().to_string(),
    })
}

fn init_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS import_runs (
                collect_finished_at TEXT PRIMARY KEY,
                imported_at_ms INTEGER NOT NULL,
                course_count INTEGER NOT NULL,
                success_count INTEGER NOT NULL,
                failure_count INTEGER NOT NULL,
                material_count INTEGER NOT NULL,
                notice_count INTEGER NOT NULL,
                assignment_count INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS courses (
                course_id TEXT PRIMARY KEY,
                clazz_id TEXT NOT NULL,
                cpi TEXT NOT NULL,
                ckenc TEXT NOT NULL,
                course_url TEXT NOT NULL,
                role TEXT,
                name TEXT NOT NULL,
                teacher TEXT,
                state TEXT,
                source TEXT,
                kcenc TEXT,
                clazzenc TEXT,
                collected_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS course_modules (
                course_id TEXT PRIMARY KEY,
                clazz_id TEXT NOT NULL,
                cpi TEXT NOT NULL,
                ckenc TEXT NOT NULL,
                name TEXT NOT NULL,
                teacher TEXT,
                course_url TEXT NOT NULL,
                course_home_url TEXT NOT NULL,
                page_title TEXT NOT NULL,
                materials_url TEXT,
                notices_url TEXT,
                assignments_url TEXT,
                collected_at TEXT NOT NULL
            );

            DROP TABLE IF EXISTS materials;
            DROP TABLE IF EXISTS notices;

            CREATE TABLE IF NOT EXISTS material_nodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id TEXT NOT NULL,
                course_name TEXT NOT NULL,
                node_id TEXT NOT NULL,
                parent_node_id TEXT,
                node_type TEXT NOT NULL,
                item_index INTEGER NOT NULL,
                path TEXT NOT NULL,
                depth INTEGER NOT NULL,
                data_id TEXT,
                folder_id TEXT,
                name TEXT NOT NULL,
                type TEXT,
                object_id TEXT,
                uploader TEXT,
                size TEXT,
                created_at TEXT,
                download_url TEXT,
                read_url TEXT,
                open_url TEXT,
                source TEXT,
                collected_at TEXT NOT NULL,
                UNIQUE(course_id, node_id)
            );

            CREATE TABLE IF NOT EXISTS notice_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id TEXT NOT NULL,
                course_name TEXT NOT NULL,
                notice_id TEXT NOT NULL,
                item_index INTEGER NOT NULL,
                title TEXT NOT NULL,
                notice_enc TEXT,
                detail_url TEXT,
                published_at TEXT,
                publisher TEXT,
                raw_text TEXT NOT NULL,
                detail_text TEXT,
                detail_html TEXT,
                detail_collected_at TEXT,
                collected_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notice_attachments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id TEXT NOT NULL,
                notice_id TEXT NOT NULL,
                attachment_index INTEGER NOT NULL,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                collected_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS assignments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_id TEXT NOT NULL,
                course_name TEXT NOT NULL,
                item_index INTEGER NOT NULL,
                title TEXT NOT NULL,
                work_url TEXT,
                status TEXT,
                start_time TEXT,
                end_time TEXT,
                raw_text TEXT NOT NULL,
                collected_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|error| format!("failed to initialize database schema: {error}"))
}

fn clear_tables(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute_batch(
            "
            DELETE FROM assignments;
            DELETE FROM notice_attachments;
            DELETE FROM notice_entries;
            DELETE FROM material_nodes;
            DELETE FROM course_modules;
            DELETE FROM courses;
            ",
        )
        .map_err(|error| format!("failed to clear business tables: {error}"))
}

fn insert_course(
    transaction: &Transaction<'_>,
    collected_at: &str,
    course: &CourseRecord,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO courses (
                course_id,
                clazz_id,
                cpi,
                ckenc,
                course_url,
                role,
                name,
                teacher,
                state,
                source,
                kcenc,
                clazzenc,
                collected_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                course.course_id,
                course.clazz_id,
                course.cpi,
                course.ckenc,
                course.course_url,
                course.role,
                course.name,
                course.teacher,
                course.state,
                course.source,
                course.kcenc,
                course.clazzenc,
                collected_at,
            ],
        )
        .map_err(|error| format!("failed to insert course `{}`: {error}", course.course_id))?;

    Ok(())
}

fn insert_course_module(
    transaction: &Transaction<'_>,
    snapshot: &CourseModuleSnapshot,
) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO course_modules (
                course_id,
                clazz_id,
                cpi,
                ckenc,
                name,
                teacher,
                course_url,
                course_home_url,
                page_title,
                materials_url,
                notices_url,
                assignments_url,
                collected_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                snapshot.course_id,
                snapshot.clazz_id,
                snapshot.cpi,
                snapshot.ckenc,
                snapshot.name,
                snapshot.teacher,
                snapshot.course_url,
                snapshot.course_home_url,
                snapshot.page_title,
                snapshot.materials_url,
                snapshot.notices_url,
                snapshot.assignments_url,
                snapshot.collected_at,
            ],
        )
        .map_err(|error| {
            format!(
                "failed to insert course module `{}`: {error}",
                snapshot.course_id
            )
        })?;

    Ok(())
}

fn insert_materials(
    transaction: &Transaction<'_>,
    snapshot: &MaterialListSnapshot,
) -> Result<(), String> {
    for item in &snapshot.items {
        transaction
            .execute(
                "INSERT INTO material_nodes (
                    course_id,
                    course_name,
                    node_id,
                    parent_node_id,
                    node_type,
                    item_index,
                    path,
                    depth,
                    data_id,
                    folder_id,
                    name,
                    type,
                    object_id,
                    uploader,
                    size,
                    created_at,
                    download_url,
                    read_url,
                    open_url,
                    source,
                    collected_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21)",
                params![
                    snapshot.course_id,
                    snapshot.course_name,
                    item.node_id,
                    item.parent_node_id,
                    item.node_type,
                    item.item_index as i64,
                    item.path,
                    item.depth as i64,
                    item.data_id,
                    item.folder_id,
                    item.name,
                    item.r#type,
                    item.object_id,
                    item.uploader,
                    item.size,
                    item.created_at,
                    item.download_url,
                    item.read_url,
                    item.open_url,
                    item.source,
                    snapshot.collected_at,
                ],
            )
            .map_err(|error| {
                format!(
                    "failed to insert material node `{}` for course `{}`: {error}",
                    item.node_id, snapshot.course_id
                )
            })?;
    }

    Ok(())
}

fn insert_notices(
    transaction: &Transaction<'_>,
    snapshot: &NoticeListSnapshot,
) -> Result<(), String> {
    for (index, item) in snapshot.items.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO notice_entries (
                    course_id,
                    course_name,
                    notice_id,
                    item_index,
                    title,
                    notice_enc,
                    detail_url,
                    published_at,
                    publisher,
                    raw_text,
                    detail_text,
                    detail_html,
                    detail_collected_at,
                    collected_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    snapshot.course_id,
                    snapshot.course_name,
                    item.notice_id,
                    index as i64,
                    item.title,
                    item.notice_enc,
                    item.detail_url,
                    item.published_at,
                    item.publisher,
                    item.raw_text,
                    item.detail_text,
                    item.detail_html,
                    item.detail_collected_at,
                    snapshot.collected_at,
                ],
            )
            .map_err(|error| {
                format!(
                    "failed to insert notice `{}` for course `{}`: {error}",
                    index, snapshot.course_id
                )
            })?;

        for (attachment_index, attachment) in item.attachments.iter().enumerate() {
            transaction
                .execute(
                    "INSERT INTO notice_attachments (
                        course_id,
                        notice_id,
                        attachment_index,
                        name,
                        url,
                        collected_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        snapshot.course_id,
                        item.notice_id,
                        attachment_index as i64,
                        attachment.name,
                        attachment.url,
                        snapshot.collected_at,
                    ],
                )
                .map_err(|error| {
                    format!(
                        "failed to insert notice attachment `{}` for course `{}`: {error}",
                        attachment_index, snapshot.course_id
                    )
                })?;
        }
    }

    Ok(())
}

fn insert_assignments(
    transaction: &Transaction<'_>,
    snapshot: &AssignmentListSnapshot,
) -> Result<(), String> {
    for (index, item) in snapshot.items.iter().enumerate() {
        transaction
            .execute(
                "INSERT INTO assignments (
                    course_id,
                    course_name,
                    item_index,
                    title,
                    work_url,
                    status,
                    start_time,
                    end_time,
                    raw_text,
                    collected_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                params![
                    snapshot.course_id,
                    snapshot.course_name,
                    index as i64,
                    item.title,
                    item.work_url,
                    item.status,
                    item.start_time,
                    item.end_time,
                    item.raw_text,
                    snapshot.collected_at,
                ],
            )
            .map_err(|error| {
                format!(
                    "failed to insert assignment `{}` for course `{}`: {error}",
                    index, snapshot.course_id
                )
            })?;
    }

    Ok(())
}

fn upsert_meta(transaction: &Transaction<'_>, key: &str, value: &str) -> Result<(), String> {
    transaction
        .execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|error| format!("failed to write meta `{key}`: {error}"))?;

    Ok(())
}

fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("failed to read `{}`: {error}", path.display()))?;
    serde_json::from_str::<T>(&contents)
        .map_err(|error| format!("failed to parse `{}`: {error}", path.display()))
}

fn read_optional_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }

    read_json_file(path).map(Some)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
