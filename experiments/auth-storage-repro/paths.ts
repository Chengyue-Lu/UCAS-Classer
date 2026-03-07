import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDir = dirname(fileURLToPath(import.meta.url))

export const reproPaths = {
  rootDir: currentDir,
  dataDir: resolve(currentDir, 'data'),
  artifactsDir: resolve(currentDir, 'data', 'artifacts'),
  storageStateFile: resolve(currentDir, 'data', 'storage-state.json'),
  metadataFile: resolve(currentDir, 'data', 'login-metadata.json'),
}

export async function ensureReproDirs() {
  await mkdir(reproPaths.dataDir, { recursive: true })
  await mkdir(reproPaths.artifactsDir, { recursive: true })
}
