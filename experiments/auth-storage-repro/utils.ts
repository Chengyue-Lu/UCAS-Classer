import type { BrowserContext, Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { looksLikeLoginUrl } from './config.js'
import { reproPaths } from './paths.js'

export async function prompt(question: string): Promise<void> {
  process.stdout.write(`${question}\n`)

  await new Promise<void>((resolvePrompt) => {
    process.stdin.resume()
    process.stdin.once('data', () => {
      process.stdin.pause()
      resolvePrompt()
    })
  })
}

export function latestPage(context: BrowserContext): Page | null {
  return [...context.pages()].reverse().find((page) => !page.isClosed()) ?? null
}

export async function writeArtifacts(
  page: Page | null,
  prefix: string,
): Promise<{ htmlPath?: string; screenshotPath?: string }> {
  if (!page) {
    return {}
  }

  const htmlPath = resolve(reproPaths.artifactsDir, `${prefix}.html`)
  const screenshotPath = resolve(reproPaths.artifactsDir, `${prefix}.png`)

  await writeFile(
    htmlPath,
    await page.content().catch(() => '<!-- failed to read page content -->'),
    'utf8',
  )
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {})

  return { htmlPath, screenshotPath }
}

export async function summarizeContext(
  context: BrowserContext,
  browserChannel: string,
  checkedUrl: string,
) {
  const page = latestPage(context)
  const cookies = await context.cookies()
  const domains = [...new Set(cookies.map((cookie) => cookie.domain))].sort()
  const currentUrl = page?.url() ?? null
  const pageTitle = page ? await page.title().catch(() => null) : null
  const bodyText = page
    ? await page.locator('body').innerText().catch(() => '')
    : ''
  const authenticated =
    currentUrl !== null &&
    !looksLikeLoginUrl(currentUrl) &&
    !bodyText.includes('校内登录') &&
    !bodyText.includes('验证码')

  return {
    browserChannel,
    checkedUrl,
    currentUrl,
    pageTitle,
    authenticated,
    cookieCount: cookies.length,
    cookieDomains: domains,
  }
}
