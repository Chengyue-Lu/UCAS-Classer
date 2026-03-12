import { writeFile } from 'node:fs/promises'
import { courseListUrl } from '../auth/config.js'
import { collectorPaths, ensureCollectorDirs } from '../shared/cache-paths.js'
import type {
  CourseListSnapshot,
  CourseSummary,
  SemesterOptionSummary,
} from '../shared/collector-types.js'
import { createRequestContext, fetchHtml, normalizeText } from '../request-collectors/common.js'

export async function collectCourseListByRequest(): Promise<CourseListSnapshot> {
  await ensureCollectorDirs()

  const apiContext = await createRequestContext()

  try {
    const fetch = await fetchHtml(apiContext, courseListUrl, 'course-list')
    if (!fetch.ok || fetch.loginLike) {
      throw new Error(`Failed to fetch course list page: ${fetch.status} ${fetch.finalUrl}`)
    }

    const semesterOptions = extractSemesterOptions(fetch.bodyText)
    const currentSectionId = extractCurrentSectionId(fetch.bodyText)
    const currentSemesterNum =
      extractCurrentSemesterNum(fetch.bodyText) ??
      semesterOptions.find((item) => item.selected)?.semesterNum ??
      null
    const currentSemesterLabel =
      semesterOptions.find((item) => item.selected)?.label ?? null

    const allCourses = normalizeCourses(
      await fetchStudyCoursesBySection(apiContext, '0', null),
    )
    const currentCourses =
      currentSectionId && currentSectionId !== '0'
        ? normalizeCourses(
            await fetchStudyCoursesBySection(apiContext, currentSectionId, currentSemesterLabel),
          )
        : []
    const currentKeys = new Set(currentCourses.map(getCourseKey))

    const courses: CourseSummary[] = allCourses.map((course) => ({
      ...course,
      termCategory:
        currentKeys.size === 0
          ? null
          : currentKeys.has(getCourseKey(course))
            ? 'current'
            : 'past',
    }))

    const pastCourses =
      currentKeys.size === 0
        ? []
        : courses.filter((course) => course.termCategory === 'past')

    await writeFile(collectorPaths.courseListHtml, fetch.bodyText, 'utf8')

    const snapshot: CourseListSnapshot = {
      collectedAt: new Date().toISOString(),
      browserChannel: 'Request context',
      checkedUrl: courseListUrl,
      currentUrl: fetch.finalUrl,
      pageTitle: fetch.title ?? '',
      authenticated: true,
      courseCount: courses.length,
      htmlPath: collectorPaths.courseListHtml,
      screenshotPath: '',
      jsonPath: collectorPaths.courseListJson,
      courses,
      currentSectionId,
      currentSemesterNum,
      currentSemesterLabel,
      semesterOptions,
      currentCourses,
      pastCourses,
      currentTermCourseCount: currentCourses.length,
      pastTermCourseCount: pastCourses.length,
    }

    await writeFile(
      collectorPaths.courseListJson,
      `${JSON.stringify(snapshot, null, 2)}\n`,
      'utf8',
    )

    return snapshot
  } finally {
    await apiContext.dispose()
  }
}

async function fetchStudyCoursesBySection(
  apiContext: Awaited<ReturnType<typeof createRequestContext>>,
  sectionId: string,
  currentSemesterLabel: string | null,
): Promise<CourseSummary[]> {
  const url = new URL('https://mooc.ucas.edu.cn/fyportal/courselist/getStudyCourse')
  url.searchParams.set('sectionId', sectionId)
  url.searchParams.set('semesterNum', '')
  url.searchParams.set('coursesource', '0')
  url.searchParams.set('coursename', '')
  url.searchParams.set('searchkkstatus', '0')
  url.searchParams.set('belongSchoolId', '0')
  url.searchParams.set('_', `${Date.now()}`)

  const response = await apiContext.get(url.toString(), {
    failOnStatusCode: false,
    timeout: 60_000,
  })
  const bodyText = await response.text()
  if (!response.ok()) {
    throw new Error(`getStudyCourse failed for sectionId=${sectionId}: ${response.status()}`)
  }

  return extractCourses(bodyText, courseListUrl).map((course): CourseSummary => ({
    ...course,
    termCategory: currentSemesterLabel ? 'current' : null,
  }))
}

function extractSemesterOptions(html: string): SemesterOptionSummary[] {
  const selectMatch = html.match(/<select name="xq"[\s\S]*?>([\s\S]*?)<\/select>/i)
  if (!selectMatch) {
    return []
  }

  return Array.from(selectMatch[1].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)).map((match) => {
    const attrs = match[1]
    return {
      value: matchAttribute(attrs, 'value') ?? '',
      semesterNum: matchAttribute(attrs, 'semesternum'),
      label: normalizeText(match[2]),
      selected: /\bselected\b/i.test(attrs),
    }
  })
}

function extractCurrentSectionId(html: string): string | null {
  return html.match(/\bsectionid="([^"]*)"/i)?.[1] ?? null
}

function extractCurrentSemesterNum(html: string): string | null {
  return html.match(/\bsemesternum="([^"]*)"/i)?.[1] ?? null
}

function extractCourses(html: string, baseUrl: string): CourseSummary[] {
  return Array.from(
    html.matchAll(
      /<li class="w_couritem clearfix"([^>]*)>([\s\S]*?)<div class="course-info">([\s\S]*?)<\/div>\s*<\/li>/gi,
    ),
  ).map((match) => {
    const attrs = match[1]
    const body = `${match[2]}${match[3]}`
    const href =
      matchAttribute(body, 'href', /<a class="color1"[\s\S]*?href=['"]([^'"]+)['"]/i) ??
      matchAttribute(body, 'href', /<a class="zoutline"[\s\S]*?href=['"]([^'"]+)['"]/i) ??
      ''
    const url = resolveUrl(href, baseUrl)
    const teacherText = normalizeText(
      body.match(/<p class="line2 color3">([\s\S]*?)<\/p>/i)?.[1] ?? null,
    )
    const nameText =
      matchAttribute(attrs, 'cname') ??
      normalizeText(
        body.match(/<span class="course-name[^"]*">([\s\S]*?)<\/span>/i)?.[1] ?? null,
      )

    return {
      courseId: matchAttribute(attrs, 'cid') ?? '',
      clazzId: matchAttribute(attrs, 'classid') ?? '',
      cpi: matchAttribute(attrs, 'personid') ?? '',
      ckenc: matchAttribute(attrs, 'ckenc') ?? '',
      courseUrl: url,
      role: url ? new URL(url).searchParams.get('role') : null,
      name: nameText.trim(),
      teacher: teacherText || null,
      state: matchAttribute(attrs, 'state'),
      source: matchAttribute(attrs, 'source'),
      kcenc: matchAttribute(attrs, 'kcenc'),
      clazzenc: matchAttribute(attrs, 'clazzenc'),
      termCategory: null,
    }
  })
}

function matchAttribute(source: string, name: string, fallback?: RegExp): string | null {
  const direct = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(source)?.[1]
  if (direct != null) {
    return decodeHtml(direct).trim() || null
  }

  const matched = fallback?.exec(source)?.[1] ?? null
  return matched ? decodeHtml(matched).trim() || null : null
}

function resolveUrl(value: string | null | undefined, baseUrl: string): string {
  if (!value) {
    return ''
  }

  try {
    return new URL(decodeHtml(value), baseUrl).toString()
  } catch {
    return decodeHtml(value)
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
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

function getCourseKey(course: Pick<CourseSummary, 'courseId' | 'clazzId'>): string {
  return `${course.courseId}|${course.clazzId}`
}
