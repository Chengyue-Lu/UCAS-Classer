//! Persistent read/unread state for user-facing content.
//! Business tables are rebuilt during import, so read state lives separately.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{params, Connection};
use serde::Serialize;

use crate::paths::database_file;

pub const KIND_NOTICE: &str = "notice";
pub const KIND_MATERIAL: &str = "material";
pub const KIND_ASSIGNMENT: &str = "assignment";

#[derive(Clone, Debug)]
pub struct ContentIdentity {
    pub kind: String,
    pub course_id: String,
    pub identity_key: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentReadUpdateResult {
    pub unread_count: usize,
}

pub fn notice_identity_key(course_id: &str, notice_id: &str) -> String {
    format!("notice:{course_id}:{notice_id}")
}

pub fn material_identity_key(course_id: &str, node_id: &str) -> String {
    format!("material:{course_id}:{node_id}")
}

pub fn assignment_identity_key(
    course_id: &str,
    title: &str,
    work_id: Option<&str>,
    start_time: Option<&str>,
    end_time: Option<&str>,
    raw_text: &str,
) -> String {
    work_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("assignment:{course_id}:work:{value}"))
        .unwrap_or_else(|| {
            format!(
                "assignment:{course_id}:{}",
                serde_json::json!({
                    "title": title,
                    "startTime": start_time,
                    "endTime": end_time,
                    "rawText": raw_text,
                })
            )
        })
}

pub fn init_schema(connection: &Connection) -> Result<(), String> {
    if table_exists(connection, "content_read_state")?
        && !table_column_exists(connection, "content_read_state", "is_read")?
    {
        migrate_legacy_schema(connection)?;
        return Ok(());
    }

    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS content_read_state (
              identity_key TEXT PRIMARY KEY,
              is_read INTEGER NOT NULL DEFAULT 0
            );
            ",
        )
        .map_err(|error| format!("failed to initialize content read state schema: {error}"))
}

fn migrate_legacy_schema(connection: &Connection) -> Result<(), String> {
    let is_read_expr = if table_column_exists(connection, "content_read_state", "viewed_at")? {
        "CASE WHEN viewed_at IS NULL THEN 0 ELSE 1 END"
    } else {
        "0"
    };

    connection
        .execute_batch(&format!(
            "
            CREATE TABLE IF NOT EXISTS content_read_state_next (
              identity_key TEXT PRIMARY KEY,
              is_read INTEGER NOT NULL DEFAULT 0
            );
            INSERT OR REPLACE INTO content_read_state_next (identity_key, is_read)
            SELECT identity_key, {is_read_expr}
            FROM content_read_state;
            DROP TABLE content_read_state;
            ALTER TABLE content_read_state_next RENAME TO content_read_state;
            "
        ))
        .map_err(|error| format!("failed to migrate content read state schema: {error}"))
}

pub fn mark_items_unread(
    connection: &Connection,
    items: &[ContentIdentity],
) -> Result<usize, String> {
    init_schema(connection)?;
    let mut inserted = 0usize;

    for item in items {
        let changed = connection
            .execute(
                "
                INSERT OR IGNORE INTO content_read_state (identity_key, is_read)
                VALUES (?1, 0)
                ",
                params![item.identity_key],
            )
            .map_err(|error| {
                format!(
                    "failed to mark content unread `{}`: {error}",
                    item.identity_key
                )
            })?;
        inserted += changed;
    }

    prune_read_state(connection)?;
    Ok(inserted)
}

pub fn mark_content_item_viewed(
    kind: String,
    _course_id: String,
    identity_key: String,
) -> Result<ContentReadUpdateResult, String> {
    let database_path = database_file();
    let connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "failed to open content read state database `{}`: {error}",
            database_path.display()
        )
    })?;
    init_schema(&connection)?;

    let _ = normalize_kind(&kind)?;
    connection
        .execute(
            "
            INSERT INTO content_read_state (identity_key, is_read)
            VALUES (?1, 1)
            ON CONFLICT(identity_key) DO UPDATE SET
              is_read = 1
            ",
            params![identity_key],
        )
        .map_err(|error| format!("failed to mark content item viewed: {error}"))?;

    Ok(ContentReadUpdateResult {
        unread_count: count_current_unread(&connection)?,
    })
}

