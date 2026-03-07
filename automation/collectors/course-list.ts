import { writeFile } from 'node:fs/promises'
import { courseListUrl } from '../auth/config.js'
import { collectorPaths, ensureCollectorDirs } from './paths.js'
import { assertAuthenticatedPage, openAuthenticatedPage } from './session.js'
import type { CourseListSnapshot, CourseSummary } from './types.js'

export async function collectCourseList(options?: {
  headed?: boolean
}): Promise<CourseListSnapshot> {
  await ensureCollectorDirs()

  const session = await openAuthenticatedPage({
    url: courseListUrl,
    headed: options?.headed,
  })

  try {
    await assertAuthenticatedPage(session.page, courseListUrl)
    await session.page.waitForSelector('#stuCourseList ul.course-list', {
      timeout: 15_000,
    })

    const courses = await session.page.$$eval(
      '#stuCourseList > ul.course-list > li.w_couritem.clearfix',
      (items) =>
        items.map((item) => {
          const href =
            item.querySelector<HTMLAnchorElement>('a.color1, a.zoutline')?.href ??
            ''
          const url = href ? new URL(href, window.location.origin) : null
          const teacherText =
            item.querySelector<HTMLElement>('p.line2.color3')?.innerText ?? ''
          const nameText =
            item.querySelector<HTMLElement>('span.course-name')?.innerText ?? ''

          return {
            courseId: item.getAttribute('cid') ?? '',
            clazzId: item.getAttribute('classid') ?? '',
            cpi: item.getAttribute('personid') ?? '',
            ckenc: item.getAttribute('ckenc') ?? '',
            courseUrl: url?.toString() ?? href,
            role: url?.searchParams.get('role') ?? null,
            name: nameText.trim(),
            teacher: teacherText.trim() || null,
            state: item.getAttribute('state'),
            source: item.getAttribute('source'),
            kcenc: item.getAttribute('kcenc'),
            clazzenc: item.getAttribute('clazzenc'),
          }
        }),
    )

    const currentUrl = session.page.url()
    const pageTitle = await session.page.title()
    const html = await session.page.content()

    await writeFile(collectorPaths.courseListHtml, html, 'utf8')
    await session.page.screenshot({
      path: collectorPaths.courseListScreenshot,
      fullPage: true,
    })

    const snapshot: CourseListSnapshot = {
      collectedAt: new Date().toISOString(),
      browserChannel: session.browserChannel,
      checkedUrl: courseListUrl,
      currentUrl,
      pageTitle,
      authenticated: true,
      courseCount: courses.length,
      htmlPath: collectorPaths.courseListHtml,
      screenshotPath: collectorPaths.courseListScreenshot,
      jsonPath: collectorPaths.courseListJson,
      courses: normalizeCourses(courses),
    }

    await writeFile(
      collectorPaths.courseListJson,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8',
    )

    return snapshot
  } finally {
    await session.context.close()
    await session.browser.close()
  }
}

function normalizeCourses(courses: CourseSummary[]): CourseSummary[] {
  return courses
    .filter(
      (course) =>
        course.courseId &&
        course.clazzId &&
        course.cpi &&
        course.ckenc &&
        course.name,
    )
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
}
