// Browser port of the desktop app's driveSync.ts. Uses the exact same Drive
// layout (PaperManager/{pdfs,meta}, appProperties keys, library.json) so the
// desktop and mobile apps sync one shared library.
import * as db from '../storage/db'
import {
  createFolder,
  downloadFile,
  listFiles,
  trashFile,
  updateFile,
  uploadFile
} from './driveClient'
import { getDriveAuthStatus } from './driveAuth'
import {
  LIBRARY_REVISION_KEY,
  addDirty,
  driveLibraryRevisions,
  drivePaperRevisions,
  loadSyncState,
  removeDirty,
  updateSyncState,
  usesGoogleDrive,
  type DriveFolderIds
} from './state'
import { notifySyncChanged, setProviderSyncStatus, type SyncStatus } from './status'
import {
  applyLibrarySnapshot,
  applyRemoteMeta,
  buildLibrarySnapshot,
  buildPaperMeta,
  computeLocalUpdatedAt,
  deleteLocalPaper
} from './localData'
import { META_SCHEMA_VERSION, sha256Hex, type LibraryJson, type PaperMeta } from './format'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

let queue: Promise<void> = Promise.resolve()

function setStatus(status: SyncStatus, error: string | null = null): void {
  setProviderSyncStatus('google-drive', status, error)
}

export function driveSyncEnabled(): boolean {
  return usesGoogleDrive() && getDriveAuthStatus() === 'signed_in'
}

export function refreshDriveSyncStatus(): void {
  setStatus(driveSyncEnabled() ? 'idle' : 'disabled')
}

/** Serialize sync work so Drive operations never interleave. */
function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch((error) => {
    setStatus('error', error instanceof Error ? error.message : String(error))
  })
  return queue
}

async function ensureFolders(): Promise<DriveFolderIds> {
  const state = loadSyncState()
  if (state.driveFolderIds) return state.driveFolderIds

  const existing = await listFiles(
    `appProperties has { key='pmRole' and value='root' } and trashed=false`
  )
  let rootId: string
  let pdfsId: string | null = null
  let metaId: string | null = null

  if (existing.length > 0) {
    rootId = existing[0].id
    const children = await listFiles(`'${rootId}' in parents and trashed=false`)
    pdfsId = children.find((f) => f.name === 'pdfs')?.id ?? null
    metaId = children.find((f) => f.name === 'meta')?.id ?? null
  } else {
    rootId = (await createFolder('PaperManager', null, { pmRole: 'root' })).id
  }
  if (!pdfsId) pdfsId = (await createFolder('pdfs', rootId, { pmRole: 'pdfs' })).id
  if (!metaId) metaId = (await createFolder('meta', rootId, { pmRole: 'meta' })).id

  const folderIds = { root: rootId, pdfs: pdfsId, meta: metaId }
  updateSyncState({ driveFolderIds: folderIds })
  return folderIds
}

function translationUpdatedAt(meta: PaperMeta): number {
  const translation = meta.translation as { updatedAt?: unknown } | undefined
  return typeof translation?.updatedAt === 'number' ? translation.updatedAt : 0
}

async function writeMetaFile(
  paperId: string,
  meta: PaperMeta,
  folders: DriveFolderIds
): Promise<void> {
  const matches = await listFiles(
    `'${folders.meta}' in parents and appProperties has { key='pmPaperId' and value='${paperId}' } and trashed=false`
  )
  // The desktop app stores a translation snapshot in the same meta file. The
  // mobile app doesn't know about translations, so preserve whatever snapshot
  // the existing remote meta carries instead of erasing it.
  if (
    !meta.deleted &&
    matches.length > 0 &&
    Number(matches[0].appProperties?.pmTranslationUpdatedAt ?? 0) > 0
  ) {
    try {
      const existing = JSON.parse(
        decoder.decode(await downloadFile(matches[0].id))
      ) as PaperMeta
      if (existing.translation) meta.translation = existing.translation
    } catch {
      // Preserving the snapshot is best-effort; the content sync still wins.
    }
  }

  const content = encoder.encode(JSON.stringify(meta))
  const props = {
    pmPaperId: paperId,
    pmUpdatedAt: String(meta.updatedAt),
    pmDeleted: meta.deleted ? '1' : '0',
    pmTranslationUpdatedAt: String(translationUpdatedAt(meta))
  }
  if (matches.length > 0) {
    await updateFile(matches[0].id, 'application/json', content, props)
  } else {
    await uploadFile({
      name: `${paperId}.json`,
      parentId: folders.meta,
      mimeType: 'application/json',
      content,
      appProperties: props
    })
  }
}

