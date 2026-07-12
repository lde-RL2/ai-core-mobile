// Browser port of the desktop app's notionChunks.ts (WebCrypto + fflate).
// Format-compatible: manifests/chunks written by either app restore on both.
import { unzipSync, zipSync } from 'fflate'
import { sha256Hex } from './format'

export const NOTION_CHUNK_SAFETY_BYTES = 256 * 1024
export const MAX_NOTION_PDF_ATTACHMENTS = 100

export interface NotionPdfChunk {
  index: number
  archiveFilename: string
  entryName: string
  payloadSize: number
  payloadSha256: string
  archiveSha256: string
}

export interface NotionPdfManifest {
  formatVersion: 1
  kind: 'ai-core-pdf-chunks'
  generation: string
  paperId: string
  originalFilename: string
  originalSize: number
  originalSha256: string
  createdAt: string
  chunks: NotionPdfChunk[]
}

export interface PackedNotionChunk {
  descriptor: NotionPdfChunk
  archive: Uint8Array
}

export function notionChunkPayloadLimit(fileLimit: number): number {
  if (!Number.isFinite(fileLimit) || fileLimit <= NOTION_CHUNK_SAFETY_BYTES + 64 * 1024) {
    throw new Error('Notion reported an unusable per-file upload limit.')
  }
  return Math.floor(fileLimit - NOTION_CHUNK_SAFETY_BYTES)
}

export function notionChunkCount(originalSize: number, payloadLimit: number): number {
  if (!Number.isFinite(originalSize) || originalSize < 0 || payloadLimit <= 0) {
    throw new Error('Invalid PDF chunk sizing input.')
  }
  return Math.max(1, Math.ceil(originalSize / payloadLimit))
}

export async function createNotionChunk(
  paperId: string,
  generation: string,
  index: number,
  payload: Uint8Array
): Promise<PackedNotionChunk> {
  const suffix = String(index + 1).padStart(3, '0')
  const entryName = `${paperId}.${generation}.part${suffix}`
  const archiveFilename = `${entryName}.zip`
  const archive = zipSync({ [entryName]: payload }, { level: 0 })
  return {
    descriptor: {
      index,
      archiveFilename,
      entryName,
      payloadSize: payload.byteLength,
      payloadSha256: await sha256Hex(payload),
      archiveSha256: await sha256Hex(archive)
    },
    archive
  }
}

export async function extractAndVerifyNotionChunk(
  descriptor: NotionPdfChunk,
  archive: Uint8Array
): Promise<Uint8Array> {
  if ((await sha256Hex(archive)) !== descriptor.archiveSha256) {
    throw new Error(`Notion PDF part ${descriptor.index + 1} archive checksum mismatch.`)
  }
  const files = unzipSync(archive)
  const payload = files[descriptor.entryName]
  if (!payload) throw new Error(`Notion PDF part ${descriptor.index + 1} is missing its payload.`)
  if (payload.byteLength !== descriptor.payloadSize) {
    throw new Error(`Notion PDF part ${descriptor.index + 1} has an unexpected size.`)
  }
  if ((await sha256Hex(payload)) !== descriptor.payloadSha256) {
    throw new Error(`Notion PDF part ${descriptor.index + 1} payload checksum mismatch.`)
  }
  return payload
}

export function createNotionPdfManifest(input: {
  paperId: string
  originalFilename: string
  originalSize: number
  originalSha256: string
  chunks: NotionPdfChunk[]
  generation?: string
}): NotionPdfManifest {
  return {
    formatVersion: 1,
    kind: 'ai-core-pdf-chunks',
    generation: input.generation ?? crypto.randomUUID(),
    paperId: input.paperId,
    originalFilename: input.originalFilename,
    originalSize: input.originalSize,
    originalSha256: input.originalSha256,
    createdAt: new Date().toISOString(),
    chunks: [...input.chunks].sort((a, b) => a.index - b.index)
  }
}

export function parseNotionPdfManifest(content: Uint8Array): NotionPdfManifest {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(content))
  } catch {
    throw new Error('Notion PDF manifest is not valid JSON.')
  }
  if (!value || typeof value !== 'object') throw new Error('Notion PDF manifest is invalid.')
  const manifest = value as Partial<NotionPdfManifest>
  if (
    manifest.formatVersion !== 1 ||
    manifest.kind !== 'ai-core-pdf-chunks' ||
    typeof manifest.paperId !== 'string' ||
    typeof manifest.originalFilename !== 'string' ||
    typeof manifest.originalSize !== 'number' ||
    typeof manifest.originalSha256 !== 'string' ||
    !Array.isArray(manifest.chunks)
  ) {
    throw new Error('Notion PDF manifest has an unsupported format.')
  }
  const indexes = new Set<number>()
  for (const chunk of manifest.chunks) {
    if (
      !chunk ||
      typeof chunk.index !== 'number' ||
      !Number.isInteger(chunk.index) ||
      chunk.index < 0 ||
      typeof chunk.archiveFilename !== 'string' ||
      typeof chunk.entryName !== 'string' ||
      typeof chunk.payloadSize !== 'number' ||
      typeof chunk.payloadSha256 !== 'string' ||
      typeof chunk.archiveSha256 !== 'string' ||
      indexes.has(chunk.index)
    ) {
      throw new Error('Notion PDF manifest contains an invalid chunk entry.')
    }
    indexes.add(chunk.index)
  }
  const sorted = [...manifest.chunks].sort((a, b) => a.index - b.index)
  if (sorted.some((chunk, index) => chunk.index !== index)) {
    throw new Error('Notion PDF manifest chunk sequence is incomplete.')
  }
  return manifest as NotionPdfManifest
}
