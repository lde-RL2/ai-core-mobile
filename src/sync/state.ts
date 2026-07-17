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

  /** Download-only mode: pull remote changes but never upload this device's
   *  edits. Keeps phone/tablet edits local so they never reach Notion/Drive or
   *  the desktop app. Defaults on — the mobile row shape is a subset of the
   *  desktop's, so pushing would strip desktop-only paper metadata. */
  readOnlySync: boolean

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

// Deploy-time defaults, the mobile counterpart of the desktop app's bundled
// OAuth credentials (buildConfig.ts): the app owner bakes these into the
// build once (GitHub repo variables → workflow env), and friends only press
// "로그인" / enter their own Notion token — same UX as the desktop app.
// Neither value is a secret: both ship inside the public JS bundle anyway.
const BUNDLED_GOOGLE_CLIENT_ID =
  (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() || null
const BUNDLED_NOTION_PROXY_URL =
  (import.meta.env.VITE_NOTION_PROXY_URL as string | undefined)?.trim() || null

export function hasBundledGoogleClientId(): boolean {
  return BUNDLED_GOOGLE_CLIENT_ID !== null
}

export function hasBundledNotionProxy(): boolean {
  return BUNDLED_NOTION_PROXY_URL !== null
}

const DEFAULT_STATE: SyncState = {
  syncTarget: 'none',
  libraryUpdatedAt: 0,
  readOnlySync: true,
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
  let state: SyncState
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    state = raw
      ? { ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<SyncState>) }
      : { ...DEFAULT_STATE }
  } catch {
    state = { ...DEFAULT_STATE }
  }
  if (!state.googleClientId) state.googleClientId = BUNDLED_GOOGLE_CLIENT_ID
  if (!state.notionProxyUrl) state.notionProxyUrl = BUNDLED_NOTION_PROXY_URL
  return state
}

export function saveSyncState(state: SyncState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function updateSyncState(patch: Partial<SyncState>): SyncState {
  const next = { ...loadSyncState(), ...patch }
  saveSyncState(next)
  return next
}

/** Drop all persisted sync bookkeeping (part of the local-data reset). */
export function resetSyncState(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function usesGoogleDrive(target: SyncTarget = loadSyncState().syncTarget): boolean {
  return target === 'google-drive' || target === 'both'
}

export function usesNotion(target: SyncTarget = loadSyncState().syncTarget): boolean {
  return target === 'notion' || target === 'both'
}

/** True when this device only downloads and never uploads. */
export function isReadOnlySync(): boolean {
  return loadSyncState().readOnlySync
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
