//! Aggregates "what is new since the last full import" and emits course-level
//! desktop notifications for the windowed app.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::paths::{data_dir, database_file, reminder_state_file};

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct ReminderState {
    baseline_established: bool,
    last_collect_finished_at: Option<String>,
    seen_notice_keys: BTreeSet<String>,
    seen_material_keys: BTreeSet<String>,
    seen_assignment_keys: BTreeSet<String>,
}

#[derive(Debug)]
struct ReminderCourseAggregate {
    course_name: String,
    new_notices: Vec<String>,
    new_materials: Vec<String>,
    new_assignments: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSyncResult {
    pub baseline_established: bool,
    pub collect_finished_at: Option<String>,
    pub notification_count: usize,
}

pub fn sync_post_import_reminders(app: &AppHandle) -> Result<ReminderSyncResult, String> {
    let database_path = database_file();
    if !database_path.exists() {
        return Ok(ReminderSyncResult {
            baseline_established: false,
            collect_finished_at: None,
            notification_count: 0,
        });
    }

    let connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "failed to open reminder database `{}`: {error}",
            database_path.display()
        )
    })?;

    let collect_finished_at = load_last_imported_collect_finished_at(&connection)?;
    let Some(collect_finished_at) = collect_finished_at else {
        return Ok(ReminderSyncResult {
            baseline_established: false,
            collect_finished_at: None,
            notification_count: 0,
        });
    };

    let notice_items = load_notice_items(&connection)?;
    let material_items = load_material_items(&connection)?;
    let assignment_items = load_assignment_items(&connection)?;

    let current_notice_keys = notice_items
        .iter()
        .map(|item| item.identity_key.clone())
        .collect::<BTreeSet<_>>();
    let current_material_keys = material_items
        .iter()
        .map(|item| item.identity_key.clone())
        .collect::<BTreeSet<_>>();
    let current_assignment_keys = assignment_items
        .iter()
        .map(|item| item.identity_key.clone())
        .collect::<BTreeSet<_>>();

    let mut state = load_reminder_state().unwrap_or_default();

    if state.last_collect_finished_at.as_deref() == Some(collect_finished_at.as_str()) {
        return Ok(ReminderSyncResult {
            baseline_established: state.baseline_established,
            collect_finished_at: Some(collect_finished_at),
            notification_count: 0,
        });
    }

    if !state.baseline_established {
        state.baseline_established = true;
        state.last_collect_finished_at = Some(collect_finished_at.clone());
        state.seen_notice_keys = current_notice_keys;
        state.seen_material_keys = current_material_keys;
        state.seen_assignment_keys = current_assignment_keys;
        save_reminder_state(&state)?;

        return Ok(ReminderSyncResult {
            baseline_established: true,
            collect_finished_at: Some(collect_finished_at),
            notification_count: 0,
        });
    }

    let mut course_aggregates = BTreeMap::<String, ReminderCourseAggregate>::new();

    notice_items
        .iter()
        .filter(|item| !item.was_seen_in(&state.seen_notice_keys))
        .for_each(|item| {
            let aggregate = course_aggregates
                .entry(item.course_id.clone())
                .or_insert_with(|| ReminderCourseAggregate {
                    course_name: item.course_name.clone(),
                    new_notices: Vec::new(),
                    new_materials: Vec::new(),
                    new_assignments: Vec::new(),
                });
            aggregate.new_notices.push(item.title.clone());
        });

    material_items
        .iter()
        .filter(|item| !item.was_seen_in(&state.seen_material_keys))
        .for_each(|item| {
            let aggregate = course_aggregates
                .entry(item.course_id.clone())
                .or_insert_with(|| ReminderCourseAggregate {
                    course_name: item.course_name.clone(),
                    new_notices: Vec::new(),
                    new_materials: Vec::new(),
                    new_assignments: Vec::new(),
                });
            aggregate.new_materials.push(item.title.clone());
        });

    assignment_items
        .iter()
        .filter(|item| !item.was_seen_in(&state.seen_assignment_keys))
        .for_each(|item| {
            let aggregate = course_aggregates
                .entry(item.course_id.clone())
                .or_insert_with(|| ReminderCourseAggregate {
                    course_name: item.course_name.clone(),
                    new_notices: Vec::new(),
                    new_materials: Vec::new(),
                    new_assignments: Vec::new(),
                });
            aggregate.new_assignments.push(item.title.clone());
        });

    let mut notification_count = 0usize;
    for aggregate in course_aggregates.values() {
        let body = build_notification_body(aggregate);
        app.notification()
            .builder()
            .title(&aggregate.course_name)
            .body(&body)
            .show()
            .map_err(|error| format!("failed to show reminder notification: {error}"))?;
        notification_count += 1;
    }

    state.last_collect_finished_at = Some(collect_finished_at.clone());
    state.seen_notice_keys = current_notice_keys;
    state.seen_material_keys = current_material_keys;
    state.seen_assignment_keys = current_assignment_keys;
    save_reminder_state(&state)?;

    Ok(ReminderSyncResult {
        baseline_established: true,
        collect_finished_at: Some(collect_finished_at),
        notification_count,
    })
}

#[derive(Debug)]
struct ReminderItem {
    course_id: String,
    course_name: String,
    identity_key: String,
    legacy_identity_key: Option<String>,
    title: String,
}

impl ReminderItem {
    fn was_seen_in(&self, seen_keys: &BTreeSet<String>) -> bool {
        seen_keys.contains(&self.identity_key)
            || self
                .legacy_identity_key
                .as_ref()
                .is_some_and(|legacy_key| seen_keys.contains(legacy_key))
    }
}

