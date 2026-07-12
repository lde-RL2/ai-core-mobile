// Browser port of the desktop app's notionSync.ts. Mirrors papers into the
// same "AI-Core Papers" Notion database (identical properties and chunked-PDF
// format), so desktop and mobile share one Notion mirror.
import * as db from '../storage/db'
import {
  createNotionPage,
  createPapersDatabase,
  downloadNotionFile,
  findPapersDatabase,
  getNotionBot,
  queryAllNotionPages,
  queryPageByAiCoreId,
  retrieveDatabase,
  retrieveDataSource,
  retrieveNotionPage,
  trashNotionPage,
  updateNotionPage,
  uploadBuffer,
  type NotionPage
} from './notionClient'
import {
  LIBRARY_REVISION_KEY,
  addDirty,
  loadSyncState,
  notionLibraryRevisions,
  notionPaperRevisions,
  removeDirty,
  updateSyncState,
  usesGoogleDrive,
  usesNotion
} from './state'
import { notifySyncChanged, setProviderSyncStatus, type SyncStatus } from './status'
import {
  MAX_NOTION_PDF_ATTACHMENTS,
  createNotionChunk,
  createNotionPdfManifest,
  extractAndVerifyNotionChunk,
  notionChunkCount,
  notionChunkPayloadLimit,
  parseNotionPdfManifest,
  type NotionPdfChunk
} from './notionChunks'
import {
  applyLibrarySnapshot,
  applyRemoteMeta,
  buildLibrarySnapshot,
  buildPaperMeta,
  computeLocalUpdatedAt
} from './localData'
import { sha256Hex, type LibraryJson, type PaperMeta } from './format'
import { markDriveDirty, markDriveLibraryDirty } from './driveSync'

const LIBRARY_ID = '__library__'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface UploadedAttachment {
  id: string
  name: string
}

interface StoredAttachment {
  name: string
  url: string
}

let queue: Promise<void> = Promise.resolve()

function setStatus(status: SyncStatus, error: string | null = null): void {
  setProviderSyncStatus('notion', status, error)
}

export function isNotionConnected(): boolean {
  const state = loadSyncState()
  return !!state.notionAccessToken && !!state.notionParentPageId && !!state.notionProxyUrl
}

export function notionSyncEnabled(): boolean {
  return usesNotion() && isNotionConnected()
}

export function refreshNotionSyncStatus(): void {
  setStatus(notionSyncEnabled() ? 'idle' : 'disabled')
}

function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch((error) => {
    setStatus('error', error instanceof Error ? error.message : String(error))
  })
  return queue
}

async function ensureDataSource(): Promise<string> {
  let state = loadSyncState()
  if (!isNotionConnected()) {
    throw new Error('Notion token and parent page are required.')
  }
  if (state.notionDataSourceId) {
    try {
      await retrieveDataSource(state.notionDataSourceId)
      return state.notionDataSourceId
    } catch {
      state = updateSyncState({ notionDataSourceId: null, notionDatabaseId: null })
    }
  }
  if (state.notionDatabaseId) {
    const database = await retrieveDatabase(state.notionDatabaseId)
    const dataSourceId = database.data_sources?.[0]?.id
    if (dataSourceId) {
      updateSyncState({ notionDataSourceId: dataSourceId })
      return dataSourceId
    }
  }

  const existingDatabase = await findPapersDatabase(state.notionParentPageId!)
  const existingDataSourceId = existingDatabase?.data_sources?.[0]?.id
  if (existingDatabase && existingDataSourceId) {
    updateSyncState({
      notionDatabaseId: existingDatabase.id,
      notionDataSourceId: existingDataSourceId
    })
    return existingDataSourceId
  }

  const database = await createPapersDatabase(state.notionParentPageId!)
  const dataSourceId = database.data_sources?.[0]?.id
  if (!dataSourceId) throw new Error('Notion created the database without a data source.')
  updateSyncState({ notionDatabaseId: database.id, notionDataSourceId: dataSourceId })
  return dataSourceId
}

function rememberPageId(aiCoreId: string, pageId: string): void {
  const state = loadSyncState()
  updateSyncState({ notionPageIds: { ...state.notionPageIds, [aiCoreId]: pageId } })
}

function forgetPageId(aiCoreId: string): void {
  const pageIds = { ...loadSyncState().notionPageIds }
  delete pageIds[aiCoreId]
  updateSyncState({ notionPageIds: pageIds })
}

