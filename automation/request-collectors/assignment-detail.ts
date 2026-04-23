import { writeFile } from 'node:fs/promises'
import type { AssignmentSummary } from '../shared/collector-types.js'
import { resolveArtifactHtml } from '../shared/cache-paths.js'
import {
  createRequestContext,
  decodeAttribute,
  fetchHtml,
  looksLikeLoginBody,
  matchAttributeValue,
  normalizeText,
  normalizeTextLikeBrowser,
  resolveUrl,
} from './request-core.js'
import { extractAssignments, fillPendingAssignmentWorkUrls } from './assignment-parser.js'

export type AssignmentDetailLink = {
  title: string
  url: string
}

export type AssignmentDetailRequest = {
  workUrl: string
  assignmentsUrl?: string | null
  workId?: string | null
  workAnswerId?: string | null
  title?: string | null
  startTime?: string | null
  endTime?: string | null
}

export type AssignmentDetailSnapshot = {
  workUrl: string
  finalUrl: string
  detailText: string
  detailHtml: string | null
  detailCollectedAt: string
  links: AssignmentDetailLink[]
}

// Assignment details are fetched on demand so background collect can stay cheap.
// We bootstrap from the course assignment list first because the detail endpoint
// depends on in-domain session cookies and, for some items, a refreshed launch URL.
export async function fetchAssignmentDetail(
  request: AssignmentDetailRequest,
): Promise<AssignmentDetailSnapshot> {
  const apiContext = await createRequestContext()
  const inputWorkUrl = request.workUrl.trim()
  if (!inputWorkUrl) {
    throw new Error('assignment detail requires a work url')
  }

  try {
    const resolvedWorkUrls = await resolveAssignmentDetailUrls(apiContext, request)
    const referer = request.assignmentsUrl?.trim() || undefined
    let lastFetch: Awaited<ReturnType<typeof fetchHtmlWithOptionalReferer>> | null = null
    let lastUrl = resolvedWorkUrls[0] ?? inputWorkUrl

    for (const candidateUrl of resolvedWorkUrls) {
      const fetch = await fetchHtmlWithOptionalReferer(
        apiContext,
        candidateUrl,
        `assignment-detail-${deriveArtifactSuffix(candidateUrl)}`,
        referer,
      )
      lastFetch = fetch
      lastUrl = candidateUrl

      if (shouldRetryAssignmentDetailCandidate(fetch)) {
        continue
      }

      if (!fetch.ok) {
        throw new Error(`assignment detail request failed with status ${fetch.status}`)
      }

      const detailHtml = await extractAssignmentDetailHtml(
        apiContext,
        request,
        fetch.bodyText,
        fetch.finalUrl,
      )
      const detailText = normalizeTextLikeBrowser(detailHtml || fetch.bodyText)
      const links = extractAssignmentDetailLinks([detailHtml, fetch.bodyText], fetch.finalUrl)

      return {
        workUrl: candidateUrl,
        finalUrl: fetch.finalUrl,
        detailText,
        detailHtml,
        detailCollectedAt: new Date().toISOString(),
        links,
      }
    }

    if (lastFetch?.loginLike) {
      throw new Error('assignment detail request was redirected to login')
    }

    throw new Error(
      lastFetch
        ? `assignment detail request failed or was denied with status ${lastFetch.status}`
        : `assignment detail request failed for ${lastUrl}`,
    )
  } finally {
    await apiContext.dispose()
  }
}

async function resolveAssignmentDetailUrls(
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  request: AssignmentDetailRequest,
): Promise<string[]> {
  const assignmentsUrl = request.assignmentsUrl?.trim()
  if (!assignmentsUrl) {
    return [request.workUrl]
  }

  const bootstrap = await fetchHtmlWithOptionalReferer(
    apiContext,
    assignmentsUrl,
    `assignment-detail-bootstrap-${deriveArtifactSuffix(assignmentsUrl)}`,
  )

  if (!bootstrap.ok) {
    return [request.workUrl]
  }

  if (bootstrap.loginLike) {
    throw new Error('assignment detail bootstrap was redirected to login')
  }

  const assignments = extractAssignments(bootstrap.bodyText, bootstrap.finalUrl)
  await fillPendingAssignmentWorkUrls(
    apiContext,
    assignments,
    bootstrap.bodyText,
    bootstrap.finalUrl,
  )

  return buildAssignmentDetailCandidates(assignments, request)
}

