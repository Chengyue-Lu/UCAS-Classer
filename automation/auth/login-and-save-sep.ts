import { writeFile } from 'node:fs/promises'
import { request, type BrowserContext, type Page } from '@playwright/test'
import { launchPersistentBrowserContext } from './browser.js'
import {
  courseListUrl,
  isAuthenticatedSepLandingUrl,
  looksLikeLoginUrl,
  portalUrl,
  sepMoocBridgeUrl,
} from './config.js'
import { authPaths, ensureAuthDirs } from './paths.js'
import { loadSavedSepUsername, prepareLoginPage } from './login-page.js'
import { writeArtifacts } from './utils.js'

const directSepLoginUrl = 'https://sep.ucas.ac.cn/d_index/Z2tkenhfbG9jYWw=/'
const LOGIN_WAIT_TIMEOUT_MS = 10 * 60 * 1000
const LOGIN_POLL_INTERVAL_MS = 1000

type LandingKind = 'portal' | 'courseList'
type RuntimeStorageState = Awaited<ReturnType<BrowserContext['storageState']>>
type CourseListVerification = {
  authenticated: boolean
  url: string
  title: string | null
  status: number
  cookieCount: number
  cookieDomains: string[]
}

async function main() {
  await ensureAuthDirs()

  const { context, browserChannel, browserProfileDir } =
    await launchPersistentBrowserContext(
      authPaths.browserProfileRootDir,
      false,
    )
  const page = context.pages()[0] ?? (await context.newPage())

  try {
    await page.goto(directSepLoginUrl, { waitUntil: 'domcontentloaded' })
    const sepUsername = await loadSavedSepUsername(authPaths.appSettingsFile)
    const loginPage = await prepareLoginPage(page, sepUsername)

    console.log(`Browser: ${browserChannel}`)
    console.log(`Dedicated browser profile: ${browserProfileDir}`)
    console.log(`Saved username filled: ${loginPage.usernameFilled ? 'yes' : 'no'}`)
    console.log(`SEP captcha detected: ${loginPage.captchaRequired ? 'yes' : 'no'}`)
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
          browserProfileDir,
          savedUsernameFilled: loginPage.usernameFilled,
          sepCaptchaRequired: loginPage.captchaRequired,
          loginPagePreparationReason: loginPage.reason,
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
          savedUsernameFilled: loginPage.usernameFilled,
          sepCaptchaRequired: loginPage.captchaRequired,
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
  let sepBridgeAttempted = false
  let lastPageUrl: string | null = null
  let lastVerification: CourseListVerification | null = null

  while (Date.now() < deadline) {
    if (!context.browser()?.isConnected()) {
      throw new Error('Login browser was closed before a savable authenticated state was reached.')
    }

    const page = latestPage(context)
    if (!page || page.isClosed()) {
      await sleep(LOGIN_POLL_INTERVAL_MS)
      continue
    }

    lastPageUrl = page.url()

    const storageState = await context.storageState().catch(() => null)
    if (!storageState) {
      await sleep(LOGIN_POLL_INTERVAL_MS)
      continue
    }

    const verificationResult = await verifyCourseListState(storageState)
    const verification = verificationResult.verification
    lastVerification = verification
    if (verification.authenticated) {
      return {
        kind: detectLandingKind(page),
        page,
        url: page.url(),
        title: await safeTitle(page),
        storageState: verificationResult.storageState,
        verification,
      }
    }

    if (!sepBridgeAttempted && isAuthenticatedSepLandingUrl(page.url())) {
      sepBridgeAttempted = true
      console.log(`Detected authenticated SEP landing: ${page.url()}`)
      console.log('Opening UCAS Online through the current SEP SSO bridge...')

      try {
        await page.goto(sepMoocBridgeUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60_000,
        })
      } catch (error) {
        console.warn(
          `SEP SSO bridge navigation did not finish cleanly: ${formatError(error)}`,
        )
      }
    }

    await sleep(LOGIN_POLL_INTERVAL_MS)
  }

  throw new Error(
    [
      `Timed out waiting for a savable authenticated storageState after ${LOGIN_WAIT_TIMEOUT_MS / 1000}s.`,
      `Last browser URL: ${lastPageUrl ?? '(unavailable)'}.`,
      lastVerification
        ? `Last course-list verification: status=${lastVerification.status}, url=${lastVerification.url}, authenticated=${lastVerification.authenticated}.`
        : 'Course-list verification did not complete.',
    ].join(' '),
  )
}

async function verifyCourseListState(
  storageState: RuntimeStorageState,
): Promise<{
  storageState: RuntimeStorageState
  verification: CourseListVerification
}> {
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
      storageState: refreshedStorageState,
      verification: {
        authenticated,
        url,
        title,
        status: response.status(),
        cookieCount: cookies.length,
        cookieDomains,
      },
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error: unknown) => {
  console.error('Failed to save login storage state from SEP login flow')
  console.error(error)
  process.exitCode = 1
})
