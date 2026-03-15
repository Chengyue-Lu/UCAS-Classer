import {
  getErrorMessage,
  getTauriEventListen,
  invokeRequiredTauriCommand,
  invokeTauriCommand,
  waitForTauriInvoke,
} from './app/bridge.js'
import {
  formatCount,
  formatRelativeTime,
  formatSettingsInterval,
  intervalMinutesToSecs,
  intervalSecsToMinutes,
} from './app/formatters.js'
import {
  getCourseSubdirSelectionPath,
  isPathInsideBase,
  joinRelativeSubdirs,
  normalizeCourseDownloadSubdirs,
  normalizeRelativeSubdir,
  toRelativeSubdir,
} from './app/path-utils.js'
import {
  createFallbackRuntimeSnapshot,
  createIdleDownloadProgress,
  getStatusSurfaceModel,
} from './app/state-models.js'
import { createCourseRenderer } from './app/course-renderer.js'
import { createDockController } from './app/dock-controller.js'
import { createDetailController } from './app/detail-controller.js'
import { createDownloadController } from './app/download-controller.js'
import { createDetailAction, createDetailChip, createTextBlock } from './app/modal-ui.js'
import { createSettingsSaver } from './app/settings-save.js'
import { createSettingsController } from './app/settings-controller.js'

const appShell = document.querySelector('#app-shell')
const courseList = document.querySelector('#course-list')
const courseCount = document.querySelector('#course-count')
const emptyState = document.querySelector('#empty-state')
const runtimeCollectAge = document.querySelector('#runtime-collect-age')
const downloadStatus = document.querySelector('#download-status')
const runtimeButtons = document.querySelectorAll('[data-runtime-action]')
const modalOverlay = document.querySelector('#detail-modal')
const modalKind = document.querySelector('#modal-kind')
const modalTitle = document.querySelector('#modal-title')
const modalMeta = document.querySelector('#modal-meta')
const modalActions = document.querySelector('#modal-actions')
const modalFeedback = document.querySelector('#modal-feedback')
const modalBody = document.querySelector('#modal-body')
const modalClose = document.querySelector('#modal-close')
const modalPanel = document.querySelector('.modal-panel')
const dockHandle = document.querySelector('#dock-handle')
let downloadStatusResetTimer = null

const state = {
  runtime: null,
  dashboard: {
    loadedAtMs: Date.now(),
    hasDatabase: false,
    courseCount: 0,
    courses: [],
  },
  settings: {
    downloadDir: '',
    courseScope: 'all',
    courseDownloadSubdirs: {},
    pendingFullCollectAfterDiff: false,
    enableAutoDockCollapse: false,
    dockSide: null,
    dockExpandedWidth: null,
    dockExpandedHeight: null,
    dockLastX: null,
    dockLastY: null,
    authCheckIntervalSecs: 180 * 60,
    collectIntervalSecs: 15 * 60,
    cookieRefreshIntervalSecs: 720 * 60,
  },
  activeAction: null,
  downloadProgress: createIdleDownloadProgress(),
  modalOpen: false,
  modalType: null,
  lastSeenDbImportFinishedAt: null,
  windowDock: {
    enabled: false,
    state: 'normal',
    side: null,
  },
}

function syncRuntimePanel() {
  const snapshot = state.runtime
  runtimeCollectAge.textContent = formatRelativeTime(snapshot?.last_collect_finished_at_ms ?? null)
  syncDownloadStatus()

  runtimeButtons.forEach((button) => {
    button.dataset.active = String(button.dataset.runtimeAction === state.activeAction)
  })
}

function syncDownloadStatus() {
  if (!downloadStatus) {
    return
  }

  const statusModel = getStatusSurfaceModel(state.runtime, state.downloadProgress)
  downloadStatus.dataset.state = statusModel.state
  downloadStatus.dataset.clickable = String(statusModel.clickable)
  downloadStatus.disabled = !statusModel.clickable
  downloadStatus.textContent = statusModel.text
}

function clearDownloadStatusResetTimer() {
  if (downloadStatusResetTimer !== null) {
    window.clearTimeout(downloadStatusResetTimer)
    downloadStatusResetTimer = null
  }
}

function setDownloadProgress(nextProgress) {
  clearDownloadStatusResetTimer()
  state.downloadProgress = nextProgress
  syncDownloadStatus()

  if (nextProgress.phase === 'success') {
    downloadStatusResetTimer = window.setTimeout(() => {
      state.downloadProgress = createIdleDownloadProgress()
      downloadStatusResetTimer = null
      syncDownloadStatus()
    }, 20000)
  }
}


function setModalFeedback(message, tone = 'neutral') {
  if (!message) {
    modalFeedback.hidden = true
    modalFeedback.textContent = ''
    modalFeedback.dataset.tone = ''
    return
  }

  modalFeedback.hidden = false
  modalFeedback.textContent = message
  modalFeedback.dataset.tone = tone
}

