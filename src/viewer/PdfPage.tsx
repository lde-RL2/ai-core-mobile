import { memo, useEffect, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Annotation } from '../types'

interface PdfPageProps {
  doc: PDFDocumentProxy
  pageNumber: number
  cssWidth: number
  cssHeight: number
  scrollRoot: HTMLElement | null
  annotations: Annotation[]
  onTapAnnotation: (annotation: Annotation) => void
}

const MAX_CANVAS_PIXELS = 14_000_000

function PdfPageImpl(props: PdfPageProps): React.JSX.Element {
  const { doc, pageNumber, cssWidth, cssHeight, scrollRoot } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textLayerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

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

  return (
    <div
      ref={containerRef}
      className="pm-page"
      data-page-number={pageNumber}
      style={{ width: cssWidth, height: cssHeight }}
    >
      {visible && <canvas ref={canvasRef} className="pm-page-canvas" />}
      <div ref={textLayerRef} className="pm-text-layer" />
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