async function findPage(dataSourceId: string, aiCoreId: string): Promise<string | null> {
  const cached = loadSyncState().notionPageIds[aiCoreId]
  if (cached) return cached
  const found = await queryPageByAiCoreId(dataSourceId, aiCoreId)
  if (!found) return null
  rememberPageId(aiCoreId, found.id)
  return found.id
}

function richText(content: string | null | undefined): object {
  return { rich_text: content ? [{ type: 'text', text: { content: content.slice(0, 2000) } }] : [] }
}

function propertyObject(
  page: { properties?: Record<string, unknown> },
  name: string
): Record<string, unknown> | null {
  const property = page.properties?.[name]
  return property && typeof property === 'object' ? (property as Record<string, unknown>) : null
}

function readRichText(page: { properties?: Record<string, unknown> }, name: string): string | null {
  const values = propertyObject(page, name)?.rich_text
  if (!Array.isArray(values)) return null
  return values
    .map((value) => {
      if (!value || typeof value !== 'object') return ''
      const item = value as { plain_text?: unknown; text?: { content?: unknown } }
      if (typeof item.plain_text === 'string') return item.plain_text
      return typeof item.text?.content === 'string' ? item.text.content : ''
    })
    .join('')
}

function readStoredAttachments(
  page: { properties?: Record<string, unknown> },
  name: string
): StoredAttachment[] {
  const files = propertyObject(page, name)?.files
  if (!Array.isArray(files)) return []
  const attachments: StoredAttachment[] = []
  for (const value of files) {
    if (!value || typeof value !== 'object') continue
    const file = value as { name?: unknown; file?: { url?: unknown } }
    if (typeof file.name === 'string' && typeof file.file?.url === 'string') {
      attachments.push({ name: file.name, url: file.file.url })
    }
  }
  return attachments
}

async function uploadPdfAttachments(
  paperId: string,
  bytes: Uint8Array,
  originalFilename: string
): Promise<UploadedAttachment[]> {
  const size = bytes.byteLength
  const bot = await getNotionBot()
  const fileLimit = bot.bot?.workspace_limits?.max_file_upload_size_in_bytes
  if (!fileLimit || size <= fileLimit) {
    const id = await uploadBuffer(originalFilename, 'application/pdf', bytes)
    return [{ id, name: originalFilename }]
  }

  const payloadLimit = notionChunkPayloadLimit(fileLimit)
  const count = notionChunkCount(size, payloadLimit)
  if (count + 1 > MAX_NOTION_PDF_ATTACHMENTS) {
    throw new Error(
      `This PDF needs ${count} Notion chunks. AI-Core supports at most ${MAX_NOTION_PDF_ATTACHMENTS - 1} chunks per paper; choose Drive for this file.`
    )
  }

  const generation = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  const chunks: NotionPdfChunk[] = []
  const uploads: UploadedAttachment[] = []
  for (let index = 0; index < count; index += 1) {
    const start = index * payloadLimit
    const payload = bytes.subarray(start, Math.min(size, start + payloadLimit))
    const packed = await createNotionChunk(paperId, generation, index, payload)
    if (packed.archive.byteLength > fileLimit) {
      throw new Error(`Notion PDF part ${index + 1} exceeds the workspace file limit.`)
    }
    const id = await uploadBuffer(
      packed.descriptor.archiveFilename,
      'application/zip',
      packed.archive
    )
    uploads.push({ id, name: packed.descriptor.archiveFilename })
    chunks.push(packed.descriptor)
  }

  const manifest = createNotionPdfManifest({
    paperId,
    originalFilename,
    originalSize: size,
    originalSha256: await sha256Hex(bytes),
    chunks,
    generation
  })
  const manifestName = `${paperId}.${generation}.manifest.json`
  const manifestContent = encoder.encode(JSON.stringify(manifest))
  if (manifestContent.byteLength > fileLimit) {
    throw new Error('The Notion PDF manifest exceeds the workspace file limit.')
  }
  const manifestId = await uploadBuffer(manifestName, 'application/json', manifestContent)
  return [{ id: manifestId, name: manifestName }, ...uploads]
}

