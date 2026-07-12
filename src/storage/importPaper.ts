import { loadPdf } from '../pdf/pdfjs'
import { extractPdfMetadata } from '../pdf/metadata'
import { sha256Hex } from '../sync/format'
import type { Paper } from '../types'
import {
  assignPaperToCollection,
  listPapers,
  putPaper,
  requestPersistentStorage,
  savePdfFile
} from './db'

export interface ImportResult {
  paper: Paper
  duplicate: boolean
}

function inferYear(title: string | null, filename: string): number | null {
  const match = `${title ?? ''} ${filename}`.match(/\b(19|20)\d{2}\b/)
  return match ? Number(match[0]) : null
}

export async function importPdfFile(
  file: File,
  collectionId: string | null
): Promise<ImportResult> {
  // Ask the browser not to evict the library under storage pressure.
  void requestPersistentStorage().catch(() => false)

  const existing = await listPapers()
  const duplicate = existing.find(
    (p) => p.fileSize === file.size && p.originalFilename === file.name
  )
  if (duplicate) {
    if (collectionId) await assignPaperToCollection(duplicate.id, collectionId)
    return { paper: duplicate, duplicate: true }
  }

  let title: string | null = null
  let authors: string | null = null
  let pageCount: number | null = null
  try {
    const doc = await loadPdf(file)
    pageCount = doc.numPages
    const meta = await extractPdfMetadata(doc, file.name)
    title = meta.title
    authors = meta.authors
    await doc.destroy().catch(() => {})
  } catch (error) {
    console.warn('[import] PDF parsing failed, falling back to filename:', error)
  }

  let contentHash: string | null = null
  try {
    contentHash = await sha256Hex(await file.arrayBuffer())
  } catch {
    // Hash is optional metadata; sync verifies only when present.
  }

  const paper: Paper = {
    id: crypto.randomUUID(),
    title: title ?? file.name.replace(/\.pdf$/i, ''),
    authors,
    year: inferYear(title, file.name),
    originalFilename: file.name,
    doi: null,
    addedAt: new Date().toISOString(),
    notes: null,
    updatedAt: Date.now(),
    fileSize: file.size,
    pageCount,
    contentHash
  }

  await savePdfFile(paper.id, file)
  await putPaper(paper)
  if (collectionId) await assignPaperToCollection(paper.id, collectionId)
  return { paper, duplicate: false }
}
