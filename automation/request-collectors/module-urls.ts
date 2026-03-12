import { request } from '@playwright/test'
import { resolveCourseModuleJson } from '../shared/cache-paths.js'
import type { CourseModuleUrls, CourseSummary } from '../shared/collector-types.js'
import { writeJsonFile } from '../shared/cache-utils.js'
import { createRequestContext, fetchHtml, resolveModuleUrlsFromHtml } from './common.js'

export async function collectCourseModuleUrlsByRequest(course: CourseSummary): Promise<CourseModuleUrls> {
  const apiContext = await createRequestContext()

  try {
    const fetch = await fetchHtml(apiContext, course.courseUrl, `course-module-${course.courseId}`)
    const resolved = resolveModuleUrlsFromHtml(course, fetch.finalUrl, fetch.bodyText)

    const snapshot: CourseModuleUrls = {
      collectedAt: new Date().toISOString(),
      browserChannel: 'Request context',
      ...resolved,
      htmlPath: fetch.htmlPath,
      screenshotPath: '',
      jsonPath: resolveCourseModuleJson(course.courseId),
    }

    await writeJsonFile(snapshot.jsonPath, snapshot)
    return snapshot
  } finally {
    await apiContext.dispose()
  }
}