pub fn mark_all_content_viewed() -> Result<ContentReadUpdateResult, String> {
    let database_path = database_file();
    if !database_path.exists() {
        return Ok(ContentReadUpdateResult { unread_count: 0 });
    }

    let connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "failed to open content read state database `{}`: {error}",
            database_path.display()
        )
    })?;
    init_schema(&connection)?;

    connection
        .execute(
            "
            UPDATE content_read_state
            SET is_read = 1
            WHERE is_read = 0
            ",
            [],
        )
        .map_err(|error| format!("failed to mark all content viewed: {error}"))?;

    Ok(ContentReadUpdateResult {
        unread_count: count_current_unread(&connection)?,
    })
}

pub fn count_current_unread_from_database() -> Result<usize, String> {
    let database_path = database_file();
    if !database_path.exists() {
        return Ok(0);
    }

    let connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "failed to open content read state database `{}`: {error}",
            database_path.display()
        )
    })?;
    init_schema(&connection)?;
    count_current_unread(&connection)
}

pub fn count_current_unread(connection: &Connection) -> Result<usize, String> {
    let unread_keys = load_unread_keys(connection)?;
    let current_keys = current_identity_keys(connection)?;
    Ok(unread_keys.intersection(&current_keys).count())
}

pub fn load_unread_keys(connection: &Connection) -> Result<BTreeSet<String>, String> {
    init_schema(connection)?;
    let mut statement = connection
        .prepare(
            "
            SELECT identity_key
            FROM content_read_state
            WHERE is_read = 0
            ",
        )
        .map_err(|error| format!("failed to prepare unread key query: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to query unread keys: {error}"))?;

    rows.collect::<Result<BTreeSet<_>, _>>()
        .map_err(|error| format!("failed to read unread keys: {error}"))
}

pub fn load_unread_keys_by_kind(
    connection: &Connection,
) -> Result<BTreeMap<String, BTreeSet<String>>, String> {
    init_schema(connection)?;
    let unread_keys = load_unread_keys(connection)?;
    let mut grouped = BTreeMap::<String, BTreeSet<String>>::new();
    for item in current_content_identities(connection)? {
        if unread_keys.contains(&item.identity_key) {
            grouped
                .entry(item.kind)
                .or_default()
                .insert(item.identity_key);
        }
    }
    Ok(grouped)
}