async function paperProperties(
  meta: PaperMeta,
  metaUploadId: string,
  pdfUploads?: UploadedAttachment[]
): Promise<Record<string, unknown>> {
  const paper = meta.paper
  if (!paper) throw new Error('Paper metadata is missing.')
  const [tagIds, allTags] = await Promise.all([
    db.listTagIdsForPaper(paper.id),
    db.listTags()
  ])
  const tagNames = allTags
    .filter((tag) => tagIds.includes(tag.id))
    .map((tag) => tag.name)
    .sort((a, b) => a.localeCompare(b))
  return {
    Name: { title: [{ type: 'text', text: { content: paper.title.slice(0, 2000) } }] },
    'AI-Core ID': richText(paper.id),
    Authors: richText(paper.authors),
    Year: { number: paper.year },
    DOI: richText(paper.doi),
    Tags: { multi_select: tagNames.slice(0, 100).map((name) => ({ name: name.slice(0, 100) })) },
    Added: { date: paper.added_at ? { start: paper.added_at } : null },
    Updated: { number: meta.updatedAt },
    'AI-Core Data': {
      files: [{ type: 'file_upload', file_upload: { id: metaUploadId } }]
    },
    ...(pdfUploads
      ? {
          PDF: {
            files: pdfUploads.map((upload) => ({
              type: 'file_upload',
              file_upload: { id: upload.id },
              name: upload.name
            }))
          }
        }
      : {})
  }
}

/** Preserve the desktop's translation snapshot when this device rewrites the
 *  meta attachment (the mobile app never produces one itself). */
async function preserveRemoteTranslation(meta: PaperMeta, pageId: string): Promise<void> {
  try {
    const page = await retrieveNotionPage(pageId)
    const dataFile = readStoredAttachments(page, 'AI-Core Data').find((file) =>
      file.name.endsWith('.json')
    )
    if (!dataFile) return
    const existing = JSON.parse(decoder.decode(await downloadNotionFile(dataFile.url))) as PaperMeta
    if (existing.translation) meta.translation = existing.translation
  } catch {
    // Best-effort only.
  }
}

async function pushPaper(paperId: string, dataSourceId: string): Promise<void> {
  const meta = await buildPaperMeta(paperId)
  if (!meta?.paper) return

  let pageId = await findPage(dataSourceId, paperId)
  if (pageId) await preserveRemoteTranslation(meta, pageId)
  const metaUploadId = await uploadBuffer(
    `${paperId}.json`,
    'application/json',
    encoder.encode(JSON.stringify(meta))
  )
  if (pageId) {
    try {
      await updateNotionPage(pageId, await paperProperties(meta, metaUploadId))
      return
    } catch (error) {
      if (!(error instanceof Error) || !/Notion API 404/.test(error.message)) throw error
      forgetPageId(paperId)
      pageId = null
    }
  }

  const blob = await db.getPdfFile(paperId)
  if (!blob) return
  const pdfUploads = await uploadPdfAttachments(
    paperId,
    new Uint8Array(await blob.arrayBuffer()),
    meta.paper.original_filename
  )
  const page = await createNotionPage(
    dataSourceId,
    await paperProperties(meta, metaUploadId, pdfUploads)
  )
  rememberPageId(paperId, page.id)
}

async function pushDeletion(paperId: string, dataSourceId: string): Promise<void> {
  const pageId = await findPage(dataSourceId, paperId)
  if (pageId) await trashNotionPage(pageId)
  forgetPageId(paperId)
}

async function restorePdfFromNotion(
  paperId: string,
  attachments: StoredAttachment[]
): Promise<Uint8Array> {
  const manifestFile = attachments.find((file) => file.name.endsWith('.manifest.json'))
  if (!manifestFile) {
    const pdf = attachments.find((file) => file.name.toLowerCase().endsWith('.pdf'))
    if (!pdf) throw new Error(`Notion paper ${paperId} has no PDF or chunk manifest.`)
    const content = await downloadNotionFile(pdf.url)
    const head = decoder.decode(content.subarray(0, 1024))
    if (!head.includes('%PDF-')) throw new Error(`Notion paper ${paperId} is not a valid PDF.`)
    return content
  }

  const manifest = parseNotionPdfManifest(await downloadNotionFile(manifestFile.url))
  if (manifest.paperId !== paperId) throw new Error('Notion PDF manifest paper ID mismatch.')
  const attachmentByName = new Map(attachments.map((file) => [file.name, file]))
  const restored = new Uint8Array(manifest.originalSize)
  let restoredSize = 0
  for (const descriptor of manifest.chunks) {
    const stored = attachmentByName.get(descriptor.archiveFilename)
    if (!stored) throw new Error(`Notion PDF part ${descriptor.index + 1} is missing.`)
    const archive = await downloadNotionFile(stored.url)
    const payload = await extractAndVerifyNotionChunk(descriptor, archive)
    if (restoredSize + payload.byteLength > manifest.originalSize) {
      throw new Error('Restored Notion PDF is larger than its manifest.')
    }
    restored.set(payload, restoredSize)
    restoredSize += payload.byteLength
  }
  if (restoredSize !== manifest.originalSize) {
    throw new Error('Restored Notion PDF size does not match its manifest.')
  }
  if ((await sha256Hex(restored)) !== manifest.originalSha256) {
    throw new Error('Restored Notion PDF checksum does not match its manifest.')
  }
  return restored
}

