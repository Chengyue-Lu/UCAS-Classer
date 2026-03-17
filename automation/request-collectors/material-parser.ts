import type { MaterialNodeSummary } from '../shared/collector-types.js'
import {
  decodeAttribute,
  escapeRegExp,
  fetchHtml,
  matchAttributeValue,
  normalizeText,
  resolveUrl,
  type RequestApiContext,
  type RequestPageFetch,
} from './request-core.js'

// Materials are the only recursive collector domain, so their traversal and
// folder URL repair live in a dedicated module instead of the shared barrel.
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
  iconSrc: string | null
}

type MaterialPageState = {
  courseId: string
  classId: string
  enc: string
  cpi: string | null
  openc: string | null
  ut: string
  currentDataId: string
}

export async function collectRequestMaterials(
  apiContext: RequestApiContext,
  modules: { courseId: string; materialsUrl: string | null },
): Promise<{
  fetch: RequestPageFetch
  items: MaterialNodeSummary[]
  pages: Array<{ depth: number; dataId: string; url: string; title: string | null; itemCount: number }>
}> {
  const visited = new Set<string>()
  return collectMaterialTreePages(apiContext, {
    courseId: modules.courseId,
    fetchUrl: modules.materialsUrl!,
    pageTag: `material-list-${modules.courseId}`,
    parentNodeId: null,
    parentPath: '',
    depth: 0,
    ancestorFolderIds: [],
    visited,
  })
}

function extractHiddenInputValue(html: string, id: string): string | null {
  const direct = html.match(
    new RegExp(`<input\\b[^>]*id=["']${escapeRegExp(id)}["'][^>]*value=["']([\\s\\S]*?)["']`, 'i'),
  )
  if (direct?.[1] != null) {
    return decodeAttribute(direct[1])
  }

  const reverse = html.match(
    new RegExp(`<input\\b[^>]*value=["']([\\s\\S]*?)["'][^>]*id=["']${escapeRegExp(id)}["']`, 'i'),
  )
  return decodeAttribute(reverse?.[1] ?? null)
}

function extractPageState(html: string, fallbackUrl: string): MaterialPageState {
  const parsed = new URL(fallbackUrl)
  const currentDataId = extractHiddenInputValue(html, 'dataId') ?? parsed.searchParams.get('dataId') ?? '0'
  const courseId = extractHiddenInputValue(html, 'courseid') ?? parsed.searchParams.get('courseId') ?? ''
  const classId = extractHiddenInputValue(html, 'classId') ?? parsed.searchParams.get('classId') ?? ''
  const enc = extractHiddenInputValue(html, 'enc') ?? parsed.searchParams.get('enc') ?? ''
  const cpi = extractHiddenInputValue(html, 'cpi') ?? parsed.searchParams.get('cpi')
  const openc = extractHiddenInputValue(html, 'openc') ?? parsed.searchParams.get('openc')
  const ut = extractHiddenInputValue(html, 'ut') ?? parsed.searchParams.get('ut') ?? 's'

  return {
    courseId,
    classId,
    enc,
    cpi,
    openc,
    ut,
    currentDataId,
  }
}

