import { access } from 'node:fs/promises'
import { launchBrowser } from './browser.js'
import { courseListUrl } from './config.js'
import { authPaths, ensureAuthDirs } from './paths.js'
import { summarizeContext, writeArtifacts } from './utils.js'

function parseArgs(argv: string[]) {
  return {
    headed: argv.includes('--headed'),
  }
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

  const { browser, browserChannel } = await launchBrowser(!options.headed)
  const context = await browser.newContext({
    storageState: authPaths.storageStateFile,
  })
  const page = await context.newPage()

  try {
    await page.goto(courseListUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    const summary = await summarizeContext(context, browserChannel, courseListUrl)
    const artifacts = await writeArtifacts(page, 'check-auth')

    console.log(
      JSON.stringify(
        {
          storageStateFile: authPaths.storageStateFile,
          ...summary,
          ...artifacts,
        },
        null,
        2,
      ),
    )

    if (!summary.authenticated) {
      process.exitCode = 2
    }
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error('Failed to check saved auth state')
  console.error(error)
  process.exitCode = 1
})
