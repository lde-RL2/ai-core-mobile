import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findResumePaper, sortPapers } from '../src/sortPapers'
import type { Paper, ReadingState } from '../src/types'

function paper(id: string, over: Partial<Paper> = {}): Paper {
  return {
    id,
    title: id,
    authors: null,
    year: null,
    originalFilename: `${id}.pdf`,
    doi: null,
    addedAt: '2026-01-01T00:00:00.000Z',
    notes: null,
    updatedAt: 0,
    fileSize: 1,
    pageCount: 10,
    ...over
  }
}

function reading(paperId: string, over: Partial<ReadingState> = {}): ReadingState {
  return { paperId, lastPage: 5, scrollFraction: 0.5, updatedAt: 1, ...over }
}

test('title sort is locale aware and year sort puts missing years last', () => {
  const papers = [paper('b', { title: 'Beta', year: 2020 }), paper('a', { title: 'Alpha' })]
  assert.deepEqual(
    sortPapers(papers, 'title', new Map()).map((p) => p.title),
    ['Alpha', 'Beta']
  )
  assert.deepEqual(
    sortPapers(papers, 'year', new Map()).map((p) => p.title),
    ['Beta', 'Alpha'],
    'a paper without a year sinks below one with a year'
  )
})

test('recently-read sort ranks by last opened, unread papers last', () => {
  const papers = [paper('never'), paper('old'), paper('fresh')]
  const map = new Map([
    ['old', reading('old', { updatedAt: 100 })],
    ['fresh', reading('fresh', { updatedAt: 900 })]
  ])
  assert.deepEqual(
    sortPapers(papers, 'read', map).map((p) => p.id),
    ['fresh', 'old', 'never']
  )
})

test('resume offers the newest in-progress paper', () => {
  const papers = [paper('a'), paper('b')]
  const map = new Map([
    ['a', reading('a', { updatedAt: 10 })],
    ['b', reading('b', { updatedAt: 20 })]
  ])
  assert.equal(findResumePaper(papers, map)?.id, 'b')
})

test('resume skips finished papers and barely-opened ones', () => {
  const finished = new Map([['a', reading('a', { scrollFraction: 1, updatedAt: 50 })]])
  assert.equal(findResumePaper([paper('a')], finished), null)

  const barelyOpened = new Map([
    ['a', reading('a', { lastPage: 1, scrollFraction: 0, updatedAt: 50 })]
  ])
  assert.equal(findResumePaper([paper('a')], barelyOpened), null)
})

test('resume returns null when nothing has been read', () => {
  assert.equal(findResumePaper([paper('a')], new Map()), null)
})