function extractRawMaterialRows(html: string, baseUrl: string): RawMaterialRow[] {
  const rows = Array.from(html.matchAll(/<tr\b([^>]*?\sid=["'][^"']+["'][^>]*)>([\s\S]*?)<\/tr>/gi))

  return rows.map((match, itemIndex) => {
    const attrs = match[1]
    const rowHtml = match[2]
    const rowId = matchAttributeValue(attrs, 'id')
    const type = matchAttributeValue(attrs, 'type')
    const objectId = matchAttributeValue(attrs, 'objectid')
    const source = matchAttributeValue(attrs, 'source')
    const rowUrl = matchAttributeValue(attrs, 'url')
    const loadUrl = matchAttributeValue(attrs, 'loadurl')
    const folderId = matchAttributeValue(attrs, 'folderid')
    const checkboxValue = matchAttributeValue(
      rowHtml.match(/<input[^>]*name=["']checkdelete["'][^>]*>/i)?.[0] ?? '',
      'value',
    )
    const downloadAnchor = rowHtml.match(
      /<a\b(?=[^>]*\bclass=["'][^"']*\bdownload\b[^"']*["'])[^>]*>/i,
    )?.[0]
    const readAnchor = rowHtml.match(
      /<a\b(?=[^>]*\bclass=["'][^"']*\bread\b[^"']*["'])[^>]*>/i,
    )?.[0]
    const nameAnchorMatch = rowHtml.match(
      /<a\b(?=[^>]*\btitle=["'])(?=[^>]*(?:\bname=|\bclass=["'][^"']*\bsrcName\b))[\s\S]*?>([\s\S]*?)<\/a>/i,
    )
    const nameAnchor = nameAnchorMatch?.[0] ?? null
    const downloadUrl = resolveUrl(matchAttributeValue(downloadAnchor ?? '', 'href'), baseUrl)
    const readUrl = matchAttributeValue(readAnchor ?? '', 'onclick')
    const iconSrc = decodeAttribute(rowHtml.match(/<img[^>]*src=["']([^"']+)["']/i)?.[1] ?? null)
    const name = matchAttributeValue(nameAnchor ?? '', 'title') ?? normalizeText(nameAnchorMatch?.[1])

    const tdTexts = Array.from(rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).map((cell) =>
      normalizeText(cell[1]),
    )

    return {
      itemIndex,
      rowId,
      dataId: checkboxValue ?? rowId,
      folderId,
      type,
      objectId,
      source,
      name: name ?? `unnamed-${itemIndex + 1}`,
      uploader: tdTexts[2] || null,
      size: tdTexts[3] || null,
      createdAt: tdTexts[4] || null,
      downloadUrl,
      readUrl,
      openUrl: resolveUrl(rowUrl ?? loadUrl ?? downloadUrl, baseUrl),
      loadUrl,
      rowUrl,
      iconSrc,
    }
  })
}

function detectMaterialNodeType(row: RawMaterialRow): MaterialNodeSummary['nodeType'] {
  const iconSrc = row.iconSrc?.toLowerCase() ?? ''
  const type = row.type?.toLowerCase() ?? ''

  if (iconSrc.includes('folder.gif') || type === 'folder' || type === 'dir' || type === 'afolder') {
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
  const nodeId = options.parentNodeId ? `${options.parentNodeId}/${rawId}` : `${options.courseId}:${rawId}`
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
    objectId: row.objectId ?? '',
    uploader: row.uploader ? normalizeText(row.uploader) : null,
    size: row.size ? normalizeText(row.size) : null,
    createdAt: row.createdAt ? normalizeText(row.createdAt) : null,
    downloadUrl: row.downloadUrl,
    readUrl: row.readUrl,
    openUrl: row.openUrl,
    source: row.source,
  }
}

function buildParentParam(ancestorFolderIds: string[]): string {
  if (ancestorFolderIds.length === 0) {
    return '[]'
  }

  return `[${ancestorFolderIds.map((id) => `{'id':'${id}'}`).join(',')}]`
}

function buildFolderUrl(
  currentUrl: string,
  pageState: MaterialPageState,
  row: RawMaterialRow,
  ancestorFolderIds: string[],
): string | null {
  const directCandidates = [row.openUrl, row.loadUrl, row.rowUrl]
  for (const candidate of directCandidates) {
    if (!candidate || candidate.startsWith('javascript:')) {
      continue
    }

    try {
      return new URL(candidate, currentUrl).toString()
    } catch {
      continue
    }
  }

  const folderId = row.folderId ?? row.dataId
  if (!folderId || !pageState.courseId || !pageState.classId || !pageState.enc) {
    return null
  }

  const target = new URL(currentUrl)
  target.searchParams.delete('pages')
  target.searchParams.delete('order')
  target.searchParams.delete('orderName')
  target.searchParams.delete('orderType')
  target.searchParams.set('courseId', pageState.courseId)
  target.searchParams.set('classId', pageState.classId)
  target.searchParams.set('type', '1')
  target.searchParams.set('dataName', row.name)
  target.searchParams.set('dataId', folderId)
  target.searchParams.set('parent', buildParentParam(ancestorFolderIds))
  target.searchParams.set('flag', '0')
  target.searchParams.set('enc', pageState.enc)
  target.searchParams.set('ut', pageState.ut)

  if (pageState.cpi) {
    target.searchParams.set('cpi', pageState.cpi)
  }

  if (pageState.openc) {
    target.searchParams.set('openc', pageState.openc)
  }

  return target.toString()
}

async function collectMaterialTreePages(
  apiContext: RequestApiContext,
  options: {
    courseId: string
    fetchUrl: string
    pageTag: string
    parentNodeId: string | null
    parentPath: string
    depth: number
    ancestorFolderIds: string[]
    visited: Set<string>
  },
): Promise<{
  fetch: RequestPageFetch
  items: MaterialNodeSummary[]
  pages: Array<{ depth: number; dataId: string; url: string; title: string | null; itemCount: number }>
}> {
  const fetch = await fetchHtml(apiContext, options.fetchUrl, options.pageTag)
  if (!fetch.ok || fetch.loginLike) {
    return {
      fetch,
      items: [],
      pages: [],
    }
  }

  const pageState = extractPageState(fetch.bodyText, fetch.finalUrl)
  const visitKey = `${pageState.currentDataId}|${options.ancestorFolderIds.join('/') || 'root'}`
  if (options.visited.has(visitKey)) {
    return {
      fetch,
      items: [],
      pages: [],
    }
  }
  options.visited.add(visitKey)

  const rows = extractRawMaterialRows(fetch.bodyText, fetch.finalUrl)
  const pages = [
    {
      depth: options.depth,
      dataId: pageState.currentDataId,
      url: fetch.finalUrl,
      title: fetch.title,
      itemCount: rows.length,
    },
  ]

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

    const childFolderId = node.folderId ?? node.dataId
    const childUrl = buildFolderUrl(fetch.finalUrl, pageState, row, options.ancestorFolderIds)
    if (!childFolderId || !childUrl) {
      continue
    }

    const child = await collectMaterialTreePages(apiContext, {
      courseId: options.courseId,
      fetchUrl: childUrl,
      pageTag: `${options.pageTag}-folder-${childFolderId}`,
      parentNodeId: node.nodeId,
      parentPath: node.path,
      depth: options.depth + 1,
      ancestorFolderIds: [...options.ancestorFolderIds, childFolderId],
      visited: options.visited,
    })

    items.push(...child.items)
    pages.push(...child.pages)
  }

  return {
    fetch,
    items,
    pages,
  }
}
