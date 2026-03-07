import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))

export const authPaths = {
  rootDir: currentDir,
  dataDir: resolve(currentDir, 'data'),
  artifactsDir: resolve(currentDir, 'data', 'artifacts'),
  storageStateFile: resolve(currentDir, 'data', 'storage-state.json'),
  metadataFile: resolve(currentDir, 'data', 'login-metadata.json'),
}

export async function ensureAuthDirs() {
  await mkdir(authPaths.dataDir, { recursive: true })
  await mkdir(authPaths.artifactsDir, { recursive: true })
}
