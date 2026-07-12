import { unzipSync, zipSync } from 'fflate'
import type { Annotation, Collection, Paper, ReadingState, Tag } from '../types'
import * as db from './db'

const MANIFEST_NAME = 'manifest.json'
const BACKUP_VERSION = 1

interface BackupManifest {
  app: 'ai-core-mobile'
  version: number
  exportedAt: string
  papers: Paper[]
  collections: Collection[]
  tags: Tag[]
  paperCollections: { paperId: string; collectionId: string }[]
  paperTags: { paperId: string; tagId: string }[]
  annotations: Annotation[]
  readingStates: ReadingState[]
}

export async function exportBackup(): Promise<Blob> {
  const [papers, collections, tags, paperCollections, paperTags, annotations, readingStates] =
    await Promise.all([
      db.listPapers(),
      db.listCollections(),
      db.listTags(),
      db.listAllPaperCollectionLinks(),
      db.listAllPaperTagLinks(),
      db.listAllAnnotations(),
      db.listReadingStates()
    ])

  const manifest: BackupManifest = {
    app: 'ai-core-mobile',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    papers,
    collections,
    tags,
    paperCollections,
    paperTags,
    annotations,
    readingStates
  }

  const files: Record<string, Uint8Array> = {
    [MANIFEST_NAME]: new TextEncoder().encode(JSON.stringify(manifest, null, 2))
  }
  for (const paper of papers) {
    const blob = await db.getPdfFile(paper.id)
    if (!blob) continue
    files[`pdfs/${paper.id}.pdf`] = new Uint8Array(await blob.arrayBuffer())
  }

  // PDFs are already compressed; store them instead of deflating.
  const zipped = zipSync(files, { level: 0 })
  return new Blob([zipped.slice().buffer], { type: 'application/zip' })
}

export function downloadBackup(blob: Blob): void {
  const stamp = new Date().toISOString().slice(0, 10)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `ai-core-backup-${stamp}.zip`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export interface ImportSummary {
  papersAdded: number
  papersSkipped: number
}

export async function importBackup(file: File): Promise<ImportSummary> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const manifestBytes = entries[MANIFEST_NAME]
  if (!manifestBytes) throw new Error('백업 파일이 아닙니다 (manifest.json 없음)')
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as BackupManifest
  if (manifest.app !== 'ai-core-mobile') throw new Error('AI-Core Mobile 백업이 아닙니다')

  const existingPapers = new Set((await db.listPapers()).map((p) => p.id))
  let papersAdded = 0
  let papersSkipped = 0

  for (const paper of manifest.papers) {
    if (existingPapers.has(paper.id)) {
      papersSkipped += 1
      continue
    }
    const pdfBytes = entries[`pdfs/${paper.id}.pdf`]
    if (!pdfBytes) {
      papersSkipped += 1
      continue
    }
    await db.savePdfFile(paper.id, new Blob([pdfBytes.slice().buffer], { type: 'application/pdf' }))
    await db.putPaper(paper)
    papersAdded += 1
  }

  for (const collection of manifest.collections) await db.putCollection(collection)
  for (const tag of manifest.tags) await db.putTag(tag)
  for (const link of manifest.paperCollections) {
    await db.assignPaperToCollection(link.paperId, link.collectionId)
  }
  for (const link of manifest.paperTags) await db.assignPaperToTag(link.paperId, link.tagId)
  for (const annotation of manifest.annotations) await db.putAnnotation(annotation)
  for (const state of manifest.readingStates) {
    const current = await db.getReadingState(state.paperId)
    if (!current || current.updatedAt < state.updatedAt) {
      await db.setReadingState(state.paperId, state.lastPage, state.scrollFraction)
    }
  }

  void db.requestPersistentStorage().catch(() => false)
  return { papersAdded, papersSkipped }
}