pub fn prune_read_state(connection: &Connection) -> Result<usize, String> {
    init_schema(connection)?;

    let current_keys = current_identity_keys(connection)?;
    let mut statement = connection
        .prepare(
            "
            SELECT identity_key, is_read
            FROM content_read_state
            ",
        )
        .map_err(|error| format!("failed to prepare read state prune query: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| format!("failed to query read states for prune: {error}"))?;

    let mut deleted = 0usize;
    for row in rows {
        let (identity_key, is_read) =
            row.map_err(|error| format!("failed to read state for prune: {error}"))?;
        if is_read != 0 || !current_keys.contains(&identity_key) {
            deleted += connection
                .execute(
                    "DELETE FROM content_read_state WHERE identity_key = ?1",
                    params![identity_key],
                )
                .map_err(|error| format!("failed to prune read state: {error}"))?;
        }
    }

    Ok(deleted)
}

fn current_identity_keys(connection: &Connection) -> Result<BTreeSet<String>, String> {
    Ok(current_content_identities(connection)?
        .into_iter()
        .map(|item| item.identity_key)
        .collect())
}

fn current_content_identities(connection: &Connection) -> Result<Vec<ContentIdentity>, String> {
    let mut items = Vec::new();

    if table_exists(connection, "notice_entries")? {
        let mut statement = connection
            .prepare("SELECT course_id, notice_id FROM notice_entries")
            .map_err(|error| format!("failed to prepare current notice identity query: {error}"))?;
        let rows = statement
            .query_map([], |row| {
                let course_id = row.get::<_, String>(0)?;
                let notice_id = row.get::<_, String>(1)?;
                Ok(ContentIdentity {
                    kind: KIND_NOTICE.to_string(),
                    identity_key: notice_identity_key(&course_id, &notice_id),
                    course_id,
                })
            })
            .map_err(|error| format!("failed to query current notice identities: {error}"))?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("failed to read current notice identities: {error}"))?,
        );
    }

    if table_exists(connection, "material_nodes")? {
        let mut statement = connection
            .prepare("SELECT course_id, node_id FROM material_nodes WHERE node_type = 'file'")
            .map_err(|error| {
                format!("failed to prepare current material identity query: {error}")
            })?;
        let rows = statement
            .query_map([], |row| {
                let course_id = row.get::<_, String>(0)?;
                let node_id = row.get::<_, String>(1)?;
                Ok(ContentIdentity {
                    kind: KIND_MATERIAL.to_string(),
                    identity_key: material_identity_key(&course_id, &node_id),
                    course_id,
                })
            })
            .map_err(|error| format!("failed to query current material identities: {error}"))?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("failed to read current material identities: {error}"))?,
        );
    }

    if table_exists(connection, "assignments")? {
        let work_id_expr = if table_column_exists(connection, "assignments", "work_id")? {
            "work_id"
        } else {
            "NULL"
        };
        let query = format!(
            "
            SELECT course_id, title, {work_id_expr}, start_time, end_time, raw_text
            FROM assignments
            "
        );
        let mut statement = connection.prepare(&query).map_err(|error| {
            format!("failed to prepare current assignment identity query: {error}")
        })?;
        let rows = statement
            .query_map([], |row| {
                let course_id = row.get::<_, String>(0)?;
                let title = row.get::<_, String>(1)?;
                let work_id = row.get::<_, Option<String>>(2)?;
                let start_time = row.get::<_, Option<String>>(3)?;
                let end_time = row.get::<_, Option<String>>(4)?;
                let raw_text = row.get::<_, String>(5)?;
                Ok(ContentIdentity {
                    kind: KIND_ASSIGNMENT.to_string(),
                    identity_key: assignment_identity_key(
                        &course_id,
                        &title,
                        work_id.as_deref(),
                        start_time.as_deref(),
                        end_time.as_deref(),
                        &raw_text,
                    ),
                    course_id,
                })
            })
            .map_err(|error| format!("failed to query current assignment identities: {error}"))?;
        items.extend(
            rows.collect::<Result<Vec<_>, _>>().map_err(|error| {
                format!("failed to read current assignment identities: {error}")
            })?,
        );
    }

    Ok(items)
}

fn normalize_kind(kind: &str) -> Result<&'static str, String> {
    match kind.trim() {
        KIND_NOTICE => Ok(KIND_NOTICE),
        KIND_MATERIAL | "materials" => Ok(KIND_MATERIAL),
        KIND_ASSIGNMENT | "assignments" => Ok(KIND_ASSIGNMENT),
        other => Err(format!("unsupported content kind `{other}`")),
    }
}

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT EXISTS(
              SELECT 1
              FROM sqlite_master
              WHERE type = 'table'
                AND name = ?1
            )
            ",
        )
        .map_err(|error| format!("failed to prepare content table existence query: {error}"))?;
    statement
        .query_row(params![table_name], |row| row.get::<_, bool>(0))
        .map_err(|error| {
            format!("failed to query content table existence for `{table_name}`: {error}")
        })
}

fn table_column_exists(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection
        .prepare(&pragma)
        .map_err(|error| format!("failed to prepare content column info query: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| {
            format!("failed to query content column info for `{table_name}`: {error}")
        })?;

    for row in rows {
        if row.map_err(|error| format!("failed to read content column info: {error}"))?
            == column_name
        {
            return Ok(true);
        }
    }

    Ok(false)
}
