export interface Paper {
  id: string
  title: string
  authors: string | null
  year: number | null
  originalFilename: string
  doi: string | null
  addedAt: string
  notes: string | null
  updatedAt: number
  fileSize: number
  pageCount: number | null
  contentHash?: string | null
  /** Opaque passthrough for desktop-only paper columns the mobile app does not
   *  model (creators_json, abstract_note, publisher, arxiv_id, file_path, …).
   *  Captured on pull and echoed back on push so a mobile round-trip never
   *  strips the richer metadata a user entered on the desktop app. */
  remoteExtras?: Record<string, unknown>
}

export interface Collection {
  id: string
  name: string
  parentId: string | null
}

export interface Tag {
  id: string
  name: string
}

// Keep in sync with the desktop schema (annotations.type CHECK constraint).
// 'area' and 'note' are created on desktop; mobile renders and edits them.
export type AnnotationType = 'highlight' | 'underline' | 'area' | 'note'

export interface NormalizedRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Annotation {
  id: string
  paperId: string
  pageNumber: number
  type: AnnotationType
  rects: NormalizedRect[]
  color: string
  note: string | null
  text: string | null
  createdAt: string
  updatedAt: number
}

export interface ReadingState {
  paperId: string
  lastPage: number
  scrollFraction: number
  updatedAt: number
}

export const ANNOTATION_COLORS = [
  '#ffe066',
  '#ffb3ba',
  '#b5e48c',
  '#9ad1f5',
  '#d8b4fe',
  '#ffd6a5'
] as const

export type ThemeMode = 'system' | 'light' | 'dark'
export type PaperTone = 'normal' | 'warm' | 'sepia' | 'dark'
