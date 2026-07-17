import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeNotionPageId } from '../src/sync/notionIds'

const DASHED = '208d1f2e-3a4b-5c6d-7e8f-90a1b2c3d4e5'

test('extracts the id from a pasted Notion page URL', () => {
  assert.equal(
    normalizeNotionPageId('https://www.notion.so/My-Papers-208d1f2e3a4b5c6d7e8f90a1b2c3d4e5'),
    DASHED
  )
})

test('accepts a bare 32-char id and returns the dashed form', () => {
  assert.equal(normalizeNotionPageId('208D1F2E3A4B5C6D7E8F90A1B2C3D4E5'), DASHED)
})

test('accepts an already-dashed id (idempotent)', () => {
  assert.equal(normalizeNotionPageId(DASHED), DASHED)
})

test('ignores a trailing query string on the URL', () => {
  assert.equal(
    normalizeNotionPageId('https://notion.so/Papers-208d1f2e3a4b5c6d7e8f90a1b2c3d4e5?v=abc'),
    DASHED
  )
})

test('rejects input with no valid id', () => {
  assert.throws(() => normalizeNotionPageId('not-a-page'))
  assert.throws(() => normalizeNotionPageId(''))
})
