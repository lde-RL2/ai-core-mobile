import type { PDFDocumentProxy } from 'pdfjs-dist'

/** A PDF destination is either a named string that has to be looked up, or an
 *  explicit array whose first entry references the target page. Shared by the
 *  document outline and by link annotations. */
export async function destinationToPageNumber(
  doc: PDFDocumentProxy,
  dest: string | unknown[] | null | undefined
): Promise<number | null> {
  if (dest === null || dest === undefined) return null
  try {
    const resolved = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(resolved) || resolved.length === 0) return null
    const ref = resolved[0]
    // Explicit page index (rare) vs. an indirect page reference (usual).
    if (typeof ref === 'number') return ref + 1
    if (ref && typeof ref === 'object' && 'num' in (ref as Record<string, unknown>)) {
      return (await doc.getPageIndex(ref as never)) + 1
    }
    return null
  } catch {
    // A broken destination should never take the reader down.
    return null
  }
}

export interface OutlineEntry {
  title: string
  dest: string | unknown[] | null
  url: string | null
  depth: number
}

interface RawOutlineNode {
  title?: string
  dest?: string | unknown[] | null
  url?: string | null
  items?: RawOutlineNode[]
}

/** Flatten the outline tree into an indented list — a phone sheet reads better
 *  as a single scrollable list than as collapsible branches. */
export function flattenOutline(nodes: RawOutlineNode[], depth = 0): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  for (const node of nodes) {
    const title = (node.title ?? '').trim()
    if (title) {
      entries.push({
        title,
        dest: node.dest ?? null,
        url: node.url ?? null,
        depth
      })
    }
    if (node.items?.length) entries.push(...flattenOutline(node.items, depth + 1))
  }
  return entries
}
