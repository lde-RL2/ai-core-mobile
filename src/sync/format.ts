// Wire format shared with the desktop app (paper-manager-work). Remote JSON
// uses the desktop's snake_case SQLite row shapes so both apps can sync the
// same Drive folder / Notion database. Keep every field name byte-identical.
import type { Annotation, Collection, Paper, ReadingState, Tag } from '../types'

export const META_SCHEMA_VERSION = 1

export interface RemotePaperRow {
  id: string
  title: string
  authors: string | null
  year: number | null
  original_filename: string
  doi: string | null
  added_at: string
  notes: string | null
  updated_at: number
  content_hash: string | null
  file_size: number | null
}

export interface RemoteAnnotationRow {
  id: string
  paper_id: string
  page_number: number
  type: string
  rects_json: string
  color: string
  note: string | null
  /** Added in desktop schema v2; metas written by older versions lack it. */
  selected_text?: string | null
  created_at: string
  updated_at: number
}

const ANNOTATION_TYPES = ['highlight', 'underline', 'area', 'note'] as const

// Every paper-row key the mobile app models itself. Anything else in a remote
// row (creators_json, abstract_note, publisher, arxiv_id, file_path, …) is a
// desktop-only column we carry through untouched instead of dropping.
const KNOWN_PAPER_KEYS: ReadonlySet<string> = new Set([
  'id',
  'title',
  'authors',
  'year',
  'original_filename',
  'doi',
  'added_at',
  'notes',
  'updated_at',
  'content_hash',
  'file_size'
])

export interface RemoteReadingState {
  last_page: number
  scroll_fraction: number
  updated_at: number
}

export interface PaperMeta {
  schemaVersion: number
  updatedAt: number
  deleted?: boolean
  paper?: RemotePaperRow
  annotations?: RemoteAnnotationRow[]
  readingState?: RemoteReadingState | null
  /** Desktop-only translation snapshot. The mobile app never creates one but
   *  must preserve an existing snapshot when it rewrites a meta file. */
  translation?: unknown
}

export interface LibraryJson {
  updatedAt: number
  collections: { id: string; name: string; parent_id: string | null }[]
  paper_collections: { paper_id: string; collection_id: string }[]
  tags?: { id: string; name: string }[]
  paper_tags?: { paper_id: string; tag_id: string }[]
}

// ---------- local → remote ----------

export function paperToRemoteRow(paper: Paper): RemotePaperRow {
  const known: RemotePaperRow = {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    original_filename: paper.originalFilename,
    doi: paper.doi,
    added_at: paper.addedAt,
    notes: paper.notes,
    updated_at: paper.updatedAt,
    content_hash: paper.contentHash ?? null,
    file_size: paper.fileSize
  }
  // Re-attach the desktop-only columns captured on the last pull. The mobile's
  // own fields always win over a same-named extra, so nothing here shadows a
  // value the user edited on this device.
  return paper.remoteExtras ? { ...paper.remoteExtras, ...known } : known
}

export function annotationToRemoteRow(annotation: Annotation): RemoteAnnotationRow {
  return {
    id: annotation.id,
    paper_id: annotation.paperId,
    page_number: annotation.pageNumber,
    type: annotation.type,
    rects_json: JSON.stringify(annotation.rects),
    color: annotation.color,
    note: annotation.note,
    // Desktop schema v2 stores the selection text in selected_text; the
    // mobile-local `text` field maps onto it 1:1.
    selected_text: annotation.text,
    created_at: annotation.createdAt,
    updated_at: annotation.updatedAt
  }
}

export function readingStateToRemote(state: ReadingState): RemoteReadingState {
  return {
    last_page: state.lastPage,
    scroll_fraction: state.scrollFraction,
    updated_at: state.updatedAt
  }
}

export function localUpdatedAt(
  paper: Paper,
  annotations: Annotation[],
  readingState: ReadingState | undefined
): number {
  let max = paper.updatedAt
  for (const annotation of annotations) max = Math.max(max, annotation.updatedAt)
  if (readingState) max = Math.max(max, readingState.updatedAt)
  return max
}

