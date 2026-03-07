use std::path::PathBuf;

pub fn project_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .map(PathBuf::from)
        .unwrap_or(manifest_dir)
}

pub fn storage_state_file() -> PathBuf {
    project_root().join("automation").join("auth").join("data").join("storage-state.json")
}
