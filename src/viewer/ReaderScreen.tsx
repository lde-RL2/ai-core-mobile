import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Annotation, AnnotationType, Paper } from '../types'
import * as db from '../storage/db'
import { loadPdf } from '../pdf/pdfjs'
import { PdfPage } from './PdfPage'
import { selectionToPageRects, type PageSelection } from './selection'
import { AnnotationEditSheet, AnnotationListSheet, SelectionToolbar } from './AnnotationSheets'
import { ReaderSearchBar } from './ReaderSearchBar'

const PAGE_GAP = 14
const SIDE_PADDING = 8
const MIN_ZOOM = 0.5
const MAX_ZOOM = 4
// Double-tap toggles between fit-width (1) and this readable zoom, which fills
// a phone with roughly one column of a two-column paper.
const READABLE_ZOOM = 2.2
const EMPTY_ANNOTATIONS: Annotation[] = []

interface ReaderScreenProps {
  paper: Paper
  onClose: () => void
  refresh: () => void
}

interface PageDim {
  w: number
  h: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function ReaderScreen(props: ReaderScreenProps): React.JSX.Element {
  const { paper } = props
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [dims, setDims] = useState<PageDim[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [selection, setSelection] = useState<PageSelection | null>(null)
  const [annotType, setAnnotType] = useState<AnnotationType>('highlight')
  const [editing, setEditing] = useState<Annotation | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)

  const contentRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const pendingScrollRef = useRef<{ left: number; top: number } | null>(null)
  const initialStateRef = useRef<{ fraction: number } | null>(null)
  const restoredRef = useRef(false)
  const latestPositionRef = useRef<{ page: number; fraction: number }>({ page: 1, fraction: 0 })
  const saveTimerRef = useRef<number | null>(null)

  // ---------- document loading ----------

  useEffect(() => {
    let cancelled = false
    let loadedDoc: PDFDocumentProxy | null = null
    void (async () => {
      try {
        const blob = await db.getPdfFile(paper.id)
        if (!blob) throw new Error('PDF 파일을 찾을 수 없습니다')
        const [reading, annotationRows] = await Promise.all([
          db.getReadingState(paper.id),
          db.listAnnotations(paper.id)
        ])
        const pdf = await loadPdf(blob)
        if (cancelled) {
          void pdf.destroy().catch(() => {})
          return
        }
        loadedDoc = pdf
        initialStateRef.current = reading ? { fraction: reading.scrollFraction } : null
        // Seed the position so closing before the first scroll event doesn't
        // overwrite saved progress with page 1.
        if (reading) {
          latestPositionRef.current = {
            page: reading.lastPage,
            fraction: reading.scrollFraction
          }
        }
        setAnnotations(annotationRows)
        const pageDims: PageDim[] = []
        for (let i = 1; i <= pdf.numPages; i += 1) {
          const page = await pdf.getPage(i)
          if (cancelled) return
          const viewport = page.getViewport({ scale: 1 })
          pageDims.push({ w: viewport.width, h: viewport.height })
        }
        setDoc(pdf)
        setDims(pageDims)
        // Papers pulled from sync arrive without a page count; backfill the
        // local-only field without marking the paper dirty.
        if (paper.pageCount === null) {
          void db.putPaperLocal({ ...paper, pageCount: pdf.numPages })
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'PDF를 열 수 없습니다')
        }
      }
    })()
    return () => {
      cancelled = true
      void loadedDoc?.destroy().catch(() => {})
    }
  }, [paper.id])