fn load_last_imported_collect_finished_at(
    connection: &Connection,
) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM meta WHERE key = 'last_imported_collect_finished_at'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to read reminder meta: {error}"))
}

fn load_notice_items(connection: &Connection) -> Result<Vec<ReminderItem>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT course_id, course_name, notice_id, title
            FROM notice_entries
            ORDER BY course_id, item_index
            ",
        )
        .map_err(|error| format!("failed to prepare reminder notice query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            let course_id = row.get::<_, String>(0)?;
            let notice_id = row.get::<_, String>(2)?;
            Ok(ReminderItem {
                course_id: course_id.clone(),
                course_name: row.get::<_, String>(1)?,
                identity_key: format!("notice:{course_id}:{notice_id}"),
                legacy_identity_key: None,
                title: row.get::<_, String>(3)?,
            })
        })
        .map_err(|error| format!("failed to query reminder notices: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read reminder notices: {error}"))
}

fn load_material_items(connection: &Connection) -> Result<Vec<ReminderItem>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT course_id, course_name, node_id, path
            FROM material_nodes
            WHERE node_type = 'file'
            ORDER BY course_id, path
            ",
        )
        .map_err(|error| format!("failed to prepare reminder material query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            let course_id = row.get::<_, String>(0)?;
            let node_id = row.get::<_, String>(2)?;
            Ok(ReminderItem {
                course_id: course_id.clone(),
                course_name: row.get::<_, String>(1)?,
                identity_key: format!("material:{course_id}:{node_id}"),
                legacy_identity_key: None,
                title: row.get::<_, String>(3)?,
            })
        })
        .map_err(|error| format!("failed to query reminder materials: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read reminder materials: {error}"))
}

fn load_assignment_items(connection: &Connection) -> Result<Vec<ReminderItem>, String> {
    let work_id_expr = if table_column_exists(connection, "assignments", "work_id")? {
        "work_id"
    } else {
        "NULL"
    };
    let query = format!(
        "
            SELECT course_id, course_name, title, {work_id_expr}, work_url, start_time, end_time, raw_text
            FROM assignments
            ORDER BY course_id, item_index
            "
    );
    let mut statement = connection
        .prepare(&query)
        .map_err(|error| format!("failed to prepare reminder assignment query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            let course_id = row.get::<_, String>(0)?;
            let title = row.get::<_, String>(2)?;
            let work_id = row.get::<_, Option<String>>(3)?;
            let work_url = row.get::<_, Option<String>>(4)?;
            let identity_key = work_id
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("assignment:{course_id}:work:{value}"))
                .unwrap_or_else(|| {
                    format!(
                        "assignment:{course_id}:{}",
                        serde_json::json!({
                            "title": title,
                            "startTime": row.get::<_, Option<String>>(5).ok().flatten(),
                            "endTime": row.get::<_, Option<String>>(6).ok().flatten(),
                            "rawText": row.get::<_, String>(7).unwrap_or_default(),
                        })
                    )
                });
            let legacy_identity_key = work_url
                .filter(|value| !value.trim().is_empty())
                .map(|value| format!("assignment:{course_id}:{value}"));

            Ok(ReminderItem {
                course_id,
                course_name: row.get::<_, String>(1)?,
                identity_key,
                legacy_identity_key,
                title,
            })
        })
        .map_err(|error| format!("failed to query reminder assignments: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read reminder assignments: {error}"))
}

fn table_column_exists(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, String> {
    let pragma = format!("PRAGMA table_info({table_name})");
    let mut statement = connection
        .prepare(&pragma)
        .map_err(|error| format!("failed to prepare reminder column info query: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| {
            format!("failed to query reminder column info for `{table_name}`: {error}")
        })?;

    for row in rows {
        if row.map_err(|error| format!("failed to read reminder column info: {error}"))?
            == column_name
        {
            return Ok(true);
        }
    }

    Ok(false)
}

fn build_notification_body(aggregate: &ReminderCourseAggregate) -> String {
    let mut parts = Vec::new();
    if !aggregate.new_notices.is_empty() {
        parts.push(format!("新通知 {} 条", aggregate.new_notices.len()));
    }
    if !aggregate.new_materials.is_empty() {
        parts.push(format!("新资料 {} 项", aggregate.new_materials.len()));
    }
    if !aggregate.new_assignments.is_empty() {
        parts.push(format!("新作业 {} 项", aggregate.new_assignments.len()));
    }

    let summary = parts.join(" / ");
    let preview = aggregate
        .new_notices
        .iter()
        .chain(aggregate.new_materials.iter())
        .chain(aggregate.new_assignments.iter())
        .take(3)
        .cloned()
        .collect::<Vec<_>>()
        .join("，");

    if preview.is_empty() {
        summary
    } else {
        format!("{summary}\n{preview}")
    }
}

fn load_reminder_state() -> Result<ReminderState, String> {
    let path = reminder_state_file();
    if !path.exists() {
        return Ok(ReminderState::default());
    }

    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read reminder state `{}`: {error}",
            path.display()
        )
    })?;
    serde_json::from_str(&raw).map_err(|error| {
        format!(
            "failed to parse reminder state `{}`: {error}",
            path.display()
        )
    })
}

fn save_reminder_state(state: &ReminderState) -> Result<(), String> {
    fs::create_dir_all(data_dir()).map_err(|error| {
        format!(
            "failed to create data dir `{}` for reminder state: {error}",
            data_dir().display()
        )
    })?;

    let contents = serde_json::to_string_pretty(state)
        .map_err(|error| format!("failed to serialize reminder state: {error}"))?;
    let path = reminder_state_file();
    fs::write(&path, contents).map_err(|error| {
        format!(
            "failed to write reminder state `{}`: {error}",
            path.display()
        )
    })
}
