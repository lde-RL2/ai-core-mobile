// Bridges the wire format (format.ts) and the local IndexedDB. Shared by the
// Drive and Notion sync engines — the mobile counterpart of the desktop's
// buildPaperMeta/applyRemoteMeta/library snapshot logic.
import * as db from '../storage/db'
import type { Annotation } from '../types'
import {
  META_SCHEMA_VERSION,
  annotationToRemoteRow,
  buildLibraryJson,
  localUpdatedAt,
  paperToRemoteRow,
  readingStateToRemote,
  remoteCollectionsToLocal,
  remoteReadingStateToLocal,
  remoteRowToAnnotation,
  remoteRowToPaper,
  type LibraryJson,
  type PaperMeta
} from './format'
import { loadSyncState, updateSyncState } from './state'

export async function computeLocalUpdatedAt(paperId: string): Promise<number> {
  const [paper, annotations, readingState] = await Promise.all([
    db.getPaper(paperId),
    db.listAnnotations(paperId),
    db.getReadingState(paperId)
  ])
  if (!paper) return 0
  return localUpdatedAt(paper, annotations, readingState)
}

export async function buildPaperMeta(paperId: string): Promise<PaperMeta | null> {
  const [paper, annotations, readingState] = await Promise.all([
    db.getPaper(paperId),
    db.listAnnotations(paperId),
    db.getReadingState(paperId)
  ])
  if (!paper) return null
  return {
    schemaVersion: META_SCHEMA_VERSION,
    updatedAt: localUpdatedAt(paper, annotations, readingState),
    paper: paperToRemoteRow(paper),
    annotations: annotations.map(annotationToRemoteRow),
    readingState: readingState ? readingStateToRemote(readingState) : null
  }
}

/** Apply a remote paper meta. For papers that are new locally the caller must
 *  have saved the PDF blob first (mirrors the desktop's filePathForNew). */
export async function applyRemoteMeta(meta: PaperMeta): Promise<void> {
  if (!meta.paper) return
  const remote = meta.paper
  await db.withSyncHooksSuppressed(async () => {
    const existing = await db.getPaper(remote.id)
    if (!existing) {
      const blob = await db.getPdfFile(remote.id)
      if (!blob) return // no PDF stored yet — skip, like desktop's missing file_path
    }
    await db.putPaperLocal(remoteRowToPaper(remote, existing))

    // Replace-all annotations (desktop policy), preserving the mobile-only
    // selected-text field for annotations we already knew.
    const current = await db.listAnnotations(remote.id)
    const currentById = new Map(current.map((a) => [a.id, a]))
    for (const annotation of current) {
      await db.deleteAnnotation(annotation.id, remote.id)
    }
    for (const row of meta.annotations ?? []) {
      const local = remoteRowToAnnotation(row, currentById.get(row.id))
      if (local) await db.putAnnotation(local)
    }

    if (meta.readingState) {
      const state = remoteReadingStateToLocal(remote.id, meta.readingState)
      await db.putReadingStateRaw(state)
    }
  })
}

export async function deleteLocalPaper(paperId: string, deletedAt: number): Promise<void> {
  await db.withSyncHooksSuppressed(async () => {
    await db.deletePaper(paperId, deletedAt)
  })
}

export async function buildLibrarySnapshot(): Promise<LibraryJson> {
  const [collections, paperCollections, tags, paperTags] = await Promise.all([
    db.listCollections(),
    db.listAllPaperCollectionLinks(),
    db.listTags(),
    db.listAllPaperTagLinks()
  ])
  return buildLibraryJson(
    loadSyncState().libraryUpdatedAt,
    collections,
    paperCollections,
    tags,
    paperTags
  )
}

export async function localLibraryHasStructure(): Promise<boolean> {
  const [collections, paperCollections, tags, paperTags] = await Promise.all([
    db.listCollections(),
    db.listAllPaperCollectionLinks(),
    db.listTags(),
    db.listAllPaperTagLinks()
  ])
  return (
    collections.length > 0 ||
    paperCollections.length > 0 ||
    tags.length > 0 ||
    paperTags.length > 0
  )
}

export async function applyLibrarySnapshot(library: LibraryJson): Promise<void> {
  await db.withSyncHooksSuppressed(async () => {
    await db.replaceLibrary({
      collections: remoteCollectionsToLocal(library.collections),
      paperCollections: library.paper_collections.map((l) => ({
        paperId: l.paper_id,
        collectionId: l.collection_id
      })),
      // Older desktop library.json files predate tags — preserve local tags
      // when the fields are absent.
      tags: library.tags?.map((t) => ({ id: t.id, name: t.name })),
      paperTags: library.paper_tags?.map((l) => ({ paperId: l.paper_id, tagId: l.tag_id }))
    })
  })
  updateSyncState({ libraryUpdatedAt: library.updatedAt })
}

/** Local annotations helper used to keep `text` across replace-all. */
export type { Annotation }
