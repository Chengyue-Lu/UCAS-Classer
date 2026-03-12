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
import {
  collectRequestMaterials,
  createRequestContext,
  extractAssignments,
  fillPendingAssignmentWorkUrls,
  extractNotices,
  fetchHtml,
  fillNoticeDetails,
} from './common.js'
import { collectCourseModuleUrlsByRequest } from './module-urls.js'

export async function runRequestFullCollect(options?: {
  concurrency?: number
  headed?: boolean
}): Promise<FullCollectSummary> {
  const startedAt = new Date().toISOString()
  const courseList = await collectCourseListByRequest()

  await pruneStaleCourseCache(courseList.courses.map((course) => course.courseId))

  const concurrency = Math.max(
    1,
    Math.min(options?.concurrency ?? 4, courseList.courses.length || 1),
  )

  const results = await runWithConcurrency(
    courseList.courses,
    concurrency,
    async (course: CourseSummary) => {
      try {
        const modules = await collectCourseModuleUrlsByRequest(course)
        const { materials, notices, assignments } = await collectCoursePayloads(modules)

        return {
          courseId: course.courseId,
          courseName: course.name,
          ok: true,
          materialCount: materials.fileCount,
          noticeCount: notices.itemCount,
          assignmentCount: assignments.itemCount,
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

  const summary: FullCollectSummary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    courseCount: courseList.courseCount,
    concurrency,
    successCount: results.filter((result) => result.ok).length,
    failureCount: results.filter((result) => !result.ok).length,
    jsonPath: collectorPaths.fullCollectSummaryJson,
    courses: results,
  }

  await writeJsonFile(summary.jsonPath, summary)
  await writeJsonFile(collectorPaths.moduleIndexJson, {
    collectedAt: summary.finishedAt,
    courseCount: courseList.courseCount,
    courses: courseList.courses,
  })

  return summary
}

async function collectCoursePayloads(modules: CourseModuleUrls): Promise<{
  materials: MaterialListSnapshot
  notices: NoticeListSnapshot
  assignments: AssignmentListSnapshot
}> {
  const apiContext = await createRequestContext()

  try {
    const [materials, notices, assignments] = await Promise.all([
      collectMaterialSnapshot(apiContext, modules),
      collectNoticeSnapshot(apiContext, modules),
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
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  modules: CourseModuleUrls,
): Promise<MaterialListSnapshot> {
  if (!modules.materialsUrl) {
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
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  modules: CourseModuleUrls,
): Promise<NoticeListSnapshot> {
  if (!modules.noticesUrl) {
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

  const fetch = await fetchHtml(apiContext, modules.noticesUrl, `notice-list-${modules.courseId}`)
  const items = extractNotices(fetch.bodyText, fetch.finalUrl)
  await fillNoticeDetails(apiContext, items)

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

async function collectAssignmentSnapshot(
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  modules: CourseModuleUrls,
): Promise<AssignmentListSnapshot> {
  if (!modules.assignmentsUrl) {
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
