import { writeFile } from 'node:fs/promises'
import { request, type BrowserContext, type Page } from '@playwright/test'
import { launchBrowser } from './browser.js'
import { courseListUrl, looksLikeLoginUrl, portalUrl } from './config.js'
import { authPaths, ensureAuthDirs } from './paths.js'
import { writeArtifacts } from './utils.js'

const directSepLoginUrl = 'https://sep.ucas.ac.cn/d_index/Z2tkenhfbG9jYWw=/'
const LOGIN_WAIT_TIMEOUT_MS = 10 * 60 * 1000
const LOGIN_POLL_INTERVAL_MS = 1000

type LandingKind = 'portal' | 'courseList'
type RuntimeStorageState = Awaited<ReturnType<BrowserContext['storageState']>>

async function main() {
  await ensureAuthDirs()

  const { browser, browserChannel } = await launchBrowser(false)
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto(directSepLoginUrl, { waitUntil: 'domcontentloaded' })

    console.log(`Browser: ${browserChannel}`)
    console.log(`Entry: ${directSepLoginUrl}`)
    console.log(`Portal: ${portalUrl}`)
    console.log(`Target: ${courseListUrl}`)
    console.log('')
    console.log('Log in in the opened browser window.')
    console.log(
      'The script will auto-save storageState as soon as the current in-memory session can access the course list.',
    )
    console.log('You do not need to manually click into the new course list page.')
    console.log('')

    const landing = await waitForSavableStorageState(context)

    await writeFile(authPaths.storageStateFile, JSON.stringify(landing.storageState, null, 2), 'utf8')
    const artifacts = await writeArtifacts(landing.page, 'after-login-save')

    await writeFile(
      authPaths.metadataFile,
      JSON.stringify(
        {
          savedAt: new Date().toISOString(),
          source: 'sep',
          browserChannel,
          openedUrl: directSepLoginUrl,
          landedKind: landing.kind,
          landedUrl: landing.url,
          landedTitle: landing.title,
          storageStateFile: authPaths.storageStateFile,
          verifiedCourseList: landing.verification,
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
          landedKind: landing.kind,
          landedUrl: landing.url,
          verifiedCourseList: landing.verification,
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

async function waitForSavableStorageState(
  context: BrowserContext,
): Promise<{
  kind: LandingKind
  page: Page
  url: string
  title: string | null
  storageState: RuntimeStorageState
  verification: {
    authenticated: boolean
    url: string
    title: string | null
    status: number
    cookieCount: number
    cookieDomains: string[]
  }
}> {
  const deadline = Date.now() + LOGIN_WAIT_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (!context.browser()?.isConnected()) {
      throw new Error('Login browser was closed before a savable authenticated state was reached.')
    }

    const page = latestPage(context)
    if (!page || page.isClosed()) {
      await sleep(LOGIN_POLL_INTERVAL_MS)
      continue
    }

    const storageState = await context.storageState().catch(() => null)
    if (!storageState) {
      await sleep(LOGIN_POLL_INTERVAL_MS)
      continue
    }

    const verification = await verifyCourseListState(storageState)
    if (verification.authenticated) {
      return {
        kind: detectLandingKind(page),
        page,
        url: page.url(),
        title: await safeTitle(page),
        storageState,
        verification,
      }
    }

    await sleep(LOGIN_POLL_INTERVAL_MS)
  }

  throw new Error(
    `Timed out waiting for a savable authenticated storageState after ${LOGIN_WAIT_TIMEOUT_MS / 1000}s.`,
  )
}

async function verifyCourseListState(storageState: RuntimeStorageState) {
  const apiContext = await request.newContext({
    storageState,
    ignoreHTTPSErrors: true,
  })

  try {
    const response = await apiContext.get(courseListUrl, {
      failOnStatusCode: false,
      timeout: 60_000,
    })
    const bodyText = await response.text()
    const refreshedStorageState = await apiContext.storageState()
    const cookies = refreshedStorageState.cookies ?? []
    const cookieDomains = [...new Set(cookies.map((cookie) => cookie.domain))].sort()
    const url = response.url()
    const title = extractTitle(bodyText)
    const authenticated =
      !looksLikeLoginUrl(url) &&
      bodyText.includes('course-list-con') &&
      !bodyText.includes('/passport/login')

    return {
      authenticated,
      url,
      title,
      status: response.status(),
      cookieCount: cookies.length,
      cookieDomains,
    }
  } finally {
    await apiContext.dispose()
  }
}

function latestPage(context: BrowserContext): Page | null {
  return [...context.pages()].reverse().find((page) => !page.isClosed()) ?? null
}

function detectLandingKind(page: Page): LandingKind {
  return page.url().includes('/fyportal/courselist/course') ? 'courseList' : 'portal'
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null
}

async function safeTitle(page: Page): Promise<string | null> {
  return page.title().catch(() => null)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

main().catch((error: unknown) => {
  console.error('Failed to save login storage state from SEP login flow')
  console.error(error)
  process.exitCode = 1
})
