export function createDetailChip(label, value) {
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

export function createDetailAction(label, onClick, options = {}) {
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

export function createTextBlock(text) {
  const block = document.createElement('p')
  block.className = text ? 'detail-section__text' : 'detail-empty'
  block.textContent = text || '暂无内容'
  return block
}

export function createAttachmentList(items, onOpen) {
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

export function appendDetailSection(modalBody, title, contentNode) {
  const section = document.createElement('section')
  section.className = 'detail-section'

  const heading = document.createElement('h3')
  heading.className = 'detail-section__title'
  heading.textContent = title

  section.append(heading, contentNode)
  modalBody.append(section)
}
