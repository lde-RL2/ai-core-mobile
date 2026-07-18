// Remembers the last zoom per paper, device-local. Deliberately not part of
// ReadingState: that row round-trips through the shared sync format, and zoom
// is a property of this screen (a phone's 2.2x is wrong on a tablet).

const KEY = 'aicore.zoomByPaper'
/** Oldest entries are dropped past this, so the map cannot grow unbounded. */
const MAX_ENTRIES = 200

type ZoomMap = Record<string, number>

function read(): ZoomMap {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' ? (parsed as ZoomMap) : {}
  } catch {
    return {}
  }
}

export function loadPaperZoom(paperId: string): number | null {
  const value = read()[paperId]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function savePaperZoom(paperId: string, zoom: number): void {
  const map = read()
  // Re-inserting moves the paper to the newest position (object key order),
  // so pruning drops the least recently read papers first.
  delete map[paperId]
  // Fit-width is the default — storing it is noise, so a reset clears instead.
  if (Math.abs(zoom - 1) >= 0.01) map[paperId] = Math.round(zoom * 100) / 100
  const ids = Object.keys(map)
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_ENTRIES))) {
    delete map[id]
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // A full localStorage only costs the convenience, never the reading.
  }
}
