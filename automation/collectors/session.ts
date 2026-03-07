import type { BrowserContext, Page } from '@playwright/test'
import { access } from 'node:fs/promises'
import { launchBrowser } from '../auth/browser.js'
import { courseListUrl, looksLikeLoginUrl } from '../auth/config.js'
import { authPaths } from '../auth/paths.js'

export type AuthenticatedSession = {
  browser: Awaited<ReturnType<typeof launchBrowser>>['browser']
  browserChannel: string
  context: BrowserContext
  page: Page
}

export async function ensureStorageStateFile() {
  try {
    await access(authPaths.storageStateFile)
  } catch {
    throw new Error(
      `Missing storage state: ${authPaths.storageStateFile}. Run \`npm run auth:login\` first.`,
    )
  }
}

export async function openAuthenticatedPage(options?: {
  url?: string
  headed?: boolean
}): Promise<AuthenticatedSession> {
  await ensureStorageStateFile()

  const targetUrl = options?.url ?? courseListUrl
  const { browser, browserChannel } = await launchBrowser(!options?.headed)
  const context = await browser.newContext({
    storageState: authPaths.storageStateFile,
  })
  const page = await context.newPage()

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  return {
    browser,
    browserChannel,
    context,
    page,
  }
}

export async function assertAuthenticatedPage(page: Page, checkedUrl: string) {
  const currentUrl = page.url()
  const bodyText = await page.locator('body').innerText().catch(() => '')

  if (
    looksLikeLoginUrl(currentUrl) ||
    bodyText.includes('校内登录') ||
    bodyText.includes('验证码')
  ) {
    throw new Error(
      `Saved storage state is not authenticated for ${checkedUrl}. Current page: ${currentUrl}`,
    )
  }
}
