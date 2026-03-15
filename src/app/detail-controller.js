import {
  appendDetailSection,
  createAttachmentList,
  createDetailAction,
  createDetailChip,
  createTextBlock,
} from './modal-ui.js'

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
}) {
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
        modalActions.append(
          createDetailAction('打开作业入口', () => {
            openAuthenticatedUrl(item.workUrl)
          }),
        )
      }

      appendDetailSection(modalBody, '详情', createTextBlock(item.rawText || ''))
      appendDetailSection(modalBody, '说明', createTextBlock('当前仅展示详情，不代替提交。'))
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

  return {
    closeDetailModal,
    createDetailAction,
    createTextBlock,
    openDetailModal,
  }
}
