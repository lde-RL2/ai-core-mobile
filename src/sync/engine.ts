// Glue between local mutations and the two sync providers: marks dirty state
// via db hooks, debounces pushes, and runs pulls on startup / on demand.
import * as db from '../storage/db'
import { loadSyncState, updateSyncState, usesGoogleDrive, usesNotion } from './state'
import {
  driveSyncEnabled,
  flushDriveDirty,
  markAllDriveDirty,
  markDriveDirty,
  markDriveLibraryDirty,
  refreshDriveSyncStatus,
  runDrivePull
} from './driveSync'
import {
  flushNotionDirty,
  markAllNotionDirty,
  markNotionDirty,
  markNotionLibraryDirty,
  notionSyncEnabled,
  refreshNotionSyncStatus,
  runNotionPull
} from './notionSync'

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
  if (driveSyncEnabled()) {
    await runDrivePull()
    await flushDriveDirty()
  }
  if (notionSyncEnabled()) {
    await runNotionPull()
    await flushNotionDirty()
  }
  updateSyncState({ lastSyncAt: Date.now() })
}

/** Queue the entire local library for upload — used right after enabling a
 *  provider or importing a backup, like the desktop's markAll*Dirty. */
export async function markAllLocalDirty(): Promise<void> {
  const papers = await db.listPapers()
  const ids = papers.map((paper) => paper.id)
  if (usesGoogleDrive()) markAllDriveDirty(ids)
  if (usesNotion()) markAllNotionDirty(ids)
  scheduleFlush()
}

export function getLastSyncAt(): number | null {
  return loadSyncState().lastSyncAt
}
