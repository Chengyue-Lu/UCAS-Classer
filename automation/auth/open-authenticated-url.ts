import { access } from 'node:fs/promises'
import { launchBrowser } from './browser.js'
import { authPaths, ensureAuthDirs } from './paths.js'

type CliOptions = {
  url: string
}

function parseArgs(argv: string[]): CliOptions {
  let url = ''

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--url') {
      url = argv[index + 1] ?? ''
      index += 1
    }
  }

  if (!url.trim()) {
    throw new Error('Missing required --url argument.')
  }

  return { url: url.trim() }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  await ensureAuthDirs()

  try {
    await access(authPaths.storageStateFile)
  } catch {
    throw new Error(
      `Missing storage state: ${authPaths.storageStateFile}. Run \`npm run auth:login\` first.`,
    )
  }

  const { browser } = await launchBrowser(false)
  const context = await browser.newContext({
    storageState: authPaths.storageStateFile,
  })
  const page = await context.newPage()

  try {
    await page.goto(options.url, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => undefined)
    await new Promise<void>((resolve) => {
      browser.once('disconnected', () => resolve())
    })
  } finally {
    await context.close().catch(() => undefined)
    await browser.close().catch(() => undefined)
  }
}

main().catch((error: unknown) => {
  console.error('Failed to open authenticated url')
  console.error(error)
  process.exitCode = 1
})
