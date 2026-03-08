import type { Browser, BrowserContext, Page } from '@playwright/test'
import { launchBrowser } from '../auth/browser.js'
import { assertAuthenticatedPage, ensureStorageStateFile } from './session.js'
import { resolveMaterialListJson } from './paths.js'
import type {
  CourseModuleUrls,
  MaterialListSnapshot,
  MaterialNodeSummary,
} from './types.js'
import {
  closeQuietly,
  createAuthenticatedContext,
  gotoSettled,
  normalizeText,
  writeJsonFile,
  writePageArtifacts,
} from './utils.js'

type RawMaterialRow = {
  itemIndex: number
  rowId: string | null
  dataId: string | null
  folderId: string | null
  type: string | null
  objectId: string | null
  source: string | null
  name: string
  uploader: string | null
  size: string | null
  createdAt: string | null
  downloadUrl: string | null
  readUrl: string | null
  openUrl: string | null
  loadUrl: string | null
  rowUrl: string | null
  clickHandler: string | null
  iconSrc: string | null
}

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

    const visited = new Set<string>()
    const items = await collectMaterialNodesFromPage(page, {
      context,
      courseId: modules.courseId,
      parentNodeId: null,
      parentPath: '',
      depth: 0,
      visited,
    })

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
      fileCount: items.filter((item) => item.nodeType === 'file').length,
      folderCount: items.filter((item) => item.nodeType === 'folder').length,
      htmlPath: artifacts.htmlPath,
      screenshotPath: artifacts.screenshotPath,
      jsonPath: resolveMaterialListJson(modules.courseId),
      items,
    }

    await writeJsonFile(snapshot.jsonPath, snapshot)
    return snapshot
  } finally {
    await closeQuietly(context, page)
    await launched?.browser.close().catch(() => {})
  }
}

async function collectMaterialNodesFromPage(
  page: Page,
  options: {
    context: BrowserContext
    courseId: string
    parentNodeId: string | null
    parentPath: string
    depth: number
    visited: Set<string>
  },
): Promise<MaterialNodeSummary[]> {
  const visitKey = await currentMaterialVisitKey(page)
  if (options.visited.has(visitKey)) {
    return []
  }
  options.visited.add(visitKey)

  const rows = await page.$$eval('#tableId02 tr[id]', (tableRows) =>
    tableRows.map((row, itemIndex) => {
      const cells = Array.from(row.querySelectorAll('td'))
      const nameAnchor = row.querySelector('a[name], a.srcName') as HTMLAnchorElement | null
      const downloadAnchor = row.querySelector('a.download[href]') as HTMLAnchorElement | null
      const readTrigger = row.querySelector('a.read') as HTMLAnchorElement | null
      const clickable = row.querySelector(
        'td:nth-child(2) div[onclick], td:nth-child(2) a[onclick], td:nth-child(2) a[href]',
      ) as HTMLElement | HTMLAnchorElement | null
      const icon = row.querySelector('td:nth-child(2) img') as HTMLImageElement | null
      const dataInput = row.querySelector('input[name="dataId"]') as HTMLInputElement | null
      const href =
        clickable instanceof HTMLAnchorElement
          ? clickable.getAttribute('href')
          : nameAnchor?.getAttribute('href')

      return {
        itemIndex,
        rowId: row.id || null,
        dataId: dataInput?.value || row.id || null,
        folderId: row.getAttribute('folderid') || row.id || null,
        type: row.getAttribute('type'),
        objectId: row.getAttribute('objectid'),
        source: row.getAttribute('source'),
        name:
          nameAnchor?.getAttribute('title')?.trim() ??
          nameAnchor?.textContent?.trim() ??
          '',
        uploader: cells[2]?.textContent?.trim() || null,
        size: cells[3]?.textContent?.trim() || null,
        createdAt: cells[4]?.textContent?.trim() || null,
        downloadUrl: downloadAnchor
          ? new URL(downloadAnchor.getAttribute('href') ?? '', window.location.origin).toString()
          : null,
        readUrl: readTrigger?.getAttribute('onclick') ?? null,
        openUrl:
          href && href.trim() && !href.startsWith('javascript:')
            ? new URL(href, window.location.origin).toString()
            : null,
        loadUrl: row.getAttribute('loadurl'),
        rowUrl: row.getAttribute('url'),
        clickHandler:
          clickable?.getAttribute('onclick') ??
          nameAnchor?.getAttribute('onclick') ??
          null,
        iconSrc: icon?.getAttribute('src') ?? null,
      }
    }),
  )

  const items: MaterialNodeSummary[] = []

  for (const row of rows) {
    const node = normalizeMaterialNode(row, {
      courseId: options.courseId,
      parentNodeId: options.parentNodeId,
      parentPath: options.parentPath,
      depth: options.depth,
    })

    items.push(node)

    if (node.nodeType !== 'folder') {
      continue
    }

    const childItems = await collectFolderChildren(page, row, node, options)
    items.push(...childItems)
  }

  return items
}

