import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  libraryHasStructure,
  shouldApplyRemoteLibrary
} from '../src/sync/librarySyncPolicy'

const base = {
  remoteUpdatedAt: 100,
  localUpdatedAt: 50,
  remoteHasStructure: true,
  localHasStructure: true,
  localDirty: false,
  revisionIsCurrent: true
}

test('fresh empty device adopts the remote folder tree even with a newer local timestamp', () => {
  // The v1.1.11 folder-loss scenario: a new device stamped libraryUpdatedAt
  // while connecting, so plain timestamp comparison would refuse the pull.
  assert.equal(
    shouldApplyRemoteLibrary({
      ...base,
      remoteUpdatedAt: 100,
      localUpdatedAt: 999, // stamped after remote
      localHasStructure: false,
      remoteHasStructure: true
    }),
    true
  )
})

test('an empty remote snapshot never erases an existing local collection tree', () => {
  assert.equal(
    shouldApplyRemoteLibrary({
      ...base,
      remoteUpdatedAt: 999, // remote looks newer
      localUpdatedAt: 100,
      localHasStructure: true,
      remoteHasStructure: false
    }),
    false
  )
})

test('a locally dirty library is never overwritten by a pull', () => {
  assert.equal(shouldApplyRemoteLibrary({ ...base, localDirty: true }), false)
})

test('a stale revision snapshot blocks the apply', () => {
  assert.equal(shouldApplyRemoteLibrary({ ...base, revisionIsCurrent: false }), false)
})

test('a genuinely newer remote snapshot with structure applies normally', () => {
  assert.equal(shouldApplyRemoteLibrary(base), true)
})

test('an older remote snapshot does not apply when both sides have structure', () => {
  assert.equal(
    shouldApplyRemoteLibrary({ ...base, remoteUpdatedAt: 10, localUpdatedAt: 50 }),
    false
  )
})

test('empty-to-empty devices do nothing', () => {
  assert.equal(
    shouldApplyRemoteLibrary({
      ...base,
      remoteUpdatedAt: 10,
      localUpdatedAt: 50,
      localHasStructure: false,
      remoteHasStructure: false
    }),
    false
  )
})

test('libraryHasStructure checks every table including optional tags', () => {
  assert.equal(
    libraryHasStructure({ collections: [], paper_collections: [] }),
    false
  )
  assert.equal(
    libraryHasStructure({ collections: [], paper_collections: [], tags: [{}], paper_tags: [] }),
    true
  )
  assert.equal(
    libraryHasStructure({ collections: [{}], paper_collections: [] }),
    true
  )
})
