import { access, mkdir, rm } from 'node:fs/promises'
import { basename, extname, parse, resolve } from 'node:path'
import { Buffer } from 'node:buffer'

export type ConflictPolicy = 'overwrite' | 'rename' | 'skip'

export type SavedTarget = {
  fileName: string
  savedPath: string
  skipped: boolean
}

export function resolveDownloadUrl(rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl
  }

  return new URL(rawUrl, 'https://mooc.ucas.edu.cn').toString()
}

export function parseContentDispositionFileName(headerValue: string | undefined): string | undefined {
  if (!headerValue) {
    return undefined
  }

  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1])
    } catch {
      return utf8Match[1]
    }
  }

  const quotedMatch = headerValue.match(/filename="([^"]+)"/i)
  if (quotedMatch?.[1]) {
    return quotedMatch[1]
  }

  const plainMatch = headerValue.match(/filename=([^;]+)/i)
  return plainMatch?.[1]?.trim()
}

export function inferFileName(
  suggestedName: string | undefined,
  dispositionName: string | undefined,
  finalUrl: string,
): string {
  const normalizedSuggestedName = tryRepairUtf8Mojibake(suggestedName)
  const normalizedDispositionName = tryRepairUtf8Mojibake(dispositionName)

  if (
    normalizedSuggestedName &&
    scoreReadableFileName(normalizedSuggestedName) >= scoreReadableFileName(normalizedDispositionName)
  ) {
    return sanitizeFileName(normalizedSuggestedName)
  }

  if (normalizedDispositionName) {
    return sanitizeFileName(normalizedDispositionName)
  }

  const pathnameName = basename(new URL(finalUrl).pathname)
  if (pathnameName && pathnameName !== '/' && pathnameName !== '.') {
    return sanitizeFileName(pathnameName)
  }

  return 'download.bin'
}

export async function detectHtmlLoginPage(buffer: Buffer, contentType: string): Promise<void> {
  if (!contentType.includes('text/html')) {
    return
  }

  const text = buffer.toString('utf8')
  const looksLikeLogin =
    text.includes('缁熶竴韬唤璁よ瘉') ||
    text.includes('鐧诲綍') ||
    text.includes('鐢ㄦ埛鐧诲綍') ||
    text.includes('mooc.ucas.edu.cn/portal')

  if (looksLikeLogin) {
    throw new Error('Download returned an HTML login page. Current storage-state is not authorized for this resource.')
  }
}

export function parseConflictPolicy(value: string | undefined, fallback: ConflictPolicy): ConflictPolicy {
  if (value === 'overwrite' || value === 'rename' || value === 'skip') {
    return value
  }

  return fallback
}

export function normalizeRelativeDir(relativeDir: string | undefined): string | undefined {
  const trimmed = relativeDir?.trim()
  if (!trimmed) {
    return undefined
  }

  const segments = trimmed
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0 || segments.some((segment) => segment === '..' || segment.includes(':'))) {
    throw new Error(`Invalid relative directory: ${relativeDir}`)
  }

  return segments.join('/')
}

export async function resolveDownloadTarget(
  outputDir: string,
  relativeDir: string | undefined,
  fileName: string,
  conflictPolicy: ConflictPolicy,
): Promise<SavedTarget> {
  const normalizedRelativeDir = normalizeRelativeDir(relativeDir)
  const targetDir = normalizedRelativeDir ? resolve(outputDir, normalizedRelativeDir) : resolve(outputDir)
  await mkdir(targetDir, { recursive: true })

  const targetPath = resolve(targetDir, fileName)
  if (conflictPolicy === 'rename') {
    const uniquePath = await ensureUniquePath(targetDir, fileName)
    return {
      fileName: basename(uniquePath),
      savedPath: uniquePath,
      skipped: false,
    }
  }

  if (conflictPolicy === 'skip' && (await pathExists(targetPath))) {
    return {
      fileName,
      savedPath: targetPath,
      skipped: true,
    }
  }

  if (conflictPolicy === 'overwrite') {
    await rm(targetPath, { force: true })
  }

  return {
    fileName,
    savedPath: targetPath,
    skipped: false,
  }
}

async function ensureUniquePath(outputDir: string, fileName: string): Promise<string> {
  const parsed = parse(fileName)
  const baseName = parsed.name || 'download'
  const extension = parsed.ext || extname(fileName)

  let candidate = resolve(outputDir, `${baseName}${extension}`)
  let suffix = 1

  while (true) {
    if (!(await pathExists(candidate))) {
      return candidate
    }

    candidate = resolve(outputDir, `${baseName} (${suffix})${extension}`)
    suffix += 1
  }
}

function scoreReadableFileName(fileName: string | undefined): number {
  if (!fileName) {
    return -1
  }

  let score = 0
  if (/[\u4e00-\u9fff]/.test(fileName)) {
    score += 3
  }
  if (/\.[A-Za-z0-9]{1,8}$/.test(fileName)) {
    score += 2
  }
  if (!fileName.includes('\uFFFD')) {
    score += 1
  }
  return score
}

function tryRepairUtf8Mojibake(fileName: string | undefined): string | undefined {
  if (!fileName) {
    return undefined
  }

  const repaired = Buffer.from(fileName, 'latin1').toString('utf8')
  if (repaired.includes('\uFFFD')) {
    return fileName
  }

  return scoreReadableFileName(repaired) > scoreReadableFileName(fileName) ? repaired : fileName
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim()
  const safe = trimmed.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
  return safe || 'download.bin'
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}
