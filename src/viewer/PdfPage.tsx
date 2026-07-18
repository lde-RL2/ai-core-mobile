import { memo, useEffect, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Annotation, NormalizedRect } from '../types'
import { findMatchRects } from './textMatch'

interface PdfPageProps {
  doc: PDFDocumentProxy
  pageNumber: number
  cssWidth: number
  cssHeight: number
  scrollRoot: HTMLElement | null
  annotations: Annotation[]
  onTapAnnotation: (annotation: Annotation) => void
  /** Active in-PDF search term; matches get a highlight overlay. */
  searchQuery: string | null
  /** Tapped a link annotation pointing inside the document. */
  onFollowDestination: (dest: string | unknown[]) => void
  /** Active placement tool; 'none' leaves scrolling and selection untouched. */
  tool: PlacementTool
  onPlaceAnnotation: (pageNumber: number, type: 'note' | 'area', rect: NormalizedRect) => void
}

export type PlacementTool = 'none' | 'note' | 'area'

/** Footprint of a placed sticky note, as a fraction of the page. */
const NOTE_SIZE = { w: 0.05, h: 0.035 }

interface PageLink {
  rect: NormalizedRect
  url: string | null
  dest: string | unknown[] | null
}

const MAX_CANVAS_PIXELS = 14_000_000

