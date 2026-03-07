import type { Browser } from '@playwright/test'
import { launchBrowser } from '../auth/browser.js'
import { assertAuthenticatedPage, ensureStorageStateFile } from './session.js'
import { resolveMaterialListJson } from './paths.js'
import type {
  CourseModuleUrls,
  MaterialListSnapshot,
  MaterialSummary,
} from './types.js'
import {
  closeQuietly,
  createAuthenticatedContext,
  gotoSettled,
  normalizeText,
  writeJsonFile,
  writePageArtifacts,
} from './utils.js'

export async function collectMaterialList(
  modules: CourseModuleUrls,
  options?: {
    browser?: Browser
    headed?: boolean
  },
): Promise<MaterialListSnapshot> {
  await ensureStorageStateFile()

  const launched = options?.browser
    ? null
    : await launchBrowser(!options?.headed)
  const browser = options?.browser ?? launched!.browser
  const browserChannel = launched?.browserChannel ?? 'Shared browser'

  if (!modules.materialsUrl) {
    const snapshot = createEmptySnapshot(modules, browserChannel)
    await writeJsonFile(snapshot.jsonPath, snapshot)
    return snapshot
  }

  const context = await createAuthenticatedContext(browser)
  const page = await context.newPage()

  try {
    await gotoSettled(page, modules.materialsUrl)
    await assertAuthenticatedPage(page, modules.materialsUrl)
    await page.waitForSelector('#zlTable', { timeout: 15_000 })

    const items = await page.$$eval('#zlTable tr[type][id]', (rows) =>
      rows.map((row) => {
        const cells = Array.from(row.querySelectorAll('td'))
        const nameAnchor = row.querySelector('a[name]') as HTMLAnchorElement | null
        const downloadAnchor = row.querySelector(
          'a.download',
        ) as HTMLAnchorElement | null
        const readTrigger = row.querySelector('a.read') as HTMLAnchorElement | null

        return {
          dataId: row.id,
          name:
            nameAnchor?.getAttribute('title')?.trim() ??
            nameAnchor?.textContent?.trim() ??
            '',
          type: row.getAttribute('type'),
          objectId: row.getAttribute('objectid'),
          uploader: cells[2]?.textContent?.trim() || null,
          size: cells[3]?.textContent?.trim() || null,
          createdAt: cells[4]?.textContent?.trim() || null,
          downloadUrl: downloadAnchor
            ? new URL(downloadAnchor.getAttribute('href') ?? '', window.location.origin).toString()
            : null,
          readUrl: readTrigger?.getAttribute('onclick') ?? null,
          source: row.getAttribute('source'),
        }
      }),
    )

    const artifacts = await writePageArtifacts(page, `material-list-${modules.courseId}`)
    const snapshot: MaterialListSnapshot = {
      collectedAt: new Date().toISOString(),
      browserChannel,
      courseId: modules.courseId,
      courseName: modules.name,
      checkedUrl: modules.materialsUrl,
      currentUrl: page.url(),
      pageTitle: await page.title(),
      itemCount: items.length,
      htmlPath: artifacts.htmlPath,
      screenshotPath: artifacts.screenshotPath,
      jsonPath: resolveMaterialListJson(modules.courseId),
      items: normalizeMaterials(items),
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
): MaterialListSnapshot {
  return {
    collectedAt: new Date().toISOString(),
    browserChannel,
    courseId: modules.courseId,
    courseName: modules.name,
    checkedUrl: modules.materialsUrl ?? modules.courseHomeUrl,
    currentUrl: modules.courseHomeUrl,
    pageTitle: modules.pageTitle,
    itemCount: 0,
    htmlPath: '',
    screenshotPath: '',
    jsonPath: resolveMaterialListJson(modules.courseId),
    items: [],
  }
}

function normalizeMaterials(items: MaterialSummary[]): MaterialSummary[] {
  return items
    .map((item) => ({
      ...item,
      name: normalizeText(item.name),
      uploader: item.uploader ? normalizeText(item.uploader) : null,
      size: item.size ? normalizeText(item.size) : null,
      createdAt: item.createdAt ? normalizeText(item.createdAt) : null,
    }))
    .filter((item) => item.dataId && item.name)
}
