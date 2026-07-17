import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  annotationToRemoteRow,
  buildLibraryJson,
  localUpdatedAt,
  paperToRemoteRow,
  remoteCollectionsToLocal,
  remoteRowToAnnotation,
  remoteRowToPaper,
  sha256Hex
} from '../src/sync/format'
import type { Annotation, Paper } from '../src/types'

const paper: Paper = {
  id: 'p1',
  title: 'Deep Learning',
  authors: 'Kim, Lee',
  year: 2024,
  originalFilename: 'deep.pdf',
  doi: '10.1/x',
  addedAt: '2026-01-01T00:00:00.000Z',
  notes: 'memo',
  updatedAt: 100,
  fileSize: 1234,
  pageCount: 7,
  contentHash: 'abc'
}

test('paper round-trips through the desktop wire format', () => {
  const remote = paperToRemoteRow(paper)
  assert.equal(remote.original_filename, 'deep.pdf')
  assert.equal(remote.content_hash, 'abc')
  const back = remoteRowToPaper(remote, paper)
  assert.deepEqual(back, paper)
})

test('pulled paper without local counterpart gets null pageCount', () => {
  const back = remoteRowToPaper(paperToRemoteRow(paper), undefined)
  assert.equal(back.pageCount, null)
  assert.equal(back.title, paper.title)
})

test('desktop-only metadata columns survive a mobile pull → push round trip', () => {
  // A meta written by the desktop v1.2.0 metadata-v2 schema: the mobile app
  // models none of these columns but must not drop them.
  const desktopRow = {
    ...paperToRemoteRow(paper),
    item_type: 'journalArticle',
    creators_json: '[{"lastName":"Kim"}]',
    abstract_note: 'We present…',
    publication_title: 'Nature',
    publisher: 'Springer',
    url: 'https://doi.org/10.1/x',
    arxiv_id: '2401.00001',
    file_path: '/home/user/papers/deep.pdf'
  }
  // Pull, then the user renames the paper on the phone, then push.
  const pulled = remoteRowToPaper(desktopRow, undefined)
  const edited = { ...pulled, title: 'Deep Learning (edited on phone)' }
  const pushed = paperToRemoteRow(edited) as unknown as Record<string, unknown>

  assert.equal(pushed.title, 'Deep Learning (edited on phone)', 'phone edit wins')
  for (const key of [
    'item_type',
    'creators_json',
    'abstract_note',
    'publication_title',
    'publisher',
    'url',
    'arxiv_id',
    'file_path'
  ]) {
    assert.equal(pushed[key], desktopRow[key as keyof typeof desktopRow], `${key} preserved`)
  }
})

test('a pre-metadata-v2 meta does not wipe extras already known locally', () => {
  const withExtras = { ...paper, remoteExtras: { abstract_note: 'kept' } }
  const legacyRow = paperToRemoteRow(paper) // 11 known keys only, no extras
  const back = remoteRowToPaper(legacyRow, withExtras)
  assert.deepEqual(back.remoteExtras, { abstract_note: 'kept' })
})

test('annotation round-trip carries text as desktop-v2 selected_text', () => {
  const annotation: Annotation = {
    id: 'a1',
    paperId: 'p1',
    pageNumber: 3,
    type: 'highlight',
    rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
    color: '#ffe066',
    note: 'important',
    text: 'selected sentence',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: 50
  }
  const remote = annotationToRemoteRow(annotation)
  assert.equal(remote.paper_id, 'p1')
  assert.equal(remote.selected_text, 'selected sentence')
  assert.ok(!('text' in remote), 'the mobile-local field name must not leak into the wire')
  const back = remoteRowToAnnotation(remote, undefined)
  assert.deepEqual(back, annotation)
})

test('older metas without selected_text keep the locally known text', () => {
  const annotation: Annotation = {
    id: 'a1',
    paperId: 'p1',
    pageNumber: 3,
    type: 'underline',
    rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.05 }],
    color: '#ffe066',
    note: null,
    text: 'known locally',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: 50
  }
  const legacyRemote = { ...annotationToRemoteRow(annotation) }
  delete legacyRemote.selected_text
  assert.equal(remoteRowToAnnotation(legacyRemote, annotation)?.text, 'known locally')
  assert.equal(remoteRowToAnnotation(legacyRemote, undefined)?.text, null)
})

test('desktop area and sticky-note annotations survive the round trip', () => {
  for (const type of ['area', 'note'] as const) {
    const annotation: Annotation = {
      id: `a-${type}`,
      paperId: 'p1',
      pageNumber: 2,
      type,
      rects: [{ x: 0.2, y: 0.3, w: 0.25, h: 0.15 }],
      color: '#9ad1f5',
      note: 'figure 3',
      text: null,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: 70
    }
    const remote = annotationToRemoteRow(annotation)
    assert.equal(remote.type, type)
    const back = remoteRowToAnnotation(remote, undefined)
    assert.equal(back?.type, type, `type ${type} must not be coerced`)
    assert.deepEqual(back, annotation)
  }
})

test('an unknown future annotation type degrades to highlight', () => {
  const remote = {
    id: 'a9',
    paper_id: 'p1',
    page_number: 1,
    type: 'ink',
    rects_json: '[{"x":0,"y":0,"w":0.1,"h":0.1}]',
    color: '#fff',
    note: null,
    created_at: '2026-01-02T00:00:00.000Z',
    updated_at: 1
  }
  assert.equal(remoteRowToAnnotation(remote, undefined)?.type, 'highlight')
})

test('localUpdatedAt is the max across paper, annotations, reading state', () => {
  const annotations = [{ updatedAt: 300 }, { updatedAt: 200 }] as Annotation[]
  assert.equal(localUpdatedAt(paper, annotations, undefined), 300)
  assert.equal(
    localUpdatedAt(paper, [], { paperId: 'p1', lastPage: 2, scrollFraction: 0.5, updatedAt: 999 }),
    999
  )
})

test('remote collections with cycles or missing parents become roots', () => {
  const local = remoteCollectionsToLocal([
    { id: 'a', name: 'A', parent_id: 'b' },
    { id: 'b', name: 'B', parent_id: 'a' },
    { id: 'c', name: 'C', parent_id: 'missing' },
    { id: 'd', name: 'D', parent_id: 'a' },
    { id: 'e', name: 'E', parent_id: 'c' }
  ])
  const byId = new Map(local.map((c) => [c.id, c]))
  assert.equal(byId.get('a')?.parentId, null)
  assert.equal(byId.get('b')?.parentId, null)
  assert.equal(byId.get('c')?.parentId, null)
  // Desktop policy: any ancestor chain that hits a cycle drops the link too.
  assert.equal(byId.get('d')?.parentId, null)
  // A chain ending at a (repaired) root stays attached.
  assert.equal(byId.get('e')?.parentId, 'c')
})

test('library json uses desktop snake_case keys', () => {
  const library = buildLibraryJson(
    42,
    [{ id: 'c1', name: 'ML', parentId: null }],
    [{ paperId: 'p1', collectionId: 'c1' }],
    [{ id: 't1', name: 'rl' }],
    [{ paperId: 'p1', tagId: 't1' }]
  )
  assert.deepEqual(library.collections[0], { id: 'c1', name: 'ML', parent_id: null })
  assert.deepEqual(library.paper_collections[0], { paper_id: 'p1', collection_id: 'c1' })
  assert.deepEqual(library.paper_tags?.[0], { paper_id: 'p1', tag_id: 't1' })
})

test('sha256Hex matches a known digest', async () => {
  const digest = await sha256Hex(new TextEncoder().encode('abc'))
  assert.equal(digest, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})
