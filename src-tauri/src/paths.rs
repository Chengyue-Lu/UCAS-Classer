use std::path::PathBuf;

pub fn project_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(PathBuf::from)
        .unwrap_or(manifest_dir)
}

pub fn storage_state_file() -> PathBuf {
    project_root()
        .join("automation")
        .join("auth")
        .join("data")
        .join("storage-state.json")
}

pub fn data_dir() -> PathBuf {
    project_root().join("data")
}

pub fn app_settings_file() -> PathBuf {
    data_dir().join("app-settings.json")
}

pub fn cache_dir() -> PathBuf {
    data_dir().join("cache")
}

pub fn database_file() -> PathBuf {
    data_dir().join("ucas-classer.sqlite")
}

pub fn course_list_file() -> PathBuf {
    cache_dir().join("course-list.json")
}

pub fn full_collect_summary_file() -> PathBuf {
    cache_dir().join("full-collect-summary.json")
}

pub fn course_module_file(course_id: &str) -> PathBuf {
    cache_dir().join(format!("course-module-{course_id}.json"))
}

pub fn material_list_file(course_id: &str) -> PathBuf {
    cache_dir().join(format!("material-list-{course_id}.json"))
}

pub fn notice_list_file(course_id: &str) -> PathBuf {
    cache_dir().join(format!("notice-list-{course_id}.json"))
}

pub fn assignment_list_file(course_id: &str) -> PathBuf {
    cache_dir().join(format!("assignment-list-{course_id}.json"))
}
