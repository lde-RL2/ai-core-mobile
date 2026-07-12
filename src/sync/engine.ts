// Glue between local mutations and the two sync providers: marks dirty state
// via db hooks, debounces pushes, and runs pulls on startup / on demand.
import * as db from '../storage/db'
import { loadSyncState, updateSyncState, usesGoogleDrive, usesNotion } from './state'
import { getProviderSyncStatus } from './status'
import {
  driveSyncEnabled,
  flushDriveDirty,
  markDriveDirty,
  markDriveLibraryDirty,
  refreshDriveSyncStatus,
  runDrivePull
} from './driveSync'
import {
  flushNotionDirty,
  markNotionDirty,
  markNotionLibraryDirty,
  notionSyncEnabled,
  refreshNotionSyncStatus,
  runNotionPull
} from './notionSync'
import { localLibraryHasStructure } from './localData'

const PUSH_DEBOUNCE_MS = 5000

let flushTimer: number | null = null

function scheduleFlush(): void {
  if (flushTimer !== null) window.clearTimeout(flushTimer)
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushAll()
  }, PUSH_DEBOUNCE_MS)
}

async function flushAll(): Promise<void> {
  if (driveSyncEnabled()) await flushDriveDirty()
  if (notionSyncEnabled()) await flushNotionDirty()
}

async function pullAll(): Promise<void> {
  if (driveSyncEnabled()) await runDrivePull()
  if (notionSyncEnabled()) await runNotionPull()
}

/** The provider queues swallow errors into their status, so a completed
 *  promise does not mean success. Only report a sync as done when no enabled
 *  provider ended in an error state. */
function everyEnabledProviderHealthy(): boolean {
  if (driveSyncEnabled() && getProviderSyncStatus('google-drive').status === 'error') return false
  if (notionSyncEnabled() && getProviderSyncStatus('notion').status === 'error') return false
  return true
}

function recordSyncCompletion(): void {
  if (everyEnabledProviderHealthy()) updateSyncState({ lastSyncAt: Date.now() })
}

export function initSyncEngine(): void {
  db.setSyncHooks({
    paperChanged: (paperId) => {
      if (usesGoogleDrive()) markDriveDirty(paperId)
      if (usesNotion()) markNotionDirty(paperId)
      scheduleFlush()
    },
    paperDeleted: (paperId) => {
      if (usesGoogleDrive()) markDriveDirty(paperId)
      if (usesNotion()) markNotionDirty(paperId)
      scheduleFlush()
    },
    libraryChanged: () => {
      if (usesGoogleDrive()) markDriveLibraryDirty()
      if (usesNotion()) markNotionLibraryDirty()
      scheduleFlush()
    }
  })
  refreshDriveSyncStatus()
  refreshNotionSyncStatus()
  if (driveSyncEnabled() || notionSyncEnabled()) {
    void syncNow().catch(() => {
      // Provider status already carries the error for the settings screen.
    })
  }
}

/** Full pull + push cycle for every enabled provider. */
export async function syncNow(): Promise<void> {
  await pullAll()
  await flushAll()
  recordSyncCompletion()
}

/** Queue the local library for upload after enabling a provider or importing
 *  a backup. Mirrors the desktop's markAll*Dirty: papers are always queued,
 *  but the library timestamp is only stamped when local structure actually
 *  exists — a fresh empty device must never outrank the remote folder tree. */
export async function markAllLocalDirty(): Promise<void> {
  const papers = await db.listPapers()
  for (const paper of papers) {
    if (usesGoogleDrive()) markDriveDirty(paper.id)
    if (usesNotion()) markNotionDirty(paper.id)
  }
  if (await localLibraryHasStructure()) {
    if (usesGoogleDrive()) markDriveLibraryDirty()
    if (usesNotion()) markNotionLibraryDirty()
  }
  scheduleFlush()
}

/** First sync after connecting a provider: adopt the remote state before
 *  queueing local content, so a fresh device downloads the existing library
 *  instead of overwriting it. */
export async function firstSyncAfterConnect(): Promise<void> {
  await pullAll()
  await markAllLocalDirty()
  await flushAll()
  recordSyncCompletion()
}

export function getLastSyncAt(): number | null {
  return loadSyncState().lastSyncAt
}
