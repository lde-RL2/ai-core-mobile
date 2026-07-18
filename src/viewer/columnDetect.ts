/** Column inference for two-column papers.
 *
 *  A PDF stores no notion of columns, so we infer them from the geometry of the
 *  text runs: a two-column layout leaves a vertical gutter that almost no line
 *  crosses, with substantial text on both sides. Detection is deliberately
 *  conservative — when unsure we report a single column and the reader behaves
 *  exactly as before. */

export interface TextSpan {
  /** Left edge, in PDF user units. */
  x: number
  width: number
}

export interface ColumnLayout {
  /** Normalized (0–1) left/right edges of each column, in reading order. */
  columns: { start: number; end: number }[]
}

const SINGLE_COLUMN: ColumnLayout = { columns: [{ start: 0, end: 1 }] }

/**
 * @param spans   text runs on the page
 * @param pageWidth page width in the same units as the spans
 */
export function detectColumns(spans: TextSpan[], pageWidth: number): ColumnLayout {
  if (pageWidth <= 0) return SINGLE_COLUMN
  const usable = spans.filter((s) => s.width > 0 && s.x >= 0 && s.x + s.width <= pageWidth * 1.02)
  // Too little text (a figure page or a cover) — don't guess.
  if (usable.length < 24) return SINGLE_COLUMN

  // Try candidate gutters across the middle of the page and pick the one that
  // is crossed by the fewest runs.
  const centre = pageWidth / 2
  const searchRadius = pageWidth * 0.12
  let best: { split: number; crossings: number } | null = null
  for (let offset = -searchRadius; offset <= searchRadius; offset += pageWidth * 0.005) {
    const split = centre + offset
    let crossings = 0
    for (const span of usable) {
      if (span.x < split && span.x + span.width > split) crossings += 1
    }
    if (!best || crossings < best.crossings) best = { split, crossings }
  }
  if (!best) return SINGLE_COLUMN

  // A real gutter is crossed by almost nothing. Full-width titles and figures
  // legitimately cross it, so allow a small fraction rather than demanding zero.
  const crossingRatio = best.crossings / usable.length
  if (crossingRatio > 0.06) return SINGLE_COLUMN

  const left = usable.filter((s) => s.x + s.width <= best.split)
  const right = usable.filter((s) => s.x >= best.split)
  // Both sides must carry real text, otherwise this is a single column that
  // simply happens to sit on one half (e.g. a narrow abstract).
  const minSide = usable.length * 0.25
  if (left.length < minSide || right.length < minSide) return SINGLE_COLUMN

  const extent = (list: TextSpan[]): { start: number; end: number } => ({
    start: Math.max(0, Math.min(...list.map((s) => s.x)) / pageWidth),
    end: Math.min(1, Math.max(...list.map((s) => s.x + s.width)) / pageWidth)
  })
  const leftExtent = extent(left)
  const rightExtent = extent(right)
  // Degenerate extents (a single stray run) would zoom absurdly.
  if (leftExtent.end - leftExtent.start < 0.15) return SINGLE_COLUMN
  if (rightExtent.end - rightExtent.start < 0.15) return SINGLE_COLUMN

  return { columns: [leftExtent, rightExtent] }
}
