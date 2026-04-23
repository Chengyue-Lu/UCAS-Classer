import {
  appendDetailSection,
  createAttachmentList,
  createDetailAction,
  createDetailChip,
  createHtmlBlock,
  createTextBlock,
} from './modal-ui.js'

// Builds the modal body for notice/material/assignment details and keeps
// the page entry file free from per-kind branching.
export function createDetailController({
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
  loadAssignmentDetail,
}) {
  let assignmentLoadToken = 0

  function createMutableDetailSection(title, initialNode) {
    const section = document.createElement('section')
    section.className = 'detail-section'

    const heading = document.createElement('h3')
    heading.className = 'detail-section__title'
    heading.textContent = title

    const content = document.createElement('div')
    content.className = 'detail-section__content'
    if (initialNode) {
      content.append(initialNode)
    }

    section.append(heading, content)
    modalBody.append(section)
    return { section, content }
  }

  function renderAssignmentLinks(content, links) {
    content.replaceChildren()
    content.append(
      createAttachmentList(links || [], (link) => {
        openAuthenticatedUrl(link.url)
      }),
    )
  }

  function createAssignmentDetailRequest(course, item) {
    return {
      courseId: course.courseId,
      assignmentsUrl: course.assignmentsUrl || null,
      workUrl: item.workUrl,
      workId: item.workId || null,
      workAnswerId: item.workAnswerId || null,
      title: item.title || '',
      status: item.status || null,
      startTime: item.startTime || null,
      endTime: item.endTime || null,
      rawText: item.rawText || '',
    }
  }

function startAssignmentDetailLoad(course, item, detailContent, linkContent, onDetailLoaded) {
    const token = ++assignmentLoadToken
    detailContent.content.replaceChildren(createTextBlock('正在加载作业详情...'))
    renderAssignmentLinks(linkContent.content, [])

    void loadAssignmentDetail(createAssignmentDetailRequest(course, item))
      .then((detail) => {
        if (token !== assignmentLoadToken || !state.modalOpen || state.modalType !== 'assignments') {
          return
        }

        detailContent.content.replaceChildren(
          detail.detailHtml
            ? createHtmlBlock(detail.detailHtml, {
                baseUrl: detail.finalUrl,
                onOpenLink: openAuthenticatedUrl,
              })
            : createTextBlock(detail.detailText || item.rawText || ''),
        )
        if (detail.links?.length) {
          linkContent.section.hidden = false
          renderAssignmentLinks(linkContent.content, detail.links || [])
        } else {
          linkContent.section.hidden = true
          renderAssignmentLinks(linkContent.content, [])
        }
        onDetailLoaded?.(detail)
      })
      .catch((error) => {
        if (token !== assignmentLoadToken || !state.modalOpen || state.modalType !== 'assignments') {
          return
        }

        detailContent.content.replaceChildren(
          createTextBlock(`加载失败：${error instanceof Error ? error.message : String(error)}`),
        )
        linkContent.section.hidden = true
        renderAssignmentLinks(linkContent.content, [])
      })
  }

  function openDetailModal(kind, course, item) {
    assignmentLoadToken += 1
    state.modalType = kind
    resetModal()

    // Keep the branching here so renderers only need to pass kind/course/item.
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

      appendDetailSection(modalBody, '正文', createTextBlock(item.detailText || item.rawText || ''))
      appendDetailSection(
        modalBody,
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

      appendDetailSection(modalBody, '路径', createTextBlock(item.path || item.title || ''))
      appendDetailSection(
        modalBody,
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
        let latestAssignmentUrl = item.workUrl
        const detailContent = createMutableDetailSection('详情', createTextBlock('正在加载作业详情...'))
        const linkContent = createMutableDetailSection('页面链接', createTextBlock(''))
        linkContent.section.hidden = true
        const handleAssignmentDetailLoaded = (detail) => {
          latestAssignmentUrl = detail.workUrl || detail.finalUrl || latestAssignmentUrl
        }

        modalActions.append(
          createDetailAction('重新加载详情', () => {
            startAssignmentDetailLoad(course, item, detailContent, linkContent, handleAssignmentDetailLoaded)
          }),
          createDetailAction('打开作业入口', () => {
            openAuthenticatedUrl(latestAssignmentUrl)
          }),
        )

        startAssignmentDetailLoad(course, item, detailContent, linkContent, handleAssignmentDetailLoaded)
      } else {
        appendDetailSection(modalBody, '详情', createTextBlock(item.rawText || ''))
      }
    }

    modalOverlay.hidden = false
    appShell.classList.add('app-shell--modal-open')
    state.modalOpen = true
  }

  function closeDetailModal() {
    assignmentLoadToken += 1
    modalOverlay.hidden = true
    appShell.classList.remove('app-shell--modal-open')
    state.modalOpen = false
    state.modalType = null
    resetModal()
  }

  return {
    closeDetailModal,
    createDetailAction,
    createTextBlock,
    openDetailModal,
  }
}
