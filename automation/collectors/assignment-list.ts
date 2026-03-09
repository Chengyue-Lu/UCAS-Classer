import type { Browser } from '@playwright/test'
import { launchBrowser } from '../auth/browser.js'
import { resolveAssignmentListJson } from './paths.js'
import { assertAuthenticatedPage, ensureStorageStateFile } from './session.js'
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
      const hasCaptcha =
        bodyText.includes('请输入验证码') ||
        bodyText.includes('看不清') ||
        Boolean(
          document.querySelector(
            'input[name*="captcha"], input[id*="captcha"], img[src*="captcha"], #numVerCode, .yzmImg',
          ),
        )

      if (hasCaptcha) {
        return []
      }

      const list = document.querySelector('#CyList')
      const nodes = list
        ? Array.from(list.querySelectorAll(':scope > li'))
        : Array.from(document.querySelectorAll('.ulDiv ul > li.lookLi, .ulDiv ul > li'))

      if (nodes.length === 0) {
        return []
      }

      const result = []

      for (const item of nodes) {
        const rawText = (item.textContent || '').replace(/\s+/g, ' ').trim()
        if (!rawText) {
          continue
        }

        const links = Array.from(item.querySelectorAll('a[href]'))
        const detailLink = links.find(function (link) {
          const href = link.getAttribute('href') || ''
          return href && !href.startsWith('javascript:')
        })
        const titleAnchor = item.querySelector('.titTxt a[title], .titTxt a, h3 a')
        const titleNode = item.querySelector('.titTxt p, h3, .titTxt, p')
        const statusNode = item.querySelector('.titTxt strong, .status, .state')
        const dates =
          rawText.match(
            /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?/g,
          ) || []
        const titleText = (
          titleAnchor?.getAttribute('title') ||
          titleAnchor?.textContent ||
          titleNode?.textContent ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim()
        const href = detailLink ? detailLink.getAttribute('href') : null
        const statusText = statusNode
          ? (statusNode.textContent || '').replace(/\s+/g, ' ').trim()
          : null

        result.push({
          title: titleText || rawText.split(/\s{2,}/)[0] || rawText,
          workUrl: href ? new URL(href, window.location.origin).toString() : null,
          status: statusText,
          startTime: dates[0] || null,
          endTime: dates[1] || null,
          rawText,
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
    item.status = item.status ? normalizeText(item.status) : null
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