async function pushPaper(paperId: string, folders: DriveFolderIds): Promise<void> {
  const meta = await buildPaperMeta(paperId)
  if (!meta) return

  // PDFs are immutable — upload only if not already in Drive.
  const pdfMatches = await listFiles(
    `'${folders.pdfs}' in parents and appProperties has { key='pmPaperId' and value='${paperId}' } and trashed=false`
  )
  if (pdfMatches.length === 0) {
    const blob = await db.getPdfFile(paperId)
    if (blob) {
      await uploadFile({
        name: `${paperId}.pdf`,
        parentId: folders.pdfs,
        mimeType: 'application/pdf',
        content: new Uint8Array(await blob.arrayBuffer()),
        appProperties: { pmPaperId: paperId }
      })
    }
  }
  await writeMetaFile(paperId, meta, folders)
}

async function pushDeletion(
  paperId: string,
  deletedAt: number,
  folders: DriveFolderIds
): Promise<void> {
  const pdfMatches = await listFiles(
    `'${folders.pdfs}' in parents and appProperties has { key='pmPaperId' and value='${paperId}' } and trashed=false`
  )
  for (const file of pdfMatches) await trashFile(file.id)
  await writeMetaFile(
    paperId,
    { schemaVersion: META_SCHEMA_VERSION, updatedAt: deletedAt, deleted: true },
    folders
  )
}

export function markDriveDirty(paperId: string): void {
  drivePaperRevisions.mark(paperId)
  addDirty('driveDirty', paperId)
}

export function markDriveLibraryDirty(): void {
  driveLibraryRevisions.mark(LIBRARY_REVISION_KEY)
  updateSyncState({ libraryUpdatedAt: Date.now(), driveLibraryDirty: true })
}

export function markAllDriveDirty(paperIds: string[]): void {
  for (const id of paperIds) {
    drivePaperRevisions.mark(id)
    addDirty('driveDirty', id)
  }
  markDriveLibraryDirty()
}

async function pushLibrary(folders: DriveFolderIds): Promise<void> {
  const library = await buildLibrarySnapshot()
  const content = encoder.encode(JSON.stringify(library))
  const props = { pmRole: 'library', pmUpdatedAt: String(library.updatedAt) }
  const matches = await listFiles(
    `'${folders.root}' in parents and appProperties has { key='pmRole' and value='library' } and trashed=false`
  )
  if (matches.length > 0) {
    await updateFile(matches[0].id, 'application/json', content, props)
  } else {
    await uploadFile({
      name: 'library.json',
      parentId: folders.root,
      mimeType: 'application/json',
      content,
      appProperties: props
    })
  }
}

async function pullLibrary(folders: DriveFolderIds): Promise<boolean> {
  const matches = await listFiles(
    `'${folders.root}' in parents and appProperties has { key='pmRole' and value='library' } and trashed=false`
  )
  if (matches.length === 0) return false
  const remoteUpdatedAt = Number(matches[0].appProperties?.pmUpdatedAt ?? 0)
  if (remoteUpdatedAt <= loadSyncState().libraryUpdatedAt) return false

  const revision = driveLibraryRevisions.snapshot(LIBRARY_REVISION_KEY)
  const library = JSON.parse(decoder.decode(await downloadFile(matches[0].id))) as LibraryJson
  if (
    !driveLibraryRevisions.isCurrent(LIBRARY_REVISION_KEY, revision) ||
    remoteUpdatedAt <= loadSyncState().libraryUpdatedAt
  ) {
    return false
  }
  await applyLibrarySnapshot(library)
  updateSyncState({ driveLibraryDirty: false })
  return true
}

