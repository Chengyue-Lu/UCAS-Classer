import { readFile } from 'node:fs/promises'

// Main orchestrator for request-based collection. It coordinates per-course
// module discovery, summary/full mode behavior, and diff output.
import {
  collectorPaths,
  resolveAssignmentListJson,
  resolveMaterialListJson,
  resolveNoticeListJson,
} from '../shared/cache-paths.js'
import { collectCourseListByRequest } from '../request-course-list/course-list.js'
import type {
  AssignmentListSnapshot,
  CourseModuleUrls,
  CourseSummary,
  FullCollectSummary,
  MaterialListSnapshot,
  NoticeListSnapshot,
} from '../shared/collector-types.js'
import { pruneStaleCourseCache, runWithConcurrency, writeJsonFile } from '../shared/cache-utils.js'
import { fillPendingAssignmentWorkUrls, extractAssignments } from './assignment-parser.js'
import { collectRequestMaterials } from './material-parser.js'
import { extractNotices, fillNoticeDetails } from './notice-parser.js'
import {
  createRequestContext,
  fetchHtml,
  type RequestApiContext,
} from './request-core.js'
import { collectCourseModuleUrlsByRequest } from './module-urls.js'

type CollectCourseResult =
  | {
      courseId: string
      courseName: string
      ok: true
      materialCount: number
      noticeCount: number
      assignmentCount: number
      summaryFingerprint: string
    }
  | {
      courseId: string
      courseName: string
      ok: false
      error: string
    }

type SuccessfulFingerprintResult = Extract<CollectCourseResult, { ok: true }>
type CourseCollectSummaryItem = FullCollectSummary['courses'][number]

