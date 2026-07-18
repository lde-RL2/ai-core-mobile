import type { Paper, ReadingState } from './types'

export type PaperSort = 'added' | 'read' | 'title' | 'year'

export const SORT_LABELS: Record<PaperSort, string> = {
  added: '추가순',
  read: '최근 읽음',
  title: '제목순',
  year: '연도순'
}

export const PAPER_SORTS = Object.keys(SORT_LABELS) as PaperSort[]

export function isPaperSort(value: unknown): value is PaperSort {
  return typeof value === 'string' && value in SORT_LABELS
}

/** Sort a paper list. Papers missing the sort key (no year, never opened) sink
 *  to the bottom instead of scattering through the list. */
export function sortPapers(
  papers: Paper[],
  sort: PaperSort,
  readingByPaper: Map<string, ReadingState>
): Paper[] {
  const sorted = [...papers]
  switch (sort) {
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title))
      break
    case 'year':
      sorted.sort((a, b) => {
        if (a.year === b.year) return a.title.localeCompare(b.title)
        if (a.year === null) return 1
        if (b.year === null) return -1
        return b.year - a.year
      })
      break
    case 'read':
      sorted.sort((a, b) => {
        const left = readingByPaper.get(a.id)?.updatedAt ?? 0
        const right = readingByPaper.get(b.id)?.updatedAt ?? 0
        if (left === right) return a.addedAt < b.addedAt ? 1 : -1
        return right - left
      })
      break
    case 'added':
    default:
      sorted.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
      break
  }
  return sorted
}

/** The paper to offer as "continue reading": the most recently opened one that
 *  is actually in progress. Finished and untouched papers are not offered. */
export function findResumePaper(
  papers: Paper[],
  readingByPaper: Map<string, ReadingState>
): Paper | null {
  let best: { paper: Paper; updatedAt: number } | null = null
  for (const paper of papers) {
    const reading = readingByPaper.get(paper.id)
    if (!reading || reading.updatedAt <= 0) continue
    // Page 1 with no scroll means it was opened but not really read.
    if (reading.lastPage <= 1 && reading.scrollFraction < 0.02) continue
    if (reading.scrollFraction >= 0.995) continue
    if (!best || reading.updatedAt > best.updatedAt) {
      best = { paper, updatedAt: reading.updatedAt }
    }
  }
  return best?.paper ?? null
}