export function flushDriveDirty(): Promise<void> {
  return enqueue(async () => {
    if (!driveSyncEnabled()) return
    const state = loadSyncState()
    const tombstones = await db.listTombstones()
    if (state.driveDirty.length === 0 && !state.driveLibraryDirty) return

    setStatus('syncing')
    const folders = await ensureFolders()
    let needsAnotherFlush = false

    for (const paperId of state.driveDirty) {
      const revision = drivePaperRevisions.snapshot(paperId)
      const tombstone = tombstones.find((t) => t.id === paperId)
      if (tombstone) {
        await pushDeletion(paperId, tombstone.deletedAt, folders)
      } else {
        await pushPaper(paperId, folders)
      }
      if (drivePaperRevisions.forgetIfCurrent(paperId, revision)) {
        removeDirty('driveDirty', paperId)
      } else {
        needsAnotherFlush = true
      }
    }

    if (loadSyncState().driveLibraryDirty) {
      const revision = driveLibraryRevisions.snapshot(LIBRARY_REVISION_KEY)
      await pushLibrary(folders)
      if (driveLibraryRevisions.forgetIfCurrent(LIBRARY_REVISION_KEY, revision)) {
        updateSyncState({ driveLibraryDirty: false })
      } else {
        needsAnotherFlush = true
      }
    }
    setStatus('idle')
    if (needsAnotherFlush) void flushDriveDirty()
  })
}

export function runDrivePull(): Promise<void> {
  return enqueue(async () => {
    if (!driveSyncEnabled()) return
    setStatus('syncing')
    const folders = await ensureFolders()
    let changed = false

    const metaFiles = await listFiles(`'${folders.meta}' in parents and trashed=false`)
    for (const metaFile of metaFiles) {
      const paperId = metaFile.appProperties?.pmPaperId
      if (!paperId) continue
      const remoteUpdatedAt = Number(metaFile.appProperties?.pmUpdatedAt ?? 0)
      const remoteDeleted = metaFile.appProperties?.pmDeleted === '1'
      const localPaper = await db.getPaper(paperId)
      const tombstone = await db.getTombstone(paperId)

      if (remoteDeleted) {
        if (localPaper) {
          if ((await computeLocalUpdatedAt(paperId)) > remoteUpdatedAt) {
            markDriveDirty(paperId) // local edits after the delete win — resurrect remotely
          } else {
            await deleteLocalPaper(paperId, remoteUpdatedAt)
            changed = true
          }
        }
        continue
      }

      if (tombstone) {
        if (remoteUpdatedAt > tombstone.deletedAt) {
          // Edited on another machine after we deleted here — resurrect locally.
          await db.removeTombstone(paperId)
        } else {
          markDriveDirty(paperId) // push our deletion
          continue
        }
      }

      if (!localPaper) {
        const pdfMatches = await listFiles(
          `'${folders.pdfs}' in parents and appProperties has { key='pmPaperId' and value='${paperId}' } and trashed=false`
        )
        if (pdfMatches.length === 0) continue
        const meta = JSON.parse(decoder.decode(await downloadFile(metaFile.id))) as PaperMeta
        const pdfBytes = await downloadFile(pdfMatches[0].id)
        const actualHash = await sha256Hex(pdfBytes)
        if (meta.paper?.content_hash && meta.paper.content_hash !== actualHash) {
          throw new Error(`Drive PDF checksum mismatch for paper ${paperId}.`)
        }
        if (meta.paper) {
          meta.paper.content_hash = actualHash
          meta.paper.file_size = pdfBytes.byteLength
        }
        await db.savePdfFile(
          paperId,
          new Blob([Uint8Array.from(pdfBytes).buffer], { type: 'application/pdf' })
        )
        await applyRemoteMeta(meta)
        changed = true
      } else {
        const localContentUpdatedAt = await computeLocalUpdatedAt(paperId)
        if (remoteUpdatedAt > localContentUpdatedAt) {
          const revision = drivePaperRevisions.snapshot(paperId)
          const meta = JSON.parse(decoder.decode(await downloadFile(metaFile.id))) as PaperMeta
          if (
            drivePaperRevisions.isCurrent(paperId, revision) &&
            remoteUpdatedAt > (await computeLocalUpdatedAt(paperId))
          ) {
            await applyRemoteMeta(meta)
            changed = true
          } else {
            markDriveDirty(paperId)
          }
        } else if (remoteUpdatedAt < localContentUpdatedAt) {
          markDriveDirty(paperId)
        }
      }
    }

    if (await pullLibrary(folders)) changed = true

    setStatus('idle')
    if (changed) notifySyncChanged()
  })
}
