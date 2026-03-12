import { request } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Buffer } from 'node:buffer'

import { authPaths } from '../auth/paths.js'
import {
  detectHtmlLoginPage,
  inferFileName,
  parseConflictPolicy,
  parseContentDispositionFileName,
  resolveDownloadTarget,
  resolveDownloadUrl,
  type ConflictPolicy,
} from './common.js'

type DownloadArgs = {
  url: string
  outputDir: string
  suggestedName?: string
  referer?: string
  relativeDir?: string
  conflict: ConflictPolicy
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
  const parsed: Partial<DownloadArgs> = {
    conflict: 'rename',
  }

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
      continue
    }

    if (current === '--relative-dir') {
      parsed.relativeDir = next
      index += 1
      continue
    }

    if (current === '--conflict') {
      parsed.conflict = parseConflictPolicy(next, 'rename')
      index += 1
    }
  }

  if (!parsed.url || !parsed.outputDir) {
    throw new Error(
      'Usage: npm run download:file -- --url <download-url> --output-dir <dir> [--suggested-name <name>] [--referer <url>] [--relative-dir <dir>] [--conflict overwrite|rename|skip]',
    )
  }

  return {
    url: parsed.url,
    outputDir: parsed.outputDir,
    suggestedName: parsed.suggestedName,
    referer: parsed.referer,
    relativeDir: parsed.relativeDir,
    conflict: parsed.conflict ?? 'rename',
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
    const fileName = inferFileName(
      args.suggestedName,
      parseContentDispositionFileName(contentDisposition),
      response.url(),
    )
    const target = await resolveDownloadTarget(outputDir, args.relativeDir, fileName, args.conflict)

    if (!target.skipped) {
      await writeFile(target.savedPath, body)
    }

    const result: DownloadResult = {
      savedPath: target.savedPath,
      savedFileName: target.fileName,
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
