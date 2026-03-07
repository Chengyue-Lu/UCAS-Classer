import type { Browser } from '@playwright/test'
import { launchBrowser } from '../auth/browser.js'
import { assertAuthenticatedPage, ensureStorageStateFile } from './session.js'
import { resolveCourseModuleJson } from './paths.js'
import type { CourseModuleUrls, CourseSummary } from './types.js'
import {
  closeQuietly,
  createAuthenticatedContext,
  gotoSettled,
  normalizeText,
  writeJsonFile,
  writePageArtifacts,
} from './utils.js'

export async function collectCourseModuleUrls(
  course: CourseSummary,
  options?: {
    browser?: Browser
    headed?: boolean
  },
): Promise<CourseModuleUrls> {
  await ensureStorageStateFile()

  const launched = options?.browser
    ? null
    : await launchBrowser(!options?.headed)
  const browser = options?.browser ?? launched!.browser
  const browserChannel = launched?.browserChannel ?? 'Shared browser'
  const context = await createAuthenticatedContext(browser)
  const page = await context.newPage()

  try {
    await gotoSettled(page, course.courseUrl)
    await assertAuthenticatedPage(page, course.courseUrl)
    await page.waitForSelector('a[title]', { timeout: 15_000 })

    const moduleUrls = await page.$$eval('a[title]', function (nodes) {
      let materialsUrl = null
      let noticesUrl = null
      let assignmentsUrl = null

      for (const node of nodes) {
        const title = node.getAttribute('title') || ''
        const text = node.textContent || ''
        const href = node.getAttribute('href')
        const data = node.getAttribute('data')

        if (!materialsUrl && (title.includes('资料') || text.includes('资料'))) {
          const value = href || data
          materialsUrl = value
            ? new URL(value, window.location.origin).toString()
            : null
        }

        if (!noticesUrl && (title.includes('通知') || text.includes('通知'))) {
          const value = href || data
          noticesUrl = value
            ? new URL(value, window.location.origin).toString()
            : null
        }

        if (!assignmentsUrl && (title.includes('作业') || text.includes('作业'))) {
          const value = data || href
          assignmentsUrl = value
            ? new URL(value, window.location.origin).toString()
            : null
        }
      }

      return {
        courseHomeUrl: window.location.href,
        pageTitle: document.title,
        materialsUrl: materialsUrl,
        noticesUrl: noticesUrl,
        assignmentsUrl: assignmentsUrl,
      }
    })

    const artifacts = await writePageArtifacts(page, `course-module-${course.courseId}`)
    const snapshot: CourseModuleUrls = {
      collectedAt: new Date().toISOString(),
      browserChannel,
      courseId: course.courseId,
      clazzId: course.clazzId,
      cpi: course.cpi,
      ckenc: course.ckenc,
      name: course.name,
      teacher: course.teacher,
      courseUrl: course.courseUrl,
      courseHomeUrl: moduleUrls.courseHomeUrl,
      pageTitle: normalizeText(moduleUrls.pageTitle),
      materialsUrl: moduleUrls.materialsUrl,
      noticesUrl: moduleUrls.noticesUrl,
      assignmentsUrl: moduleUrls.assignmentsUrl,
      htmlPath: artifacts.htmlPath,
      screenshotPath: artifacts.screenshotPath,
      jsonPath: resolveCourseModuleJson(course.courseId),
    }

    await writeJsonFile(snapshot.jsonPath, snapshot)
    return snapshot
  } finally {
    await closeQuietly(context, page)
    await launched?.browser.close().catch(() => {})
  }
}
