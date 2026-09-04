import { rm } from 'node:fs/promises'
import { authPaths } from './paths.js'

async function main() {
  await rm(authPaths.browserProfileRootDir, { recursive: true, force: true })
  console.log(`Removed dedicated login browser data: ${authPaths.browserProfileRootDir}`)
}

main().catch((error: unknown) => {
  console.error('Failed to reset dedicated login browser data')
  console.error(error)
  process.exitCode = 1
})
