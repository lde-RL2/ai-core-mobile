import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k)
}

const { loadPaperZoom, savePaperZoom } = await import('../src/viewer/zoomMemory')

beforeEach(() => store.clear())

test('round-trips a zoom per paper', () => {
  savePaperZoom('a', 2.2)
  savePaperZoom('b', 1.5)
  assert.equal(loadPaperZoom('a'), 2.2)
  assert.equal(loadPaperZoom('b'), 1.5)
  assert.equal(loadPaperZoom('missing'), null)
})

test('fit-width (1.0) clears the entry instead of storing noise', () => {
  savePaperZoom('a', 2.2)
  savePaperZoom('a', 1)
  assert.equal(loadPaperZoom('a'), null)
  assert.ok(!(store.get('aicore.zoomByPaper') ?? '').includes('"a"'))
})

test('prunes the least recently saved papers past the cap', () => {
  for (let i = 0; i < 205; i += 1) savePaperZoom(`p${i}`, 2)
  assert.equal(loadPaperZoom('p0'), null, 'oldest dropped')
  assert.equal(loadPaperZoom('p204'), 2, 'newest kept')
})

test('re-saving refreshes recency so active papers survive pruning', () => {
  for (let i = 0; i < 200; i += 1) savePaperZoom(`p${i}`, 2)
  savePaperZoom('p0', 3) // touch the oldest
  for (let i = 200; i < 205; i += 1) savePaperZoom(`p${i}`, 2)
  assert.equal(loadPaperZoom('p0'), 3, 'refreshed entry survives')
})

test('corrupt storage degrades to defaults', () => {
  store.set('aicore.zoomByPaper', '{not json')
  assert.equal(loadPaperZoom('a'), null)
  savePaperZoom('a', 2) // must not throw
  assert.equal(loadPaperZoom('a'), 2)
})