async function pullNotionPages(dataSourceId: string): Promise<boolean> {
  const pages = await queryAllNotionPages(dataSourceId)
  let changed = false
  let remoteLibrary: (LibraryJson & { schemaVersion?: number }) | null = null
  const libraryRevision = notionLibraryRevisions.snapshot(LIBRARY_REVISION_KEY)

  for (const listedPage of pages) {
    const page: NotionPage = listedPage.properties
      ? listedPage
      : await retrieveNotionPage(listedPage.id)
    const aiCoreId = readRichText(page, 'AI-Core ID')
    if (!aiCoreId) continue
    rememberPageId(aiCoreId, page.id)
    const dataFile = readStoredAttachments(page, 'AI-Core Data').find((file) =>
      file.name.endsWith('.json')
    )
    if (!dataFile) continue
    const paperRevision = notionPaperRevisions.snapshot(aiCoreId)
    const data = await downloadNotionFile(dataFile.url)

    if (aiCoreId === LIBRARY_ID) {
      const parsed = JSON.parse(decoder.decode(data)) as LibraryJson & { schemaVersion?: number }
      if (parsed.schemaVersion === 1) remoteLibrary = parsed
      continue
    }

    const meta = JSON.parse(decoder.decode(data)) as PaperMeta
    if (!meta.paper || meta.paper.id !== aiCoreId) continue
    const localPaper = await db.getPaper(aiCoreId)
    const tombstone = await db.getTombstone(aiCoreId)
    if (tombstone && tombstone.deletedAt >= meta.updatedAt) {
      markNotionDirty(aiCoreId)
      continue
    }
    if (tombstone) await db.removeTombstone(aiCoreId)

    if (!localPaper) {
      const fullPage = await retrieveNotionPage(page.id)
      const pdfBytes = await restorePdfFromNotion(
        aiCoreId,
        readStoredAttachments(fullPage, 'PDF')
      )
      const actualHash = await sha256Hex(pdfBytes)
      if (meta.paper.content_hash && meta.paper.content_hash !== actualHash) {
        throw new Error(`Notion PDF checksum mismatch for paper ${aiCoreId}.`)
      }
      meta.paper.content_hash = actualHash
      meta.paper.file_size = pdfBytes.byteLength
      await db.savePdfFile(
        aiCoreId,
        new Blob([Uint8Array.from(pdfBytes).buffer], { type: 'application/pdf' })
      )
      await applyRemoteMeta(meta)
      removeDirty('notionDirty', aiCoreId)
      if (usesGoogleDrive()) markDriveDirty(aiCoreId)
      changed = true
    } else if (meta.updatedAt > (await computeLocalUpdatedAt(aiCoreId))) {
      if (notionPaperRevisions.isCurrent(aiCoreId, paperRevision)) {
        await applyRemoteMeta(meta)
        removeDirty('notionDirty', aiCoreId)
        if (usesGoogleDrive()) markDriveDirty(aiCoreId)
        changed = true
      } else {
        markNotionDirty(aiCoreId)
      }
    } else if (meta.updatedAt < (await computeLocalUpdatedAt(aiCoreId))) {
      markNotionDirty(aiCoreId)
    }
  }

  if (
    remoteLibrary &&
    remoteLibrary.updatedAt > loadSyncState().libraryUpdatedAt &&
    notionLibraryRevisions.isCurrent(LIBRARY_REVISION_KEY, libraryRevision)
  ) {
    await applyLibrarySnapshot(remoteLibrary)
    updateSyncState({ notionLibraryDirty: false })
    if (usesGoogleDrive()) markDriveLibraryDirty()
    changed = true
  }
  return changed
}

