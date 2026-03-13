import { mkdir } from 'node:fs/promises'
import { getCacheDir, resolveCachePath } from '../../shared/runtime-paths.js'

export const collectorPaths = {
  cacheDir: getCacheDir(),
  artifactsDir: resolveCachePath('artifacts'),
  courseListJson: resolveCachePath('course-list.json'),
  courseListHtml: resolveCachePath('course-list.html'),
  courseListScreenshot: resolveCachePath('course-list.png'),
  moduleIndexJson: resolveCachePath('course-module-index.json'),
  fullCollectSummaryJson: resolveCachePath('full-collect-summary.json'),
  collectFingerprintStateJson: resolveCachePath('collect-fingerprint-state.json'),
}

export async function ensureCollectorDirs() {
  await mkdir(collectorPaths.cacheDir, { recursive: true })
  await mkdir(collectorPaths.artifactsDir, { recursive: true })
}

export function resolveArtifactHtml(name: string): string {
  return resolveCachePath('artifacts', `${name}.html`)
}

export function resolveArtifactScreenshot(name: string): string {
  return resolveCachePath('artifacts', `${name}.png`)
}

export function resolveCourseModuleJson(courseId: string): string {
  return resolveCachePath(`course-module-${courseId}.json`)
}

export function resolveMaterialListJson(courseId: string): string {
  return resolveCachePath(`material-list-${courseId}.json`)
}

export function resolveNoticeListJson(courseId: string): string {
  return resolveCachePath(`notice-list-${courseId}.json`)
}

export function resolveAssignmentListJson(courseId: string): string {
  return resolveCachePath(`assignment-list-${courseId}.json`)
}
