import { readdir, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { collectorPaths, ensureCollectorDirs } from './cache-paths.js'

export async function writeJsonFile(path: string, data: unknown) {
  await ensureCollectorDirs()
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export async function pruneStaleCourseCache(activeCourseIds: string[]) {
  await ensureCollectorDirs()

  const keep = new Set(activeCourseIds)
  const files = await readdir(collectorPaths.cacheDir)
  const staleFiles = files.filter((file) => {
    const match = file.match(
      /^(course-module|material-list|notice-list|assignment-list)-(\d+)\.json$/,
    )
    return match ? !keep.has(match[2]) : false
  })

  await Promise.all(
    staleFiles.map((file) => rm(`${collectorPaths.cacheDir}\\${file}`, { force: true })),
  )

  const artifactFiles = await readdir(collectorPaths.artifactsDir)
  const staleArtifacts = artifactFiles.filter((file) => {
    const match = basename(file).match(
      /^(course-module|material-list|notice-list|assignment-list)-(\d+)\.(html|png)$/,
    )
    return match ? !keep.has(match[2]) : false
  })

  await Promise.all(
    staleArtifacts.map((file) =>
      rm(`${collectorPaths.artifactsDir}\\${file}`, { force: true }),
    ),
  )
}

export async function runWithConcurrency<TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
): Promise<TOutput[]> {
  const limit = Math.max(1, Math.min(concurrency, items.length || 1))
  const results = new Array<TOutput>(items.length)
  let cursor = 0

  async function consume() {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= items.length) {
        return
      }

      results[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => consume()))
  return results
}
