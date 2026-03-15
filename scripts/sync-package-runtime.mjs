import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = path.join(repoRoot, 'ucasclasser-package')

const mode = process.argv[2]
if (mode !== '--check' && mode !== '--write') {
  console.error('Usage: node scripts/sync-package-runtime.mjs --check|--write')
  process.exit(2)
}

const sharedFiles = [
  'src/index.html',
  'src/app.js',
  'src/styles.css',
  'shared/runtime-paths.ts',
  'automation/auth/browser.ts',
  'automation/auth/check-api.ts',
  'automation/auth/config.ts',
  'automation/auth/login-and-save-sep.ts',
  'automation/auth/open-authenticated-url.ts',
  'automation/auth/paths.ts',
  'automation/auth/reset.ts',
  'automation/auth/utils.ts',
  'src-tauri/src/app_data.rs',
  'src-tauri/src/app_settings.rs',
  'src-tauri/src/auth_runtime.rs',
  'src-tauri/src/db_import.rs',
  'src-tauri/src/downloads.rs',
  'src-tauri/src/lib.rs',
]

const sharedDirs = [
  'src/app',
  'automation/downloads',
  'automation/request-course-list',
  'automation/request-collectors',
  'automation/shared',
]

const cleanupPaths = [
  'automation/collectors',
  'automation/auth/check-auth.ts',
  'automation/auth/login-and-save.ts',
  'automation/auth/webcheck.ts',
  'runtime-dist/automation/collectors',
  'runtime-dist/automation/auth/check-auth.js',
  'runtime-dist/automation/auth/login-and-save.js',
  'runtime-dist/automation/auth/webcheck.js',
  'src-tauri/resources/runtime/runtime-dist/automation/collectors',
  'src-tauri/resources/runtime/runtime-dist/automation/auth/check-auth.js',
  'src-tauri/resources/runtime/runtime-dist/automation/auth/login-and-save.js',
  'src-tauri/resources/runtime/runtime-dist/automation/auth/webcheck.js',
]

await assertDirectory(packageRoot, 'local package root')

const drifts = []

for (const relativePath of sharedFiles) {
  const sourceFile = path.join(repoRoot, relativePath)
  const targetFile = path.join(packageRoot, relativePath)
  drifts.push(...(await compareFilePair(relativePath, sourceFile, targetFile)))
}

for (const relativeDir of sharedDirs) {
  const sourceDir = path.join(repoRoot, relativeDir)
  const targetDir = path.join(packageRoot, relativeDir)
  drifts.push(...(await compareDirectoryPair(relativeDir, sourceDir, targetDir)))
}

for (const relativePath of cleanupPaths) {
  const targetPath = path.join(packageRoot, relativePath)
  if (await pathExists(targetPath)) {
    drifts.push(`stale package-only path should be removed: ${relativePath}`)
  }
}

if (mode === '--check') {
  if (drifts.length === 0) {
    console.log('Package runtime is in sync.')
    process.exit(0)
  }

  console.log('Package runtime drift detected:')
  for (const drift of drifts) {
    console.log(`- ${drift}`)
  }
  process.exit(1)
}

await applySync()
console.log(`Package runtime sync completed. Updated ${sharedFiles.length} files and ${sharedDirs.length} directories.`)

async function applySync() {
  for (const relativePath of cleanupPaths) {
    await rm(path.join(packageRoot, relativePath), { force: true, recursive: true })
  }

  for (const relativePath of sharedFiles) {
    const sourceFile = path.join(repoRoot, relativePath)
    const targetFile = path.join(packageRoot, relativePath)
    await mkdir(path.dirname(targetFile), { recursive: true })
    await cp(sourceFile, targetFile, { force: true })
  }

  for (const relativeDir of sharedDirs) {
    const sourceDir = path.join(repoRoot, relativeDir)
    const targetDir = path.join(packageRoot, relativeDir)
    await rm(targetDir, { force: true, recursive: true })
    await mkdir(path.dirname(targetDir), { recursive: true })
    await cp(sourceDir, targetDir, { recursive: true, force: true })
  }

  const stampFile = path.join(packageRoot, 'runtime-sync.stamp.json')
  const stamp = {
    syncedAt: new Date().toISOString(),
    sourceRoot: repoRoot,
    sharedFiles,
    sharedDirs,
    cleanupPaths,
  }
  await writeFile(stampFile, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8')
}

async function compareFilePair(label, sourceFile, targetFile) {
  const issues = []
  if (!(await pathExists(sourceFile))) {
    issues.push(`source file missing: ${label}`)
    return issues
  }

  if (!(await pathExists(targetFile))) {
    issues.push(`target file missing: ${label}`)
    return issues
  }

  const [sourceContent, targetContent] = await Promise.all([
    readFile(sourceFile),
    readFile(targetFile),
  ])

  if (!sourceContent.equals(targetContent)) {
    issues.push(`content drift: ${label}`)
  }

  return issues
}

async function compareDirectoryPair(label, sourceDir, targetDir) {
  const issues = []
  await assertDirectory(sourceDir, `source directory ${label}`)

  if (!(await pathExists(targetDir))) {
    issues.push(`target directory missing: ${label}`)
    return issues
  }

  const sourceFiles = await listFiles(sourceDir)
  const targetFiles = await listFiles(targetDir)
  const sourceSet = new Set(sourceFiles)
  const targetSet = new Set(targetFiles)

  for (const relativeFile of sourceFiles) {
    const nestedLabel = path.posix.join(label.replaceAll('\\', '/'), relativeFile)
    const sourceFile = path.join(sourceDir, relativeFile)
    const targetFile = path.join(targetDir, relativeFile)
    issues.push(...(await compareFilePair(nestedLabel, sourceFile, targetFile)))
  }

  for (const relativeFile of targetFiles) {
    if (!sourceSet.has(relativeFile)) {
      issues.push(`stale file under synced directory ${label}: ${relativeFile}`)
    }
  }

  return issues
}

async function listFiles(rootDir, prefix = '') {
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(absolutePath, relativePath)))
      continue
    }
    files.push(relativePath)
  }

  files.sort()
  return files
}

async function assertDirectory(targetPath, label) {
  let metadata
  try {
    metadata = await stat(targetPath)
  } catch {
    throw new Error(`Missing ${label}: ${targetPath}`)
  }

  if (!metadata.isDirectory()) {
    throw new Error(`Expected directory for ${label}: ${targetPath}`)
  }
}

async function pathExists(targetPath) {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}
