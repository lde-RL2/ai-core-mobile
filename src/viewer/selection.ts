import type { NormalizedRect } from '../types'

export interface PageSelection {
  pageNumber: number
  rects: NormalizedRect[]
  text: string
}

function closestPageElement(node: Node | null): HTMLElement | null {
  let el: Node | null = node
  while (el && !(el instanceof HTMLElement && el.dataset.pageNumber)) {
    el = el.parentNode
  }
  return el as HTMLElement | null
}

/** Convert the current DOM selection inside a PDF text layer into
 *  page-relative normalized rects (fractions of page width/height). */
export function selectionToPageRects(selection: Selection): PageSelection | null {
  if (selection.rangeCount === 0 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const pageEl = closestPageElement(range.startContainer)
  if (!pageEl) return null

  const pageNumber = Number(pageEl.dataset.pageNumber)
  const pageRect = pageEl.getBoundingClientRect()
  if (!pageNumber || pageRect.width <= 0 || pageRect.height <= 0) return null

  const rects: NormalizedRect[] = []
  const seen = new Set<string>()
  for (const rect of range.getClientRects()) {
    if (rect.width < 1 || rect.height < 1) continue
    // Clip to this page; a selection spanning pages keeps the first page only.
    if (rect.bottom < pageRect.top || rect.top > pageRect.bottom) continue
    if (rect.height > pageRect.height * 0.9) continue
    const normalized: NormalizedRect = {
      x: (rect.left - pageRect.left) / pageRect.width,
      y: (rect.top - pageRect.top) / pageRect.height,
      w: rect.width / pageRect.width,
      h: rect.height / pageRect.height
    }
    const key = [normalized.x, normalized.y, normalized.w, normalized.h]
      .map((v) => v.toFixed(4))
      .join(',')
    if (seen.has(key)) continue
    seen.add(key)
    rects.push(normalized)
  }
  if (rects.length === 0) return null

  const text = selection.toString().replace(/\s+/g, ' ').trim()
  return { pageNumber, rects, text }
}
