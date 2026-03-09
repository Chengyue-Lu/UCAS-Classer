import { access, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { request } from '@playwright/test'
import { courseListUrl, looksLikeLoginUrl } from './config.js'
import { authPaths, ensureAuthDirs } from './paths.js'

function parseArgs(argv: string[]) {
  return {
    refreshStorageOnSuccess: argv.includes('--refresh-storage-on-success'),
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

  const apiContext = await request.newContext({
    storageState: authPaths.storageStateFile,
    ignoreHTTPSErrors: true,
  })

  try {
    const response = await apiContext.get(courseListUrl, {
      failOnStatusCode: false,
      timeout: 60_000,
    })
    const bodyText = await response.text()
    const contentType = response.headers()['content-type'] ?? ''
    const currentUrl = response.url()
    const pageTitle = extractTitle(bodyText)
    const authenticated = isAuthenticatedResponse({
      currentUrl,
      contentType,
      bodyText,
    })

    const storageState = await apiContext.storageState()
    const cookies = storageState.cookies ?? []
    const cookieDomains = [...new Set(cookies.map((cookie) => cookie.domain))].sort()

    if (authenticated && options.refreshStorageOnSuccess) {
      await apiContext.storageState({ path: authPaths.storageStateFile })
    }

    const htmlPath = resolve(authPaths.artifactsDir, 'check-auth-api.html')
    await writeFile(htmlPath, bodyText, 'utf8')

    console.log(
      JSON.stringify(
        {
          storageStateFile: authPaths.storageStateFile,
          refreshStorageOnSuccess: options.refreshStorageOnSuccess,
          browserChannel: 'Request context',
          checkedUrl: courseListUrl,
          currentUrl,
          pageTitle,
          authenticated,
          cookieCount: cookies.length,
          cookieDomains,
          status: response.status(),
          contentType,
          htmlPath,
        },
        null,
        2,
      ),
    )

    if (!authenticated) {
      process.exitCode = 2
    }
  } finally {
    await apiContext.dispose()
  }
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i)
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null
}

function looksLikeLoginBody(contentType: string, bodyText: string): boolean {
  if (!contentType.includes('text/html')) {
    return false
  }

  return (
    bodyText.includes('/passport/login') ||
    bodyText.includes('id="loginForm"') ||
    bodyText.includes('name="loginForm"') ||
    bodyText.includes('passport.mooc.ucas.edu.cn')
  )
}

function isAuthenticatedResponse(options: {
  currentUrl: string
  contentType: string
  bodyText: string
}): boolean {
  return (
    !looksLikeLoginUrl(options.currentUrl) &&
    !looksLikeLoginBody(options.contentType, options.bodyText) &&
    options.bodyText.includes('course-list-con')
  )
}

main().catch((error: unknown) => {
  console.error('Failed to check saved auth state by API')
  console.error(error)
  process.exitCode = 1
})
