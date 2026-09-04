import { chromium } from '@playwright/test'
import { access, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

type BrowserLaunchTarget = {
  label: string
  profileName: string
  channel?: 'msedge' | 'chrome'
  executablePath?: string
}

export type BrowserLaunchResult = {
  browser: Awaited<ReturnType<typeof chromium.launch>>
  browserChannel: string
}

export type PersistentBrowserLaunchResult = {
  context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>
  browserChannel: string
  browserProfileDir: string
}

const execFileAsync = promisify(execFile)

async function firstExistingPath(paths: string[]): Promise<string | undefined> {
  for (const candidate of paths) {
    try {
      await access(candidate)
      return candidate
    } catch {
      continue
    }
  }

  return undefined
}

async function findExecutableOnPath(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('where', [command], {
      windowsHide: true,
    })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
  } catch {
    return undefined
  }
}

async function resolveLaunchTargets(): Promise<BrowserLaunchTarget[]> {
  const edgeExecutable = await firstExistingPath([
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    `${process.env.LOCALAPPDATA ?? ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ])
  const chromeExecutable = await firstExistingPath([
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
  ])
  const edgeOnPath = edgeExecutable ?? (await findExecutableOnPath('msedge'))
  const chromeOnPath = chromeExecutable ?? (await findExecutableOnPath('chrome'))

  return [
    edgeOnPath
      ? { label: 'Microsoft Edge', profileName: 'edge', executablePath: edgeOnPath }
      : { label: 'Microsoft Edge', profileName: 'edge', channel: 'msedge' },
    chromeOnPath
      ? { label: 'Google Chrome', profileName: 'chrome', executablePath: chromeOnPath }
      : { label: 'Google Chrome', profileName: 'chrome', channel: 'chrome' },
    { label: 'Playwright Chromium', profileName: 'playwright-chromium' },
  ]
}

export function browserProfileDirFor(rootDir: string, profileName: string): string {
  return resolve(rootDir, profileName)
}

export function isBrowserProfileInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /ProcessSingleton|SingletonLock|user data directory is already in use|Opening in existing browser session/i.test(
    message,
  )
}

export async function launchBrowser(
  headless = false,
): Promise<BrowserLaunchResult> {
  const targets = await resolveLaunchTargets()

  for (const target of targets) {
    try {
      const browser = await chromium.launch({
        headless,
        ...(target.executablePath
          ? { executablePath: target.executablePath }
          : target.channel
            ? { channel: target.channel }
            : {}),
      })

      return {
        browser,
        browserChannel: target.label,
      }
    } catch (error) {
      if (target.label === 'Playwright Chromium') {
        throw error
      }
    }
  }

  throw new Error('Unable to launch a browser')
}

export async function launchPersistentBrowserContext(
  profileRootDir: string,
  headless = false,
): Promise<PersistentBrowserLaunchResult> {
  const targets = await resolveLaunchTargets()
  await mkdir(profileRootDir, { recursive: true })

  for (const target of targets) {
    const browserProfileDir = browserProfileDirFor(
      profileRootDir,
      target.profileName,
    )

    try {
      const context = await chromium.launchPersistentContext(browserProfileDir, {
        headless,
        ...(target.executablePath
          ? { executablePath: target.executablePath }
          : target.channel
            ? { channel: target.channel }
            : {}),
      })

      return {
        context,
        browserChannel: target.label,
        browserProfileDir,
      }
    } catch (error) {
      if (isBrowserProfileInUseError(error)) {
        throw new Error(
          `The UCAS Classer ${target.label} login profile is already in use. Close the existing login window and try again.`,
          { cause: error },
        )
      }

      if (target.label === 'Playwright Chromium') {
        throw error
      }
    }
  }

  throw new Error('Unable to launch a persistent browser context')
}
