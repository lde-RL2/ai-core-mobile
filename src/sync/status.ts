export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'error'
export type SyncProvider = 'google-drive' | 'notion'

export interface ProviderStatus {
  status: SyncStatus
  error: string | null
}

const statuses: Record<SyncProvider, ProviderStatus> = {
  'google-drive': { status: 'disabled', error: null },
  notion: { status: 'disabled', error: null }
}

export function setProviderSyncStatus(
  provider: SyncProvider,
  status: SyncStatus,
  error: string | null = null
): void {
  statuses[provider] = { status, error }
  window.dispatchEvent(new Event('aicore:sync-status'))
}

export function getProviderSyncStatus(provider: SyncProvider): ProviderStatus {
  return statuses[provider]
}

export function getAggregateSyncStatus(): ProviderStatus {
  const active = Object.values(statuses).filter((s) => s.status !== 'disabled')
  if (active.length === 0) return { status: 'disabled', error: null }
  const error = active.find((s) => s.status === 'error')
  if (error) return error
  if (active.some((s) => s.status === 'syncing')) return { status: 'syncing', error: null }
  return { status: 'idle', error: null }
}

/** Fired after a pull applied remote changes, so the UI can reload. */
export function notifySyncChanged(): void {
  window.dispatchEvent(new Event('aicore:sync-changed'))
}