function PdfPageImpl(props: PdfPageProps): React.JSX.Element {
  const { doc, pageNumber, cssWidth, cssHeight, scrollRoot } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [textRendered, setTextRendered] = useState(0)
  const [matchRects, setMatchRects] = useState<NormalizedRect[]>([])
  const [links, setLinks] = useState<PageLink[]>([])
  const [draft, setDraft] = useState<NormalizedRect | null>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || !scrollRoot) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setVisible(entry.isIntersecting)
      },
      { root: scrollRoot, rootMargin: '1200px 0px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollRoot])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    const textDiv = textLayerRef.current
    if (!canvas || !textDiv) return

    let cancelled = false
    let renderTask: ReturnType<
      Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']
    > | null = null
    let textLayer: TextLayer | null = null

    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const baseViewport = page.getViewport({ scale: 1 })
        const scale = cssWidth / baseViewport.width
        const viewport = page.getViewport({ scale })

        let outputScale = Math.min(window.devicePixelRatio || 1, 2)
        const pixels = viewport.width * viewport.height * outputScale * outputScale
        if (pixels > MAX_CANVAS_PIXELS) {
          outputScale = Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height))
        }
        canvas.width = Math.floor(viewport.width * outputScale)
        canvas.height = Math.floor(viewport.height * outputScale)
        const context = canvas.getContext('2d')
        if (!context) return

        renderTask = page.render({
          canvasContext: context,
          viewport,
          transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined
        })
        await renderTask.promise
        if (cancelled) return

        textDiv.textContent = ''
        textDiv.style.setProperty('--scale-factor', String(viewport.scale))
        textLayer = new TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport
        })
        await textLayer.render()
        if (!cancelled) setTextRendered((n) => n + 1)

        // Link annotations: citation jumps, DOI/arXiv URLs, cross-references.
        // Normalized against the viewport so they stay put at any zoom.
        const raw = (await page.getAnnotations({ intent: 'display' })) as {
          subtype?: string
          rect?: number[]
          url?: string
          dest?: string | unknown[]
        }[]
        if (cancelled) return
        const pageLinks: PageLink[] = []
        for (const item of raw) {
          if (item.subtype !== 'Link' || !item.rect) continue
          if (!item.url && !item.dest) continue
          const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(item.rect)
          const left = Math.min(x1, x2)
          const top = Math.min(y1, y2)
          const width = Math.abs(x2 - x1)
          const height = Math.abs(y2 - y1)
          if (width <= 0 || height <= 0) continue
          pageLinks.push({
            rect: {
              x: left / viewport.width,
              y: top / viewport.height,
              w: width / viewport.width,
              h: height / viewport.height
            },
            url: item.url ?? null,
            dest: item.dest ?? null
          })
        }
        setLinks(pageLinks)
      } catch (error) {
        if (!cancelled && (error as Error)?.name !== 'RenderingCancelledException') {
          console.warn(`[pdf] page ${pageNumber} render failed:`, error)
        }
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
      textLayer?.cancel()
      if (textLayerRef.current) textLayerRef.current.textContent = ''
    }
  }, [visible, doc, pageNumber, cssWidth])

  // Recompute match boxes whenever the term changes or the layer re-renders
  // (zoom re-renders the text layer at the new scale).
  useEffect(() => {
    const textDiv = textLayerRef.current
    if (!props.searchQuery || !textDiv || !visible || textRendered === 0) {
      setMatchRects([])
      return
    }
    setMatchRects(findMatchRects(textDiv, props.searchQuery, cssWidth, cssHeight))
  }, [props.searchQuery, visible, textRendered, cssWidth, cssHeight])

  const pointOnPage = (event: React.PointerEvent): { x: number; y: number } | null => {
    const box = containerRef.current?.getBoundingClientRect()
    if (!box || box.width === 0 || box.height === 0) return null
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height))
    }
  }

  const captureHandlers =
    props.tool === 'none'
      ? null
      : {
          onPointerDown: (event: React.PointerEvent) => {
            const point = pointOnPage(event)
            if (!point) return
            dragRef.current = point
            if (props.tool === 'area') {
              event.currentTarget.setPointerCapture(event.pointerId)
              setDraft({ x: point.x, y: point.y, w: 0, h: 0 })
            }
          },
          onPointerMove: (event: React.PointerEvent) => {
            if (props.tool !== 'area' || !dragRef.current) return
            const point = pointOnPage(event)
            if (!point) return
            const start = dragRef.current
            setDraft({
              x: Math.min(start.x, point.x),
              y: Math.min(start.y, point.y),
              w: Math.abs(point.x - start.x),
              h: Math.abs(point.y - start.y)
            })
          },
          onPointerUp: (event: React.PointerEvent) => {
            const start = dragRef.current
            dragRef.current = null
            const point = pointOnPage(event)
            if (!start || !point) {
              setDraft(null)
              return
            }
            if (props.tool === 'note') {
              // A tap places the note; a drag was meant as a scroll.
              if (Math.hypot(point.x - start.x, point.y - start.y) > 0.02) return
              props.onPlaceAnnotation(pageNumber, 'note', {
                x: Math.min(1 - NOTE_SIZE.w, Math.max(0, point.x - NOTE_SIZE.w / 2)),
                y: Math.min(1 - NOTE_SIZE.h, Math.max(0, point.y - NOTE_SIZE.h / 2)),
                ...NOTE_SIZE
              })
              return
            }
            const rect = {
              x: Math.min(start.x, point.x),
              y: Math.min(start.y, point.y),
              w: Math.abs(point.x - start.x),
              h: Math.abs(point.y - start.y)
            }
            setDraft(null)
            // Ignore an accidental tap that drew nothing.
            if (rect.w < 0.02 || rect.h < 0.01) return
            props.onPlaceAnnotation(pageNumber, 'area', rect)
          },
          onPointerCancel: () => {
            dragRef.current = null
            setDraft(null)
          }
        }

  return (
    <div
      ref={containerRef}
      className="pm-page"
      data-page-number={pageNumber}
      style={{ width: cssWidth, height: cssHeight }}
    >
      {visible && <canvas ref={canvasRef} className="pm-page-canvas" />}
      <div ref={textLayerRef} className="pm-text-layer" />
      {matchRects.length > 0 && (
        <div className="pm-search-layer" aria-hidden>
          {matchRects.map((rect, index) => (
            <div
              key={index}
              className="pm-search-hit"
              style={{
                left: `${rect.x * 100}%`,
                top: `${rect.y * 100}%`,
                width: `${rect.w * 100}%`,
                height: `${rect.h * 100}%`
              }}
            />
          ))}
        </div>
      )}
      {captureHandlers && (
        <div
          className={`pm-capture-layer ${props.tool}`}
          {...captureHandlers}
          role="presentation"
        >
          {draft && (
            <div
              className="pm-area-draft"
              style={{
                left: `${draft.x * 100}%`,
                top: `${draft.y * 100}%`,
                width: `${draft.w * 100}%`,
                height: `${draft.h * 100}%`
              }}
            />
          )}
        </div>
      )}
      {visible && links.length > 0 && (
        <div className="pm-link-layer">
          {links.map((link, index) => (
            <button
              key={index}
              className="pm-link"
              aria-label={link.url ?? '문서 내 이동'}
              style={{
                left: `${link.rect.x * 100}%`,
                top: `${link.rect.y * 100}%`,
                width: `${link.rect.w * 100}%`,
                height: `${link.rect.h * 100}%`
              }}
              onClick={(e) => {
                e.stopPropagation()
                if (link.url) window.open(link.url, '_blank', 'noopener,noreferrer')
                else if (link.dest) props.onFollowDestination(link.dest)
              }}
            />
          ))}
        </div>
      )}
      <div className="pm-annotation-layer">
        {visible &&
          props.annotations.map((annotation) =>
            annotation.rects.map((rect, index) => (
              <div
                key={`${annotation.id}-${index}`}
                className={`pm-annotation ${annotation.type}`}
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  ...(annotation.type === 'highlight' || annotation.type === 'note'
                    ? { backgroundColor: annotation.color }
                    : annotation.type === 'underline'
                      ? { borderBottomColor: annotation.color }
                      : {
                          // area: outlined box with a faint fill (desktop parity)
                          borderColor: annotation.color,
                          backgroundColor: `${annotation.color}14`
                        })
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onTapAnnotation(annotation)
                }}
              />
            ))
          )}
      </div>
    </div>
  )
}

export const PdfPage = memo(PdfPageImpl)
