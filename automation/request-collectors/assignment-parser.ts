import type { AssignmentSummary } from '../shared/collector-types.js'
import {
  decodeAttribute,
  normalizeText,
  normalizeTextLikeBrowser,
  resolveUrl,
  type RequestApiContext,
} from './request-core.js'

// Assignment parsing stays separate so full collect can keep orchestration
// logic thin while this module owns HTML extraction and launch URL repair.
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
        pickAssignmentWorkUrl(block, baseUrl) ??
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
      const directWorkIdentity = directWorkUrl ? extractWorkIdentity(directWorkUrl) : null

      return {
        title: title || rawText,
        workUrl: directWorkUrl,
        status: status || null,
        startTime: dateMatches[0] ?? null,
        endTime: dateMatches[1] ?? null,
        rawText,
        workId: inspectTaskMatch?.[1] ?? directWorkIdentity?.workId ?? null,
        workAnswerId: inspectTaskMatch?.[2] ?? directWorkIdentity?.workAnswerId ?? null,
        reEdit: block.match(/\bdata3=["']([^"']+)["']/i)?.[1] ?? null,
      }
    })
    .filter((item) => Boolean(item.title && item.rawText))
}

function pickAssignmentWorkUrl(block: string, baseUrl: string): string | null {
  const candidates = Array.from(block.matchAll(/<a\b([^>]*)>/gi))
    .map((match) => {
      const attrs = match[1]
      const url = resolveUrl(attrs.match(/\bhref=(["'])([\s\S]*?)\1/i)?.[2] ?? null, baseUrl)
      return {
        attrs,
        url,
      }
    })
    .filter((candidate): candidate is { attrs: string; url: string } =>
      Boolean(candidate.url && /\/work\//i.test(candidate.url)),
    )
    .sort((left, right) => scoreAssignmentWorkUrl(right) - scoreAssignmentWorkUrl(left))

  return candidates[0]?.url ?? null
}

function scoreAssignmentWorkUrl(candidate: { attrs: string; url: string }): number {
  let score = 0
  if (/\/selectWorkQuestionYiPiYue\b/i.test(candidate.url)) {
    score += 30
  }
  if (/\/doHomeWorkNew\b/i.test(candidate.url)) {
    score += 10
  }
  if (/[?&]evaluation=0\b/i.test(candidate.url)) {
    score += 20
  }
  if (/\bBtn_(?:blue|red)_1\b/i.test(candidate.attrs)) {
    score += 15
  }
  return score
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

type AssignmentLaunchTemplate = {
  enc: string
  cpi: string | null
  openc: string | null
  workSystem: string | null
}

export async function fillPendingAssignmentWorkUrls(
  apiContext: RequestApiContext,
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
    if (!needsAssignmentLaunchUrlRefresh(item)) {
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

function needsAssignmentLaunchUrlRefresh(item: AssignmentSummary): boolean {
  if (!item.workId) {
    return false
  }

  if (!item.workUrl) {
    return true
  }

  if (!item.workUrl.includes('/doHomeWorkNew')) {
    return false
  }

  return !item.workUrl.includes('standardEnc=')
}

function extractAssignmentBlocks(html: string): string[] {
  const scopedSection =
    html.match(/<div\b[^>]*class=["'][^"']*\bulDiv\b[^"']*["'][^>]*>([\s\S]*?)<div\b[^>]*class=["']page["']/i)?.[1] ??
    html.match(/<div\b[^>]*class=["'][^"']*\bulDiv\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ??
    html

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
  apiContext: RequestApiContext,
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
