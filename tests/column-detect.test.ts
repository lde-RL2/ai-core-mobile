import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectColumns, type TextSpan } from '../src/viewer/columnDetect'

const PAGE = 612 // US Letter points

/** Lines filling one column band. */
function band(x: number, width: number, count: number): TextSpan[] {
  return Array.from({ length: count }, () => ({ x, width }))
}

test('a two-column paper is detected with both column extents', () => {
  const spans = [...band(54, 240, 40), ...band(318, 240, 40)]
  const layout = detectColumns(spans, PAGE)
  assert.equal(layout.columns.length, 2, 'two columns')
  const [left, right] = layout.columns
  assert.ok(left.start < 0.12 && left.end < 0.55, `left band ${JSON.stringify(left)}`)
  assert.ok(right.start > 0.45 && right.end > 0.85, `right band ${JSON.stringify(right)}`)
})

test('a single-column paper stays single', () => {
  const layout = detectColumns(band(72, 468, 60), PAGE)
  assert.equal(layout.columns.length, 1)
})

test('a two-column page with a full-width title still detects two columns', () => {
  const spans = [
    ...band(54, 504, 3), // title + author block spanning the gutter
    ...band(54, 240, 40),
    ...band(318, 240, 40)
  ]
  assert.equal(detectColumns(spans, PAGE).columns.length, 2)
})

test('a figure-heavy page with little text is left alone', () => {
  assert.equal(detectColumns(band(54, 240, 10), PAGE).columns.length, 1)
})

test('text on only one half is not treated as two columns', () => {
  const spans = [...band(54, 240, 50), ...band(318, 240, 3)]
  assert.equal(detectColumns(spans, PAGE).columns.length, 1)
})

test('degenerate input never throws and falls back to one column', () => {
  assert.equal(detectColumns([], PAGE).columns.length, 1)
  assert.equal(detectColumns(band(54, 240, 40), 0).columns.length, 1)
})
