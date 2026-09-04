import assert from 'node:assert/strict'
import test from 'node:test'

import { formatAssignmentProgress } from '../app/course-renderer.js'
import { formatCount } from '../app/formatters.js'

test('renders counts without leading zeroes', () => {
  assert.equal(formatCount(0), '0')
  assert.equal(formatCount(7), '7')
  assert.equal(formatCount(12), '12')
})

test('renders assignment progress as unfinished over total', () => {
  const assignments = [
    { status: '待做', endTime: '2999-01-01 00:00' },
    { status: '已完成', endTime: '2000-01-01 00:00' },
  ]

  assert.equal(formatAssignmentProgress(assignments), '1/2')
  assert.equal(formatAssignmentProgress([]), '0/0')
})