async function fetchHtmlWithOptionalReferer(
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  url: string,
  artifactPrefix: string,
  referer?: string,
) {
  if (!referer) {
    const result = await fetchHtml(apiContext, url, artifactPrefix)
    return {
      ...result,
      loginLike: result.loginLike || looksLikeLoginUrl(result.finalUrl),
    }
  }

  const response = await apiContext.get(url, {
    failOnStatusCode: false,
    timeout: 60_000,
    headers: {
      referer,
    },
  })
  const contentType = response.headers()['content-type'] ?? ''
  const bodyText = await response.text()
  const htmlPath = resolveArtifactHtml(artifactPrefix)
  await writeFile(htmlPath, bodyText, 'utf8')

  return {
    finalUrl: response.url(),
    status: response.status(),
    ok: response.ok(),
    contentType,
    bodyText,
    loginLike: looksLikeLoginUrl(response.url()) || looksLikeLoginBody(contentType, bodyText),
    title: bodyText.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? null,
    htmlPath,
  }
}

function looksLikeLoginUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return /passport\.mooc\.ucas\.edu\.cn/i.test(parsed.hostname) && /\/login\b/i.test(parsed.pathname)
  } catch {
    return /passport\.mooc\.ucas\.edu\.cn\/login/i.test(url)
  }
}

function matchAssignmentFromList(
  assignments: AssignmentSummary[],
  request: AssignmentDetailRequest,
): AssignmentSummary | null {
  const requestedParams = extractWorkIdentity(request.workUrl)
  const requestedWorkId = request.workId?.trim() || requestedParams.workId
  const requestedWorkAnswerId = request.workAnswerId?.trim() || requestedParams.workAnswerId

  if (requestedWorkId) {
    const matchedByIds = assignments.find((item) => {
      if (!item.workId || item.workId !== requestedWorkId) {
        return false
      }

      if (!requestedWorkAnswerId) {
        return true
      }

      return (item.workAnswerId ?? null) === requestedWorkAnswerId
    })

    if (matchedByIds?.workUrl) {
      return matchedByIds
    }
  }

  return (
    assignments.find((item) => {
      if (!item.workUrl) {
        return false
      }

      return (
        (request.title?.trim() || '') === (item.title?.trim() || '') &&
        (request.startTime || null) === (item.startTime || null) &&
        (request.endTime || null) === (item.endTime || null)
      )
    }) ?? null
  )
}

function buildAssignmentDetailCandidates(
  assignments: AssignmentSummary[],
  request: AssignmentDetailRequest,
): string[] {
  const candidates: string[] = []
  const requestedParams = extractWorkIdentity(request.workUrl)
  const requestedWorkId = request.workId?.trim() || requestedParams.workId

  const push = (url: string | null | undefined) => {
    if (!url || candidates.includes(url)) {
      return
    }
    candidates.push(url)
  }

  const matched = matchAssignmentFromList(assignments, request)
  push(matched?.workUrl)

  if (requestedWorkId) {
    assignments
      .filter((item) => item.workId === requestedWorkId)
      .sort((left, right) => scoreAssignmentDetailCandidate(right) - scoreAssignmentDetailCandidate(left))
      .forEach((item) => push(item.workUrl))
  }

  push(request.workUrl)
  return candidates
}

function scoreAssignmentDetailCandidate(item: AssignmentSummary): number {
  const url = item.workUrl ?? ''
  let score = 0
  if (/selectWorkQuestionYiPiYue/i.test(url)) {
    score += 20
  }
  if (/doHomeWorkNew/i.test(url)) {
    score += 5
  }
  if (isSubmittedAssignmentStatus(item.status, item.rawText)) {
    score += 10
  }
  return score
}

function isSubmittedAssignmentStatus(status: string | null | undefined, rawText: string | null | undefined): boolean {
  const text = `${status ?? ''} ${rawText ?? ''}`
  return /待批阅|已完成|已提交|已批阅|分\s*查看|查看/.test(text) && !/待做/.test(status ?? '')
}

function shouldRetryAssignmentDetailCandidate(fetch: Awaited<ReturnType<typeof fetchHtmlWithOptionalReferer>>): boolean {
  if (fetch.loginLike) {
    return true
  }
  if ([401, 403, 404].includes(fetch.status)) {
    return true
  }

  return looksLikeAssignmentAccessDenied(fetch.bodyText, fetch.title)
}

