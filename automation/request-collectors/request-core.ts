import { writeFile } from 'node:fs/promises'
import { request } from '@playwright/test'
import { authPaths } from '../auth/paths.js'
import type { CourseModuleUrls, CourseSummary } from '../shared/collector-types.js'
import { resolveArtifactHtml } from '../shared/cache-paths.js'

// Shared request-side core utilities. This file owns request context creation,
// HTML fetching, text normalization, and the lightweight module URL parser.
type AnchorSummary = {
  title: string | null
  text: string
  href: string | null
  data: string | null
}

export type RequestApiContext = Awaited<ReturnType<typeof createRequestContext>>

export type RequestPageFetch = {
  finalUrl: string
  status: number
  ok: boolean
  contentType: string
  bodyText: string
  loginLike: boolean
  title: string | null
  htmlPath: string
}

export function normalizeText(value: string | null | undefined): string {
  return stripTags(value)
}

export function normalizeTextLikeBrowser(value: string | null | undefined): string {
  return stripTagsLikeBrowser(value)
}

export async function createRequestContext() {
  return request.newContext({
    storageState: authPaths.storageStateFile,
    ignoreHTTPSErrors: true,
  })
}

export async function fetchHtml(
  apiContext: RequestApiContext,
  url: string,
  artifactPrefix: string,
): Promise<RequestPageFetch> {
  const response = await apiContext.get(url, {
    failOnStatusCode: false,
    timeout: 60_000,
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
    title: extractTitle(bodyText),
    htmlPath,
  }
}

export function looksLikeLoginBody(contentType: string, bodyText: string): boolean {
  if (!contentType.includes('text/html')) {
    return false
  }

  return (
    bodyText.includes('/passport/login') ||
    bodyText.includes('id="loginForm"') ||
    bodyText.includes('name="loginForm"') ||
    bodyText.includes('passport.mooc.ucas.edu.cn')
  )
}

export function resolveModuleUrlsFromHtml(
  course: CourseSummary,
  courseHomeUrl: string,
  html: string,
): Omit<CourseModuleUrls, 'collectedAt' | 'browserChannel' | 'htmlPath' | 'screenshotPath' | 'jsonPath'> {
  const anchors = extractAnchors(html, courseHomeUrl)

  return {
    courseId: course.courseId,
    clazzId: course.clazzId,
    cpi: course.cpi,
    ckenc: course.ckenc,
    name: course.name,
    teacher: course.teacher,
    courseUrl: course.courseUrl,
    courseHomeUrl,
    pageTitle: extractTitle(html) ?? '',
    materialsUrl: pickModuleUrl(anchors, '资料', false),
    noticesUrl: pickModuleUrl(anchors, '通知', false),
    assignmentsUrl: pickModuleUrl(anchors, '作业', true),
  }
}

export function decodeHtml(value: string | null | undefined): string {
  if (!value) {
    return ''
  }

  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
}

export function stripTags(value: string | null | undefined): string {
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function stripTagsLikeBrowser(value: string | null | undefined): string {
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s*\/\s*/g, '/')
    .trim()
}

export function decodeAttribute(value: string | null | undefined): string | null {
  const decoded = decodeHtml(value).trim()
  return decoded || null
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function matchAttributeValue(source: string, name: string): string | null {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}=(["'])([\\s\\S]*?)\\1`, 'i')
  return decodeAttribute(pattern.exec(source)?.[2] ?? null)
}

export function resolveUrl(value: string | null | undefined, baseUrl: string): string | null {
  const decoded = decodeAttribute(value)
  if (!decoded || decoded.startsWith('javascript:')) {
    return null
  }

  try {
    return new URL(decoded, baseUrl).toString()
  } catch {
    return null
  }
}

export function extractTitle(html: string): string | null {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i)
  return match ? normalizeText(match[1]) : null
}

function extractAnchors(html: string, baseUrl: string): AnchorSummary[] {
  const anchors: AnchorSummary[] = []
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi

  for (const match of html.matchAll(pattern)) {
    const attrs = match[1]
    anchors.push({
      title: matchAttributeValue(attrs, 'title'),
      text: normalizeText(match[2]),
      href: resolveUrl(matchAttributeValue(attrs, 'href'), baseUrl),
      data: resolveUrl(matchAttributeValue(attrs, 'data'), baseUrl),
    })
  }

  return anchors
}

function pickModuleUrl(anchors: AnchorSummary[], keyword: string, preferData: boolean): string | null {
  for (const anchor of anchors) {
    const haystack = `${anchor.title ?? ''} ${anchor.text}`
    if (!haystack.includes(keyword)) {
      continue
    }

    if (preferData) {
      return anchor.data ?? anchor.href ?? null
    }

    return anchor.href ?? anchor.data ?? null
  }

  return null
}
