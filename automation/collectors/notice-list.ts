import type { Browser, BrowserContext } from '@playwright/test'
import { launchBrowser } from '../auth/browser.js'
import { assertAuthenticatedPage, ensureStorageStateFile } from './session.js'
import { resolveNoticeListJson } from './paths.js'
import type {
  CourseModuleUrls,
  NoticeAttachment,
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

type RawNoticeItem = {
  noticeId: string | null
  noticeEnc: string | null
  title: string
  publishedAt: string | null
  publisher: string | null
  rawText: string
  detailUrl: string | null
}

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
    await page.waitForFunction(
      () => {
        const container = document.querySelector('#noticeContent')
        if (!container) {
          return false
        }

        return (
          container.querySelector('li .noticeTop') !== null ||
          container.querySelector('input[name="moreNotice"]') !== null ||
          container.querySelector('input[name="lastIdBack"]') !== null
        )
      },
      undefined,
      { timeout: 15_000 },
    )

    const items = await page.evaluate(function () {
      const container = document.querySelector('#noticeContent')
      if (!container) {
        return []
      }

      return Array.from(container.querySelectorAll('li')).map((node) => {
        const root = node.querySelector('.noticeTop') as HTMLElement | null
        const titleAnchor = node.querySelector('h3 a') as HTMLAnchorElement | null
        const detailCall = root?.getAttribute('onclick') ?? ''
        const match = detailCall.match(
          /showUserListdetail\('([^']+)','([^']+)',(\d+),(\d+),'([^']+)',(\d+),'([^']+)'\)/,
        )

        let detailUrl = null
        if (match) {
          const [, noticeEnc, noticeId, courseId, classId, openc, cpi, ut] = match
          detailUrl = new URL(
            `/mooc-ans/schoolCourseInfo/getNoticeUserList?noticeId=${noticeId}&courseId=${courseId}&classId=${classId}&cpi=${cpi}&ut=${ut}&openc=${openc}&noticeEnc=${noticeEnc}`,
            window.location.origin,
          ).toString()
        }

        const paragraphs = Array.from(node.querySelectorAll('p'))
        const publishedAt =
          paragraphs
            .find((item) => item.textContent?.includes('发布时间'))
            ?.textContent?.replace(/\s+/g, ' ')
            .split('：')
            .pop()
            ?.trim() ?? null
        const publisher =
          paragraphs
            .find(
              (item) =>
                item.textContent?.includes('发布人') ||
                item.textContent?.includes('发送人'),
            )
            ?.textContent?.replace(/\s+/g, ' ')
            .split('：')
            .pop()
            ?.trim() ?? null

        return {
          noticeId: match?.[2] ?? null,
          noticeEnc: match?.[1] ?? null,
          title:
            titleAnchor?.getAttribute('title')?.trim() ??
            titleAnchor?.textContent?.trim() ??
            '',
          publishedAt,
          publisher,
          rawText: (node.textContent || '').replace(/\s+/g, ' ').trim(),
          detailUrl,
        }
      })
    })

    const normalizedItems = normalizeNotices(items)
    const enrichedItems: NoticeSummary[] = []

    for (const item of normalizedItems) {
      const detail = item.detailUrl
        ? await collectNoticeDetail(context, item.detailUrl)
        : null

      enrichedItems.push({
        ...item,
        detailText: detail?.detailText ?? null,
        detailHtml: detail?.detailHtml ?? null,
        detailCollectedAt: detail?.detailCollectedAt ?? null,
        attachments: detail?.attachments ?? [],
      })
    }

    const artifacts = await writePageArtifacts(page, `notice-list-${modules.courseId}`)
    const snapshot: NoticeListSnapshot = {
      collectedAt: new Date().toISOString(),
      browserChannel,
      courseId: modules.courseId,
      courseName: modules.name,
      checkedUrl: modules.noticesUrl,
      currentUrl: page.url(),
      pageTitle: await page.title(),
      itemCount: enrichedItems.length,
      htmlPath: artifacts.htmlPath,
      screenshotPath: artifacts.screenshotPath,
      jsonPath: resolveNoticeListJson(modules.courseId),
      items: enrichedItems,
    }

    await writeJsonFile(snapshot.jsonPath, snapshot)
    return snapshot
  } finally {
    await closeQuietly(context, page)
    await launched?.browser.close().catch(() => {})
  }
}

async function collectNoticeDetail(
  context: BrowserContext,
  detailUrl: string,
): Promise<{
  detailText: string | null
  detailHtml: string | null
  detailCollectedAt: string
  attachments: NoticeAttachment[]
} | null> {
  const page = await context.newPage()

  try {
    await gotoSettled(page, detailUrl)
    await assertAuthenticatedPage(page, detailUrl)
    await page.waitForSelector('#contentNotice, body', { timeout: 15_000 })

    return await page.evaluate(() => {
      const content = document.querySelector('#contentNotice') as HTMLElement | null
      const detailText = (content?.textContent || '').replace(/\s+/g, ' ').trim() || null
      const detailHtml = content?.innerHTML?.trim() || null
      const attachmentNodes = Array.from(
        document.querySelectorAll(
          '.noticeAttachment a[href], .oneAttachment a[href], .attachmentHref[href], .img_area a[href]',
        ),
      ) as HTMLAnchorElement[]

      const seen = new Set<string>()
      const attachments = attachmentNodes
        .map((anchor) => {
          const href = anchor.getAttribute('href') || ''
          if (!href || href.startsWith('javascript:')) {
            return null
          }

          const url = new URL(href, window.location.origin).toString()
          if (seen.has(url)) {
            return null
          }
          seen.add(url)

          return {
            name:
              (anchor.getAttribute('title') || '').trim() ||
              (anchor.textContent || '').replace(/\s+/g, ' ').trim() ||
              url.split('/').pop() ||
              url,
            url,
          }
        })
        .filter((item): item is { name: string; url: string } => item !== null)

      return {
        detailText,
        detailHtml,
        detailCollectedAt: new Date().toISOString(),
        attachments,
      }
    })
  } catch {
    return null
  } finally {
    await page.close().catch(() => {})
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

function normalizeNotices(items: RawNoticeItem[]): NoticeSummary[] {
  const seen = new Set<string>()

  return items
    .map((item) => ({
      noticeId: normalizeText(item.noticeId) || `${normalizeText(item.title)}|${normalizeText(item.publishedAt)}`,
      noticeEnc: item.noticeEnc ? normalizeText(item.noticeEnc) : null,
      title: normalizeText(item.title),
      detailUrl: item.detailUrl?.startsWith('javascript:') ? null : item.detailUrl,
      publishedAt: item.publishedAt ? normalizeText(item.publishedAt) : null,
      publisher: item.publisher ? normalizeText(item.publisher) : null,
      rawText: normalizeText(item.rawText),
      detailText: null,
      detailHtml: null,
      detailCollectedAt: null,
      attachments: [],
    }))
    .filter((item) => {
      if (!item.title || !item.rawText) {
        return false
      }

      const key = `${item.noticeId}|${item.title}|${item.publishedAt ?? ''}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
}
