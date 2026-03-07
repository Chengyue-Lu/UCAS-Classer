import type { Browser } from '@playwright/test'
import { launchBrowser } from '../auth/browser.js'
import { assertAuthenticatedPage, ensureStorageStateFile } from './session.js'
import { resolveNoticeListJson } from './paths.js'
import type {
  CourseModuleUrls,
  NoticeListSnapshot,
  NoticeSummary,
} from './types.js'
import {
  closeQuietly,
  createAuthenticatedContext,
  gotoSettled,
  normalizeText,
  writeJsonFile,
  writePageArtifacts,
} from './utils.js'

export async function collectNoticeList(
  modules: CourseModuleUrls,
  options?: {
    browser?: Browser
    headed?: boolean
  },
): Promise<NoticeListSnapshot> {
  await ensureStorageStateFile()

  const launched = options?.browser
    ? null
    : await launchBrowser(!options?.headed)
  const browser = options?.browser ?? launched!.browser
  const browserChannel = launched?.browserChannel ?? 'Shared browser'

  if (!modules.noticesUrl) {
    const snapshot = createEmptySnapshot(modules, browserChannel)
    await writeJsonFile(snapshot.jsonPath, snapshot)
    return snapshot
  }

  const context = await createAuthenticatedContext(browser)
  const page = await context.newPage()

  try {
    await gotoSettled(page, modules.noticesUrl)
    await assertAuthenticatedPage(page, modules.noticesUrl)
    await page.waitForSelector('h3.noticeTitle, #noticeContent', { timeout: 15_000 })

    const items = await page.evaluate(function () {
      const container = document.querySelector('#noticeContent')
      if (!container) {
        return []
      }

      const directChildren = Array.from(container.children).filter(function (node) {
        return node.tagName !== 'INPUT'
      })

      const candidates =
        directChildren.length === 1 &&
        ['UL', 'OL', 'DIV'].includes(directChildren[0].tagName)
          ? Array.from(directChildren[0].children)
          : directChildren

      const result = []

      for (const node of candidates) {
        const rawText = (node.textContent || '').replace(/\s+/g, ' ').trim()
        if (!rawText) {
          continue
        }

        const anchor = node.querySelector('a[href]')
        const href = anchor ? anchor.getAttribute('href') : null
        const detailUrl = href
          ? new URL(href, window.location.origin).toString()
          : null
        const titleAttr = anchor ? anchor.getAttribute('title') || '' : ''
        const anchorText = anchor ? (anchor.textContent || '').replace(/\s+/g, ' ').trim() : ''
        const dates =
          rawText.match(
            /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}(?:\s+\d{1,2}:\d{2})?/g,
          ) || []
        const title =
          titleAttr.replace(/\s+/g, ' ').trim() ||
          anchorText ||
          rawText.split(/\s{2,}/)[0] ||
          rawText

        if (title && rawText) {
          result.push({
            title: title,
            detailUrl: detailUrl,
            publishedAt: dates[0] || null,
            publisher: null,
            rawText: rawText,
          })
        }
      }

      return result
    })

    const artifacts = await writePageArtifacts(page, `notice-list-${modules.courseId}`)
    const snapshot: NoticeListSnapshot = {
      collectedAt: new Date().toISOString(),
      browserChannel,
      courseId: modules.courseId,
      courseName: modules.name,
      checkedUrl: modules.noticesUrl,
      currentUrl: page.url(),
      pageTitle: await page.title(),
      itemCount: items.length,
      htmlPath: artifacts.htmlPath,
      screenshotPath: artifacts.screenshotPath,
      jsonPath: resolveNoticeListJson(modules.courseId),
      items: normalizeNotices(items),
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
): NoticeListSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    browserChannel,
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.noticesUrl ?? modules.courseHomeUrl,
    currentUrl: modules.courseHomeUrl,
    pageTitle: modules.pageTitle,
    itemCount: 0,
    htmlPath: '',
    screenshotPath: '',
    jsonPath: resolveNoticeListJson(modules.courseId),
    items: [],
  }
}

function normalizeNotices(items: NoticeSummary[]): NoticeSummary[] {
  const seen = new Set<string>()

  return items.filter((item) => {
    item.title = normalizeText(item.title)
    item.rawText = normalizeText(item.rawText)
    item.publishedAt = item.publishedAt ? normalizeText(item.publishedAt) : null
    if (item.detailUrl?.startsWith('javascript:')) {
      item.detailUrl = null
    }

    if (!item.title || !item.rawText) {
      return false
    }

    const key = `${item.title}|${item.publishedAt ?? ''}|${item.detailUrl ?? ''}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