async function pushLibrary(dataSourceId: string): Promise<void> {
  const library = { schemaVersion: 1 as const, ...(await buildLibrarySnapshot()) }
  const uploadId = await uploadBuffer(
    'library.json',
    'application/json',
    encoder.encode(JSON.stringify(library))
  )
  const properties = {
    Name: { title: [{ type: 'text', text: { content: 'AI-Core Library State' } }] },
    'AI-Core ID': richText(LIBRARY_ID),
    Updated: { number: library.updatedAt },
    'AI-Core Data': { files: [{ type: 'file_upload', file_upload: { id: uploadId } }] }
  }
  const pageId = await findPage(dataSourceId, LIBRARY_ID)
  if (pageId) {
    await updateNotionPage(pageId, properties)
  } else {
    const page = await createNotionPage(dataSourceId, properties)
    rememberPageId(LIBRARY_ID, page.id)
  }
}

export function markNotionDirty(paperId: string): void {
  notionPaperRevisions.mark(paperId)
  addDirty('notionDirty', paperId)
}

export function markNotionLibraryDirty(): void {
  notionLibraryRevisions.mark(LIBRARY_REVISION_KEY)
  updateSyncState({ libraryUpdatedAt: Date.now(), notionLibraryDirty: true })
}

export function markAllNotionDirty(paperIds: string[]): void {
  for (const id of paperIds) {
    notionPaperRevisions.mark(id)
    addDirty('notionDirty', id)
  }
  markNotionLibraryDirty()
}

export function flushNotionDirty(): Promise<void> {
  return enqueue(async () => {
    if (!notionSyncEnabled()) return
    const state = loadSyncState()
    if (state.notionDirty.length === 0 && !state.notionLibraryDirty) return
    setStatus('syncing')
    const dataSourceId = await ensureDataSource()
    const tombstones = await db.listTombstones()
    const deleted = new Set(tombstones.map(({ id }) => id))
    let needsAnotherFlush = false

    for (const paperId of state.notionDirty) {
      const revision = notionPaperRevisions.snapshot(paperId)
      if (deleted.has(paperId)) await pushDeletion(paperId, dataSourceId)
      else await pushPaper(paperId, dataSourceId)
      if (notionPaperRevisions.forgetIfCurrent(paperId, revision)) {
        removeDirty('notionDirty', paperId)
      } else {
        needsAnotherFlush = true
      }
    }

    if (loadSyncState().notionLibraryDirty) {
      const revision = notionLibraryRevisions.snapshot(LIBRARY_REVISION_KEY)
      await pushLibrary(dataSourceId)
      if (notionLibraryRevisions.forgetIfCurrent(LIBRARY_REVISION_KEY, revision)) {
        updateSyncState({ notionLibraryDirty: false })
      } else {
        needsAnotherFlush = true
      }
    }
    setStatus('idle')
    notifySyncChanged()
    if (needsAnotherFlush) void flushNotionDirty()
  })
}

export function runNotionPull(): Promise<void> {
  return enqueue(async () => {
    if (!notionSyncEnabled()) return
    setStatus('syncing')
    const dataSourceId = await ensureDataSource()
    const changed = await pullNotionPages(dataSourceId)
    setStatus('idle')
    if (changed) notifySyncChanged()
  })
}

export async function testNotionConnection(): Promise<{
  workspace: string
  maxFileUploadBytes: number | null
}> {
  if (!isNotionConnected()) throw new Error('Notion token and parent page are required.')
  const bot = await getNotionBot()
  await ensureDataSource()
  await runNotionPull()
  await flushNotionDirty()
  return {
    workspace: bot.bot?.workspace_name ?? bot.name ?? 'Connected workspace',
    maxFileUploadBytes: bot.bot?.workspace_limits?.max_file_upload_size_in_bytes ?? null
  }
}

export function disconnectNotion(): void {
  updateSyncState({
    notionAccessToken: null,
    notionParentPageId: null,
    notionDatabaseId: null,
    notionDataSourceId: null,
    notionPageIds: {}
  })
  refreshNotionSyncStatus()
}
