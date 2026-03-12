import { request } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
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

type BatchArgs = {
  manifest: string
  outputDir: string
  conflict: ConflictPolicy
}

type DownloadRequest = {
  url: string
  suggestedName?: string
  referer?: string
  relativeSubdir?: string
}

type DownloadItemResult = {
  ok: boolean
  suggestedName?: string
  savedPath?: string
  savedFileName?: string
  relativeSubdir?: string
  error?: string
}

type DownloadBatchResult = {
  totalCount: number
  successCount: number
  failureCount: number
  items: DownloadItemResult[]
}

function parseArgs(argv: string[]): BatchArgs {
  let manifest = ''
  let outputDir = ''
  let conflict: ConflictPolicy = 'overwrite'

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]
    const next = argv[index + 1]

    if (!next) {
      break
    }

    if (current === '--manifest') {
      manifest = next
      index += 1
      continue
    }

    if (current === '--output-dir') {
      outputDir = next
      index += 1
      continue
    }

    if (current === '--conflict') {
      conflict = parseConflictPolicy(next, 'overwrite')
      index += 1
    }
  }

  if (!manifest || !outputDir) {
    throw new Error('Usage: npm run download:batch -- --manifest <path> --output-dir <dir> [--conflict overwrite|rename|skip]')
  }

  return {
    manifest: resolve(manifest),
    outputDir: resolve(outputDir),
    conflict,
  }
}

async function loadManifest(manifestPath: string): Promise<DownloadRequest[]> {
  const contents = await readFile(manifestPath, 'utf8')
  const parsed = JSON.parse(contents)
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid batch manifest: expected array in ${manifestPath}`)
  }

  return parsed.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.url !== 'string') {
      throw new Error(`Invalid batch manifest item in ${manifestPath}`)
    }

    return {
      url: item.url,
      suggestedName: typeof item.suggestedName === 'string' ? item.suggestedName : undefined,
      referer: typeof item.referer === 'string' ? item.referer : undefined,
      relativeSubdir: typeof item.relativeSubdir === 'string' ? item.relativeSubdir : undefined,
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const jobs = await loadManifest(args.manifest)
  const apiContext = await request.newContext({
    storageState: authPaths.storageStateFile,
    ignoreHTTPSErrors: true,
  })

  const items: DownloadItemResult[] = []

  try {
    for (const job of jobs) {
      try {
        const response = await apiContext.get(resolveDownloadUrl(job.url), {
          failOnStatusCode: false,
          timeout: 60_000,
          headers: job.referer ? { referer: job.referer } : undefined,
        })

        if (!response.ok()) {
          throw new Error(`Download request failed: ${response.status()} ${response.statusText()}`)
        }

        const body = Buffer.from(await response.body())
        const headers = response.headers()
        const contentType = headers['content-type'] ?? 'application/octet-stream'
        await detectHtmlLoginPage(body, contentType)

        const fileName = inferFileName(
          job.suggestedName,
          parseContentDispositionFileName(headers['content-disposition']),
          response.url(),
        )
        const target = await resolveDownloadTarget(
          args.outputDir,
          job.relativeSubdir,
          fileName,
          args.conflict,
        )

        if (!target.skipped) {
          await writeFile(target.savedPath, body)
        }

        items.push({
          ok: true,
          suggestedName: job.suggestedName,
          savedPath: target.savedPath,
          savedFileName: target.fileName,
          relativeSubdir: job.relativeSubdir,
        })
      } catch (error) {
        items.push({
          ok: false,
          suggestedName: job.suggestedName,
          relativeSubdir: job.relativeSubdir,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  } finally {
    await apiContext.dispose()
  }

  const result: DownloadBatchResult = {
    totalCount: items.length,
    successCount: items.filter((item) => item.ok).length,
    failureCount: items.filter((item) => !item.ok).length,
    items,
  }

  console.log(JSON.stringify(result))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