const detailControllerRef = {
  closeDetailModal: null,
  openDetailModal: null,
}

const courseRendererRef = {
  refreshTitleMarquee: null,
  renderCourses: null,
}

const dockController = createDockController({
  appShell,
  dockHandle,
  state,
  closeDetailModal: (...args) => detailControllerRef.closeDetailModal?.(...args),
  invokeTauriCommand,
  getTauriEventListen,
})

const {
  bindDockInteractions,
  initializeDockSync,
  refreshWindowDockState,
  renderDockSurface,
} = dockController

const saveSettingsPatch = createSettingsSaver({
  state,
  syncSettingsMeta,
  renderCourses: () => courseRendererRef.renderCourses?.(),
  refreshWindowDockState,
  invokeRequiredTauriCommand,
  normalizeCourseDownloadSubdirs,
  setModalFeedback,
})

const settingsControllerRef = {
  openSettingsModal: null,
}

const downloadController = createDownloadController({
  state,
  setModalFeedback,
  setDownloadProgress,
  openSettingsModal: (...args) => settingsControllerRef.openSettingsModal?.(...args),
  invokeRequiredTauriCommand,
  normalizeRelativeSubdir,
  joinRelativeSubdirs,
  getErrorMessage,
})

const { downloadMaterialBatch, downloadResource, getDownloadRelativeDir } = downloadController

const detailController = createDetailController({
  state,
  modalOverlay,
  modalKind,
  modalTitle,
  modalMeta,
  modalActions,
  modalBody,
  appShell,
  resetModal,
  downloadResource,
  getDownloadRelativeDir,
  copyText,
  openExternalUrl,
  openAuthenticatedUrl,
})

const { closeDetailModal, openDetailModal } = detailController
detailControllerRef.closeDetailModal = closeDetailModal
detailControllerRef.openDetailModal = openDetailModal

const courseRenderer = createCourseRenderer({
  state,
  courseList,
  courseCount,
  emptyState,
  openDetailModal: (...args) => detailControllerRef.openDetailModal?.(...args),
  downloadMaterialBatch,
})

const { refreshTitleMarquee, renderCourses } = courseRenderer
courseRendererRef.refreshTitleMarquee = refreshTitleMarquee
courseRendererRef.renderCourses = renderCourses

const settingsController = createSettingsController({
  state,
  modalOverlay,
  modalKind,
  modalTitle,
  modalBody,
  modalActions,
  modalPanel,
  appShell,
  setModalFeedback,
  resetModal,
  applySettingsModalChromeOrder,
  syncSettingsMeta,
  createDetailAction,
  createTextBlock,
  saveSettingsPatch,
  renderCourses: () => courseRendererRef.renderCourses?.(),
  invokeTauriCommand,
  pickFolderPath,
  intervalSecsToMinutes,
  intervalMinutesToSecs,
  getCourseSubdirSelectionPath,
  isPathInsideBase,
  normalizeRelativeSubdir,
  toRelativeSubdir,
  getErrorMessage,
})

const { openCourseSubdirModal, openSettingsModal } = settingsController
settingsControllerRef.openSettingsModal = openSettingsModal

function applyDefaultModalChromeOrder() {
  modalPanel.append(modalMeta, modalActions, modalFeedback, modalBody)
}

function applySettingsModalChromeOrder() {
  modalPanel.append(modalMeta, modalBody, modalFeedback, modalActions)
}

function resetModal() {
  applyDefaultModalChromeOrder()
  modalPanel.dataset.layout = 'default'
  modalKind.textContent = '详情'
  modalTitle.textContent = '详情'
  modalMeta.replaceChildren()
  modalActions.replaceChildren()
  modalBody.replaceChildren()
  setModalFeedback('')
}

function syncSettingsMeta(settings) {
  const downloadChip = createDetailChip('下载目录', settings.downloadDir || '未设置')
  downloadChip.classList.add('detail-chip--wide')

  const summaryRow = document.createElement('div')
  summaryRow.className = 'settings-meta-row'
  summaryRow.append(
    createDetailChip('Check', formatSettingsInterval(settings.authCheckIntervalSecs, 180)),
    createDetailChip('Collect', formatSettingsInterval(settings.collectIntervalSecs, 15)),
    createDetailChip('Cookie', formatSettingsInterval(settings.cookieRefreshIntervalSecs, 720)),
  )

  modalMeta.replaceChildren(downloadChip, summaryRow)
}

async function pickFolderPath(initialPath = '') {
  const selectedPath = await invokeTauriCommand('pick_folder_path', {
    initialPath: initialPath || null,
  })

  if (selectedPath === null) {
    throw new Error('当前环境不支持系统目录选择器。')
  }

  return typeof selectedPath === 'string' ? selectedPath : ''
}

async function copyText(text) {
  try {
    if (!navigator.clipboard?.writeText) {
      setModalFeedback('当前环境不支持剪贴板。', 'error')
      return
    }

    await navigator.clipboard.writeText(text)
    setModalFeedback('链接已复制到剪贴板。', 'success')
  } catch (error) {
    setModalFeedback(`复制失败: ${String(error)}`, 'error')
  }
}