async function collectFolderChildren(
  page: Page,
  row: RawMaterialRow,
  node: MaterialNodeSummary,
  options: {
    context: BrowserContext
    courseId: string
    parentNodeId: string | null
    parentPath: string
    depth: number
    visited: Set<string>
  },
): Promise<MaterialNodeSummary[]> {
  const directUrl = resolveFolderUrl(row, page.url())
  if (directUrl) {
    const childPage = await options.context.newPage()
    try {
      await gotoSettled(childPage, directUrl)
      await assertAuthenticatedPage(childPage, directUrl)
      await childPage.waitForSelector('#zlTable', { timeout: 15_000 })
      return await collectMaterialNodesFromPage(childPage, {
        ...options,
        parentNodeId: node.nodeId,
        parentPath: node.path,
        depth: node.depth + 1,
      })
    } catch {
      return []
    } finally {
      await childPage.close().catch(() => {})
    }
  }

  const currentUrl = page.url()
  const beforeState = await readMaterialNavigationState(page)
  const clicked = await clickFolderRow(page, row)
  if (!clicked) {
    return []
  }

  const navigated = await waitForFolderNavigation(page, currentUrl, beforeState)
  if (!navigated) {
    return []
  }

  try {
    await assertAuthenticatedPage(page, page.url())
    await page.waitForSelector('#zlTable', { timeout: 15_000 })
    return await collectMaterialNodesFromPage(page, {
      ...options,
      parentNodeId: node.nodeId,
      parentPath: node.path,
      depth: node.depth + 1,
    })
  } catch {
    return []
  } finally {
    await gotoSettled(page, currentUrl)
    await page.waitForSelector('#zlTable', { timeout: 15_000 }).catch(() => {})
  }
}

async function currentMaterialVisitKey(page: Page): Promise<string> {
  return page.evaluate(() => {
    const dataId =
      (document.querySelector('#dataId') as HTMLInputElement | null)?.value ?? '0'
    return `${window.location.pathname}${window.location.search}|dataId=${dataId}`
  })
}

async function readMaterialNavigationState(page: Page): Promise<{
  url: string
  dataId: string
}> {
  return page.evaluate(() => ({
    url: window.location.href,
    dataId: (document.querySelector('#dataId') as HTMLInputElement | null)?.value ?? '0',
  }))
}

async function clickFolderRow(page: Page, row: RawMaterialRow): Promise<boolean> {
  const baseSelector = row.rowId
    ? `#tableId02 tr[id="${row.rowId}"]`
    : `#tableId02 tr[id]:nth-of-type(${row.itemIndex + 1})`

  const selectors = [
    `${baseSelector} td:nth-child(2) div[onclick]`,
    `${baseSelector} td:nth-child(2) a[onclick]`,
    `${baseSelector} td:nth-child(2) a[href]:not([href^="javascript"])`,
  ]

  for (const selector of selectors) {
    const target = page.locator(selector).first()
    if ((await target.count()) === 0) {
      continue
    }

    try {
      await target.click()
      return true
    } catch {
      continue
    }
  }

  return false
}

async function waitForFolderNavigation(
  page: Page,
  currentUrl: string,
  beforeState: { url: string; dataId: string },
): Promise<boolean> {
  try {
    await page.waitForFunction(
      ({ url, dataId }) => {
        const currentDataId =
          (document.querySelector('#dataId') as HTMLInputElement | null)?.value ?? '0'
        return window.location.href !== url || currentDataId !== dataId
      },
      beforeState,
      { timeout: 8_000 },
    )
    return true
  } catch {
    return page.url() !== currentUrl
  }
}

function resolveFolderUrl(row: RawMaterialRow, baseUrl: string): string | null {
  const candidates = [row.openUrl, row.loadUrl, row.rowUrl]

  for (const value of candidates) {
    if (!value) {
      continue
    }

    const trimmed = value.trim()
    if (!trimmed || trimmed.startsWith('javascript:')) {
      continue
    }

    try {
      return new URL(trimmed, baseUrl).toString()
    } catch {
      continue
    }
  }

  return null
}

function normalizeMaterialNode(
  row: RawMaterialRow,
  options: {
    courseId: string
    parentNodeId: string | null
    parentPath: string
    depth: number
  },
): MaterialNodeSummary {
  const nodeType = detectMaterialNodeType(row)
  const rawId =
    row.dataId ??
    row.folderId ??
    row.rowId ??
    `depth-${options.depth}-index-${row.itemIndex}`
  const nodeId = options.parentNodeId
    ? `${options.parentNodeId}/${rawId}`
    : `${options.courseId}:${rawId}`
  const name = normalizeText(row.name) || `未命名节点-${row.itemIndex + 1}`
  const path = options.parentPath ? `${options.parentPath}/${name}` : name

  return {
    nodeId,
    parentNodeId: options.parentNodeId,
    nodeType,
    itemIndex: row.itemIndex,
    path,
    depth: options.depth,
    dataId: row.dataId,
    folderId: nodeType === 'folder' ? row.folderId ?? row.dataId : null,
    name,
    type: row.type ? normalizeText(row.type) : null,
    objectId: row.objectId,
    uploader: row.uploader ? normalizeText(row.uploader) : null,
    size: row.size ? normalizeText(row.size) : null,
    createdAt: row.createdAt ? normalizeText(row.createdAt) : null,
    downloadUrl: row.downloadUrl,
    readUrl: row.readUrl,
    openUrl: resolveFolderUrl(row, 'http://mooc.mooc.ucas.edu.cn'),
    source: row.source,
  }
}

function detectMaterialNodeType(row: RawMaterialRow): MaterialNodeSummary['nodeType'] {
  const iconSrc = row.iconSrc?.toLowerCase() ?? ''
  const type = row.type?.toLowerCase() ?? ''

  if (iconSrc.includes('folder.gif') || type === 'folder' || type === 'dir') {
    return 'folder'
  }

  if (row.downloadUrl || row.readUrl || type) {
    return 'file'
  }

  if (row.openUrl || row.loadUrl || row.rowUrl) {
    return 'link'
  }

  return 'unknown'
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
    fileCount: 0,
    folderCount: 0,
    htmlPath: '',
    screenshotPath: '',
    jsonPath: resolveMaterialListJson(modules.courseId),
    items: [],
  }
}
