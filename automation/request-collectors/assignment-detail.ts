import { writeFile } from 'node:fs/promises'
import type { AssignmentSummary } from '../shared/collector-types.js'
import { resolveArtifactHtml } from '../shared/cache-paths.js'
import {
  createRequestContext,
  decodeAttribute,
  fetchHtml,
  looksLikeLoginBody,
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
    const resolvedWorkUrl = await resolveAssignmentDetailUrl(apiContext, request)
    const referer = request.assignmentsUrl?.trim() || undefined
    const fetch = await fetchHtmlWithOptionalReferer(
      apiContext,
      resolvedWorkUrl,
      `assignment-detail-${deriveArtifactSuffix(resolvedWorkUrl)}`,
      referer,
    )

    if (!fetch.ok) {
      throw new Error(`assignment detail request failed with status ${fetch.status}`)
    }

    if (fetch.loginLike) {
      throw new Error('assignment detail request was redirected to login')
    }

    const detailHtml = await extractAssignmentDetailHtml(
      apiContext,
      request,
      fetch.bodyText,
      fetch.finalUrl,
    )
    const detailText = normalizeTextLikeBrowser(detailHtml || fetch.bodyText)
    const links = extractAssignmentDetailLinks(detailHtml || fetch.bodyText, fetch.finalUrl)

    return {
      workUrl: resolvedWorkUrl,
      finalUrl: fetch.finalUrl,
      detailText,
      detailHtml,
      detailCollectedAt: new Date().toISOString(),
      links,
    }
  } finally {
    await apiContext.dispose()
  }
}

async function resolveAssignmentDetailUrl(
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  request: AssignmentDetailRequest,
): Promise<string> {
  const assignmentsUrl = request.assignmentsUrl?.trim()
  if (!assignmentsUrl) {
    return request.workUrl
  }

  const bootstrap = await fetchHtmlWithOptionalReferer(
    apiContext,
    assignmentsUrl,
    `assignment-detail-bootstrap-${deriveArtifactSuffix(assignmentsUrl)}`,
  )

  if (!bootstrap.ok) {
    return request.workUrl
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

  const matched = matchAssignmentFromList(assignments, request)
  return matched?.workUrl || request.workUrl
}

async function fetchHtmlWithOptionalReferer(
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  url: string,
  artifactPrefix: string,
  referer?: string,
) {
  if (!referer) {
    return fetchHtml(apiContext, url, artifactPrefix)
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
    loginLike: looksLikeLoginBody(contentType, bodyText),
    title: bodyText.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? null,
    htmlPath,
  }
}

function matchAssignmentFromList(
  assignments: AssignmentSummary[],
  request: AssignmentDetailRequest,
): AssignmentSummary | null {
  const requestedParams = extractWorkIdentity(request.workUrl)

  if (requestedParams.workId) {
    const matchedByIds = assignments.find((item) => {
      if (!item.workId || item.workId !== requestedParams.workId) {
        return false
      }

      if (!requestedParams.workAnswerId) {
        return true
      }

      return (item.workAnswerId ?? null) === requestedParams.workAnswerId
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
  const match = html.match(
    /<div\b[^>]*class=["'][^"']*\bZyBottom\b[^"']*["'][^>]*>([\s\S]*?)<\/form>/i,
  )
  if (!match) {
    return null
  }

  const cleaned = cleanAssignmentFragment(match[1])
  return cleaned
    ? `
        <section class="assignment-detail-body">
          ${cleaned}
        </section>
      `
    : null
}

function cleanAssignmentFragment(fragment: string): string {
  return fragment
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
    .replace(/暂时保存|提交作业|看不清|确认提交？|保存成功|知道了|确定|取消/gi, ' ')
    .replace(/\s(on[a-z]+)=("|')[\s\S]*?\2/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
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

function extractAssignmentDetailLinks(html: string, baseUrl: string): AssignmentDetailLink[] {
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
  ])

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1]
    const href = resolveUrl(attrs.match(/\bhref=(["'])([\s\S]*?)\1/i)?.[2] ?? null, baseUrl)
    const title =
      decodeAttribute(attrs.match(/\btitle=(["'])([\s\S]*?)\1/i)?.[2] ?? null) ??
      normalizeText(match[2]) ??
      '链接'

    if (!href) {
      continue
    }

    if (ignoredTitles.has(title || '')) {
      continue
    }

    links.push({
      title: title || '链接',
      url: href,
    })
  }

  return dedupeLinks(links)
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
