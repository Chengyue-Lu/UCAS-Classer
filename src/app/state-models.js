function createIdleDownloadProgress() {
  return {
    phase: 'idle',
    completedCount: 0,
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
  }
}

function createFallbackRuntimeSnapshot() {
  return {
    scheduler_running: false,
    interrupt_flag: false,
    interrupt_reason: null,
    auth_check_running: false,
    explicit_check_running: false,
    reset_running: false,
    login_running: false,
    hourly_refresh_due: false,
    collect_refresh_due: false,
    collect_refresh_running: false,
    db_import_due: false,
    db_import_running: false,
    last_auth_check_at_ms: null,
    last_auth_check_ok: null,
    last_collect_finished_at_ms: null,
    last_collect_ok: null,
    last_db_import_finished_at_ms: null,
    last_error: null,
  }
}

function getRuntimeStatusModel(snapshot) {
  let label = 'UNKNOWN'

  if (!snapshot) {
    return {
      label,
      tone: 'neutral',
    }
  }

  if (snapshot.db_import_running) {
    label = 'IMPORTING'
  } else if (snapshot.collect_refresh_running) {
    label = 'COLLECTING'
  } else if (snapshot.auth_check_running || snapshot.explicit_check_running) {
    label = 'CHECKING'
  } else if (snapshot.login_running) {
    label = 'LOGIN REQUIRED'
  } else if (snapshot.interrupt_flag) {
    label = 'INTERRUPTED'
  } else if (snapshot.last_auth_check_ok === true) {
    label = 'ONLINE'
  } else if (snapshot.last_auth_check_ok === false) {
    label = 'OFFLINE'
  }

  let tone = 'neutral'
  if (label === 'ONLINE') {
    tone = 'online'
  } else if (label === 'CHECKING' || label === 'COLLECTING' || label === 'IMPORTING') {
    tone = 'active'
  } else if (label === 'INTERRUPTED' || label === 'LOGIN REQUIRED') {
    tone = 'warning'
  } else if (label === 'OFFLINE') {
    tone = 'danger'
  }

  return {
    label,
    tone,
  }
}

function getStatusSurfaceModel(runtime, downloadProgress) {
  if (downloadProgress.phase === 'running') {
    return {
      state: 'warning',
      text: `Downloading... ${downloadProgress.completedCount}/${downloadProgress.totalCount}`,
      clickable: false,
    }
  }

  if (downloadProgress.phase === 'success') {
    return {
      state: 'online',
      text: 'Success!',
      clickable: false,
    }
  }

  if (downloadProgress.phase === 'fail') {
    return {
      state: 'danger',
      text: `Fail: ${downloadProgress.successCount} Success, ${downloadProgress.failureCount} Fail`,
      clickable: true,
    }
  }

  const runtimeStatus = getRuntimeStatusModel(runtime)
  return {
    state: runtimeStatus.tone,
    text: runtimeStatus.label === 'UNKNOWN' ? 'WAITING' : runtimeStatus.label,
    clickable: false,
  }
}

export {
  createFallbackRuntimeSnapshot,
  createIdleDownloadProgress,
  getRuntimeStatusModel,
  getStatusSurfaceModel,
}
