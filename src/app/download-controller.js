export function createDownloadController({
  state,
  setModalFeedback,
  setDownloadProgress,
  openSettingsModal,
  invokeRequiredTauriCommand,
  normalizeRelativeSubdir,
  joinRelativeSubdirs,
  getErrorMessage,
}) {
  function getCourseDownloadSubdir(courseId) {
    const value = state.settings.courseDownloadSubdirs?.[courseId]
    return typeof value === 'string' ? normalizeRelativeSubdir(value) : ''
  }

  function getMaterialRelativeDir(item) {
    const segments = String(item?.path || '')
      .replace(/\\/g, '/')
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)

    if (segments.length <= 1) {
      return ''
    }

    return normalizeRelativeSubdir(segments.slice(0, -1).join('/'))
  }

  function getDownloadRelativeDir(course, item = null) {
    const courseRelativeDir = getCourseDownloadSubdir(course?.courseId)
    const materialRelativeDir = item && item.nodeType === 'file' ? getMaterialRelativeDir(item) : ''
    return joinRelativeSubdirs(courseRelativeDir, materialRelativeDir)
  }

  async function downloadResource({
    url,
    suggestedName,
    referer,
    relativeSubdir = '',
    conflictPolicy = 'rename',
  }) {
    if (!url) {
      setModalFeedback('当前条目没有可用下载地址。', 'error')
      return
    }

    if (!state.settings.downloadDir?.trim()) {
      openSettingsModal('请先设置下载目录。')
      return
    }

    setModalFeedback('正在下载...', 'info')

    try {
      const result = await invokeRequiredTauriCommand(
        'download_protected_file',
        {
          url,
          suggestedName: suggestedName ?? null,
          referer,
          relativeSubdir: normalizeRelativeSubdir(relativeSubdir) || null,
          conflictPolicy,
        },
        '当前不在 Tauri 环境内，无法执行内置下载。',
      )
      setModalFeedback(`已下载到: ${result.savedPath}`, 'success')
    } catch (error) {
      setModalFeedback(getErrorMessage(error), 'error')
    }
  }

  async function downloadMaterialBatch(course, items) {
    if (state.downloadProgress.phase === 'running') {
      setModalFeedback('当前已有批量下载任务在执行。', 'warning')
      return
    }

    if (!state.settings.downloadDir?.trim()) {
      openSettingsModal('请先设置下载目录。')
      return
    }

    const requests = items
      .filter((item) => item.nodeType === 'file' && item.downloadUrl)
      .map((item) => ({
        url: item.downloadUrl,
        suggestedName: item.name || item.title || null,
        referer: course.materialsUrl || null,
        relativeSubdir: getDownloadRelativeDir(course, item) || null,
      }))

    if (!requests.length) {
      setModalFeedback('当前课程没有可批量下载的资料。', 'warning')
      return
    }

    setDownloadProgress({
      phase: 'running',
      completedCount: 0,
      totalCount: requests.length,
      successCount: 0,
      failureCount: 0,
    })
    setModalFeedback(`正在批量下载 ${requests.length} 项资料...`, 'info')

    const failedItems = []
    let successCount = 0

    try {
      for (let index = 0; index < requests.length; index += 1) {
        const request = requests[index]

        try {
          await invokeRequiredTauriCommand(
            'download_protected_file',
            {
              url: request.url,
              suggestedName: request.suggestedName ?? null,
              referer: request.referer,
              relativeSubdir: request.relativeSubdir,
              conflictPolicy: 'overwrite',
            },
            '当前不在 Tauri 环境内，无法执行内置批量下载。',
          )
          successCount += 1
        } catch (error) {
          failedItems.push({
            suggestedName: request.suggestedName,
            error: getErrorMessage(error),
          })
        }

        setDownloadProgress({
          phase: 'running',
          completedCount: index + 1,
          totalCount: requests.length,
          successCount,
          failureCount: failedItems.length,
        })
        await new Promise((resolve) => {
          window.setTimeout(resolve, 0)
        })
      }

      if (failedItems.length > 0) {
        setDownloadProgress({
          phase: 'fail',
          completedCount: requests.length,
          totalCount: requests.length,
          successCount,
          failureCount: failedItems.length,
        })

        const failureSummary = failedItems
          .slice(0, 3)
          .map((item) => `${item.suggestedName || '未命名文件'}: ${item.error || '下载失败'}`)
          .join(' | ')
        const summary = `批量下载完成：成功 ${successCount} / 失败 ${failedItems.length} / 共 ${requests.length}`
        console.error('Material batch download failures', failedItems)
        setModalFeedback(failureSummary ? `${summary}。${failureSummary}` : summary, 'warning')
        return
      }

      setDownloadProgress({
        phase: 'success',
        completedCount: requests.length,
        totalCount: requests.length,
        successCount,
        failureCount: 0,
      })
      setModalFeedback(`批量下载完成：成功 ${successCount} / 共 ${requests.length}`, 'success')
    } catch (error) {
      setDownloadProgress({
        phase: 'fail',
        completedCount: state.downloadProgress.completedCount,
        totalCount: requests.length,
        successCount,
        failureCount: Math.max(1, failedItems.length),
      })
      setModalFeedback(getErrorMessage(error), 'error')
    }
  }

  return {
    downloadMaterialBatch,
    downloadResource,
    getDownloadRelativeDir,
  }
}
