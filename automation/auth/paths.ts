import { access, cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDataPath } from '../../shared/runtime-paths.js'

const currentDir = dirname(fileURLToPath(import.meta.url))
const legacyDataDir = resolve(currentDir, 'data')
const legacyArtifactsDir = resolve(legacyDataDir, 'artifacts')
const legacyStorageStateFile = resolve(legacyDataDir, 'storage-state.json')
const legacyMetadataFile = resolve(legacyDataDir, 'login-metadata.json')

export const authPaths = {
  rootDir: currentDir,
  dataDir: resolveDataPath('auth'),
  artifactsDir: resolveDataPath('auth', 'artifacts'),
  storageStateFile: resolveDataPath('auth', 'storage-state.json'),
  metadataFile: resolveDataPath('auth', 'login-metadata.json'),
}

export async function ensureAuthDirs() {
  await mkdir(authPaths.dataDir, { recursive: true })
  await mkdir(authPaths.artifactsDir, { recursive: true })
  await migrateLegacyAuthData()
}

async function migrateLegacyAuthData() {
  if (await shouldCopy(legacyStorageStateFile, authPaths.storageStateFile)) {
    await cp(legacyStorageStateFile, authPaths.storageStateFile, { force: true })
  }

  if (await shouldCopy(legacyMetadataFile, authPaths.metadataFile)) {
    await cp(legacyMetadataFile, authPaths.metadataFile, { force: true })
  }

  if (!(await pathExists(legacyArtifactsDir))) {
    return
  }

  const artifactFiles = await readdir(legacyArtifactsDir)
  for (const fileName of artifactFiles) {
    const sourceFile = resolve(legacyArtifactsDir, fileName)
    const targetFile = resolve(authPaths.artifactsDir, fileName)
    if (await shouldCopy(sourceFile, targetFile)) {
      await cp(sourceFile, targetFile, { force: true })
    }
  }
}

async function shouldCopy(sourceFile: string, targetFile: string) {
  return (await pathExists(sourceFile)) && !(await pathExists(targetFile))
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}
