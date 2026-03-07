import type { Browser } from '@playwright/test'
import { launchBrowser } from '../auth/browser.js'
import { assertAuthenticatedPage, ensureStorageStateFile } from './session.js'
import { resolveAssignmentListJson } from './paths.js'
import type {
  AssignmentListSnapshot,
  AssignmentSummary,
  CourseModuleUrls,
} from './types.js'
import {
  closeQuietly,
  createAuthenticatedContext,
  gotoSettled,
  normalizeText,
  writeJsonFile,
  writePageArtifacts,
} from './utils.js'

export async function collectAssignmentList(
  modules: CourseModuleUrls,
  options?: {
    browser?: Browser
    headed?: boolean
  },
): Promise<AssignmentListSnapshot> {
  await ensureStorageStateFile()

  const launched = options?.browser
    ? null
    : await launchBrowser(!options?.headed)
  const browser = options?.browser ?? launched!.browser
  const browserChannel = launched?.browserChannel ?? 'Shared browser'

  if (!modules.assignmentsUrl) {
    const snapshot = createEmptySnapshot(modules, browserChannel)
    await writeJsonFile(snapshot.jsonPath, snapshot)
    return snapshot
  }

  const context = await createAuthenticatedContext(browser)
  const page = await context.newPage()

  try {
    await gotoSettled(page, modules.assignmentsUrl)
    await assertAuthenticatedPage(page, modules.assignmentsUrl)
    await page.waitForSelector('.CyTop, .ulDiv, #CyList', { timeout: 15_000 })

    const items = await page.evaluate(function () {
      const bodyText = (document.body.textContent || '').replace(/\s+/g, ' ').trim()
      if (bodyText.includes('请输入验证码') || bodyText.includes('看不清')) {
        return []
      }

      const list = document.querySelector('#CyList')
      if (!list) {
        return []
      }

      const result = []
      const items = Array.from(list.querySelectorAll(':scope > li'))

      for (const item of items) {
        const rawText = (item.textContent || '').replace(/\s+/g, ' ').trim()
        if (!rawText) {
          continue
        }

        const links = Array.from(item.querySelectorAll('a[href]'))
        const detailLink = links.find(function (link) {
          const href = link.getAttribute('href') || ''
          return href && !href.startsWith('javascript:')
        })
        const titleNode = item.querySelector('h3 a, .titTxt a, .titTxt, h3, p')
        const dates =
          rawText.match(
            /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?/g,
          ) || []
        const titleText = titleNode
          ? (titleNode.textContent || '').replace(/\s+/g, ' ').trim()
          : ''
        const href = detailLink ? detailLink.getAttribute('href') : null

        result.push({
          title: titleText || rawText.split(/\s{2,}/)[0] || rawText,
          workUrl: href ? new URL(href, window.location.origin).toString() : null,
          status: null,
          startTime: dates[0] || null,
          endTime: dates[1] || null,
          rawText: rawText,
        })
      }

      return result
    })

    const artifacts = await writePageArtifacts(page, `assignment-list-${modules.courseId}`)
    const snapshot: AssignmentListSnapshot = {
      collectedAt: new Date().toISOString(),
      browserChannel,
      courseId: modules.courseId,
      courseName: modules.name,
      checkedUrl: modules.assignmentsUrl,
      currentUrl: page.url(),
      pageTitle: await page.title(),
      itemCount: items.length,
      htmlPath: artifacts.htmlPath,
      screenshotPath: artifacts.screenshotPath,
      jsonPath: resolveAssignmentListJson(modules.courseId),
      items: normalizeAssignments(items),
    }

    await writeJsonFile(snapshot.jsonPath, snapshot)
    return snapshot
  } finally {
    await closeQuietly(context, page)
    await launched?.browser.close().catch(() => {})
  }
}

function createEmptySnapshot(
  modules: CourseModuleUrls,
  browserChannel: string,
): AssignmentListSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    browserChannel,
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.assignmentsUrl ?? modules.courseHomeUrl,
    currentUrl: modules.courseHomeUrl,
    pageTitle: modules.pageTitle,
    itemCount: 0,
    htmlPath: '',
    screenshotPath: '',
    jsonPath: resolveAssignmentListJson(modules.courseId),
    items: [],
  }
}

function normalizeAssignments(items: AssignmentSummary[]): AssignmentSummary[] {
  const seen = new Set<string>()

  return items.filter((item) => {
    item.title = normalizeText(item.title)
    item.rawText = normalizeText(item.rawText)
    item.startTime = item.startTime ? normalizeText(item.startTime) : null
    item.endTime = item.endTime ? normalizeText(item.endTime) : null

    if (!item.title || !item.rawText) {
      return false
    }

    const key = `${item.title}|${item.workUrl ?? ''}|${item.startTime ?? ''}|${item.endTime ?? ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
