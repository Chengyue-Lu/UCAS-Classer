import assert from 'node:assert/strict'
import test from 'node:test'

import { invokeNullableTauriCommand } from '../app/bridge.js'

function withWindow(value, operation) {
  const previousWindow = globalThis.window
  globalThis.window = value

  return Promise.resolve(operation()).finally(() => {
    if (previousWindow === undefined) {
      delete globalThis.window
    } else {
      globalThis.window = previousWindow
    }
  })
}

test('preserves null when a nullable command is cancelled', async () => {
  await withWindow(
    {
      __TAURI_INTERNALS__: {
        invoke: async () => null,
      },
    },
    async () => {
      assert.equal(await invokeNullableTauriCommand('pick_folder_path'), null)
    },
  )
})

test('still reports a missing Tauri bridge', async () => {
  await withWindow({}, async () => {
    await assert.rejects(
      invokeNullableTauriCommand('pick_folder_path', {}, '目录选择器不可用。'),
      (error) => error?.code === 'bridge_unavailable' && error.message === '目录选择器不可用。',
    )
  })
})
