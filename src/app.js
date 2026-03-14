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
let dockCollapseTimer = null
let dockStatePollTimer = null
let dockStateEventUnlisten = null

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
  downloadProgress: {
    phase: 'idle',
    completedCount: 0,
    totalCount: 0,
    successCount: 0,
    failureCount: 0,
  },
  modalOpen: false,
  modalType: null,
  lastSeenDbImportFinishedAt: null,
  windowDock: {
    enabled: false,
    state: 'normal',
    side: null,
  },
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

function getTauriInvoke() {
  return window.__TAURI_INTERNALS__?.invoke ?? window.__TAURI__?.core?.invoke ?? null
}

function getTauriEventListen() {
  return (
    window.__TAURI__?.event?.listen ??
    window.__TAURI_INTERNALS__?.event?.listen ??
    window.__TAURI_INTERNALS__?.plugins?.event?.listen ??
    null
  )
}

async function invokeTauriCommand(command, args = {}) {
  const invoke = getTauriInvoke()
  if (!invoke) {
    return null
  }

  return invoke(command, args)
}

async function waitForTauriInvoke(timeoutMs = 4000) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const invoke = getTauriInvoke()
    if (invoke) {
      return invoke
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 50)
    })
  }

  return null
}

function clearDockStateEventSubscription() {
  if (typeof dockStateEventUnlisten === 'function') {
    dockStateEventUnlisten()
  }
  dockStateEventUnlisten = null
}

function clearDockCollapseTimer() {
  if (dockCollapseTimer !== null) {
    window.clearTimeout(dockCollapseTimer)
    dockCollapseTimer = null
  }
}

function clearDockStatePollTimer() {
  if (dockStatePollTimer !== null) {
    window.clearInterval(dockStatePollTimer)
    dockStatePollTimer = null
  }
}

function applyWindowDockState(dockState) {
  state.windowDock = {
    enabled: Boolean(dockState?.enabled),
    state: dockState?.state || 'normal',
    side: dockState?.side || null,
  }
  syncDockSurface()
}

function syncDockSurface() {
  appShell.dataset.dockState = state.windowDock.state || 'normal'
  appShell.dataset.dockSide = state.windowDock.side || ''
  dockHandle.hidden = state.windowDock.state !== 'collapsed'

  if (state.windowDock.state === 'collapsed' && state.modalOpen) {
    closeDetailModal()
  }
}

function formatCount(value) {
  return String(Number(value) || 0).padStart(2, '0')
}

function intervalSecsToMinutes(value, fallbackMinutes) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return String(fallbackMinutes)
  }

  return String(Math.max(1, Math.round(seconds / 60)))
}

function intervalMinutesToSecs(value, fallbackSeconds) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return fallbackSeconds
  }

  return Math.max(1, Math.round(minutes)) * 60
}

