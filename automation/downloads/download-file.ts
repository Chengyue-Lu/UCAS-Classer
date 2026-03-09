import { request } from '@playwright/test'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, parse, resolve } from 'node:path'
import { Buffer } from 'node:buffer'

import { authPaths } from '../auth/paths.js'

type DownloadArgs = {
  url: string
  outputDir: string
  suggestedName?: string
  referer?: string
}

type DownloadResult = {
  savedPath: string
  savedFileName: string
  outputDir: string
  finalUrl: string
  contentType: string
  byteCount: number
}

function parseArgs(argv: string[]): DownloadArgs {
  const parsed: Partial<DownloadArgs> = {}

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]

    if (!next) {
      break
    }

    if (current === '--url') {
      parsed.url = next
      index += 1
      continue
    }

    if (current === '--output-dir') {
      parsed.outputDir = next
      index += 1
      continue
    }

    if (current === '--suggested-name') {
      parsed.suggestedName = next
      index += 1
      continue
    }

    if (current === '--referer') {
      parsed.referer = next
      index += 1
    }
  }

  if (!parsed.url || !parsed.outputDir) {
    throw new Error('Usage: npm run download:file -- --url <download-url> --output-dir <dir> [--suggested-name <name>] [--referer <url>]')
  }

  return {
    url: parsed.url,
    outputDir: parsed.outputDir,
    suggestedName: parsed.suggestedName,
    referer: parsed.referer,
  }
}

function resolveDownloadUrl(rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl
  }

  return new URL(rawUrl, 'https://mooc.ucas.edu.cn').toString()
}

function parseContentDispositionFileName(headerValue: string | undefined): string | undefined {
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
  if (!/[Ã�æçé]/.test(fileName)) {
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

function inferFileName(
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

async function ensureUniquePath(outputDir: string, fileName: string): Promise<string> {
  const parsed = parse(fileName)
  const baseName = parsed.name || 'download'
  const extension = parsed.ext || extname(fileName)

  let candidate = resolve(outputDir, `${baseName}${extension}`)
  let suffix = 1

  while (true) {
    try {
      await access(candidate)
      candidate = resolve(outputDir, `${baseName} (${suffix})${extension}`)
      suffix += 1
    } catch {
      return candidate
    }
  }
}

async function detectHtmlLoginPage(buffer: Buffer, contentType: string): Promise<void> {
  if (!contentType.includes('text/html')) {
    return
  }

  const text = buffer.toString('utf8')
  const looksLikeLogin =
    text.includes('统一身份认证') ||
    text.includes('登录') ||
    text.includes('用户登录') ||
    text.includes('mooc.ucas.edu.cn/portal')

  if (looksLikeLogin) {
    throw new Error('Download returned an HTML login page. Current storage-state is not authorized for this resource.')
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const resolvedUrl = resolveDownloadUrl(args.url)
  const outputDir = resolve(args.outputDir)

  await mkdir(outputDir, { recursive: true })

  const apiContext = await request.newContext({
    storageState: authPaths.storageStateFile,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: args.referer
      ? {
          referer: args.referer,
        }
      : undefined,
  })

  try {
    const response = await apiContext.get(resolvedUrl, {
      failOnStatusCode: false,
      timeout: 60_000,
    })

    if (!response.ok()) {
      throw new Error(`Download request failed: ${response.status()} ${response.statusText()}`)
    }

    const body = Buffer.from(await response.body())
    const headers = response.headers()
    const contentType = headers['content-type'] ?? 'application/octet-stream'
    await detectHtmlLoginPage(body, contentType)

    const contentDisposition = headers['content-disposition']
    const fileName = inferFileName(args.suggestedName, parseContentDispositionFileName(contentDisposition), response.url())
    const targetPath = await ensureUniquePath(outputDir, fileName)

    await writeFile(targetPath, body)

    const result: DownloadResult = {
      savedPath: targetPath,
      savedFileName: basename(targetPath),
      outputDir,
      finalUrl: response.url(),
      contentType,
      byteCount: body.byteLength,
    }

    console.log(JSON.stringify(result))
  } finally {
    await apiContext.dispose()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