function looksLikeAssignmentAccessDenied(bodyText: string, title: string | null): boolean {
  const text = normalizeTextLikeBrowser(`${title ?? ''} ${bodyText.slice(0, 4000)}`)
  return /无权访问|无访问权限|没有权限|访问权限|访问受限|非法访问|页面不存在|长时间没有操作|重新进入课程|error-page|错误/.test(text)
}

function extractWorkIdentity(workUrl: string): {
  workId: string | null
  workAnswerId: string | null
} {
  try {
    const url = new URL(workUrl)
    return {
      workId: url.searchParams.get('workId'),
      workAnswerId: url.searchParams.get('workAnswerId'),
    }
  } catch {
    return {
      workId: null,
      workAnswerId: null,
    }
  }
}

function deriveArtifactSuffix(workUrl: string): string {
  try {
    const url = new URL(workUrl)
    const courseId = url.searchParams.get('courseId') || 'course'
    const workId = url.searchParams.get('workId') || 'work'
    return `${courseId}-${workId}`
  } catch {
    return `${Date.now()}`
  }
}

async function extractAssignmentDetailHtml(
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  request: AssignmentDetailRequest,
  html: string,
  baseUrl: string,
): Promise<string | null> {
  const summaryHtml = extractAssignmentSummaryHtml(html, request)
  const bodyHtml = extractAssignmentQuestionHtml(html)
  const sections = [summaryHtml, bodyHtml].filter(Boolean)

  if (!sections.length) {
    return null
  }

  const composed = `
    <div class="assignment-detail-fragment">
      ${sections.join('\n')}
    </div>
  `

  return inlineAuthenticatedImages(apiContext, composed, baseUrl)
}

function extractAssignmentSummaryHtml(html: string, request: AssignmentDetailRequest): string | null {
  const summarySource =
    html.match(/<div[^>]*>\s*[\s\S]*?题量：[\s\S]*?截止时间：[\s\S]*?<\/div>\s*<form\b/i)?.[0] ?? html

  const itemCount = matchSummaryValue(summarySource, /题量：\s*([^<\s]+)/)
  const score = matchSummaryValue(summarySource, /满分：[\s\S]*?([0-9]+(?:\.[0-9]+)?)\s*分/i)
  const creator = matchSummaryValue(summarySource, /创建者：\s*([^<\s]+)/)
  const deadline = matchSummaryValue(summarySource, /截止时间：\s*([0-9\-/: ]+)/)
  const parts = [
    itemCount ? `<span><strong>题量</strong>${escapeHtml(itemCount)}</span>` : '',
    score ? `<span><strong>满分</strong>${escapeHtml(score)} 分</span>` : '',
    creator ? `<span><strong>创建者</strong>${escapeHtml(creator)}</span>` : '',
    deadline ? `<span><strong>截止时间</strong>${escapeHtml(deadline)}</span>` : '',
  ].filter(Boolean)

  if (!parts.length && !request.title?.trim()) {
    return null
  }

  return `
    <section class="assignment-detail-summary">
      ${request.title?.trim() ? `<h4 class="assignment-detail-summary__title">${escapeHtml(request.title.trim())}</h4>` : ''}
      <div class="assignment-detail-summary__meta">
        ${parts.join('')}
      </div>
    </section>
  `
}

function extractAssignmentQuestionHtml(html: string): string | null {
  const bodySource = extractAssignmentQuestionSource(html)
  if (!bodySource) {
    return null
  }

  const cleaned = cleanAssignmentFragment(bodySource)
  return cleaned
    ? `
        <section class="assignment-detail-body">
          ${cleaned}
        </section>
      `
    : null
}

