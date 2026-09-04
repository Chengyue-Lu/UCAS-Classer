import assert from 'node:assert/strict'
import test from 'node:test'

import { getDockCollapseDelay } from '../app/dock-controller.js'

test('uses the base collapse delay when no resize is active', () => {
  assert.equal(getDockCollapseDelay(1_000, 0), 400)
  assert.equal(getDockCollapseDelay(1_000, 900), 400)
})

test('waits for the resize cooldown before collapsing', () => {
  assert.equal(getDockCollapseDelay(1_000, 1_900), 900)
  assert.equal(getDockCollapseDelay(1_850, 1_900), 400)
})