export async function runRequestFullCollect(options?: {
  concurrency?: number
  headed?: boolean
  mode?: 'full' | 'summary'
}): Promise<FullCollectSummary> {
  const startedAt = new Date().toISOString()
  const mode = options?.mode === 'summary' ? 'summary' : 'full'
  const courseList = await collectCourseListByRequest()

  await pruneStaleCourseCache(courseList.courses.map((course) => course.courseId))

  const concurrency = Math.max(
    1,
    Math.min(options?.concurrency ?? 4, courseList.courses.length || 1),
  )

  const results = await runWithConcurrency(
    courseList.courses,
    concurrency,
    async (course: CourseSummary): Promise<CollectCourseResult> => {
      try {
        const modules = await collectCourseModuleUrlsByRequest(course)
        const { materials, notices, assignments } = await collectCoursePayloads(modules, mode)
        const summaryFingerprint = createCourseSummaryFingerprint({
          materials,
          notices,
          assignments,
        })

        return {
          courseId: course.courseId,
          courseName: course.name,
          ok: true,
          materialCount: materials.fileCount,
          noticeCount: notices.itemCount,
          assignmentCount: assignments.itemCount,
          summaryFingerprint,
        }
      } catch (error) {
        return {
          courseId: course.courseId,
          courseName: course.name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  )

  const previousFingerprints = await loadCollectFingerprintState()
  const fingerprintResults = getSuccessfulFingerprintResults(results)
  const changedCourseIds =
    mode === 'summary'
      ? fingerprintResults
          .filter((result) => previousFingerprints[result.courseId] !== result.summaryFingerprint)
          .map((result) => result.courseId)
      : []
  const hasDiff = mode === 'summary' && changedCourseIds.length > 0
  const collectSucceeded = results.every((result) => result.ok)

  const summary: FullCollectSummary = {
    mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    courseCount: courseList.courseCount,
    concurrency,
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    hasDiff,
    pendingFullCollectAfterDiff: hasDiff,
    changedCourseIds,
    jsonPath: collectorPaths.fullCollectSummaryJson,
    courses: results.map(toCourseCollectSummaryItem),
  }

  await writeJsonFile(summary.jsonPath, summary)
  await writeJsonFile(collectorPaths.moduleIndexJson, {
    collectedAt: summary.finishedAt,
    courseCount: courseList.courseCount,
    courses: courseList.courses,
  })

  if (mode === 'full' && collectSucceeded) {
    await writeJsonFile(collectorPaths.collectFingerprintStateJson, {
      updatedAt: summary.finishedAt,
      mode,
      courseFingerprints: Object.fromEntries(
        fingerprintResults.map((result) => [result.courseId, result.summaryFingerprint]),
      ),
    })
  }

  return summary
}

async function collectCoursePayloads(
  modules: CourseModuleUrls,
  mode: 'full' | 'summary',
): Promise<{
  materials: MaterialListSnapshot
  notices: NoticeListSnapshot
  assignments: AssignmentListSnapshot
}> {
  const apiContext = await createRequestContext()

  try {
    const [materials, notices, assignments] = await Promise.all([
      collectMaterialSnapshot(apiContext, modules),
      collectNoticeSnapshot(apiContext, modules, mode),
      collectAssignmentSnapshot(apiContext, modules),
    ])

    await writeJsonFile(materials.jsonPath, materials)
    await writeJsonFile(notices.jsonPath, notices)
    await writeJsonFile(assignments.jsonPath, assignments)

    return {
      materials,
      notices,
      assignments,
    }
  } finally {
    await apiContext.dispose()
  }
}

async function collectMaterialSnapshot(
  apiContext: RequestApiContext,
  modules: CourseModuleUrls,
): Promise<MaterialListSnapshot> {
  if (!modules.materialsUrl) {
    return createEmptyMaterialSnapshot(modules)
  }

  const collected = await collectRequestMaterials(apiContext, modules)
  const fileCount = collected.items.filter((item) => item.nodeType === 'file').length
  const folderCount = collected.items.filter((item) => item.nodeType === 'folder').length

  return {
    collectedAt: new Date().toISOString(),
    browserChannel: 'Request context',
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.materialsUrl,
    currentUrl: collected.fetch.finalUrl,
    pageTitle: collected.fetch.title ?? modules.pageTitle,
    itemCount: collected.items.length,
    fileCount,
    folderCount,
    htmlPath: collected.fetch.htmlPath,
    screenshotPath: '',
    jsonPath: resolveMaterialListJson(modules.courseId),
    items: collected.items,
  }
}

async function collectNoticeSnapshot(
  apiContext: RequestApiContext,
  modules: CourseModuleUrls,
  mode: 'full' | 'summary',
): Promise<NoticeListSnapshot> {
  if (!modules.noticesUrl) {
    return createEmptyNoticeSnapshot(modules)
  }

  const fetch = await fetchHtml(apiContext, modules.noticesUrl, `notice-list-${modules.courseId}`)
  const items = extractNotices(fetch.bodyText, fetch.finalUrl)
  if (mode === 'full') {
    // Summary mode intentionally stops at list-level metadata so background
    // collect stays cheaper unless a later full pass is required.
    await fillNoticeDetails(apiContext, items)
  }

  return {
    collectedAt: new Date().toISOString(),
    browserChannel: 'Request context',
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.noticesUrl,
    currentUrl: fetch.finalUrl,
    pageTitle: fetch.title ?? modules.pageTitle,
    itemCount: items.length,
    htmlPath: fetch.htmlPath,
    screenshotPath: '',
    jsonPath: resolveNoticeListJson(modules.courseId),
    items,
  }
}

async function loadCollectFingerprintState(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(collectorPaths.collectFingerprintStateJson, 'utf8')
    const parsed = JSON.parse(raw) as {
      courseFingerprints?: Record<string, string>
    }
    return parsed.courseFingerprints ?? {}
  } catch {
    return {}
  }
}

function createCourseSummaryFingerprint(input: {
  materials: MaterialListSnapshot
  notices: NoticeListSnapshot
  assignments: AssignmentListSnapshot
}): string {
  const materials = input.materials.items.map((item) => ({
    nodeId: item.nodeId,
    parentNodeId: item.parentNodeId,
    nodeType: item.nodeType,
    path: item.path,
    depth: item.depth,
    dataId: item.dataId,
    folderId: item.folderId,
    name: item.name,
    type: item.type,
    uploader: item.uploader,
    size: item.size,
    createdAt: item.createdAt,
    downloadUrl: item.downloadUrl,
    readUrl: item.readUrl,
    openUrl: item.openUrl,
    source: item.source,
  }))
  const notices = input.notices.items.map((item) => ({
    noticeId: item.noticeId,
    noticeEnc: item.noticeEnc,
    title: item.title,
    detailUrl: item.detailUrl,
    publishedAt: item.publishedAt,
    publisher: item.publisher,
    rawText: item.rawText,
  }))
  const assignments = input.assignments.items.map((item) => ({
    title: item.title,
    workUrl: item.workUrl,
    status: item.status,
    startTime: item.startTime,
    endTime: item.endTime,
    rawText: item.rawText,
    workId: item.workId ?? null,
    workAnswerId: item.workAnswerId ?? null,
    reEdit: item.reEdit ?? null,
  }))

  return JSON.stringify({
    materials,
    notices,
    assignments,
  })
}

async function collectAssignmentSnapshot(
  apiContext: RequestApiContext,
  modules: CourseModuleUrls,
): Promise<AssignmentListSnapshot> {
  if (!modules.assignmentsUrl) {
    return createEmptyAssignmentSnapshot(modules)
  }

  const fetch = await fetchHtml(
    apiContext,
    modules.assignmentsUrl,
    `assignment-list-${modules.courseId}`,
  )
  const items = extractAssignments(fetch.bodyText, fetch.finalUrl)
  await fillPendingAssignmentWorkUrls(apiContext, items, fetch.bodyText, fetch.finalUrl)

  return {
    collectedAt: new Date().toISOString(),
    browserChannel: 'Request context',
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.assignmentsUrl,
    currentUrl: fetch.finalUrl,
    pageTitle: fetch.title ?? modules.pageTitle,
    itemCount: items.length,
    htmlPath: fetch.htmlPath,
    screenshotPath: '',
    jsonPath: resolveAssignmentListJson(modules.courseId),
    items,
  }
}

function getSuccessfulFingerprintResults(
  results: CollectCourseResult[],
): SuccessfulFingerprintResult[] {
  return results.filter((result): result is SuccessfulFingerprintResult => result.ok)
}

function toCourseCollectSummaryItem(result: CollectCourseResult): CourseCollectSummaryItem {
  if (result.ok) {
    return {
      courseId: result.courseId,
      courseName: result.courseName,
      ok: true,
      error: undefined,
      materialCount: result.materialCount,
      noticeCount: result.noticeCount,
      assignmentCount: result.assignmentCount,
    }
  }

  return {
    courseId: result.courseId,
    courseName: result.courseName,
    ok: false,
    error: result.error,
    materialCount: 0,
    noticeCount: 0,
    assignmentCount: 0,
  }
}

function createEmptyMaterialSnapshot(modules: CourseModuleUrls): MaterialListSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    browserChannel: 'Request context',
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.courseHomeUrl,
    currentUrl: modules.courseHomeUrl,
    pageTitle: modules.pageTitle,
    itemCount: 0,
    fileCount: 0,
    folderCount: 0,
    htmlPath: '',
    screenshotPath: '',
    jsonPath: resolveMaterialListJson(modules.courseId),
    items: [],
  }
}

function createEmptyNoticeSnapshot(modules: CourseModuleUrls): NoticeListSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    browserChannel: 'Request context',
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.courseHomeUrl,
    currentUrl: modules.courseHomeUrl,
    pageTitle: modules.pageTitle,
    itemCount: 0,
    htmlPath: '',
    screenshotPath: '',
    jsonPath: resolveNoticeListJson(modules.courseId),
    items: [],
  }
}

function createEmptyAssignmentSnapshot(modules: CourseModuleUrls): AssignmentListSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    browserChannel: 'Request context',
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.courseHomeUrl,
    currentUrl: modules.courseHomeUrl,
    pageTitle: modules.pageTitle,
    itemCount: 0,
    htmlPath: '',
    screenshotPath: '',
    jsonPath: resolveAssignmentListJson(modules.courseId),
    items: [],
  }
}
