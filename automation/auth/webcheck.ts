import { access } from 'node:fs/promises'
import { launchBrowser } from './browser.js'
import { courseListUrl } from './config.js'
import { authPaths, ensureAuthDirs } from './paths.js'
import { prompt, summarizeContext, writeArtifacts } from './utils.js'

type CliOptions = {
  closeAfterMs?: number
}

function parseArgs(argv: string[]): CliOptions {
  let closeAfterMs: number | undefined

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--close-after-ms') {
      const value = Number(argv[index + 1] ?? '')
      if (Number.isFinite(value) && value > 0) {
        closeAfterMs = value
      }
      index += 1
    }
  }

  return { closeAfterMs }
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

  const { browser, browserChannel } = await launchBrowser(false)
  const context = await browser.newContext({
    storageState: authPaths.storageStateFile,
  })
  const page = await context.newPage()

  try {
    await page.goto(courseListUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)

    const summary = await summarizeContext(context, browserChannel, courseListUrl)
    const artifacts = await writeArtifacts(page, 'webcheck')

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

    if (options.closeAfterMs) {
      await page.waitForTimeout(options.closeAfterMs)
      return
    }

    await prompt('浏览器已打开课程列表页。检查完成后按回车关闭。')
  } finally {
    await context.close()
    await browser.close()
  }
}

main().catch((error: unknown) => {
  console.error('Failed to open course website with saved storage state')
  console.error(error)
  process.exitCode = 1
})