function extractAssignmentQuestionSource(html: string): string | null {
  const submitPageMatch = html.match(
    /<div\b[^>]*class=["'][^"']*\bZyBottom\b[^"']*["'][^>]*>([\s\S]*?)<\/form>/i,
  )
  if (submitPageMatch) {
    return submitPageMatch[1]
  }

  const openMatch = /<div\b[^>]*class=["'][^"']*\bZyBottom\b[^"']*["'][^>]*>/i.exec(html)
  if (!openMatch) {
    return null
  }

  const tail = html.slice(openMatch.index + openMatch[0].length)
  const endCandidates = [
    tail.search(/<div\b[^>]*class=["'][^"']*\bZY_sub\b[^"']*["']/i),
    tail.search(/<script\b/i),
  ].filter((index) => index >= 0)
  const endIndex = endCandidates.length ? Math.min(...endCandidates) : tail.length
  return tail.slice(0, endIndex)
}

function cleanAssignmentFragment(fragment: string): string {
  return replaceAttachmentIframes(fragment)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<input\b[^>]*>/gi, ' ')
    .replace(/<textarea\b[\s\S]*?<\/textarea>/gi, ' ')
    .replace(/<select\b[\s\S]*?<\/select>/gi, ' ')
    .replace(/<button\b[\s\S]*?<\/button>/gi, ' ')
    .replace(/<a\b[^>]*href=(["'])javascript:[\s\S]*?\1[^>]*>([\s\S]*?)<\/a>/gi, '$2')
    .replace(/<ul\b[^>]*class=["'][^"']*\bZy_ulTk\b[^"']*["'][^>]*>[\s\S]*?<\/ul>/gi, ' ')
    .replace(/<div\b[^>]*class=["'][^"']*\bZY_sub\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ')
    .replace(/<a\b[^>]*class=["'][^"']*\b(RebackA|Btn_blue_1|btnGray_1|workBtnIndex)\b[^"']*["'][\s\S]*?<\/a>/gi, ' ')
    .replace(/<span>\s*填写答案\s*<\/span>/gi, ' ')
    .replace(/暂时保存|提交作业|看不清|确认提交？|保存成功|知道了|取消/gi, ' ')
    .replace(/\s(on[a-z]+)=("|')[\s\S]*?\2/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function replaceAttachmentIframes(fragment: string): string {
  return fragment.replace(/<iframe\b([^>]*)>\s*<\/iframe>/gi, (fullMatch, attrs: string) => {
    const className = matchAttributeValue(attrs, 'class') ?? ''
    const moduleName = matchAttributeValue(attrs, 'module') ?? ''
    const objectId = matchAttributeValue(attrs, 'objectid') ?? ''
    const filename = matchAttributeValue(attrs, 'filename') ?? matchAttachmentNamePayload(attrs)
    const isAttachment = /attach|insertAttach/i.test(`${className} ${moduleName}`) || Boolean(objectId)
    if (!isAttachment || !filename) {
      return fullMatch
    }

    return `<p class="assignment-attachment-placeholder">附件：${escapeHtml(filename)}</p>`
  })
}

function matchAttachmentNamePayload(attrs: string): string | null {
  const encoded = matchAttributeValue(attrs, 'name')
  if (!encoded) {
    return null
  }

  try {
    const decoded = decodeURIComponent(encoded)
    const parsed = JSON.parse(decoded) as { name?: string }
    return parsed.name?.trim() || null
  } catch {
    return null
  }
}

async function inlineAuthenticatedImages(
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  html: string,
  baseUrl: string,
): Promise<string> {
  const matches = Array.from(
    html.matchAll(/<img\b([^>]*)\bsrc=(["'])([\s\S]*?)\2([^>]*)>/gi),
  )

  if (!matches.length) {
    return html
  }

  let output = html
  for (const match of matches) {
    const originalTag = match[0]
    const originalSrc = match[3]
    const absoluteSrc = resolveUrl(originalSrc, baseUrl)
    if (!absoluteSrc || absoluteSrc.startsWith('data:')) {
      continue
    }

    try {
      const response = await apiContext.get(absoluteSrc, {
        failOnStatusCode: false,
        timeout: 60_000,
        headers: {
          referer: baseUrl,
        },
      })

      if (!response.ok()) {
        continue
      }

      const contentType = response.headers()['content-type'] ?? ''
      if (!contentType.startsWith('image/')) {
        continue
      }

      const body = await response.body()
      const dataUrl = `data:${contentType};base64,${body.toString('base64')}`
      output = output.replace(originalTag, originalTag.replace(originalSrc, dataUrl))
    } catch {
      // Keep the original src as a best-effort fallback if inline fetch fails.
    }
  }

  return output
}

function extractAssignmentDetailLinks(sources: Array<string | null | undefined>, baseUrl: string): AssignmentDetailLink[] {
  const links: AssignmentDetailLink[] = []
  const ignoredTitles = new Set([
    '首页',
    '任务',
    '统计',
    '资料',
    '通知',
    '作业',
    '考试',
    '讨论',
    '课程评价',
    '返回',
    '暂时保存',
    '提交作业',
    '填写答案',
    '看不清',
    '确定',
    '取消',
    '知道了',
  ])

  for (const [sourceIndex, html] of sources.filter((source): source is string => Boolean(source)).entries()) {
    for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = match[1]
      const href = resolveUrl(matchAttributeValue(attrs, 'href'), baseUrl)
      const title =
        matchAttributeValue(attrs, 'title') ??
        matchAttributeValue(attrs, 'download') ??
        normalizeText(match[2]) ??
        inferLinkTitleFromUrl(href) ??
        '链接'

      if (!href) {
        continue
      }

      if (ignoredTitles.has(title || '')) {
        continue
      }

      if (!isUsefulAssignmentDetailLink(attrs, match[0], href, title, sourceIndex > 0)) {
        continue
      }

      links.push({
        title: title || '链接',
        url: href,
      })
    }

    extractObjectAttachmentLinks(html, baseUrl).forEach((link) => links.push(link))
  }

  return dedupeLinks(links)
}

function extractObjectAttachmentLinks(html: string, baseUrl: string): AssignmentDetailLink[] {
  const links: AssignmentDetailLink[] = []
  for (const match of html.matchAll(/<([a-z0-9]+)\b([^>]*(?:objectid|objectId)[^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const attrs = match[2]
    const objectId = matchAttributeValue(attrs, 'objectid') ?? matchAttributeValue(attrs, 'objectId')
    if (!objectId) {
      continue
    }

    const url = resolveUrl(
      matchAttributeValue(attrs, 'loadurl') ??
        matchAttributeValue(attrs, 'data') ??
        matchAttributeValue(attrs, 'url') ??
        matchAttributeValue(attrs, 'href'),
      baseUrl,
    )
    if (!url) {
      continue
    }

    const title =
      matchAttributeValue(attrs, 'title') ??
      matchAttributeValue(attrs, 'filename') ??
      matchAttributeValue(attrs, 'name') ??
      normalizeText(match[3]) ??
      inferLinkTitleFromUrl(url) ??
      '附件'

    links.push({ title, url })
  }

  return links
}

function isUsefulAssignmentDetailLink(
  attrs: string,
  raw: string,
  href: string,
  title: string,
  attachmentOnly: boolean,
): boolean {
  const lowerAttrs = attrs.toLowerCase()
  const lowerRaw = raw.toLowerCase()
  const lowerHref = href.toLowerCase()
  const lowerTitle = title.toLowerCase()

  if (/javascript:|#$/i.test(href)) {
    return false
  }

  const attachmentLike =
    lowerAttrs.includes('attachment') ||
    lowerRaw.includes('attachment') ||
    lowerRaw.includes('attach') ||
    lowerRaw.includes('附件') ||
    lowerHref.includes('/upload/') ||
    lowerHref.includes('ueditorupload') ||
    lowerHref.includes('cs.mooc.ucas.edu.cn/') ||
    lowerHref.includes('p.cldisk.com/') ||
    /\.(jpg|jpeg|png|gif|bmp|webp|pdf|doc|docx|ppt|pptx|xls|xlsx|zip|rar|7z|txt)(\?|$)/i.test(href)

  if (attachmentLike) {
    return true
  }

  if (attachmentOnly) {
    return false
  }

  return !/首页|任务|统计|资料|通知|作业|考试|讨论|课程评价|返回|提交|保存|验证码/.test(lowerTitle)
}

function inferLinkTitleFromUrl(url: string | null): string | null {
  if (!url) {
    return null
  }

  try {
    const parsed = new URL(url)
    return decodeURIComponent(parsed.pathname.split('/').at(-1) || '') || null
  } catch {
    return null
  }
}

function matchSummaryValue(source: string, pattern: RegExp): string | null {
  const match = source.match(pattern)?.[1] ?? null
  return normalizeText(match)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function dedupeLinks(items: AssignmentDetailLink[]): AssignmentDetailLink[] {
  const seen = new Set<string>()
  const results: AssignmentDetailLink[] = []

  items.forEach((item) => {
    const key = `${item.title}\u0000${item.url}`
    if (seen.has(key)) {
      return
    }

    seen.add(key)
    results.push(item)
  })

  return results
}
