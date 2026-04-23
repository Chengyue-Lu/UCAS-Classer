import { access } from 'node:fs/promises'
import { launchBrowser } from './browser.js'
import { authPaths, ensureAuthDirs } from './paths.js'

type CliOptions = {
  url: string
  assignmentsUrl: string | null
  workId: string | null
  workAnswerId: string | null
}

function parseArgs(argv: string[]): CliOptions {
  let url = ''
  let assignmentsUrl: string | null = null
  let workId: string | null = null
  let workAnswerId: string | null = null

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--url') {
      url = argv[index + 1] ?? ''
      index += 1
    } else if (argv[index] === '--assignments-url') {
      assignmentsUrl = (argv[index + 1] ?? '').trim() || null
      index += 1
    } else if (argv[index] === '--work-id') {
      workId = (argv[index + 1] ?? '').trim() || null
      index += 1
    } else if (argv[index] === '--work-answer-id') {
      workAnswerId = (argv[index + 1] ?? '').trim() || null
      index += 1
    }
  }

  if (!url.trim()) {
    throw new Error('Missing required --url argument.')
  }

  return {
    url: url.trim(),
    assignmentsUrl,
    workId,
    workAnswerId,
  }
}

async function openAssignmentEntryFromList(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof launchBrowser>>['browser']['newPage']>>,
  options: CliOptions,
): Promise<boolean> {
  if (!options.assignmentsUrl || !options.workId) {
    return false
  }

  try {
    await page.goto(options.assignmentsUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle').catch(() => undefined)
  } catch (error) {
    console.error('Failed to open assignment list before entry click')
    console.error(error)
    return false
  }

  const selector = 'a, button, input[type="button"], input[type="submit"], [onclick]'
  const markedCandidate = await page.evaluate(
    ({ selector, workId, workAnswerId, targetUrl }) => {
      document.querySelectorAll('[data-ucas-open-assignment-target]').forEach((element) => {
        element.removeAttribute('data-ucas-open-assignment-target')
      })

      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
      }

      const candidates = Array.from(document.querySelectorAll(selector))
        .map((element) => {
          const text = (element.textContent || (element as HTMLInputElement).value || '').trim()
          const href = element instanceof HTMLAnchorElement ? element.href : ''
          const onclick = element.getAttribute('onclick') || ''
          const className = String((element as HTMLElement).className || '')
          const combined = `${href} ${onclick}`
          if (!combined.includes(`workId=${workId}`) || !isVisible(element)) {
            return null
          }

          let score = 0
          if (targetUrl && href === targetUrl) {
            score += 40
          }
          if (workAnswerId && combined.includes(`workAnswerId=${workAnswerId}`)) {
            score += 35
          }
          if (/selectWorkQuestionYiPiYue/i.test(combined)) {
            score += 30
          }
          if (/evaluation=0/i.test(combined)) {
            score += 25
          }
          if (/doHomeWorkNew/i.test(combined)) {
            score += 10
          }
          if (/view|enter|assignment/i.test(text)) {
            score += 10
          }
          if (/Btn_blue|blue|button/i.test(className)) {
            score += 5
          }

          return { element, score, href }
        })
        .filter((candidate): candidate is { element: Element; score: number; href: string } => candidate !== null)
        .sort((left, right) => right.score - left.score)

      const best = candidates[0] ?? null
      if (!best) {
        return { found: false, href: null }
      }

      best.element.setAttribute('data-ucas-open-assignment-target', '1')
      return { found: true, href: best.href || null }
    },
    {
      selector,
      workId: options.workId,
      workAnswerId: options.workAnswerId,
      targetUrl: options.url,
    },
  )

  if (!markedCandidate.found) {
    return false
  }

  const popupPromise = page.waitForEvent('popup', { timeout: 3000 }).catch(() => null)
  const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => null)

  try {
    await page.locator('[data-ucas-open-assignment-target="1"]').click({ timeout: 15000 })
  } catch (error) {
    console.error('Failed to click marked assignment entry, falling back to DOM click')
    console.error(error)
    await page.evaluate(() => {
      const target = document.querySelector<HTMLElement>('[data-ucas-open-assignment-target="1"]')
      target?.click()
    })
  }

  const popup = await popupPromise
  await navigationPromise
  if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => undefined)
    await popup.waitForLoadState('networkidle').catch(() => undefined)
  } else {
    await page.waitForLoadState('networkidle').catch(() => undefined)
  }

  return true
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
    let openedFromAssignmentList = false
    try {
      openedFromAssignmentList = await openAssignmentEntryFromList(page, options)
    } catch (error) {
      console.error('Failed to open assignment entry from list')
      console.error(error)
    }

    if (!openedFromAssignmentList) {
      try {
        await page.goto(options.url, { waitUntil: 'domcontentloaded' })
        await page.waitForLoadState('networkidle').catch(() => undefined)
      } catch (error) {
        console.error('Failed to open authenticated url directly')
        console.error(error)
      }
    }
    await new Promise<void>((resolve) => {
      browser.once('disconnected', () => resolve())
    })
  } catch (error) {
    console.error('Unexpected error while opening authenticated url; keeping browser open for inspection')
    console.error(error)
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
