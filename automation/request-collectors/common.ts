import { writeFile } from 'node:fs/promises'
import { request } from '@playwright/test'
import { authPaths } from '../auth/paths.js'
import type {
  AssignmentSummary,
  CourseModuleUrls,
  CourseSummary,
  MaterialNodeSummary,
  NoticeAttachment,
  NoticeSummary,
} from '../shared/collector-types.js'
import { resolveArtifactHtml } from '../shared/cache-paths.js'

type AnchorSummary = {
  title: string | null
  text: string
  href: string | null
  data: string | null
}

type RawMaterialRow = {
  itemIndex: number
  rowId: string | null
  dataId: string | null
  folderId: string | null
  type: string | null
  objectId: string | null
  source: string | null
  name: string
  uploader: string | null
  size: string | null
  createdAt: string | null
  downloadUrl: string | null
  readUrl: string | null
  openUrl: string | null
  loadUrl: string | null
  rowUrl: string | null
  iconSrc: string | null
}

type MaterialPageState = {
  courseId: string
  classId: string
  enc: string
  cpi: string | null
  openc: string | null
  ut: string
  currentDataId: string
}

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
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
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
    bodyText.includes('统一身份认证') ||
    bodyText.includes('用户登录') ||
    bodyText.includes('登录') ||
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

export async function collectRequestMaterials(
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
  modules: CourseModuleUrls,
): Promise<{
  fetch: RequestPageFetch
  items: MaterialNodeSummary[]
  pages: Array<{ depth: number; dataId: string; url: string; title: string | null; itemCount: number }>
}> {
  const visited = new Set<string>()
  return collectMaterialTreePages(apiContext, {
    courseId: modules.courseId,
    fetchUrl: modules.materialsUrl!,
    pageTag: `material-list-${modules.courseId}`,
    parentNodeId: null,
    parentPath: '',
    depth: 0,
    ancestorFolderIds: [],
    visited,
  })
}

