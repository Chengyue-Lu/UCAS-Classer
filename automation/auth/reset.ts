import { rm } from 'node:fs/promises'
import { authPaths } from './paths.js'

async function main() {
  await rm(authPaths.dataDir, { recursive: true, force: true })
  console.log(`Removed auth data: ${authPaths.dataDir}`)
}

main().catch((error: unknown) => {
  console.error('Failed to reset auth storage data')
  console.error(error)
  process.exitCode = 1
})
