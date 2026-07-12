// Browser port of the desktop app's first-page title/author inference
// (paper-manager-work/src/main/services/pdfMetadata.ts).
import type { PDFDocumentProxy } from 'pdfjs-dist'

export interface ExtractedPdfMetadata {
  title: string | null
  authors: string | null
}

interface PdfTextFragment {
  text: string
  x: number
  y: number
  fontSize: number
}

interface TextLine {
  text: string
  y: number
  fontSize: number
}

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned || null
}

function isGenericTitle(title: string, filename: string): boolean {
  const normalized = title.toLocaleLowerCase()
  const base = filename.replace(/\.pdf$/i, '').toLocaleLowerCase()
  return (
    normalized === base ||
    /^(untitled|document|article|paper|manuscript|microsoft word\b)/i.test(title)
  )
}

function buildLines(fragments: PdfTextFragment[]): TextLine[] {
  const rows: PdfTextFragment[][] = []
  const sorted = [...fragments].sort((a, b) => b.y - a.y || a.x - b.x)

  for (const fragment of sorted) {
    const row = rows.find((candidate) => {
      const averageY = candidate.reduce((sum, item) => sum + item.y, 0) / candidate.length
      const tolerance = Math.max(2, fragment.fontSize * 0.35)
      return Math.abs(averageY - fragment.y) <= tolerance
    })
    if (row) row.push(fragment)
    else rows.push([fragment])
  }

  return rows
    .map((row) => {
      row.sort((a, b) => a.x - b.x)
      return {
        text: row
          .map((fragment) => fragment.text)
          .join(' ')
          .replace(/\s+([,.;:])/g, '$1')
          .replace(/\s+/g, ' ')
          .trim(),
        y: row.reduce((sum, fragment) => sum + fragment.y, 0) / row.length,
        fontSize: Math.max(...row.map((fragment) => fragment.fontSize))
      }
    })
    .filter((line) => line.text.length > 0)
    .sort((a, b) => b.y - a.y)
}

function looksLikeFrontMatterNoise(text: string): boolean {
  return /^(doi\b|https?:|www\.|arxiv:|received\b|accepted\b|published\b|vol\.|volume\b|copyright\b)/i.test(
    text
  )
}

function inferTitle(
  lines: TextLine[],
  pageHeight: number
): { value: string | null; bottomY: number } {
  const candidates = lines.filter(
    (line) =>
      line.y > pageHeight * 0.38 &&
      line.text.length >= 8 &&
      line.text.length <= 240 &&
      !looksLikeFrontMatterNoise(line.text)
  )
  if (candidates.length === 0) return { value: null, bottomY: pageHeight }

  const largestFont = Math.max(...candidates.map((line) => line.fontSize))
  const anchor = candidates.find((line) => line.fontSize >= largestFont * 0.92)
  if (!anchor) return { value: null, bottomY: pageHeight }

  const titleLines = candidates
    .filter(
      (line) =>
        line.fontSize >= largestFont * 0.82 &&
        Math.abs(line.y - anchor.y) <= Math.max(90, largestFont * 4.5)
    )
    .sort((a, b) => b.y - a.y)
    .slice(0, 4)

  const value = cleanText(titleLines.map((line) => line.text).join(' '))
  return { value, bottomY: Math.min(...titleLines.map((line) => line.y)) }
}

function looksLikeAuthorLine(text: string): boolean {
  if (text.length < 3 || text.length > 220) return false
  if (
    /\b(abstract|keywords?|introduction|university|institute|department|laboratory|school of|faculty|corresponding|email)\b/i.test(
      text
    )
  ) {
    return false
  }
  if (/@|https?:|www\./i.test(text)) return false

  const words = text.match(/[\p{L}][\p{L}'’-]*/gu) ?? []
  return words.length >= 2 && words.length <= 30
}

function inferAuthors(lines: TextLine[], titleBottomY: number): string | null {
  const candidates = lines
    .filter(
      (line) =>
        line.y < titleBottomY - 2 && line.y > titleBottomY - 150 && looksLikeAuthorLine(line.text)
    )
    .sort((a, b) => b.y - a.y)
    .slice(0, 2)
  return cleanText(candidates.map((line) => line.text).join(', '))
}

async function inferFromFirstPage(document: PDFDocumentProxy): Promise<ExtractedPdfMetadata> {
  const page = await document.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  const content = await page.getTextContent()
  const fragments: PdfTextFragment[] = []

  for (const item of content.items) {
    if (!('str' in item)) continue
    const text = cleanText(item.str)
    if (!text) continue
    const fontSize = Math.hypot(Number(item.transform[2]), Number(item.transform[3])) || item.height
    fragments.push({
      text,
      x: Number(item.transform[4]),
      y: Number(item.transform[5]),
      fontSize
    })
  }

  const lines = buildLines(fragments)
  const inferredTitle = inferTitle(lines, viewport.height)
  return {
    title: inferredTitle.value,
    authors: inferAuthors(lines, inferredTitle.bottomY)
  }
}

/** Extract embedded PDF metadata, falling back to first-page layout heuristics. */
export async function extractPdfMetadata(
  document: PDFDocumentProxy,
  filename: string
): Promise<ExtractedPdfMetadata> {
  try {
    const metadata = await document.getMetadata()
    const info = metadata.info as { Title?: unknown; Author?: unknown }
    const embeddedTitle =
      cleanText(metadata.metadata?.get('dc:title')) ?? cleanText(info.Title) ?? null
    const embeddedAuthors =
      cleanText(metadata.metadata?.get('dc:creator')) ?? cleanText(info.Author) ?? null
    const inferred = await inferFromFirstPage(document)

    return {
      title:
        embeddedTitle && !isGenericTitle(embeddedTitle, filename) ? embeddedTitle : inferred.title,
      authors: embeddedAuthors ?? inferred.authors
    }
  } catch (error) {
    console.warn('[pdf-metadata] Could not extract metadata:', error)
    return { title: null, authors: null }
  }
}