async function openExternalUrl(url) {
  if (!url) {
    return
  }

  const result = await invokeTauriCommand('open_external_url', { url })
  if (result === null) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

async function openAuthenticatedUrl(url) {
  if (!url) {
    return
  }

  try {
    const result = await invokeTauriCommand('open_authenticated_url', { url })
    if (result === null) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } catch (error) {
    setModalFeedback(String(error), 'error')
  }
}

async function loadDashboardData() {
  const data = await invokeTauriCommand('load_dashboard_data')
  if (!data) {
    state.dashboard = {
      loadedAtMs: Date.now(),
      hasDatabase: false,
      courseCount: 0,
      courses: [],
    }
  } else {
    state.dashboard = data
  }

  renderCourses()
  syncRuntimePanel()
}

async function loadSettings() {
  const settings = await invokeTauriCommand('load_app_settings')
  if (!settings) {
    return
  }

  state.settings = {
    ...state.settings,
    ...settings,
    courseDownloadSubdirs: settings.courseDownloadSubdirs || {},
  }
}

async function refreshRuntimeStatus() {
  const snapshot = await invokeTauriCommand('get_runtime_status')
  if (!snapshot) {
    state.runtime = createFallbackRuntimeSnapshot()
    syncRuntimePanel()
    return
  }

  state.runtime = snapshot
  syncRuntimePanel()

  const importVersion =
    snapshot.last_imported_collect_finished_at ||
    String(snapshot.last_db_import_finished_at_ms || '')

  if (importVersion && importVersion !== state.lastSeenDbImportFinishedAt) {
    state.lastSeenDbImportFinishedAt = importVersion
    await loadDashboardData()
  }
}

async function runRuntimeAction(action) {
  const commandMap = {
    check: 'run_auth_check',
    collect: 'run_full_collect',
    login: 'run_interrupt_login',
  }

  const command = commandMap[action]
  if (!command) {
    return
  }

  state.activeAction = action
  syncRuntimePanel()

  try {
    const snapshot = await invokeTauriCommand(command)
    if (snapshot) {
      state.runtime = snapshot
    }

    if (action === 'collect') {
      await loadDashboardData()
    }
  } finally {
    state.activeAction = null
    syncRuntimePanel()
  }
}

function bindRuntimeButtons() {
  runtimeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      runRuntimeAction(button.dataset.runtimeAction)
    })
  })
}

function bindStatusSurface() {
  if (!downloadStatus) {
    return
  }

  downloadStatus.addEventListener('click', () => {
    if (state.downloadProgress.phase !== 'fail') {
      return
    }

    setDownloadProgress(createIdleDownloadProgress())
  })
}

function bindWindowControls() {
  document.querySelectorAll('.window-button').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.action

      if (action === 'settings') {
        openSettingsModal()
        return
      }

      if (action === 'minimize') {
        await invokeTauriCommand('window_minimize')
        return
      }

      if (action === 'close') {
        const result = await invokeTauriCommand('window_close')
        if (result === null) {
          window.close()
        }
      }
    })
  })
}

function bindModalControls() {
  modalClose.addEventListener('click', closeDetailModal)
  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) {
      closeDetailModal()
    }
  })

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.modalOpen) {
      closeDetailModal()
    }
  })
}

function bindTitleOverflowRefresh() {
  window.addEventListener('resize', () => {
    document.querySelectorAll('.course-card').forEach((card) => {
      refreshTitleMarquee(card)
    })
  })
}

function startRuntimeUiTimer() {
  window.setInterval(() => {
    syncRuntimePanel()
  }, 30000)
}

function startRuntimeStatusPolling() {
  window.setInterval(() => {
    refreshRuntimeStatus()
  }, 3000)
}

async function initializeRuntime() {
  const started = await invokeTauriCommand('start_runtime_scheduler')
  state.runtime = started || createFallbackRuntimeSnapshot()
  syncRuntimePanel()
}

async function initialize() {
  bindWindowControls()
  bindRuntimeButtons()
  bindStatusSurface()
  bindModalControls()
  bindTitleOverflowRefresh()
  bindDockInteractions()
  closeDetailModal()
  renderDockSurface()

  const invoke = await waitForTauriInvoke()
  if (!invoke) {
    state.runtime = createFallbackRuntimeSnapshot()
    syncRuntimePanel()
    renderDockSurface()
    const errorNode = document.querySelector('#runtime-error')
    if (errorNode) {
      errorNode.hidden = false
      errorNode.textContent = 'Tauri bridge unavailable'
    }
    return
  }

  await Promise.all([loadSettings(), initializeRuntime()])
  await initializeDockSync()
  await Promise.all([refreshRuntimeStatus(), loadDashboardData()])

  startRuntimeUiTimer()
  startRuntimeStatusPolling()
}

initialize()