function formatSettingsInterval(value, fallbackMinutes) {
  const minutes = Number(intervalSecsToMinutes(value, fallbackMinutes))
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return `${fallbackMinutes} m`
  }

  if (minutes < 60) {
    return `${minutes} m`
  }

  const hours = minutes / 60
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`
}

function formatRelativeTime(timestamp) {
  if (!timestamp) {
    return '从未'
  }

  const diffMs = Math.max(0, Date.now() - timestamp)
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMinutes <= 0) {
    return '刚刚'
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} 小时前`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} 天前`
}

function getRuntimeLabel(snapshot) {
  if (!snapshot) {
    return 'UNKNOWN'
  }

  if (snapshot.db_import_running) {
    return 'IMPORTING'
  }

  if (snapshot.collect_refresh_running) {
    return 'COLLECTING'
  }

  if (snapshot.auth_check_running || snapshot.explicit_check_running) {
    return 'CHECKING'
  }

  if (snapshot.login_running) {
    return 'LOGIN REQUIRED'
  }

  if (snapshot.interrupt_flag) {
    return 'INTERRUPTED'
  }

  if (snapshot.last_auth_check_ok === true) {
    return 'ONLINE'
  }

  if (snapshot.last_auth_check_ok === false) {
    return 'OFFLINE'
  }

  return 'UNKNOWN'
}

function getRuntimeTone(snapshot) {
  const label = getRuntimeLabel(snapshot)

  if (label === 'ONLINE') {
    return 'online'
  }

  if (label === 'CHECKING' || label === 'COLLECTING' || label === 'IMPORTING') {
    return 'active'
  }

  if (label === 'INTERRUPTED' || label === 'LOGIN REQUIRED') {
    return 'warning'
  }

  if (label === 'OFFLINE') {
    return 'danger'
  }

  return 'neutral'
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

  const progress = state.downloadProgress

  downloadStatus.dataset.clickable = 'false'
  downloadStatus.disabled = true

  if (progress.phase === 'running') {
    downloadStatus.dataset.state = 'warning'
    downloadStatus.textContent = `Downloading... ${progress.completedCount}/${progress.totalCount}`
    return
  }

  if (progress.phase === 'success') {
    downloadStatus.dataset.state = 'online'
    downloadStatus.textContent = 'Success!'
    return
  }

  if (progress.phase === 'fail') {
    downloadStatus.dataset.state = 'danger'
    downloadStatus.textContent = `Fail: ${progress.successCount} Success, ${progress.failureCount} Fail`
    downloadStatus.dataset.clickable = 'true'
    downloadStatus.disabled = false
    return
  }

  const runtimeLabel = getRuntimeLabel(state.runtime)
  downloadStatus.dataset.state = getRuntimeTone(state.runtime)
  downloadStatus.textContent = runtimeLabel === 'UNKNOWN' ? 'WAITING' : runtimeLabel
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
      state.downloadProgress = {
        phase: 'idle',
        completedCount: 0,
        totalCount: 0,
        successCount: 0,
        failureCount: 0,
      }
      downloadStatusResetTimer = null
      syncDownloadStatus()
    }, 20000)
  }
}

async function subscribeDockStateEvents() {
  clearDockStateEventSubscription()
  const listen = getTauriEventListen()
  if (!listen) {
    return false
  }

  try {
    const unlisten = await listen('dock-state-changed', (event) => {
      if (!event?.payload) {
        return
      }

      applyWindowDockState(event.payload)
    })

    dockStateEventUnlisten = typeof unlisten === 'function' ? unlisten : null
    return true
  } catch (error) {
    console.warn('Failed to subscribe dock-state-changed event', error)
    dockStateEventUnlisten = null
    return false
  }
}

function getCourseScopeLabel(scope) {
  if (scope === 'current') {
    return '当前学期'
  }

  if (scope === 'past') {
    return '以往学期'
  }

  return '全部'
}

function normalizeRelativeSubdir(relativeDir) {
  if (!relativeDir) {
    return ''
  }

  const segments = String(relativeDir)
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (
    segments.length === 0 ||
    segments.some((segment) => segment === '..' || segment.includes(':'))
  ) {
    return ''
  }

  return segments.join('/')
}

function joinRelativeSubdirs(...parts) {
  const segments = parts
    .flatMap((part) => normalizeRelativeSubdir(part).split('/'))
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments.join('/')
}

function normalizeSystemPath(path) {
  return String(path || '')
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+/g, '\\')
}

function isPathInsideBase(basePath, selectedPath) {
  const normalizedBase = normalizeSystemPath(basePath).replace(/\\$/, '')
  const normalizedSelected = normalizeSystemPath(selectedPath).replace(/\\$/, '')

  if (!normalizedBase || !normalizedSelected) {
    return false
  }

  const baseLower = normalizedBase.toLowerCase()
  const selectedLower = normalizedSelected.toLowerCase()
  return selectedLower === baseLower || selectedLower.startsWith(`${baseLower}\\`)
}

function toRelativeSubdir(basePath, selectedPath) {
  if (!isPathInsideBase(basePath, selectedPath)) {
    return ''
  }

  const normalizedBase = normalizeSystemPath(basePath).replace(/\\$/, '')
  const normalizedSelected = normalizeSystemPath(selectedPath).replace(/\\$/, '')
  if (normalizedBase.toLowerCase() === normalizedSelected.toLowerCase()) {
    return ''
  }

  return normalizeRelativeSubdir(normalizedSelected.slice(normalizedBase.length + 1))
}

function getCourseSubdirSelectionPath(downloadDir, relativeSubdir) {
  const basePath = normalizeSystemPath(downloadDir)
  if (!basePath) {
    return ''
  }

  const normalizedRelative = normalizeRelativeSubdir(relativeSubdir)
  if (!normalizedRelative) {
    return basePath
  }

  return `${basePath}\\${normalizedRelative.replace(/\//g, '\\')}`
}

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

function createInlineStat(label, count) {
  const stat = document.createElement('span')
  stat.className = 'course-card__inline-stat'
  stat.append(
    document.createTextNode(`${label}(`),
    Object.assign(document.createElement('span'), {
      className: 'course-card__inline-value',
      textContent: formatCount(count),
    }),
    document.createTextNode(')'),
  )
  return stat
}

function createCourseCard(course) {
  const card = document.createElement('article')
  card.className = 'course-card'
  card.dataset.expanded = 'false'

  const toggle = document.createElement('button')
  toggle.className = 'course-card__toggle'
  toggle.type = 'button'

  const header = document.createElement('div')
  header.className = 'course-card__header'

  const titleMarquee = document.createElement('div')
  titleMarquee.className = 'course-card__title-marquee'

  const titleTrack = document.createElement('div')
  titleTrack.className = 'course-card__title-track'

  const titlePrimary = document.createElement('span')
  titlePrimary.className = 'course-card__title-segment'
  titlePrimary.textContent = course.courseName

  const titleClone = document.createElement('span')
  titleClone.className = 'course-card__title-segment course-card__title-segment--clone'
  titleClone.textContent = course.courseName

  titleTrack.append(titlePrimary, titleClone)
  titleMarquee.append(titleTrack)

  const summaryStats = document.createElement('div')
  summaryStats.className = 'course-card__summary-stats'
  summaryStats.append(
    createInlineStat('通知', course.noticeCount),
    createInlineStat('资料', course.materialCount),
    createInlineStat('作业', course.assignmentCount),
  )

  const chevron = document.createElement('span')
  chevron.className = 'course-card__chevron'
  chevron.setAttribute('aria-hidden', 'true')
  summaryStats.append(chevron)

  header.append(titleMarquee, summaryStats)
  toggle.append(header)

  const body = document.createElement('div')
  body.className = 'course-card__body'

  const bodyInner = document.createElement('div')
  bodyInner.className = 'course-card__body-inner'

  const modules = document.createElement('div')
  modules.className = 'course-card__modules'
  modules.append(
    createModuleCard(course, 'notice', '通知', course.notices || []),
    createModuleCard(course, 'materials', '资料', course.materials || []),
    createModuleCard(course, 'assignments', '作业', course.assignments || []),
  )

  bodyInner.append(modules)
  body.append(bodyInner)
  card.append(toggle, body)

  toggle.addEventListener('click', () => {
    card.dataset.expanded = String(card.dataset.expanded !== 'true')
    requestAnimationFrame(() => refreshTitleMarquee(card))
  })

  requestAnimationFrame(() => refreshTitleMarquee(card))
  return card
}

function getDisplayItems(kind, items) {
  if (kind !== 'materials') {
    return items
  }

  return items.filter((item) => item.nodeType !== 'folder')
}

function getItemTitle(kind, item) {
  if (kind === 'materials') {
    return item.title || item.path || item.name || '未命名资料'
  }

  return item.title || '未命名条目'
}

function createModuleCard(course, kind, label, items) {
  const displayItems = getDisplayItems(kind, items)
  const downloadableItems = displayItems.filter((item) => item.downloadUrl)

  const moduleCard = document.createElement('article')
  moduleCard.className = 'module-card'
  moduleCard.dataset.expanded = 'false'
  moduleCard.dataset.module = kind

  const toggle = document.createElement('button')
  toggle.className = 'module-card__toggle'
  toggle.type = 'button'

  const copy = document.createElement('span')
  copy.className = 'module-card__toggle-copy'

  const title = document.createElement('span')
  title.className = 'module-card__title'
  title.textContent = label

  const meta = document.createElement('span')
  meta.className = 'module-card__meta'
  meta.textContent = `${displayItems.length} 项`

  const chevron = document.createElement('span')
  chevron.className = 'module-card__chevron'
  chevron.setAttribute('aria-hidden', 'true')

  copy.append(title, meta)
  toggle.append(copy, chevron)

  const body = document.createElement('div')
  body.className = 'module-card__body'

  if (displayItems.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'module-card__empty'
    empty.textContent = `暂无${label}`
    body.append(empty)
  } else {
    if (kind === 'materials' && downloadableItems.length > 0) {
      const toolbar = document.createElement('div')
      toolbar.className = 'module-card__toolbar'

      const batchButton = document.createElement('button')
      batchButton.className = 'module-card__toolbar-button'
      batchButton.type = 'button'
      batchButton.textContent = '批量下载资料'
      batchButton.addEventListener('click', async (event) => {
        event.stopPropagation()
        await downloadMaterialBatch(course, downloadableItems)
      })

      toolbar.append(batchButton)
      body.append(toolbar)
    }

    const list = document.createElement('ul')
    list.className = 'module-card__list'

    const pager = document.createElement('div')
    pager.className = 'module-card__pager'

    const previousButton = document.createElement('button')
    previousButton.className = 'module-card__pager-button'
    previousButton.type = 'button'
    previousButton.textContent = '上一页'

    const pagerStatus = document.createElement('span')
    pagerStatus.className = 'module-card__pager-status'

    const nextButton = document.createElement('button')
    nextButton.className = 'module-card__pager-button'
    nextButton.type = 'button'
    nextButton.textContent = '下一页'

    pager.append(previousButton, pagerStatus, nextButton)
    body.append(list, pager)

    let currentPage = 1
    const pageSize = 5
    const totalPages = Math.max(1, Math.ceil(displayItems.length / pageSize))

    const renderPage = () => {
      list.replaceChildren()

      const pageStart = (currentPage - 1) * pageSize
      const pageItems = displayItems.slice(pageStart, pageStart + pageSize)

      pageItems.forEach((item) => {
        const li = document.createElement('li')
        const button = document.createElement('button')
        button.className = 'module-item-button'
        button.type = 'button'

        const text = document.createElement('span')
        text.className = 'module-item-button__text'
        text.textContent = getItemTitle(kind, item)

        const arrow = document.createElement('span')
        arrow.className = 'module-item-button__arrow'
        arrow.textContent = '→'

        button.append(text, arrow)
        button.addEventListener('click', (event) => {
          event.stopPropagation()
          openDetailModal(kind, course, item)
        })

        li.append(button)
        list.append(li)
      })

      pagerStatus.textContent = `${currentPage} / ${totalPages}`
      previousButton.disabled = currentPage <= 1
      nextButton.disabled = currentPage >= totalPages
      pager.hidden = totalPages <= 1
    }

    previousButton.addEventListener('click', (event) => {
      event.stopPropagation()
      if (currentPage <= 1) {
        return
      }
      currentPage -= 1
      renderPage()
    })

    nextButton.addEventListener('click', (event) => {
      event.stopPropagation()
      if (currentPage >= totalPages) {
        return
      }
      currentPage += 1
      renderPage()
    })

    renderPage()
  }

  toggle.addEventListener('click', () => {
    moduleCard.dataset.expanded = String(moduleCard.dataset.expanded !== 'true')
  })

  moduleCard.append(toggle, body)
  return moduleCard
}

function refreshTitleMarquee(card) {
  const marquee = card.querySelector('.course-card__title-marquee')
  const primaryTitle = card.querySelector('.course-card__title-segment')

  if (!marquee || !primaryTitle) {
    return
  }

  const shouldScroll = primaryTitle.scrollWidth > marquee.clientWidth + 6
  marquee.classList.toggle('is-overflowing', shouldScroll)

  if (shouldScroll) {
    marquee.style.setProperty('--scroll-distance', `${primaryTitle.scrollWidth + 28}px`)
    return
  }

  marquee.style.removeProperty('--scroll-distance')
}

function getScopedCourses() {
  const courses = state.dashboard.courses ?? []
  const scope = state.settings.courseScope || 'all'

  if (scope === 'current') {
    return courses.filter((course) => course.termCategory === 'current')
  }

  if (scope === 'past') {
    return courses.filter((course) => course.termCategory === 'past')
  }

  return courses
}

function renderCourses() {
  courseList.replaceChildren()

  const courses = getScopedCourses()
  courseCount.textContent = `${courses.length} courses`
  emptyState.hidden = courses.length > 0

  courses.forEach((course) => {
    courseList.append(createCourseCard(course))
  })
}

function createDetailChip(label, value) {
  const chip = document.createElement('span')
  chip.className = 'detail-chip'
  chip.append(
    document.createTextNode(label),
    Object.assign(document.createElement('strong'), {
      textContent: value || '—',
    }),
  )
  return chip
}

function createDetailAction(label, onClick, options = {}) {
  const button = document.createElement('button')
  button.className = 'detail-action'
  if (options.primary) {
    button.classList.add('detail-action--primary')
  }
  if (options.compact) {
    button.classList.add('detail-action--compact')
  }
  button.type = 'button'
  button.textContent = label
  button.addEventListener('click', onClick)
  return button
}

function appendDetailSection(title, contentNode) {
  const section = document.createElement('section')
  section.className = 'detail-section'

  const heading = document.createElement('h3')
  heading.className = 'detail-section__title'
  heading.textContent = title

  section.append(heading, contentNode)
  modalBody.append(section)
}

function createTextBlock(text) {
  const block = document.createElement('p')
  block.className = text ? 'detail-section__text' : 'detail-empty'
  block.textContent = text || '暂无内容'
  return block
}

function createAttachmentList(items, onOpen) {
  if (!items.length) {
    return createTextBlock('')
  }

  const list = document.createElement('ul')
  list.className = 'detail-list'

  items.forEach((item) => {
    const li = document.createElement('li')
    const button = document.createElement('button')
    button.className = 'detail-list__button'
    button.type = 'button'
    button.append(
      Object.assign(document.createElement('span'), {
        textContent: item.title || item.name || '附件',
      }),
      Object.assign(document.createElement('span'), {
        textContent: '下载',
      }),
    )
    button.addEventListener('click', () => onOpen(item))
    li.append(button)
    list.append(li)
  })

  return list
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

async function getWindowDockState() {
  const dockState = await invokeTauriCommand('get_window_dock_state')
  if (!dockState) {
    return {
      enabled: Boolean(state.settings.enableAutoDockCollapse),
      state: 'normal',
      side: null,
    }
  }

  return dockState
}

async function refreshWindowDockState() {
  const dockState = await getWindowDockState()
  applyWindowDockState(dockState)
}

async function expandDockedWindow() {
  clearDockCollapseTimer()
  try {
    await invokeTauriCommand('expand_docked_window')
  } finally {
    await refreshWindowDockState()
  }
}

async function collapseDockedWindow() {
  clearDockCollapseTimer()
  try {
    await invokeTauriCommand('collapse_docked_window')
  } finally {
    await refreshWindowDockState()
  }
}

function scheduleDockCollapse() {
  if (state.modalOpen || state.windowDock.state !== 'expanded') {
    return
  }

  clearDockCollapseTimer()
  dockCollapseTimer = window.setTimeout(() => {
    dockCollapseTimer = null
    collapseDockedWindow()
  }, 400)
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
    const result = await invokeTauriCommand('download_protected_file', {
      url,
      suggestedName: suggestedName ?? null,
      referer,
      relativeSubdir: normalizeRelativeSubdir(relativeSubdir) || null,
      conflictPolicy,
    })

    if (!result) {
      setModalFeedback('当前不在 Tauri 环境内，无法执行内置下载。', 'error')
      return
    }

    setModalFeedback(`已下载到: ${result.savedPath}`, 'success')
  } catch (error) {
    setModalFeedback(String(error), 'error')
  }
}

async function downloadMaterialBatchLegacy(course, items) {
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

  setModalFeedback(`正在批量下载 ${requests.length} 项资料...`, 'info')

  try {
    const result = await invokeTauriCommand('download_protected_files', {
      requests,
    })

    if (!result) {
      setModalFeedback('当前不在 Tauri 环境内，无法执行内置批量下载。', 'error')
      return
    }

    const failedItems = (result.items || []).filter((item) => !item.ok).slice(0, 3)
    const failureSummary = failedItems
      .map((item) => `${item.suggestedName || '未命名文件'}: ${item.error || '下载失败'}`)
      .join(' | ')
    const summary = `批量下载完成：成功 ${result.successCount} / 失败 ${result.failureCount} / 共 ${result.totalCount}`

    if (result.failureCount > 0) {
      console.error('Material batch download result', result)
      setModalFeedback(failureSummary ? `${summary}。${failureSummary}` : summary, 'warning')
      return
    }

    setModalFeedback(summary, 'success')
  } catch (error) {
    setModalFeedback(String(error), 'error')
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
        const result = await invokeTauriCommand('download_protected_file', {
          url: request.url,
          suggestedName: request.suggestedName ?? null,
          referer: request.referer,
          relativeSubdir: request.relativeSubdir,
          conflictPolicy: 'overwrite',
        })

        if (!result) {
          throw new Error('当前不在 Tauri 环境内，无法执行内置批量下载。')
        }

        successCount += 1
      } catch (error) {
        failedItems.push({
          suggestedName: request.suggestedName,
          error: String(error),
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
    setModalFeedback(String(error), 'error')
  }
}

function openDetailModal(kind, course, item) {
  state.modalType = kind
  resetModal()

  if (kind === 'notice') {
    modalKind.textContent = '通知'
    modalTitle.textContent = item.title || '未命名通知'
    modalMeta.append(
      createDetailChip('课程', course.courseName),
      createDetailChip('时间', item.publishedAt || '—'),
      createDetailChip('发布人', item.publisher || '—'),
    )

    if (item.detailUrl) {
      modalActions.append(
        createDetailAction('打开原始页面', () => {
          openAuthenticatedUrl(item.detailUrl)
        }),
      )
    }

    appendDetailSection('正文', createTextBlock(item.detailText || item.rawText || ''))
    appendDetailSection(
      '附件',
      createAttachmentList(item.attachments || [], (attachment) => {
        downloadResource({
          url: attachment.url,
          suggestedName: attachment.title || '附件',
          referer: item.detailUrl || course.noticesUrl || null,
          relativeSubdir: getDownloadRelativeDir(course),
        })
      }),
    )
  }

  if (kind === 'materials') {
    modalKind.textContent = '资料'
    modalTitle.textContent = item.name || item.title || '未命名资料'
    modalMeta.append(
      createDetailChip('课程', course.courseName),
      createDetailChip('上传人', item.uploader || '—'),
      createDetailChip('时间', item.createdAt || '—'),
    )

    if (item.size) {
      modalMeta.append(createDetailChip('大小', item.size))
    }

    if (item.downloadUrl) {
      modalActions.append(
        createDetailAction(
          '下载到本地',
          () => {
            downloadResource({
              url: item.downloadUrl,
              suggestedName: item.name || item.title,
              referer: course.materialsUrl || null,
              relativeSubdir: getDownloadRelativeDir(course, item),
            })
          },
          { primary: true },
        ),
        createDetailAction('复制下载链接', () => {
          copyText(item.downloadUrl)
        }),
      )
    } else if (item.openUrl || item.readUrl) {
      modalActions.append(
        createDetailAction('打开资料入口', () => {
          openExternalUrl(item.openUrl || item.readUrl)
        }),
      )
    }

    appendDetailSection('路径', createTextBlock(item.path || item.title || ''))
    appendDetailSection(
      '说明',
      createTextBlock('下载会沿用当前登录态，并自动落到设置中的主下载目录与课程子目录下。'),
    )
  }

  if (kind === 'assignments') {
    modalKind.textContent = '作业'
    modalTitle.textContent = item.title || '未命名作业'
    modalMeta.append(
      createDetailChip('课程', course.courseName),
      createDetailChip('状态', item.status || '—'),
      createDetailChip('开始', item.startTime || '—'),
      createDetailChip('截止', item.endTime || '—'),
    )

    if (item.workUrl) {
      modalActions.append(
        createDetailAction('打开作业入口', () => {
          openAuthenticatedUrl(item.workUrl)
        }),
      )
    }

    appendDetailSection('详情', createTextBlock(item.rawText || ''))
    appendDetailSection('说明', createTextBlock('当前仅展示详情，不代替提交。'))
  }

  modalOverlay.hidden = false
  appShell.classList.add('app-shell--modal-open')
  state.modalOpen = true
}

function createSettingsField(label, value, options = {}) {
  const field = document.createElement('label')
  field.className = 'settings-field'
  if (options.compact) {
    field.classList.add('settings-field--compact')
  }

  const title = document.createElement('span')
  title.className = 'settings-field__label'
  title.textContent = label

  const control = document.createElement('input')
  control.type = options.type || 'text'
  control.className = 'settings-field__control'
  control.value = value ?? ''
  control.placeholder = options.placeholder ?? ''
  control.disabled = Boolean(options.disabled)
  control.min = options.min ?? ''
  control.dataset.field = options.fieldName ?? ''

  field.append(title, control)
  return { field, control }
}

function createSettingsActionRow() {
  const row = document.createElement('div')
  row.className = 'settings-action-row'
  return row
}

function createSettingsToggleField(label, hint, isActive, onToggle) {
  const field = document.createElement('div')
  field.className = 'settings-field settings-field--toggle'

  const title = document.createElement('span')
  title.className = 'settings-field__label'
  title.textContent = label

  const toggle = document.createElement('button')
  toggle.className = 'settings-toggle'
  toggle.type = 'button'
  toggle.dataset.active = String(Boolean(isActive))
  const text = document.createElement('span')
  text.className = 'settings-toggle__text'

  const toggleTitle = document.createElement('span')
  toggleTitle.className = 'settings-toggle__title'
  toggleTitle.textContent = label
  text.append(toggleTitle)

  if (hint) {
    const toggleHint = document.createElement('span')
    toggleHint.className = 'settings-toggle__hint'
    toggleHint.textContent = hint
    text.append(toggleHint)
  }

  const pill = document.createElement('span')
  pill.className = 'settings-toggle__pill'
  pill.textContent = isActive ? 'ON' : 'OFF'
  toggle.append(text, pill)
  toggle.addEventListener('click', onToggle)

  field.append(title, toggle)
  return { field, toggle }
}

async function openCourseSubdirModal(feedbackMessage = '') {
  state.modalType = 'course-subdirs'
  resetModal()
  modalPanel.dataset.layout = 'settings'
  applySettingsModalChromeOrder()

  modalKind.textContent = 'Subdirs'
  modalTitle.textContent = '课程分目录'
  syncSettingsMeta(state.settings)

  if (!state.settings.downloadDir?.trim()) {
    setModalFeedback('请先在全局设置里配置下载目录。', 'warning')
  }

  const courses = [...(state.dashboard.courses || [])].sort((left, right) =>
    String(left.courseName || '').localeCompare(String(right.courseName || ''), 'zh-CN'),
  )
  const draftSubdirs = {
    ...(state.settings.courseDownloadSubdirs || {}),
  }

  const list = document.createElement('div')
  list.className = 'course-subdir-list'

  const persistCourseSubdirs = async (successMessage) => {
    const saved = await invokeTauriCommand('save_app_settings', {
      settings: {
        ...state.settings,
        courseDownloadSubdirs: Object.fromEntries(
          Object.entries(draftSubdirs)
            .map(([courseId, relativeDir]) => [courseId, normalizeRelativeSubdir(relativeDir)])
            .filter(([, relativeDir]) => relativeDir),
        ),
      },
    })

    if (!saved) {
      throw new Error('当前不在 Tauri 环境内，无法保存设置。')
    }

    state.settings = saved
    renderCourses()
    if (successMessage) {
      setModalFeedback(successMessage, 'success')
    }
  }

  const renderRows = () => {
    list.replaceChildren()

    if (!courses.length) {
      list.append(createTextBlock('当前没有已加载课程，无法配置课程分目录。'))
      return
    }

    courses.forEach((course) => {
      const currentValue = normalizeRelativeSubdir(draftSubdirs[course.courseId] || '')
      const row = document.createElement('section')
      row.className = 'course-subdir-row'

      const header = document.createElement('div')
      header.className = 'course-subdir-row__header'

      const title = document.createElement('h3')
      title.className = 'course-subdir-row__title'
      title.textContent = course.courseName

      const value = document.createElement('p')
      value.className = 'course-subdir-row__value'
      value.textContent = currentValue || '未设置，直接下载到主目录'

      header.append(title, value)

      const actions = document.createElement('div')
      actions.className = 'course-subdir-row__actions'

      const selectButton = createDetailAction('选择子文件夹', async () => {
        if (!state.settings.downloadDir?.trim()) {
          setModalFeedback('请先在全局设置里配置下载目录。', 'warning')
          return
        }

        try {
          const selected = await pickFolderPath(
            getCourseSubdirSelectionPath(state.settings.downloadDir, currentValue),
          )
          if (!selected) {
            return
          }

          if (!isPathInsideBase(state.settings.downloadDir, selected)) {
            setModalFeedback('课程子文件夹必须位于主下载目录之下。', 'error')
            return
          }

          draftSubdirs[course.courseId] = toRelativeSubdir(state.settings.downloadDir, selected)
          await persistCourseSubdirs('课程分目录已自动保存。')
          renderRows()
        } catch (error) {
          setModalFeedback(String(error), 'error')
        }
      })

      const clearButton = createDetailAction('清空', async () => {
        try {
          delete draftSubdirs[course.courseId]
          await persistCourseSubdirs('课程分目录已自动保存。')
          renderRows()
        } catch (error) {
          setModalFeedback(String(error), 'error')
        }
      })

      actions.append(selectButton, clearButton)
      row.append(header, actions)
      list.append(row)
    })
  }

  renderRows()
  modalBody.append(list)

  modalActions.append(
    createDetailAction('返回全局设置', () => {
      openSettingsModal()
    }),
    createDetailAction(
      '保存分目录',
      async () => {
        try {
          const saved = await invokeTauriCommand('save_app_settings', {
            settings: {
              ...state.settings,
              courseDownloadSubdirs: Object.fromEntries(
                Object.entries(draftSubdirs)
                  .map(([courseId, relativeDir]) => [courseId, normalizeRelativeSubdir(relativeDir)])
                  .filter(([, relativeDir]) => relativeDir),
              ),
            },
          })

          if (!saved) {
            setModalFeedback('当前不在 Tauri 环境内，无法保存设置。', 'error')
            return
          }

          state.settings = saved
          setModalFeedback('课程分目录已保存。', 'success')
          renderCourses()
          refreshWindowDockState()
        } catch (error) {
          setModalFeedback(String(error), 'error')
        }
      },
      { primary: true },
    ),
  )

  if (feedbackMessage) {
    setModalFeedback(feedbackMessage, 'warning')
  }

  modalOverlay.hidden = false
  appShell.classList.add('app-shell--modal-open')
  state.modalOpen = true
}

function openSettingsModal(feedbackMessage = '') {
  state.modalType = 'settings'
  resetModal()
  modalPanel.dataset.layout = 'settings'
  applySettingsModalChromeOrder()

  modalKind.textContent = 'Settings'
  modalTitle.textContent = '应用设置'
  syncSettingsMeta(state.settings)

  const settingsForm = document.createElement('div')
  settingsForm.className = 'settings-form'

  const downloadField = createSettingsField('下载目录', state.settings.downloadDir, {
    fieldName: 'downloadDir',
    placeholder: '例如: D:\\Downloads\\UCAS Classer',
  })
  const authCheckField = createSettingsField(
    'CHECK 间隔',
    intervalSecsToMinutes(state.settings.authCheckIntervalSecs, 180),
    {
      fieldName: 'authCheckIntervalSecs',
      placeholder: '默认 3',
      type: 'number',
      min: '1',
      compact: true,
    },
  )
  const collectField = createSettingsField(
    'COLLECT 间隔',
    intervalSecsToMinutes(state.settings.collectIntervalSecs, 15),
    {
      fieldName: 'collectIntervalSecs',
      placeholder: '默认 60',
      type: 'number',
      min: '1',
      compact: true,
    },
  )
  const cookieRefreshField = createSettingsField(
    'COOKIE 刷新间隔',
    intervalSecsToMinutes(state.settings.cookieRefreshIntervalSecs, 720),
    {
      fieldName: 'cookieRefreshIntervalSecs',
      placeholder: '默认 60',
      type: 'number',
      min: '1',
      compact: true,
    },
  )

  let dockEnabled = Boolean(state.settings.enableAutoDockCollapse)
  let dockSaving = false
  const dockToggleField = createSettingsToggleField(
    '自动窗口收起',
    '窗口拖到左右边缘后自动收起，移入边缘栏再展开。',
    dockEnabled,
    async () => {
      if (dockSaving) {
        return
      }

      const previousEnabled = dockEnabled
      dockEnabled = !dockEnabled
      dockSaving = true
      dockToggleField.toggle.disabled = true
      dockToggleField.toggle.dataset.active = String(dockEnabled)
      dockToggleField.toggle.querySelector('.settings-toggle__pill').textContent = dockEnabled
        ? 'ON'
        : 'OFF'

      try {
        const saved = await invokeTauriCommand('save_app_settings', {
          settings: {
            ...state.settings,
            enableAutoDockCollapse: dockEnabled,
          },
        })

        if (!saved) {
          dockEnabled = previousEnabled
          setModalFeedback('自动侧收设置未保存。', 'error')
          return
        }

        state.settings = saved
        dockEnabled = Boolean(saved.enableAutoDockCollapse)
        if (!dockEnabled) {
          await invokeTauriCommand('exit_dock_mode')
        }
        syncSettingsMeta(state.settings)
        refreshWindowDockState()
        setModalFeedback('自动侧收设置已更新。', 'success')
      } catch (error) {
        dockEnabled = previousEnabled
        setModalFeedback(String(error), 'error')
      } finally {
        dockToggleField.toggle.disabled = false
        dockSaving = false
        dockToggleField.toggle.dataset.active = String(dockEnabled)
        dockToggleField.toggle.querySelector('.settings-toggle__pill').textContent = dockEnabled
          ? 'ON'
          : 'OFF'
      }
    },
  )
  dockToggleField.toggle.querySelector('.settings-toggle__hint')?.remove()

  const downloadActionRow = createSettingsActionRow()
  const pickButton = createDetailAction('选择文件夹', async () => {
    try {
      const selected = await pickFolderPath(downloadField.control.value.trim() || state.settings.downloadDir)
      if (!selected) {
        return
      }
      downloadField.control.value = selected
    } catch (error) {
      setModalFeedback(String(error), 'error')
    }
  })
  const subdirButton = createDetailAction('课程分目录', () => {
    const nextDownloadDir = downloadField.control.value.trim()
    state.settings = {
      ...state.settings,
      downloadDir: nextDownloadDir || state.settings.downloadDir,
    }
    openCourseSubdirModal()
  })
  downloadActionRow.append(pickButton, subdirButton)

  const scopeField = document.createElement('div')
  scopeField.className = 'settings-field settings-field--scope'
  scopeField.append(
    Object.assign(document.createElement('span'), {
      className: 'settings-field__label',
      textContent: '课程范围',
    }),
  )

  const scopeToggle = document.createElement('div')
  scopeToggle.className = 'settings-scope-toggle'
  const scopeOptions = [
    { value: 'all', label: '全部' },
    { value: 'current', label: '当前学期' },
    { value: 'past', label: '以往学期' },
  ]
  let selectedScope = state.settings.courseScope || 'all'
  let scopeSaving = false

  const renderScopeButtons = () => {
    scopeToggle.replaceChildren()
    scopeOptions.forEach((option) => {
      const button = document.createElement('button')
      button.className = 'settings-scope-toggle__button'
      button.type = 'button'
      button.dataset.active = String(selectedScope === option.value)
      button.textContent = option.label
      button.disabled = scopeSaving
      button.addEventListener('click', async () => {
        if (scopeSaving || selectedScope === option.value) {
          return
        }

        const previousScope = state.settings.courseScope || 'all'
        selectedScope = option.value
        scopeSaving = true
        renderScopeButtons()

        try {
          const saved = await invokeTauriCommand('save_app_settings', {
            settings: {
              ...state.settings,
              courseScope: option.value,
            },
          })

          if (!saved) {
            selectedScope = previousScope
            setModalFeedback('当前不在 Tauri 环境内，无法保存范围设置。', 'error')
            return
          }

          state.settings = saved
          selectedScope = saved.courseScope || option.value
          syncSettingsMeta(state.settings)
          renderCourses()
          setModalFeedback('课程范围已更新。', 'success')
        } catch (error) {
          selectedScope = previousScope
          setModalFeedback(String(error), 'error')
        } finally {
          scopeSaving = false
          renderScopeButtons()
        }
      })
      scopeToggle.append(button)
    })
  }

  renderScopeButtons()
  scopeField.append(scopeToggle)

  const intervalRow = document.createElement('div')
  intervalRow.className = 'settings-inline-row'
  intervalRow.append(authCheckField.field, collectField.field, cookieRefreshField.field)

  const settingsHint = document.createElement('p')
  settingsHint.className = 'settings-form__hint'
  settingsHint.textContent = '所有时间设置单位均为分钟。课程分目录会在主下载目录下生效。'

  settingsForm.append(
    downloadField.field,
    downloadActionRow,
    dockToggleField.field,
    scopeField,
    intervalRow,
  )
  modalBody.append(settingsForm, settingsHint)

  modalActions.append(
    createDetailAction(
      '保存设置',
      async () => {
        const nextSettings = {
          ...state.settings,
          downloadDir: downloadField.control.value.trim(),
          enableAutoDockCollapse: dockEnabled,
          courseScope: state.settings.courseScope || selectedScope,
          authCheckIntervalSecs: intervalMinutesToSecs(authCheckField.control.value, 180 * 60),
          collectIntervalSecs: intervalMinutesToSecs(collectField.control.value, 15 * 60),
          cookieRefreshIntervalSecs: intervalMinutesToSecs(cookieRefreshField.control.value, 720 * 60),
        }

        try {
          const saved = await invokeTauriCommand('save_app_settings', {
            settings: nextSettings,
          })

          if (!saved) {
            setModalFeedback('当前不在 Tauri 环境内，无法保存设置。', 'error')
            return
          }

          state.settings = saved
          if (!saved.enableAutoDockCollapse) {
            await invokeTauriCommand('exit_dock_mode')
          }
          selectedScope = state.settings.courseScope || selectedScope
          syncSettingsMeta(state.settings)
          renderScopeButtons()
          renderCourses()
          refreshWindowDockState()
          setModalFeedback('设置已保存。', 'success')
        } catch (error) {
          setModalFeedback(String(error), 'error')
        }
      },
      { primary: true },
    ),
  )

  if (feedbackMessage) {
    setModalFeedback(feedbackMessage, 'warning')
  }

  modalOverlay.hidden = false
  appShell.classList.add('app-shell--modal-open')
  state.modalOpen = true
}

function closeDetailModal() {
  modalOverlay.hidden = true
  appShell.classList.remove('app-shell--modal-open')
  state.modalOpen = false
  state.modalType = null
  resetModal()
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

    setDownloadProgress({
      phase: 'idle',
      completedCount: 0,
      totalCount: 0,
      successCount: 0,
      failureCount: 0,
    })
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

function bindDockInteractions() {
  if (!dockHandle) {
    return
  }

  dockHandle.addEventListener('mouseenter', () => {
    if (state.windowDock.state === 'collapsed') {
      expandDockedWindow()
    }
  })

  appShell.addEventListener('mouseenter', () => {
    clearDockCollapseTimer()
  })

  appShell.addEventListener('mouseleave', (event) => {
    if (event.relatedTarget === null) {
      scheduleDockCollapse()
    }
  })
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
  syncDockSurface()

  const invoke = await waitForTauriInvoke()
  if (!invoke) {
    state.runtime = createFallbackRuntimeSnapshot()
    syncRuntimePanel()
    syncDockSurface()
    const errorNode = document.querySelector('#runtime-error')
    if (errorNode) {
      errorNode.hidden = false
      errorNode.textContent = 'Tauri bridge unavailable'
    }
    return
  }

  await Promise.all([loadSettings(), initializeRuntime()])
  const hasDockEvents = await subscribeDockStateEvents()
  await refreshWindowDockState()
  await Promise.all([refreshRuntimeStatus(), loadDashboardData()])

  window.setInterval(() => {
    syncRuntimePanel()
  }, 30000)

  window.setInterval(() => {
    refreshRuntimeStatus()
  }, 3000)

  clearDockStatePollTimer()
  dockStatePollTimer = window.setInterval(() => {
    refreshWindowDockState()
  }, hasDockEvents ? 5000 : 1500)
}

initialize()