  // Persist reading position on unmount.
  const refreshRef = useRef(props.refresh)
  refreshRef.current = props.refresh
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      const { page, fraction } = latestPositionRef.current
      void db.setReadingState(paper.id, page, fraction).then(() => refreshRef.current())
    }
  }, [paper.id])

  // ---------- layout ----------

  useEffect(() => {
    if (!scrollEl) return
    const observer = new ResizeObserver(() => setContainerWidth(scrollEl.clientWidth))
    observer.observe(scrollEl)
    setContainerWidth(scrollEl.clientWidth)
    return () => observer.disconnect()
  }, [scrollEl])

  const cssPageWidth = Math.max(1, (containerWidth - SIDE_PADDING * 2) * zoom)

  const layout = useMemo(() => {
    if (!dims) return null
    // The gap must scale with zoom too, otherwise the layout is not a uniform
    // scaling of itself between zoom levels and the zoom-anchor math below
    // drifts — landing on a different page the further you are down the doc.
    const gap = PAGE_GAP * zoom
    const tops: number[] = []
    const heights: number[] = []
    let cursor = gap
    for (const dim of dims) {
      const height = (cssPageWidth * dim.h) / dim.w
      tops.push(cursor)
      heights.push(height)
      cursor += height + gap
    }
    return { tops, heights, totalHeight: cursor }
  }, [dims, cssPageWidth, zoom])

  const layoutRef = useRef(layout)
  layoutRef.current = layout

  // Restore last reading position once the full layout is known.
  useEffect(() => {
    if (!scrollEl || !layout || restoredRef.current) return
    restoredRef.current = true
    const fraction = initialStateRef.current?.fraction ?? 0
    requestAnimationFrame(() => {
      scrollEl.scrollTop = fraction * Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight)
    })
  }, [scrollEl, layout])

  // Apply the scroll anchor computed by a zoom change.
  useEffect(() => {
    if (!scrollEl || !pendingScrollRef.current) return
    const { left, top } = pendingScrollRef.current
    pendingScrollRef.current = null
    scrollEl.scrollLeft = left
    scrollEl.scrollTop = top
  }, [zoom, scrollEl])

  // ---------- scroll: current page + reading state ----------

  const handleScroll = useCallback(() => {
    if (!scrollEl) return
    const currentLayout = layoutRef.current
    if (!currentLayout) return
    const midpoint = scrollEl.scrollTop + scrollEl.clientHeight / 2
    let page = 1
    for (let i = 0; i < currentLayout.tops.length; i += 1) {
      if (currentLayout.tops[i] <= midpoint) page = i + 1
      else break
    }
    setCurrentPage(page)
    const fraction =
      scrollEl.scrollTop / Math.max(1, scrollEl.scrollHeight - scrollEl.clientHeight)
    latestPositionRef.current = { page, fraction: clamp(fraction, 0, 1) }
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      const { page: savedPage, fraction: savedFraction } = latestPositionRef.current
      void db.setReadingState(paper.id, savedPage, savedFraction)
    }, 800)
  }, [scrollEl, paper.id])

  // ---------- pinch zoom ----------

  useEffect(() => {
    if (!scrollEl) return
    let pinch: {
      startDist: number
      startZoom: number
      midX: number
      midY: number
      startScrollLeft: number
      startScrollTop: number
      ratio: number
    } | null = null

    // Single-finger tap tracking, used only to detect a double-tap.
    let tapStart: { x: number; y: number; t: number } | null = null
    let lastTapTime = 0
    let lastTapX = 0
    let lastTapY = 0

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 1) {
        const t = e.touches[0]
        tapStart = { x: t.clientX, y: t.clientY, t: Date.now() }
      }
      if (e.touches.length !== 2) return
      tapStart = null
      const [a, b] = [e.touches[0], e.touches[1]]
      const rect = scrollEl.getBoundingClientRect()
      pinch = {
        startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        startZoom: zoomRef.current,
        midX: (a.clientX + b.clientX) / 2 - rect.left,
        midY: (a.clientY + b.clientY) / 2 - rect.top,
        startScrollLeft: scrollEl.scrollLeft,
        startScrollTop: scrollEl.scrollTop,
        ratio: 1
      }
    }

    const handleDoubleTap = (e: TouchEvent): void => {
      const start = tapStart
      tapStart = null
      if (!start || e.touches.length > 0) return
      const t = e.changedTouches[0]
      if (!t) return
      // A clean tap: little movement, short duration (not a scroll or long
      // press for text selection).
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 12) return
      if (Date.now() - start.t > 250) return
      const now = Date.now()
      const near = Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 40
      if (now - lastTapTime < 300 && near) {
        lastTapTime = 0
        const rect = scrollEl.getBoundingClientRect()
        const px = t.clientX - rect.left
        const py = t.clientY - rect.top
        const target = zoomRef.current < READABLE_ZOOM - 0.05 ? READABLE_ZOOM : 1
        const ratio = target / zoomRef.current
        pendingScrollRef.current = {
          left: (scrollEl.scrollLeft + px) * ratio - px,
          top: (scrollEl.scrollTop + py) * ratio - py
        }
        setZoom(target)
      } else {
        lastTapTime = now
        lastTapX = t.clientX
        lastTapY = t.clientY
      }
    }

    const onTouchMove = (e: TouchEvent): void => {
      if (!pinch || e.touches.length !== 2) return
      e.preventDefault()
      const [a, b] = [e.touches[0], e.touches[1]]
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      const ratio = clamp(
        dist / pinch.startDist,
        MIN_ZOOM / pinch.startZoom,
        MAX_ZOOM / pinch.startZoom
      )
      pinch.ratio = ratio
      const content = contentRef.current
      if (!content) return
      const tx = (pinch.midX + pinch.startScrollLeft) * (1 - ratio)
      const ty = (pinch.midY + pinch.startScrollTop) * (1 - ratio)
      content.style.transformOrigin = '0 0'
      content.style.transform = `translate(${tx}px, ${ty}px) scale(${ratio})`
    }

    const onTouchEnd = (e: TouchEvent): void => {
      if (!pinch) {
        handleDoubleTap(e)
        return
      }
      if (e.touches.length >= 2) return
      const finished = pinch
      pinch = null
      const content = contentRef.current
      if (content) content.style.transform = ''
      const newZoom = clamp(finished.startZoom * finished.ratio, MIN_ZOOM, MAX_ZOOM)
      pendingScrollRef.current = {
        left: (finished.startScrollLeft + finished.midX) * finished.ratio - finished.midX,
        top: (finished.startScrollTop + finished.midY) * finished.ratio - finished.midY
      }
      setZoom(newZoom)
    }

    scrollEl.addEventListener('touchstart', onTouchStart, { passive: true })
    scrollEl.addEventListener('touchmove', onTouchMove, { passive: false })
    scrollEl.addEventListener('touchend', onTouchEnd)
    scrollEl.addEventListener('touchcancel', onTouchEnd)
    return () => {
      scrollEl.removeEventListener('touchstart', onTouchStart)
      scrollEl.removeEventListener('touchmove', onTouchMove)
      scrollEl.removeEventListener('touchend', onTouchEnd)
      scrollEl.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [scrollEl])

  const setZoomAnchoredAtCenter = useCallback(
    (nextZoom: number) => {
      const target = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
      if (!scrollEl || target === zoomRef.current) return
      const ratio = target / zoomRef.current
      const cx = scrollEl.clientWidth / 2
      const cy = scrollEl.clientHeight / 2
      pendingScrollRef.current = {
        left: (scrollEl.scrollLeft + cx) * ratio - cx,
        top: (scrollEl.scrollTop + cy) * ratio - cy
      }
      setZoom(target)
    },
    [scrollEl]
  )

  // ---------- text selection → annotation ----------

  useEffect(() => {
    let timer: number | null = null
    const onSelectionChange = (): void => {
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const domSelection = document.getSelection()
        if (
          !domSelection ||
          domSelection.isCollapsed ||
          domSelection.rangeCount === 0 ||
          !scrollEl?.contains(domSelection.getRangeAt(0).startContainer)
        ) {
          setSelection(null)
          return
        }
        setSelection(selectionToPageRects(domSelection))
      }, 250)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => {
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('selectionchange', onSelectionChange)
    }
  }, [scrollEl])

  const applyAnnotation = useCallback(
    async (color: string, withNote: boolean) => {
      if (!selection) return
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        paperId: paper.id,
        pageNumber: selection.pageNumber,
        type: annotType,
        rects: selection.rects,
        color,
        note: null,
        text: selection.text || null,
        createdAt: new Date().toISOString(),
        updatedAt: Date.now()
      }
      await db.putAnnotation(annotation)
      setAnnotations((prev) => [...prev, annotation])
      document.getSelection()?.removeAllRanges()
      setSelection(null)
      if (withNote) setEditing(annotation)
    },
    [selection, annotType, paper.id]
  )

  const copySelection = useCallback(async () => {
    if (!selection) return
    try {
      await navigator.clipboard.writeText(selection.text)
    } catch (err) {
      console.warn('[clipboard] copy failed:', err)
    }
    document.getSelection()?.removeAllRanges()
    setSelection(null)
  }, [selection])

  const saveAnnotationEdit = useCallback(
    async (update: { type: AnnotationType; color: string; note: string | null }) => {
      if (!editing) return
      const next: Annotation = { ...editing, ...update, updatedAt: Date.now() }
      await db.putAnnotation(next)
      setAnnotations((prev) => prev.map((a) => (a.id === next.id ? next : a)))
      setEditing(null)
    },
    [editing]
  )

  const deleteEditingAnnotation = useCallback(async () => {
    if (!editing) return
    await db.deleteAnnotation(editing.id, editing.paperId)
    setAnnotations((prev) => prev.filter((a) => a.id !== editing.id))
    setEditing(null)
  }, [editing])

  // ---------- navigation ----------

  const jumpToPage = useCallback(
    (pageNumber: number, yFraction = 0) => {
      const currentLayout = layoutRef.current
      if (!scrollEl || !currentLayout) return
      const index = clamp(pageNumber, 1, currentLayout.tops.length) - 1
      scrollEl.scrollTop =
        currentLayout.tops[index] + currentLayout.heights[index] * yFraction - 8
    },
    [scrollEl]
  )

  const promptPageJump = useCallback(() => {
    if (!dims) return
    const raw = window.prompt(`페이지 이동 (1–${dims.length})`, String(currentPage))
    const pageNumber = raw ? Number.parseInt(raw, 10) : NaN
    if (Number.isFinite(pageNumber)) jumpToPage(pageNumber)
  }, [dims, currentPage, jumpToPage])

  // ---------- render ----------

  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>()
    for (const annotation of annotations) {
      const list = map.get(annotation.pageNumber) ?? []
      list.push(annotation)
      map.set(annotation.pageNumber, list)
    }
    return map
  }, [annotations])

  return (
    <div className="reader">
      <header className="reader-topbar">
        <button className="icon-button" aria-label="뒤로" onClick={props.onClose}>
          ‹
        </button>
        <span className="reader-title">{paper.title}</span>
        <button className="reader-page-indicator" onClick={promptPageJump}>
          {currentPage} / {dims?.length ?? paper.pageCount ?? '–'}
        </button>
        <button
          className="icon-button"
          aria-label="축소"
          onClick={() => setZoomAnchoredAtCenter(zoom / 1.25)}
        >
          −
        </button>
        <button
          className="icon-button"
          aria-label="확대"
          onClick={() => setZoomAnchoredAtCenter(zoom * 1.25)}
        >
          ＋
        </button>
        <button
          className="icon-button"
          aria-label="본문 검색"
          onClick={() => setSearchOpen((open) => !open)}
        >
          🔍
        </button>
        <button className="icon-button" aria-label="주석 목록" onClick={() => setListOpen(true)}>
          📑
        </button>
      </header>

      {searchOpen && doc && (
        <ReaderSearchBar
          doc={doc}
          onJump={(pageNumber) => jumpToPage(pageNumber)}
          onClose={() => setSearchOpen(false)}
        />
      )}

      <div ref={setScrollEl} className="reader-scroll" onScroll={handleScroll}>
        {error && (
          <div className="empty-state">
            <p>{error}</p>
          </div>
        )}
        {!error && (!doc || !layout) && (
          <div className="empty-state">
            <p>PDF 여는 중…</p>
          </div>
        )}
        {doc && layout && dims && (
          <div
            ref={contentRef}
            className="reader-content"
            style={{
              width: cssPageWidth + SIDE_PADDING * 2,
              height: layout.totalHeight,
              minWidth: '100%'
            }}
          >
            {dims.map((_, index) => (
              <div
                key={index}
                style={{
                  position: 'absolute',
                  top: layout.tops[index],
                  left: SIDE_PADDING
                }}
              >
                <PdfPage
                  doc={doc}
                  pageNumber={index + 1}
                  cssWidth={cssPageWidth}
                  cssHeight={layout.heights[index]}
                  scrollRoot={scrollEl}
                  annotations={annotationsByPage.get(index + 1) ?? EMPTY_ANNOTATIONS}
                  onTapAnnotation={setEditing}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {selection && !editing && (
        <SelectionToolbar
          annotType={annotType}
          setAnnotType={setAnnotType}
          onApply={(color, withNote) => void applyAnnotation(color, withNote)}
          onCopy={() => void copySelection()}
        />
      )}

      {editing && (
        <AnnotationEditSheet
          annotation={editing}
          onSave={(update) => void saveAnnotationEdit(update)}
          onDelete={() => void deleteEditingAnnotation()}
          onClose={() => setEditing(null)}
        />
      )}

      {listOpen && (
        <AnnotationListSheet
          annotations={annotations}
          onJump={(annotation) => {
            setListOpen(false)
            jumpToPage(annotation.pageNumber, annotation.rects[0]?.y ?? 0)
          }}
          onClose={() => setListOpen(false)}
        />
      )}
    </div>
  )
}