export function buildLibraryJson(
  updatedAt: number,
  collections: Collection[],
  paperCollections: { paperId: string; collectionId: string }[],
  tags: Tag[],
  paperTags: { paperId: string; tagId: string }[]
): LibraryJson {
  return {
    updatedAt,
    collections: collections.map((c) => ({ id: c.id, name: c.name, parent_id: c.parentId })),
    paper_collections: paperCollections.map((l) => ({
      paper_id: l.paperId,
      collection_id: l.collectionId
    })),
    tags: tags.map((t) => ({ id: t.id, name: t.name })),
    paper_tags: paperTags.map((l) => ({ paper_id: l.paperId, tag_id: l.tagId }))
  }
}

// ---------- remote → local ----------

export function remoteRowToPaper(
  row: RemotePaperRow,
  existing: Paper | undefined
): Paper {
  const paper: Paper = {
    id: row.id,
    title: row.title,
    authors: row.authors,
    year: row.year,
    originalFilename: row.original_filename,
    doi: row.doi,
    addedAt: row.added_at,
    notes: row.notes,
    updatedAt: row.updated_at,
    contentHash: row.content_hash ?? existing?.contentHash ?? null,
    fileSize: row.file_size ?? existing?.fileSize ?? 0,
    // Local-only field: unknown for freshly pulled papers, backfilled by the
    // reader on first open.
    pageCount: existing?.pageCount ?? null
  }
  // Capture any desktop-only columns so a later push echoes them back verbatim.
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row as unknown as Record<string, unknown>)) {
    if (!KNOWN_PAPER_KEYS.has(key)) extras[key] = value
  }
  if (Object.keys(extras).length > 0) {
    paper.remoteExtras = extras
  } else if (existing?.remoteExtras) {
    // A meta that carries no extra columns at all (a pre-metadata-v2 desktop
    // build) must not wipe what we already preserved locally.
    paper.remoteExtras = existing.remoteExtras
  }
  return paper
}

export function remoteRowToAnnotation(
  row: RemoteAnnotationRow,
  existing: Annotation | undefined
): Annotation | null {
  let rects: Annotation['rects']
  try {
    rects = JSON.parse(row.rects_json) as Annotation['rects']
  } catch {
    return null
  }
  if (!Array.isArray(rects)) return null
  return {
    id: row.id,
    paperId: row.paper_id,
    pageNumber: row.page_number,
    // Preserve every desktop v2 type. An unknown future type degrades to
    // highlight as a last resort — matching the desktop's own fallback.
    type: (ANNOTATION_TYPES as readonly string[]).includes(row.type)
      ? (row.type as Annotation['type'])
      : 'highlight',
    rects,
    color: row.color,
    note: row.note,
    // v2 metas carry the selection text; older metas fall back to what we
    // knew locally.
    text: row.selected_text ?? existing?.text ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function remoteReadingStateToLocal(
  paperId: string,
  remote: RemoteReadingState
): ReadingState {
  return {
    paperId,
    lastPage: remote.last_page,
    scrollFraction: remote.scroll_fraction,
    updatedAt: remote.updated_at
  }
}

/** Resolve remote collections into local rows, dropping parent links that are
 *  missing or cyclic (mirrors the desktop pull logic). */
export function remoteCollectionsToLocal(
  remote: LibraryJson['collections']
): Collection[] {
  const byId = new Map(remote.map((c) => [c.id, c]))
  return remote.map((collection) => {
    let parentId: string | null = null
    if (collection.parent_id && byId.has(collection.parent_id)) {
      const visited = new Set([collection.id])
      let cursor: string | null = collection.parent_id
      let valid = true
      while (cursor) {
        if (visited.has(cursor)) {
          valid = false
          break
        }
        visited.add(cursor)
        cursor = byId.get(cursor)?.parent_id ?? null
      }
      if (valid) parentId = collection.parent_id
    }
    return { id: collection.id, name: collection.name, parentId }
  })
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Uint8Array ? Uint8Array.from(data).buffer : data
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
