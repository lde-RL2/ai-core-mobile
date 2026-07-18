// First-page preview images for the library. Generated on demand the first
// time a card asks for one, cached in IndexedDB forever after, and dropped
// together with the paper. Regenerable, so backups and sync ignore them.
import { getPdfFile, getThumbnail, saveThumbnail } from './db'
import { loadPdf } from '../pdf/pdfjs'

/** CSS width of a card thumbnail is ~56px; render at 3x so it stays crisp on
 *  high-density phone screens and in the larger resume card. */
const RENDER_WIDTH = 168

// Generating a thumbnail means loading the whole PDF, so never do more than
// one at a time — a first visit to a large library queues them politely
// instead of decoding forty PDFs at once.
let queue: Promise<unknown> = Promise.resolve()
const inFlight = new Map<string, Promise<Blob | null>>()

async function generate(paperId: string): Promise<Blob | null> {
  const file = await getPdfFile(paperId)
  if (!file) return null
  const pdf = await loadPdf(file)
  try {
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: RENDER_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) return null
    // Papers with transparent backgrounds should preview as paper, not void.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: context, viewport }).promise
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.82)
    )
  } finally {
    void pdf.destroy().catch(() => {})
  }
}

/** Cached thumbnail, generating (once) when absent. Returns null when the PDF
 *  is missing or unrenderable — the caller shows its placeholder. */
export function requestThumbnail(paperId: string): Promise<Blob | null> {
  const existing = inFlight.get(paperId)
  if (existing) return existing

  const task = (async () => {
    const cached = await getThumbnail(paperId)
    if (cached) return cached
    // Serialize the expensive part behind the shared queue.
    const result = queue.then(async () => {
      try {
        const blob = await generate(paperId)
        if (blob) await saveThumbnail(paperId, blob)
        return blob
      } catch {
        return null
      }
    })
    queue = result.catch(() => {})
    return result
  })()

  inFlight.set(paperId, task)
  void task.finally(() => inFlight.delete(paperId))
  return task
}
