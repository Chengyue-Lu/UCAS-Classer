import assert from 'node:assert/strict'
import test from 'node:test'
import { resolve } from 'node:path'
import {
  browserProfileDirFor,
  isBrowserProfileInUseError,
} from './browser.js'

test('isolates persistent profiles by browser family', () => {
  const rootDir = resolve('data', 'login-browser-profile')

  assert.equal(browserProfileDirFor(rootDir, 'edge'), resolve(rootDir, 'edge'))
  assert.equal(
    browserProfileDirFor(rootDir, 'chrome'),
    resolve(rootDir, 'chrome'),
  )
  assert.notEqual(
    browserProfileDirFor(rootDir, 'edge'),
    browserProfileDirFor(rootDir, 'chrome'),
  )
})

test('recognizes Chromium profile lock failures', () => {
  assert.equal(
    isBrowserProfileInUseError(
      new Error('Failed to create a ProcessSingleton for your profile directory'),
    ),
    true,
  )
  assert.equal(
    isBrowserProfileInUseError(new Error('Browser executable was not found')),
    false,
  )
})
