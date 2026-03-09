use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::paths::database_file;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardData {
    pub loaded_at_ms: u64,
    pub has_database: bool,
    pub course_count: usize,
    pub courses: Vec<DashboardCourse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardCourse {
    pub course_id: String,
    pub course_name: String,
    pub term_category: Option<String>,
    pub teacher: Option<String>,
    pub materials_url: Option<String>,
    pub notices_url: Option<String>,
    pub assignments_url: Option<String>,
    pub notice_count: usize,
    pub material_count: usize,
    pub assignment_count: usize,
    pub notices: Vec<DashboardNotice>,
    pub materials: Vec<DashboardMaterial>,
    pub assignments: Vec<DashboardAssignment>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardNotice {
    pub notice_id: String,
    pub title: String,
    pub published_at: Option<String>,
    pub publisher: Option<String>,
    pub detail_text: Option<String>,
    pub detail_html: Option<String>,
    pub detail_url: Option<String>,
    pub attachments: Vec<DashboardLinkItem>,
    pub raw_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMaterial {
    pub node_id: String,
    pub title: String,
    pub name: String,
    pub path: String,
    pub node_type: String,
    pub uploader: Option<String>,
    pub size: Option<String>,
    pub created_at: Option<String>,
    pub download_url: Option<String>,
    pub open_url: Option<String>,
    pub read_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardAssignment {
    pub title: String,
    pub status: Option<String>,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub work_url: Option<String>,
    pub raw_text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardLinkItem {
    pub title: String,
    pub url: String,
}

pub fn load_dashboard_data() -> Result<DashboardData, String> {
    let database_path = database_file();
    if !database_path.exists() {
        return Ok(DashboardData {
            loaded_at_ms: now_ms(),
            has_database: false,
            course_count: 0,
            courses: Vec::new(),
        });
    }

    let connection = Connection::open(&database_path).map_err(|error| {
        format!(
            "failed to open dashboard database `{}`: {error}",
            database_path.display()
        )
    })?;

    let has_courses = table_exists(&connection, "courses")?;
    if !has_courses {
        return Ok(DashboardData {
            loaded_at_ms: now_ms(),
            has_database: true,
            course_count: 0,
            courses: Vec::new(),
        });
    }

    let has_material_nodes = table_exists(&connection, "material_nodes")?;
    let has_notice_entries = table_exists(&connection, "notice_entries")?;
    let has_notice_attachments = table_exists(&connection, "notice_attachments")?;
    let has_assignments = table_exists(&connection, "assignments")?;
    let has_course_modules = table_exists(&connection, "course_modules")?;

    let mut statement = connection
        .prepare(
            "
            SELECT
              course_id,
              name,
              teacher,
              term_category
            FROM courses
            ORDER BY course_id ASC
            ",
        )
        .map_err(|error| format!("failed to prepare courses query: {error}"))?;

    let course_rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(|error| format!("failed to query dashboard courses: {error}"))?;

    let mut courses = Vec::new();

    for row in course_rows {
        let (course_id, course_name, teacher, term_category) =
            row.map_err(|error| format!("failed to read dashboard course row: {error}"))?;

        let notices = if has_notice_entries {
            load_course_notices(&connection, &course_id, has_notice_attachments)?
        } else {
            Vec::new()
        };

        let materials = if has_material_nodes {
            load_course_materials(&connection, &course_id)?
        } else {
            Vec::new()
        };

        let assignments = if has_assignments {
            load_course_assignments(&connection, &course_id)?
        } else {
            Vec::new()
        };

        let (materials_url, notices_url, assignments_url) = if has_course_modules {
            load_course_module_urls(&connection, &course_id)?
        } else {
            (None, None, None)
        };

        let material_count = materials
            .iter()
            .filter(|item| item.node_type == "file")
            .count();

        courses.push(DashboardCourse {
            course_id,
            course_name,
            term_category,
            teacher,
            materials_url,
            notices_url,
            assignments_url,
            notice_count: notices.len(),
            material_count,
            assignment_count: assignments.len(),
            notices,
            materials,
            assignments,
        });
    }

    Ok(DashboardData {
        loaded_at_ms: now_ms(),
        has_database: true,
        course_count: courses.len(),
        courses,
    })
}

fn load_course_notices(
    connection: &Connection,
    course_id: &str,
    has_notice_attachments: bool,
) -> Result<Vec<DashboardNotice>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              notice_id,
              title,
              published_at,
              publisher,
              detail_text,
              detail_html,
              detail_url,
              raw_text
            FROM notice_entries
            WHERE course_id = ?1
            ORDER BY item_index ASC
            ",
        )
        .map_err(|error| format!("failed to prepare notices query: {error}"))?;

    let rows = statement
        .query_map(params![course_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(|error| format!("failed to query notices for course `{course_id}`: {error}"))?;

    let mut notices = Vec::new();
    for row in rows {
        let (
            notice_id,
            title,
            published_at,
            publisher,
            detail_text,
            detail_html,
            detail_url,
            raw_text,
        ) = row.map_err(|error| format!("failed to read notice row: {error}"))?;

        let attachments = if has_notice_attachments {
            load_notice_attachments(connection, course_id, &notice_id)?
        } else {
            Vec::new()
        };

        notices.push(DashboardNotice {
            notice_id,
            title,
            published_at,
            publisher,
            detail_text,
            detail_html,
            detail_url,
            attachments,
            raw_text,
        });
    }

    Ok(notices)
}

fn load_notice_attachments(
    connection: &Connection,
    course_id: &str,
    notice_id: &str,
) -> Result<Vec<DashboardLinkItem>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              name,
              url
            FROM notice_attachments
            WHERE course_id = ?1
              AND notice_id = ?2
            ORDER BY attachment_index ASC
            ",
        )
        .map_err(|error| format!("failed to prepare notice attachments query: {error}"))?;

    let rows = statement
        .query_map(params![course_id, notice_id], |row| {
            Ok(DashboardLinkItem {
                title: row.get::<_, String>(0)?,
                url: row.get::<_, String>(1)?,
            })
        })
        .map_err(|error| {
            format!(
                "failed to query notice attachments for course `{course_id}` notice `{notice_id}`: {error}"
            )
        })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read notice attachments: {error}"))
}

fn load_course_materials(
    connection: &Connection,
    course_id: &str,
) -> Result<Vec<DashboardMaterial>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              node_id,
              path,
              name,
              node_type,
              uploader,
              size,
              created_at,
              download_url,
              open_url,
              read_url
            FROM material_nodes
            WHERE course_id = ?1
            ORDER BY path ASC
            ",
        )
        .map_err(|error| format!("failed to prepare materials query: {error}"))?;

    let rows = statement
        .query_map(params![course_id], |row| {
            let path = row.get::<_, String>(1)?;
            let name = row.get::<_, String>(2)?;
            Ok(DashboardMaterial {
                node_id: row.get::<_, String>(0)?,
                title: path.clone(),
                path,
                name,
                node_type: row.get::<_, String>(3)?,
                uploader: row.get::<_, Option<String>>(4)?,
                size: row.get::<_, Option<String>>(5)?,
                created_at: row.get::<_, Option<String>>(6)?,
                download_url: row.get::<_, Option<String>>(7)?,
                open_url: row.get::<_, Option<String>>(8)?,
                read_url: row.get::<_, Option<String>>(9)?,
            })
        })
        .map_err(|error| format!("failed to query materials for course `{course_id}`: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read materials: {error}"))
}

fn load_course_assignments(
    connection: &Connection,
    course_id: &str,
) -> Result<Vec<DashboardAssignment>, String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              title,
              status,
              start_time,
              end_time,
              work_url,
              raw_text
            FROM assignments
            WHERE course_id = ?1
            ORDER BY item_index ASC
            ",
        )
        .map_err(|error| format!("failed to prepare assignments query: {error}"))?;

    let rows = statement
        .query_map(params![course_id], |row| {
            Ok(DashboardAssignment {
                title: row.get::<_, String>(0)?,
                status: row.get::<_, Option<String>>(1)?,
                start_time: row.get::<_, Option<String>>(2)?,
                end_time: row.get::<_, Option<String>>(3)?,
                work_url: row.get::<_, Option<String>>(4)?,
                raw_text: row.get::<_, String>(5)?,
            })
        })
        .map_err(|error| format!("failed to query assignments for course `{course_id}`: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to read assignments: {error}"))
}

fn load_course_module_urls(
    connection: &Connection,
    course_id: &str,
) -> Result<(Option<String>, Option<String>, Option<String>), String> {
    let mut statement = connection
        .prepare(
            "
            SELECT
              materials_url,
              notices_url,
              assignments_url
            FROM course_modules
            WHERE course_id = ?1
            LIMIT 1
            ",
        )
        .map_err(|error| format!("failed to prepare course module urls query: {error}"))?;

    statement
        .query_row(params![course_id], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .optional()
        .map_err(|error| format!("failed to query course module urls for `{course_id}`: {error}"))?
        .map_or(Ok((None, None, None)), Ok)
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
        .map_err(|error| format!("failed to prepare table existence query: {error}"))?;

    statement
        .query_row(params![table_name], |row| row.get::<_, bool>(0))
        .map_err(|error| format!("failed to query table existence for `{table_name}`: {error}"))
}

fn now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
