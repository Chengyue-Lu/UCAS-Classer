const appShell = document.querySelector('#app-shell')
const courseList = document.querySelector('#course-list')
const courseCount = document.querySelector('#course-count')
const emptyState = document.querySelector('#empty-state')
const runtimeStatus = document.querySelector('#runtime-status')
const runtimeCheckAge = document.querySelector('#runtime-check-age')
const runtimeCollectAge = document.querySelector('#runtime-collect-age')
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
    authCheckIntervalSecs: 180,
    collectIntervalSecs: 3600,
    cookieRefreshIntervalSecs: 3600,
  },
  activeAction: null,
  modalOpen: false,
  modalType: null,
  lastSeenDbImportFinishedAt: null,
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
  runtimeStatus.textContent = getRuntimeLabel(snapshot)
  runtimeStatus.dataset.state = getRuntimeTone(snapshot)
  runtimeCheckAge.textContent = formatRelativeTime(snapshot?.last_auth_check_at_ms ?? null)
  runtimeCollectAge.textContent = formatRelativeTime(snapshot?.last_collect_finished_at_ms ?? null)

  runtimeButtons.forEach((button) => {
    button.dataset.active = String(button.dataset.runtimeAction === state.activeAction)
  })
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
    createModuleCard(course, 'notice', '通知', course.notices),
    createModuleCard(course, 'materials', '资料', course.materials),
    createModuleCard(course, 'assignments', '作业', course.assignments),
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
        arrow.textContent = '↗'

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

function renderCourses() {
  courseList.replaceChildren()

  const courses = getScopedCourses()
  courseCount.textContent = `${courses.length} courses`
  emptyState.hidden = courses.length > 0

  courses.forEach((course) => {
    courseList.append(createCourseCard(course))
  })
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

function resetModal() {
  modalPanel.dataset.layout = 'default'
  modalKind.textContent = '详情'
  modalTitle.textContent = '详情'
  modalMeta.replaceChildren()
  modalActions.replaceChildren()
  modalBody.replaceChildren()
  setModalFeedback('')
}

function syncSettingsMeta(settings) {
  modalMeta.replaceChildren(...createSettingsMeta(settings))
}

async function downloadResource({ url, suggestedName, referer }) {
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
      suggested_name: suggestedName ?? null,
      referer,
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
      createTextBlock(
        '当前下载由后端直接携带已保存 cookie 执行，文件会落到设置里的下载目录。'
      ),
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
    appendDetailSection('说明', createTextBlock('当前只展示详情，不代替提交。'))
  }

  modalOverlay.hidden = false
  appShell.classList.add('app-shell--modal-open')
  state.modalOpen = true
}

function createSettingsField(label, value, options = {}) {
  const field = document.createElement('label')
  field.className = 'settings-field'

  const title = document.createElement('span')
  title.className = 'settings-field__label'
  title.textContent = label

  let control
  if (options.multiline) {
    control = document.createElement('textarea')
    control.rows = 3
  } else {
    control = document.createElement('input')
    control.type = 'text'
  }

  control.className = 'settings-field__control'
  control.value = value ?? ''
  control.placeholder = options.placeholder ?? ''
  control.disabled = Boolean(options.disabled)
  control.dataset.field = options.fieldName ?? ''

  field.append(title, control)
  return { field, control }
}

