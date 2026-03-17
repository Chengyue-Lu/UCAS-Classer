// Reusable modal building blocks shared by settings and detail flows.
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

export function createHtmlBlock(html, options = {}) {
  if (!html || !html.trim()) {
    return createTextBlock('')
  }

  const wrapper = document.createElement('div')
  wrapper.className = 'detail-richtext'

  const template = document.createElement('template')
  template.innerHTML = html
  sanitizeDetailHtml(template.content, options)
  wrapper.append(template.content)

  if (!wrapper.textContent?.trim() && !wrapper.querySelector('img, table, ul, ol, p, div')) {
    return createTextBlock('')
  }

  return wrapper
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

function sanitizeDetailHtml(root, options) {
  root.querySelectorAll('script, style, input, textarea, select, button').forEach((node) => {
    node.remove()
  })

  root.querySelectorAll('*').forEach((node) => {
    for (const attr of [...node.attributes]) {
      if (attr.name.toLowerCase().startsWith('on')) {
        node.removeAttribute(attr.name)
      }
    }

    if (node.tagName === 'A') {
      sanitizeDetailLink(node, options)
    }

    if (node.tagName === 'IMG') {
      sanitizeDetailImage(node, options)
    }

    if (node.tagName === 'TABLE') {
      node.classList.add('detail-richtext__table')
    }
  })
}

function sanitizeDetailLink(node, options) {
  const rawHref = node.getAttribute('href')?.trim() || ''
  if (!rawHref || rawHref.startsWith('javascript:')) {
    node.removeAttribute('href')
    return
  }

  let href = rawHref
  if (options.baseUrl) {
    try {
      href = new URL(rawHref, options.baseUrl).toString()
    } catch {
      href = rawHref
    }
  }

  node.setAttribute('href', href)
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noreferrer')

  if (typeof options.onOpenLink === 'function') {
    node.addEventListener('click', (event) => {
      event.preventDefault()
      options.onOpenLink(href)
    })
  }
}

function sanitizeDetailImage(node, options) {
  const rawSrc = node.getAttribute('src')?.trim() || ''
  if (!rawSrc) {
    node.remove()
    return
  }

  let src = rawSrc
  if (!rawSrc.startsWith('data:') && options.baseUrl) {
    try {
      src = new URL(rawSrc, options.baseUrl).toString()
    } catch {
      src = rawSrc
    }
  }

  node.setAttribute('src', src)
  node.setAttribute('loading', 'lazy')
  node.classList.add('detail-richtext__image')
}
