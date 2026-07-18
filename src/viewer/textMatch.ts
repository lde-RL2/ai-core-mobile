import type { NormalizedRect } from '../types'

/** Locate every occurrence of `query` inside a rendered pdf.js text layer and
 *  return their boxes normalized to the page (0–1), so the caller can overlay
 *  highlights that survive zoom and re-render.
 *
 *  Matching walks the concatenated text of the layer rather than individual
 *  spans, so a term split across spans (very common — pdf.js breaks runs at
 *  font/kerning changes) is still found. */
export function findMatchRects(
  container: HTMLElement,
  query: string,
  pageWidth: number,
  pageHeight: number
): NormalizedRect[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length < 2 || pageWidth <= 0 || pageHeight <= 0) return []

  // Build the layer's full text with a map back to (textNode, offset).
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const nodes: { node: Text; start: number }[] = []
  let haystack = ''
  let current = walker.nextNode()
  while (current) {
    const text = current.nodeValue ?? ''
    if (text.length > 0) {
      nodes.push({ node: current as Text, start: haystack.length })
      haystack += text
    }
    current = walker.nextNode()
  }
  if (nodes.length === 0) return []

  const lower = haystack.toLocaleLowerCase()
  const containerRect = container.getBoundingClientRect()
  if (containerRect.width === 0 || containerRect.height === 0) return []

  const locate = (offset: number): { node: Text; offset: number } | null => {
    // Last node whose start is <= offset.
    let low = 0
    let high = nodes.length - 1
    let found = -1
    while (low <= high) {
      const mid = (low + high) >> 1
      if (nodes[mid].start <= offset) {
        found = mid
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    if (found === -1) return null
    const entry = nodes[found]
    return { node: entry.node, offset: offset - entry.start }
  }

  const rects: NormalizedRect[] = []
  let index = lower.indexOf(needle)
  while (index !== -1 && rects.length < 500) {
    const start = locate(index)
    const end = locate(index + needle.length - 1)
    if (start && end) {
      try {
        const range = document.createRange()
        range.setStart(start.node, Math.min(start.offset, start.node.length))
        range.setEnd(end.node, Math.min(end.offset + 1, end.node.length))
        for (const box of Array.from(range.getClientRects())) {
          if (box.width <= 0 || box.height <= 0) continue
          rects.push({
            x: (box.left - containerRect.left) / containerRect.width,
            y: (box.top - containerRect.top) / containerRect.height,
            w: box.width / containerRect.width,
            h: box.height / containerRect.height
          })
        }
        range.detach()
      } catch {
        // A range that spans detached nodes is simply skipped.
      }
    }
    index = lower.indexOf(needle, index + needle.length)
  }
  return rects
}
