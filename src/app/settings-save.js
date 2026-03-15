export function createSettingsSaver({
  state,
  syncSettingsMeta,
  renderCourses,
  refreshWindowDockState,
  invokeRequiredTauriCommand,
  normalizeCourseDownloadSubdirs,
  setModalFeedback,
}) {
  return async function saveSettingsPatch(
    patch,
    {
      successMessage = '',
      syncMeta = false,
      renderCoursesAfterSave = false,
      refreshDockStateAfterSave = false,
      afterSave = null,
    } = {},
  ) {
    const nextSettings = {
      ...state.settings,
      ...patch,
    }

    if (Object.hasOwn(nextSettings, 'courseDownloadSubdirs')) {
      nextSettings.courseDownloadSubdirs = normalizeCourseDownloadSubdirs(
        nextSettings.courseDownloadSubdirs,
      )
    }

    const saved = await invokeRequiredTauriCommand(
      'save_app_settings',
      { settings: nextSettings },
      '当前不在 Tauri 环境内，无法保存设置。',
    )

    state.settings = saved

    if (syncMeta) {
      syncSettingsMeta(state.settings)
    }

    if (renderCoursesAfterSave) {
      renderCourses()
    }

    if (typeof afterSave === 'function') {
      await afterSave(saved)
    }

    if (refreshDockStateAfterSave) {
      await refreshWindowDockState()
    }

    if (successMessage) {
      setModalFeedback(successMessage, 'success')
    }

    return saved
  }
}