function openSettingsModal(feedbackMessage = '') {
  state.modalType = 'settings'
  resetModal()
  modalPanel.dataset.layout = 'settings'

  modalKind.textContent = 'Settings'
  modalTitle.textContent = '应用设置'
  modalMeta.append(
    createDetailChip('当前下载目录', state.settings.downloadDir || '未设置'),
    createDetailChip(
      '课程范围',
      state.settings.courseScope === 'current'
        ? '当前学期'
        : state.settings.courseScope === 'past'
          ? '以前学期'
          : '全部',
    ),
    createDetailChip(
      'Check 间隔',
      `${Math.max(1, Math.round((state.settings.authCheckIntervalSecs || 180) / 60))} 分钟`,
    ),
    createDetailChip(
      'Collect 间隔',
      `${Math.max(1, Math.round((state.settings.collectIntervalSecs || 3600) / 60))} 分钟`,
    ),
    createDetailChip(
      'Cookie 刷新',
      `${Math.max(1, Math.round((state.settings.cookieRefreshIntervalSecs || 3600) / 60))} 分钟`,
    ),
  )
  syncSettingsMeta(state.settings)

  const settingsForm = document.createElement('div')
  settingsForm.className = 'settings-form'

  const downloadField = createSettingsField('下载目录', state.settings.downloadDir, {
    fieldName: 'downloadDir',
    placeholder: '例如: D:\\Downloads\\UCAS Classer',
  })
  const authCheckField = createSettingsField(
    'Check 间隔（分钟）',
    intervalSecsToMinutes(state.settings.authCheckIntervalSecs, 3),
    {
      fieldName: 'authCheckIntervalSecs',
      placeholder: '默认 3',
    },
  )
  authCheckField.field.classList.add('settings-field--compact')
  authCheckField.control.type = 'number'
  authCheckField.control.min = '1'

  const collectField = createSettingsField(
    'Collect 间隔（分钟）',
    intervalSecsToMinutes(state.settings.collectIntervalSecs, 60),
    {
      fieldName: 'collectIntervalSecs',
      placeholder: '默认 60',
    },
  )
  collectField.field.classList.add('settings-field--compact')
  collectField.control.type = 'number'
  collectField.control.min = '1'

  const cookieRefreshField = createSettingsField(
    'Cookie 刷新间隔（分钟）',
    intervalSecsToMinutes(state.settings.cookieRefreshIntervalSecs, 60),
    {
      fieldName: 'cookieRefreshIntervalSecs',
      placeholder: '默认 60',
    },
  )
  cookieRefreshField.field.classList.add('settings-field--compact')
  cookieRefreshField.control.type = 'number'
  cookieRefreshField.control.min = '1'

  const scopeField = document.createElement('div')
  scopeField.className = 'settings-field'
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
    { value: 'past', label: '以前学期' },
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
            setModalFeedback('Tauri bridge unavailable; scope was not saved.', 'error')
            return
          }

          state.settings = saved
          selectedScope = saved.courseScope || option.value
          syncSettingsMeta(state.settings)
          renderScopeButtons()
          renderCourses()
          setModalFeedback('Course scope updated.', 'success')
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

  settingsForm.append(downloadField.field, scopeField, intervalRow)
  modalBody.append(settingsForm)

  modalActions.append(
    createDetailAction(
      '保存设置',
      async () => {
        const nextSettings = {
          ...state.settings,
          downloadDir: downloadField.control.value.trim(),
          courseScope: state.settings.courseScope || selectedScope,
          authCheckIntervalSecs: intervalMinutesToSecs(authCheckField.control.value, 180),
          collectIntervalSecs: intervalMinutesToSecs(collectField.control.value, 3600),
          cookieRefreshIntervalSecs: intervalMinutesToSecs(
            cookieRefreshField.control.value,
            3600,
          ),
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
          selectedScope = state.settings.courseScope || selectedScope
          syncSettingsMeta(state.settings)
          renderScopeButtons()
          modalMeta.replaceChildren(
            createDetailChip('当前下载目录', state.settings.downloadDir || '未设置'),
            createDetailChip(
              '课程范围',
              state.settings.courseScope === 'current'
                ? '当前学期'
                : state.settings.courseScope === 'past'
                  ? '以前学期'
                  : '全部',
            ),
            createDetailChip(
              'Check 间隔',
              `${Math.max(1, Math.round((state.settings.authCheckIntervalSecs || 180) / 60))} 分钟`,
            ),
            createDetailChip(
              'Collect 间隔',
              `${Math.max(1, Math.round((state.settings.collectIntervalSecs || 3600) / 60))} 分钟`,
            ),
            createDetailChip(
              'Cookie 刷新',
              `${Math.max(1, Math.round((state.settings.cookieRefreshIntervalSecs || 3600) / 60))} 分钟`,
            ),
          )
          syncSettingsMeta(state.settings)
          renderCourses()
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

function getCourseScopeLabel(scope) {
  if (scope === 'current') {
    return '当前学期'
  }

  if (scope === 'past') {
    return '以前学期'
  }

  return '全部'
}

function createSettingsMeta(settings) {
  const downloadChip = createDetailChip('下载目录', settings.downloadDir || '未设置')
  downloadChip.classList.add('detail-chip--wide')

  const summaryRow = document.createElement('div')
  summaryRow.className = 'settings-meta-row'
  summaryRow.append(
    createDetailChip('范围', getCourseScopeLabel(settings.courseScope)),
    createDetailChip(
      'Check',
      `${Math.max(1, Math.round((settings.authCheckIntervalSecs || 180) / 60))} 分钟`,
    ),
    createDetailChip(
      'Collect',
      `${Math.max(1, Math.round((settings.collectIntervalSecs || 3600) / 60))} 分钟`,
    ),
    createDetailChip(
      'Cookie',
      `${Math.max(1, Math.round((settings.cookieRefreshIntervalSecs || 3600) / 60))} 分钟`,
    ),
  )

  return [downloadChip, summaryRow]
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

  state.settings = settings
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

async function initializeRuntime() {
  const started = await invokeTauriCommand('start_runtime_scheduler')
  state.runtime = started || createFallbackRuntimeSnapshot()
  syncRuntimePanel()
}

async function initialize() {
  bindWindowControls()
  bindRuntimeButtons()
  bindModalControls()
  bindTitleOverflowRefresh()
  closeDetailModal()

  const invoke = await waitForTauriInvoke()
  if (!invoke) {
    state.runtime = createFallbackRuntimeSnapshot()
    syncRuntimePanel()
    const errorNode = document.querySelector('#runtime-error')
    if (errorNode) {
      errorNode.hidden = false
      errorNode.textContent = 'Tauri bridge unavailable'
    }
    return
  }

  await Promise.all([loadSettings(), initializeRuntime()])
  await Promise.all([refreshRuntimeStatus(), loadDashboardData()])

  window.setInterval(() => {
    syncRuntimePanel()
  }, 30000)

  window.setInterval(() => {
    refreshRuntimeStatus()
  }, 3000)
}

initialize()
