import type { NoticeAttachment, NoticeSummary } from '../shared/collector-types.js'
import {
  decodeAttribute,
  escapeRegExp,
  looksLikeLoginBody,
  matchAttributeValue,
  normalizeText,
  normalizeTextLikeBrowser,
  resolveUrl,
  type RequestApiContext,
} from './request-core.js'

// Notice parsing is isolated so detail fetching can evolve independently from
// materials and assignments, especially for future lazy-load strategies.
export function extractNotices(html: string, baseUrl: string): NoticeSummary[] {
  const items = Array.from(html.matchAll(/<li>\s*<div class=["']noticeTop["'][\s\S]*?<\/li>/gi))

  return items
    .map((match) => {
      const block = match[0]
      const onclickMatch = block.match(
        /showUserListdetail\('([^']+)','([^']+)',(\d+),(\d+),'([^']+)',(\d+),'([^']+)'\)/,
      )
      const title =
        decodeAttribute(block.match(/<h3>\s*<a[^>]*title=["']([^"']*)["']/i)?.[1] ?? null) ??
        normalizeText(block.match(/<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1])
      const paragraphs = Array.from(block.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)).map((entry) =>
        normalizeText(entry[1]),
      )
      const publishedAt = stripFieldLabel(paragraphs[0] ?? null)
      const publisher = stripFieldLabel(paragraphs[1] ?? null)
      const detailUrl = onclickMatch
        ? new URL(
            `/mooc-ans/schoolCourseInfo/getNoticeUserList?noticeId=${onclickMatch[2]}&courseId=${onclickMatch[3]}&classId=${onclickMatch[4]}&cpi=${onclickMatch[6]}&ut=${onclickMatch[7]}&openc=${onclickMatch[5]}&noticeEnc=${onclickMatch[1]}`,
            baseUrl,
          ).toString()
        : null

      return {
        noticeId: onclickMatch?.[2] ?? `${title}|${publishedAt ?? ''}`,
        noticeEnc: onclickMatch?.[1] ?? null,
        title: title || normalizeText(block),
        detailUrl,
        publishedAt,
        publisher,
        rawText: normalizeTextLikeBrowser(block),
        detailText: null,
        detailHtml: null,
        detailCollectedAt: null,
        attachments: [],
      }
    })
    .filter((item) => Boolean(item.title && item.rawText))
}

export async function fillNoticeDetails(
  apiContext: RequestApiContext,
  notices: NoticeSummary[],
): Promise<void> {
  for (const item of notices) {
    if (!item.detailUrl) {
      continue
    }

    const detail = await fetchNoticeDetail(apiContext, item.detailUrl)
    if (!detail) {
      continue
    }

    item.detailText = detail.detailText
    item.detailHtml = detail.detailHtml
    item.detailCollectedAt = detail.detailCollectedAt
    item.attachments = detail.attachments
  }
}

function stripFieldLabel(value: string | null): string | null {
  if (!value) {
    return null
  }

  const normalized = value.replace(/^[^:：]*[:：]\s*/, '').trim()
  return normalized || null
}

function extractAllAnchors(
  html: string,
  baseUrl: string,
): Array<{
  url: string
  name: string
  className: string | null
  raw: string
}> {
  const anchors: Array<{ url: string; name: string; className: string | null; raw: string }> = []
  const pattern = /<a\b([^>]*?)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(pattern)) {
    const href = resolveUrl(match[2], baseUrl)
    if (!href) {
      continue
    }

    const attrs = `${match[1]} ${match[3]}`
    const className = matchAttributeValue(attrs, 'class')
    const title = matchAttributeValue(attrs, 'title')
    const parsed = new URL(href)
    const name =
      title ||
      normalizeText(match[4]) ||
      decodeURIComponent(`${parsed.pathname.split('/').at(-1) ?? ''}${parsed.search}`) ||
      href

    anchors.push({
      url: href,
      name,
      className,
      raw: match[0],
    })
  }

  return anchors
}

function extractNoticeAttachments(html: string, baseUrl: string): NoticeAttachment[] {
  const anchors = extractAllAnchors(html, baseUrl)
  const seen = new Set<string>()
  const result: NoticeAttachment[] = []

  for (const anchor of anchors) {
    const lowerUrl = anchor.url.toLowerCase()
    const lowerRaw = anchor.raw.toLowerCase()
    const lowerClass = anchor.className?.toLowerCase() ?? ''
    const isAttachmentLike =
      lowerClass.includes('attachmenthref') ||
      lowerRaw.includes('noticeattachment') ||
      lowerRaw.includes('oneattachment') ||
      lowerRaw.includes('img_area') ||
      lowerUrl.includes('cs.mooc.ucas.edu.cn/') ||
      lowerUrl.includes('/upload/') ||
      lowerUrl.includes('p.cldisk.com/') ||
      /\.(jpg|jpeg|png|gif|bmp|webp|pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar)(\?|$)/i.test(anchor.url)

    if (!isAttachmentLike || seen.has(anchor.url)) {
      continue
    }

    seen.add(anchor.url)
    result.push({
      name: anchor.name,
      url: anchor.url,
    })
  }

  return result
}

function extractBalancedInnerHtml(
  html: string,
  selector: {
    tag: string
    id?: string
  },
): string | null {
  const openPattern = new RegExp(
    `<${selector.tag}\\b[^>]*id=["']${escapeRegExp(selector.id!)}["'][^>]*>`,
    'i',
  )
  const startMatch = openPattern.exec(html)
  if (!startMatch || startMatch.index == null) {
    return null
  }

  const startIndex = startMatch.index + startMatch[0].length
  const tokenPattern = new RegExp(`<${selector.tag}\\b[^>]*>|</${selector.tag}>`, 'gi')
  tokenPattern.lastIndex = startIndex

  let depth = 1
  let token: RegExpExecArray | null
  while ((token = tokenPattern.exec(html)) !== null) {
    if (token[0].startsWith(`</${selector.tag}`)) {
      depth -= 1
      if (depth === 0) {
        return html.slice(startIndex, token.index)
      }
    } else {
      depth += 1
    }
  }

  return null
}

async function fetchNoticeDetail(
  apiContext: RequestApiContext,
  detailUrl: string,
): Promise<{
  detailText: string | null
  detailHtml: string | null
  detailCollectedAt: string
  attachments: NoticeAttachment[]
} | null> {
  const response = await apiContext.get(detailUrl, {
    failOnStatusCode: false,
    timeout: 60_000,
  })

  const bodyText = await response.text()
  if (!response.ok() || looksLikeLoginBody(response.headers()['content-type'] ?? '', bodyText)) {
    return null
  }

  const contentHtml =
    extractBalancedInnerHtml(bodyText, { tag: 'div', id: 'contentNotice' }) ??
    extractBalancedInnerHtml(bodyText, { tag: 'p', id: 'contentNotice' })
  return {
    detailText: normalizeText(contentHtml) || null,
    detailHtml: contentHtml?.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim() || null,
    detailCollectedAt: new Date().toISOString(),
    attachments: extractNoticeAttachments(bodyText, detailUrl),
  }
}
