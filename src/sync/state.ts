// Persisted sync bookkeeping, the mobile counterpart of the desktop app's
// config.json sync fields. Lives in localStorage: small, synchronous, survives
// reloads. Secrets (Notion token) stay on-device like the desktop config file.
import { MutationRevisionTracker } from './policy'

export type SyncTarget = 'none' | 'google-drive' | 'notion' | 'both'

export interface DriveFolderIds {
  root: string
  pdfs: string
  meta: string
}

export interface SyncState {
  syncTarget: SyncTarget
  libraryUpdatedAt: number

  googleClientId: string | null
  driveFolderIds: DriveFolderIds | null
  driveDirty: string[]
  driveLibraryDirty: boolean

  notionProxyUrl: string | null
  notionAccessToken: string | null
  notionParentPageId: string | null
  notionDatabaseId: string | null
  notionDataSourceId: string | null
  notionPageIds: Record<string, string>
  notionDirty: string[]
  notionLibraryDirty: boolean

  lastSyncAt: number | null
}

const STORAGE_KEY = 'aicore.sync'

const DEFAULT_STATE: SyncState = {
  syncTarget: 'none',
  libraryUpdatedAt: 0,
  googleClientId: null,
  driveFolderIds: null,
  driveDirty: [],
  driveLibraryDirty: false,
  notionProxyUrl: null,
  notionAccessToken: null,
  notionParentPageId: null,
  notionDatabaseId: null,
  notionDataSourceId: null,
  notionPageIds: {},
  notionDirty: [],
  notionLibraryDirty: false,
  lastSyncAt: null
}

export function loadSyncState(): SyncState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_STATE }
    return { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<SyncState>) }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

export function saveSyncState(state: SyncState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function updateSyncState(patch: Partial<SyncState>): SyncState {
  const next = { ...loadSyncState(), ...patch }
  saveSyncState(next)
  return next
}

export function usesGoogleDrive(target: SyncTarget = loadSyncState().syncTarget): boolean {
  return target === 'google-drive' || target === 'both'
}

export function usesNotion(target: SyncTarget = loadSyncState().syncTarget): boolean {
  return target === 'notion' || target === 'both'
}

export function addDirty(key: 'driveDirty' | 'notionDirty', paperId: string): void {
  const state = loadSyncState()
  if (!state[key].includes(paperId)) {
    updateSyncState({ [key]: [...state[key], paperId] } as Partial<SyncState>)
  }
}

export function removeDirty(key: 'driveDirty' | 'notionDirty', paperId: string): void {
  const state = loadSyncState()
  updateSyncState({ [key]: state[key].filter((id) => id !== paperId) } as Partial<SyncState>)
}

// In-memory revision trackers shared by both providers (reset on reload —
// safe, because a reload also interrupts any in-flight upload).
export const drivePaperRevisions = new MutationRevisionTracker()
export const driveLibraryRevisions = new MutationRevisionTracker()
export const notionPaperRevisions = new MutationRevisionTracker()
export const notionLibraryRevisions = new MutationRevisionTracker()
export const LIBRARY_REVISION_KEY = 'library'
