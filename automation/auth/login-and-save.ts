import type { BrowserContext } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { launchBrowser } from './browser.js'
import { courseListUrl, looksLikeLoginUrl, portalUrl } from './config.js'
import { authPaths, ensureAuthDirs } from './paths.js'
import { latestPage, summarizeContext, writeArtifacts } from './utils.js'

const AUTO_SAVE_TIMEOUT_MS = 10 * 60 * 1000
const AUTO_SAVE_POLL_INTERVAL_MS = 1000

async function main() {
  await ensureAuthDirs()

  const { browser, browserChannel } = await launchBrowser(false)
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(portalUrl, { waitUntil: 'domcontentloaded' })

    console.log(`Browser: ${browserChannel}`)
    console.log(`Portal: ${portalUrl}`)
    console.log(`Target: ${courseListUrl}`)
    console.log('')
    console.log('Log in in the opened browser window.')
    console.log('After login, enter the course list page in the same browser window.')
    console.log('The script will auto-save storageState and close the browser.')
    console.log('')

    await waitForAuthenticatedCourseList(context)

    await context.storageState({ path: authPaths.storageStateFile })
    const summary = await summarizeContext(context, browserChannel, courseListUrl)
    const artifacts = await writeArtifacts(latestPage(context), 'after-login-save')

    await writeFile(
      authPaths.metadataFile,
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          portalUrl,
          courseListUrl,
          ...summary,
          ...artifacts,
        },
        null,
        2,
      ),
      'utf8',
    )

    console.log('Saved authenticated storage state. Closing browser...')
    console.log(
      JSON.stringify(
        {
          storageStateFile: authPaths.storageStateFile,
          metadataFile: authPaths.metadataFile,
          ...summary,
          ...artifacts,
        },
        null,
        2,
      ),
    )
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

async function waitForAuthenticatedCourseList(context: BrowserContext) {
  const deadline = Date.now() + AUTO_SAVE_TIMEOUT_MS

  while (Date.now() < deadline) {
    const currentPage = latestPage(context)
    if (currentPage && !currentPage.isClosed()) {
      const currentUrl = currentPage.url()
      const bodyText = await currentPage
        .locator('body')
        .innerText()
        .catch(() => '')
      const courseListVisible = await currentPage
        .locator('#stuCourseList ul.course-list')
        .count()
        .catch(() => 0)

      const isCourseListPage =
        currentUrl.includes('/fyportal/courselist/course') || courseListVisible > 0
      const isAuthenticated =
        !looksLikeLoginUrl(currentUrl) &&
        !bodyText.includes('校内登录') &&
        !bodyText.includes('验证码')

      if (isCourseListPage && isAuthenticated) {
        return
      }
    }

    await new Promise((resolve) => {
      setTimeout(resolve, AUTO_SAVE_POLL_INTERVAL_MS)
    })
  }

  throw new Error(
    `Timed out waiting for an authenticated course list page after ${AUTO_SAVE_TIMEOUT_MS / 1000}s.`,
  )
}

main().catch((error: unknown) => {
  console.error('Failed to save login storage state')
  console.error(error)
  process.exitCode = 1
})
