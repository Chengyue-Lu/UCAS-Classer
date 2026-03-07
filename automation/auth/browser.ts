import { chromium } from '@playwright/test'
import { access } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

type BrowserLaunchTarget = {
  label: string
  channel?: 'msedge' | 'chrome'
  executablePath?: string
}

export type BrowserLaunchResult = {
  browser: Awaited<ReturnType<typeof chromium.launch>>
  browserChannel: string
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
      ? { label: 'Microsoft Edge', executablePath: edgeOnPath }
      : { label: 'Microsoft Edge', channel: 'msedge' },
    chromeOnPath
      ? { label: 'Google Chrome', executablePath: chromeOnPath }
      : { label: 'Google Chrome', channel: 'chrome' },
    { label: 'Playwright Chromium' },
  ]
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
