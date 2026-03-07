import { rm } from 'node:fs/promises'
import { reproPaths } from './paths.js'

async function main() {
  await rm(reproPaths.dataDir, { recursive: true, force: true })
  console.log(`Removed repro data: ${reproPaths.dataDir}`)
}

main().catch((error: unknown) => {
  console.error('Failed to reset auth storage repro data')
  console.error(error)
  process.exitCode = 1
})
