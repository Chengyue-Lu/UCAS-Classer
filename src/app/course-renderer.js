import { formatCount } from './formatters.js'

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

export function createCourseRenderer({
  state,
  courseList,
  courseCount,
  emptyState,
  openDetailModal,
  downloadMaterialBatch,
}) {
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

  return {
    refreshTitleMarquee,
    renderCourses,
  }
}
