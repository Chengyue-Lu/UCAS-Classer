import { readFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'

export type LoginPagePreparation = {
  usernameFilled: boolean
  captchaRequired: boolean
  reason: string | null
}

type StoredAppSettings = {
  sepUsername?: unknown
}

export async function loadSavedSepUsername(settingsFile: string): Promise<string> {
  try {
    const raw = await readFile(settingsFile, 'utf8')
    const settings = JSON.parse(raw) as StoredAppSettings
    return typeof settings.sepUsername === 'string'
      ? settings.sepUsername.trim()
      : ''
  } catch {
    return ''
  }
}

export async function prepareLoginPage(
  page: Page,
  sepUsername: string,
): Promise<LoginPagePreparation> {
  return page
    .evaluate(({ savedUsername }) => {
      const usernameInput = document.querySelector<HTMLInputElement>('#userName1')
      const captcha = document.querySelector<HTMLInputElement>('#certCode1')

      if (!usernameInput) {
        return {
          usernameFilled: false,
          captchaRequired: false,
          reason: 'SEP login controls were not found',
        }
      }

      if (savedUsername) {
        usernameInput.value = savedUsername
        usernameInput.dispatchEvent(new Event('input', { bubbles: true }))
        usernameInput.dispatchEvent(new Event('change', { bubbles: true }))
      }

      const captchaRequired = Boolean(captcha)

      return {
        usernameFilled: Boolean(savedUsername),
        captchaRequired,
        reason: null,
      }
    }, { savedUsername: sepUsername })
    .catch((error: unknown) => ({
      usernameFilled: false,
      captchaRequired: false,
      reason: error instanceof Error ? error.message : String(error),
    }))
}