export function extractAssignments(html: string, baseUrl: string): AssignmentSummary[] {
  const items = extractAssignmentBlocks(html)
  const base = new URL(baseUrl)
  const classId = base.searchParams.get('classId')
  const courseId = base.searchParams.get('courseId')
  const ut = base.searchParams.get('ut') ?? 's'
  const enc = base.searchParams.get('enc')
  const cpi = base.searchParams.get('cpi')
  const openc = base.searchParams.get('openc')

  return items
    .map((block) => {
      const inspectTaskMatch = block.match(
        /class=["'][^"']*\binspectTask\b[^"']*["'][^>]*\bdata=["']([^"']+)["'][^>]*\bdata2=["']([^"']+)["']/i,
      )
      const directWorkUrl =
        resolveUrl(
          block.match(/<a[^>]*href=["']([^"']*\/work\/[^"']+)["'][^>]*title=["'][^"']*["']/i)?.[1] ??
            block.match(/<a[^>]*class=["'][^"']*\bBtn_(?:blue|red)_1\b[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1] ??
            null,
          baseUrl,
        ) ??
        buildInspectTaskUrl({
          baseUrl,
          courseId,
          classId,
          ut,
          enc,
          cpi,
          openc,
          workId: inspectTaskMatch?.[1] ?? null,
          workAnswerId: inspectTaskMatch?.[2] ?? null,
        })
      const title =
        decodeAttribute(block.match(/<a[^>]*title=["']([^"']+)["']/i)?.[1] ?? null) ??
        normalizeText(block.match(/<p[^>]*class=["'][^"']*clearfix[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1])
      const rawText = normalizeTextLikeBrowser(block)
      const dateMatches =
        rawText.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?/g) ?? []
      const status = normalizeText(block.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1])

      return {
        title: title || rawText,
        workUrl: directWorkUrl,
        status: status || null,
        startTime: dateMatches[0] ?? null,
        endTime: dateMatches[1] ?? null,
        rawText,
        workId: inspectTaskMatch?.[1] ?? null,
        workAnswerId: inspectTaskMatch?.[2] ?? null,
        reEdit: block.match(/\bdata3=["']([^"']+)["']/i)?.[1] ?? null,
      }
    })
      .filter((item) => Boolean(item.title && item.rawText))
}

function extractAssignmentBlocks(html: string): string[] {
  const scopedSection =
    html.match(/<div\b[^>]*class=["'][^"']*\bulDiv\b[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["']page["']/i)?.[1] ??
    html.match(/<div\b[^>]*class=["'][^"']*\bulDiv\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ??
    html

  const lookLiBlocks = Array.from(
    scopedSection.matchAll(/<li\b[^>]*class=["'][^"']*\blookLi\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi),
  ).map((match) => match[1])

  if (lookLiBlocks.length > 0) {
    return lookLiBlocks
  }

  return Array.from(scopedSection.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi))
    .map((match) => match[1])
    .filter((block) => /作业状态|开始时间|截止时间|inspectTask|做作业|查看/.test(block))
}

function buildInspectTaskUrl(options: {
  baseUrl: string
  courseId: string | null
  classId: string | null
  ut: string
  enc: string | null
  cpi: string | null
  openc: string | null
  workId: string | null
  workAnswerId: string | null
}): string | null {
  if (!options.courseId || !options.classId || !options.workId) {
    return null
  }

  const url = new URL('/mooc-ans/work/doHomeWorkNew', options.baseUrl)
  url.searchParams.set('courseId', options.courseId)
  url.searchParams.set('classId', options.classId)
  url.searchParams.set('workId', options.workId)
  if (options.workAnswerId) {
    url.searchParams.set('workAnswerId', options.workAnswerId)
  }
  url.searchParams.set('isdisplaytable', '2')
  url.searchParams.set('mooc', '1')
  url.searchParams.set('ut', options.ut)
  if (options.enc) {
    url.searchParams.set('enc', options.enc)
  }
  if (options.cpi) {
    url.searchParams.set('cpi', options.cpi)
  }
  if (options.openc) {
    url.searchParams.set('openc', options.openc)
  }

  return url.toString()
}

type AssignmentLaunchTemplate = {
  enc: string
  cpi: string | null
  openc: string | null
  workSystem: string | null
}

export async function fillPendingAssignmentWorkUrls(
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
  assignments: AssignmentSummary[],
  html: string,
  baseUrl: string,
): Promise<void> {
  const template = extractAssignmentLaunchTemplate(html)
  if (!template) {
    return
  }

  for (const item of assignments) {
    if (!item.workId) {
      continue
    }
    if (item.workUrl && !(item.status?.includes('待做') ?? false)) {
      continue
    }

    const standardEnc = await fetchAssignmentStandardEnc(
      apiContext,
      baseUrl,
      item.workId,
      template.cpi,
    )
    if (!standardEnc) {
      continue
    }

    item.workUrl = buildPendingAssignmentUrl({
      baseUrl,
      template,
      workId: item.workId,
      workAnswerId: item.workAnswerId,
      standardEnc,
      reEdit: item.reEdit,
    })
  }
}

function extractAssignmentLaunchTemplate(html: string): AssignmentLaunchTemplate | null {
  const match = html.match(
    /doHomeWorkNew\?courseId="\s*\+\s*courseId\s*\+\s*"&classId="\s*\+\s*classId\s*\+\s*"&workId="\s*\+\s*workRelationId\s*\+\s*"&workAnswerId="\s*\+\s*workRelationAnswerId\s*\+\s*"(&reEdit=1)?&isdisplaytable=2&mooc=1&enc=([^&"]+)&workSystem=([^&"]+)&cpi=([^&"]+)&openc=([^&"]+)&standardEnc=/i,
  )
  if (!match) {
    return null
  }

  return {
    enc: match[2],
    workSystem: match[3] || null,
    cpi: match[4] || null,
    openc: match[5] || null,
  }
}

async function fetchAssignmentStandardEnc(
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
  baseUrl: string,
  workId: string,
  cpi: string | null,
): Promise<string | null> {
  const base = new URL(baseUrl)
  const courseId = base.searchParams.get('courseId')
  const classId = base.searchParams.get('classId')
  if (!courseId || !classId) {
    return null
  }

  const url = new URL('/mooc-ans/work/isExpire', baseUrl)
  url.searchParams.set('classId', classId)
  url.searchParams.set('courseId', courseId)
  url.searchParams.set('workRelationId', workId)
  if (cpi) {
    url.searchParams.set('cpi', cpi)
  }

  const response = await apiContext.get(url.toString(), {
    failOnStatusCode: false,
    timeout: 60_000,
  })
  const bodyText = await response.text()
  if (!response.ok()) {
    return null
  }

  try {
    const payload = JSON.parse(bodyText) as { status?: number | string; standardEnc?: string }
    if (`${payload.status ?? ''}` !== '0') {
      return null
    }
    return payload.standardEnc ?? null
  } catch {
    return null
  }
}

function buildPendingAssignmentUrl(options: {
  baseUrl: string
  template: AssignmentLaunchTemplate
  workId: string
  workAnswerId?: string | null
  standardEnc: string
  reEdit?: string | null
}): string {
  const base = new URL(options.baseUrl)
  const courseId = base.searchParams.get('courseId') ?? ''
  const classId = base.searchParams.get('classId') ?? ''
  const ut = base.searchParams.get('ut') ?? 's'
  const url = new URL('/mooc-ans/work/doHomeWorkNew', options.baseUrl)

  url.searchParams.set('courseId', courseId)
  url.searchParams.set('classId', classId)
  url.searchParams.set('workId', options.workId)
  if (options.workAnswerId) {
    url.searchParams.set('workAnswerId', options.workAnswerId)
  }
  if (options.reEdit === '1') {
    url.searchParams.set('reEdit', '1')
  }
  url.searchParams.set('isdisplaytable', '2')
  url.searchParams.set('mooc', '1')
  url.searchParams.set('ut', ut)
  url.searchParams.set('enc', options.template.enc)
  if (options.template.workSystem) {
    url.searchParams.set('workSystem', options.template.workSystem)
  }
  if (options.template.cpi) {
    url.searchParams.set('cpi', options.template.cpi)
  }
  if (options.template.openc) {
    url.searchParams.set('openc', options.template.openc)
  }
  url.searchParams.set('standardEnc', options.standardEnc)

  return url.toString()
}

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
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
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

function decodeHtml(value: string | null | undefined): string {
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

function stripTags(value: string | null | undefined): string {
  return decodeHtml(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripTagsLikeBrowser(value: string | null | undefined): string {
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

function decodeAttribute(value: string | null | undefined): string | null {
  const decoded = decodeHtml(value).trim()
  return decoded || null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function matchAttributeValue(source: string, name: string): string | null {
  const pattern = new RegExp(`\\b${escapeRegExp(name)}=(["'])([\\s\\S]*?)\\1`, 'i')
  return decodeAttribute(pattern.exec(source)?.[2] ?? null)
}

function resolveUrl(value: string | null | undefined, baseUrl: string): string | null {
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

function extractTitle(html: string): string | null {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i)
  return match ? normalizeText(match[1]) : null
}

function stripFieldLabel(value: string | null): string | null {
  if (!value) {
    return null
  }

  const normalized = value.replace(/^[^:：]*[:：]\s*/, '').trim()
  return normalized || null
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

function extractHiddenInputValue(html: string, id: string): string | null {
  const direct = html.match(
    new RegExp(`<input\\b[^>]*id=["']${escapeRegExp(id)}["'][^>]*value=["']([\\s\\S]*?)["']`, 'i'),
  )
  if (direct?.[1] != null) {
    return decodeAttribute(direct[1])
  }

  const reverse = html.match(
    new RegExp(`<input\\b[^>]*value=["']([\\s\\S]*?)["'][^>]*id=["']${escapeRegExp(id)}["']`, 'i'),
  )
  return decodeAttribute(reverse?.[1] ?? null)
}

function extractPageState(html: string, fallbackUrl: string): MaterialPageState {
  const parsed = new URL(fallbackUrl)
  const currentDataId = extractHiddenInputValue(html, 'dataId') ?? parsed.searchParams.get('dataId') ?? '0'
  const courseId = extractHiddenInputValue(html, 'courseid') ?? parsed.searchParams.get('courseId') ?? ''
  const classId = extractHiddenInputValue(html, 'classId') ?? parsed.searchParams.get('classId') ?? ''
  const enc = extractHiddenInputValue(html, 'enc') ?? parsed.searchParams.get('enc') ?? ''
  const cpi = extractHiddenInputValue(html, 'cpi') ?? parsed.searchParams.get('cpi')
  const openc = extractHiddenInputValue(html, 'openc') ?? parsed.searchParams.get('openc')
  const ut = extractHiddenInputValue(html, 'ut') ?? parsed.searchParams.get('ut') ?? 's'

  return {
    courseId,
    classId,
    enc,
    cpi,
    openc,
    ut,
    currentDataId,
  }
}

function extractRawMaterialRows(html: string, baseUrl: string): RawMaterialRow[] {
  const rows = Array.from(html.matchAll(/<tr\b([^>]*?\sid=["'][^"']+["'][^>]*)>([\s\S]*?)<\/tr>/gi))

  return rows.map((match, itemIndex) => {
    const attrs = match[1]
    const rowHtml = match[2]
    const rowId = matchAttributeValue(attrs, 'id')
    const type = matchAttributeValue(attrs, 'type')
    const objectId = matchAttributeValue(attrs, 'objectid')
    const source = matchAttributeValue(attrs, 'source')
    const rowUrl = matchAttributeValue(attrs, 'url')
    const loadUrl = matchAttributeValue(attrs, 'loadurl')
    const folderId = matchAttributeValue(attrs, 'folderid')
    const checkboxValue = matchAttributeValue(
      rowHtml.match(/<input[^>]*name=["']checkdelete["'][^>]*>/i)?.[0] ?? '',
      'value',
    )
    const downloadAnchor = rowHtml.match(
      /<a\b(?=[^>]*\bclass=["'][^"']*\bdownload\b[^"']*["'])[^>]*>/i,
    )?.[0]
    const readAnchor = rowHtml.match(
      /<a\b(?=[^>]*\bclass=["'][^"']*\bread\b[^"']*["'])[^>]*>/i,
    )?.[0]
    const nameAnchorMatch = rowHtml.match(
      /<a\b(?=[^>]*\btitle=["'])(?=[^>]*(?:\bname=|\bclass=["'][^"']*\bsrcName\b))[\s\S]*?>([\s\S]*?)<\/a>/i,
    )
    const nameAnchor = nameAnchorMatch?.[0] ?? null
    const downloadUrl = resolveUrl(matchAttributeValue(downloadAnchor ?? '', 'href'), baseUrl)
    const readUrl = matchAttributeValue(readAnchor ?? '', 'onclick')
    const iconSrc = decodeAttribute(rowHtml.match(/<img[^>]*src=["']([^"']+)["']/i)?.[1] ?? null)
    const name = matchAttributeValue(nameAnchor ?? '', 'title') ?? normalizeText(nameAnchorMatch?.[1])

    const tdTexts = Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) =>
      normalizeText(cell[1]),
    )

    return {
      itemIndex,
      rowId,
      dataId: checkboxValue ?? rowId,
      folderId,
      type,
      objectId,
      source,
      name: name ?? `unnamed-${itemIndex + 1}`,
      uploader: tdTexts[2] || null,
      size: tdTexts[3] || null,
      createdAt: tdTexts[4] || null,
      downloadUrl,
      readUrl,
      openUrl: resolveUrl(rowUrl ?? loadUrl ?? downloadUrl, baseUrl),
      loadUrl,
      rowUrl,
      iconSrc,
    }
  })
}

function detectMaterialNodeType(row: RawMaterialRow): MaterialNodeSummary['nodeType'] {
  const iconSrc = row.iconSrc?.toLowerCase() ?? ''
  const type = row.type?.toLowerCase() ?? ''

  if (iconSrc.includes('folder.gif') || type === 'folder' || type === 'dir' || type === 'afolder') {
    return 'folder'
  }

  if (row.downloadUrl || row.readUrl || type) {
    return 'file'
  }

  if (row.openUrl || row.loadUrl || row.rowUrl) {
    return 'link'
  }

  return 'unknown'
}

function normalizeMaterialNode(
  row: RawMaterialRow,
  options: {
    courseId: string
    parentNodeId: string | null
    parentPath: string
    depth: number
  },
): MaterialNodeSummary {
  const nodeType = detectMaterialNodeType(row)
  const rawId =
    row.dataId ??
    row.folderId ??
    row.rowId ??
    `depth-${options.depth}-index-${row.itemIndex}`
  const nodeId = options.parentNodeId ? `${options.parentNodeId}/${rawId}` : `${options.courseId}:${rawId}`
  const name = normalizeText(row.name) || `未命名节点-${row.itemIndex + 1}`
  const path = options.parentPath ? `${options.parentPath}/${name}` : name

  return {
    nodeId,
    parentNodeId: options.parentNodeId,
    nodeType,
    itemIndex: row.itemIndex,
    path,
    depth: options.depth,
    dataId: row.dataId,
    folderId: nodeType === 'folder' ? row.folderId ?? row.dataId : null,
    name,
    type: row.type ? normalizeText(row.type) : null,
    objectId: row.objectId ?? '',
    uploader: row.uploader ? normalizeText(row.uploader) : null,
    size: row.size ? normalizeText(row.size) : null,
    createdAt: row.createdAt ? normalizeText(row.createdAt) : null,
    downloadUrl: row.downloadUrl,
    readUrl: row.readUrl,
    openUrl: row.openUrl,
    source: row.source,
  }
}

function buildParentParam(ancestorFolderIds: string[]): string {
  if (ancestorFolderIds.length === 0) {
    return '[]'
  }

  return `[${ancestorFolderIds.map((id) => `{'id':'${id}'}`).join(',')}]`
}

function buildFolderUrl(
  currentUrl: string,
  pageState: MaterialPageState,
  row: RawMaterialRow,
  ancestorFolderIds: string[],
): string | null {
  const directCandidates = [row.openUrl, row.loadUrl, row.rowUrl]
  for (const candidate of directCandidates) {
    if (!candidate || candidate.startsWith('javascript:')) {
      continue
    }

    try {
      return new URL(candidate, currentUrl).toString()
    } catch {
      continue
    }
  }

  const folderId = row.folderId ?? row.dataId
  if (!folderId || !pageState.courseId || !pageState.classId || !pageState.enc) {
    return null
  }

  const target = new URL(currentUrl)
  target.searchParams.delete('pages')
  target.searchParams.delete('order')
  target.searchParams.delete('orderName')
  target.searchParams.delete('orderType')
  target.searchParams.set('courseId', pageState.courseId)
  target.searchParams.set('classId', pageState.classId)
  target.searchParams.set('type', '1')
  target.searchParams.set('dataName', row.name)
  target.searchParams.set('dataId', folderId)
  target.searchParams.set('parent', buildParentParam(ancestorFolderIds))
  target.searchParams.set('flag', '0')
  target.searchParams.set('enc', pageState.enc)
  target.searchParams.set('ut', pageState.ut)

  if (pageState.cpi) {
    target.searchParams.set('cpi', pageState.cpi)
  }

  if (pageState.openc) {
    target.searchParams.set('openc', pageState.openc)
  }

  return target.toString()
}

async function collectMaterialTreePages(
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
  options: {
    courseId: string
    fetchUrl: string
    pageTag: string
    parentNodeId: string | null
    parentPath: string
    depth: number
    ancestorFolderIds: string[]
    visited: Set<string>
  },
): Promise<{
  fetch: RequestPageFetch
  items: MaterialNodeSummary[]
  pages: Array<{ depth: number; dataId: string; url: string; title: string | null; itemCount: number }>
}> {
  const fetch = await fetchHtml(apiContext, options.fetchUrl, options.pageTag)
  if (!fetch.ok || fetch.loginLike) {
    return {
      fetch,
      items: [],
      pages: [],
    }
  }

  const pageState = extractPageState(fetch.bodyText, fetch.finalUrl)
  const visitKey = `${pageState.currentDataId}|${options.ancestorFolderIds.join('/') || 'root'}`
  if (options.visited.has(visitKey)) {
    return {
      fetch,
      items: [],
      pages: [],
    }
  }
  options.visited.add(visitKey)

  const rows = extractRawMaterialRows(fetch.bodyText, fetch.finalUrl)
  const pages = [
    {
      depth: options.depth,
      dataId: pageState.currentDataId,
      url: fetch.finalUrl,
      title: fetch.title,
      itemCount: rows.length,
    },
  ]

  const items: MaterialNodeSummary[] = []

  for (const row of rows) {
    const node = normalizeMaterialNode(row, {
      courseId: options.courseId,
      parentNodeId: options.parentNodeId,
      parentPath: options.parentPath,
      depth: options.depth,
    })
    items.push(node)

    if (node.nodeType !== 'folder') {
      continue
    }

    const childFolderId = node.folderId ?? node.dataId
    const childUrl = buildFolderUrl(fetch.finalUrl, pageState, row, options.ancestorFolderIds)
    if (!childFolderId || !childUrl) {
      continue
    }

    const child = await collectMaterialTreePages(apiContext, {
      courseId: options.courseId,
      fetchUrl: childUrl,
      pageTag: `${options.pageTag}-folder-${childFolderId}`,
      parentNodeId: node.nodeId,
      parentPath: node.path,
      depth: options.depth + 1,
      ancestorFolderIds: [...options.ancestorFolderIds, childFolderId],
      visited: options.visited,
    })

    items.push(...child.items)
    pages.push(...child.pages)
  }

  return {
    fetch,
    items,
    pages,
  }
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
  apiContext: Awaited<ReturnType<typeof request.newContext>>,
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
