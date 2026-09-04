import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { loadSavedSepUsername } from './login-page.js'

test('loads and trims the saved SEP username', async () => {
  const testDir = await mkdtemp(resolve(tmpdir(), 'ucas-auth-settings-'))
  const settingsFile = resolve(testDir, 'app-settings.json')

  try {
    await writeFile(settingsFile, JSON.stringify({ sepUsername: '  sample-user  ' }))
    assert.equal(await loadSavedSepUsername(settingsFile), 'sample-user')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})

test('treats missing or non-string usernames as empty', async () => {
  const missingFile = resolve(tmpdir(), `missing-ucas-settings-${process.pid}.json`)
  assert.equal(await loadSavedSepUsername(missingFile), '')

  const testDir = await mkdtemp(resolve(tmpdir(), 'ucas-auth-settings-'))
  const settingsFile = resolve(testDir, 'app-settings.json')
  try {
    await writeFile(settingsFile, JSON.stringify({ sepUsername: 12345 }))
    assert.equal(await loadSavedSepUsername(settingsFile), '')
  } finally {
    await rm(testDir, { recursive: true, force: true })
  }
})
