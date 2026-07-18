import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { ANNOTATION_COLORS, type Annotation, type AnnotationType, type Paper } from '../types'
import * as db from '../storage/db'
import { loadPdf } from '../pdf/pdfjs'
import { PdfPage, type PlacementTool } from './PdfPage'
import { selectionToPageRects, type PageSelection } from './selection'
import { AnnotationEditSheet, AnnotationListSheet, SelectionToolbar } from './AnnotationSheets'
import { ReaderSearchBar } from './ReaderSearchBar'
import { OutlineSheet } from './OutlineSheet'
import { destinationToPageNumber, flattenOutline, type OutlineEntry } from './pdfDest'
import { detectColumns, type ColumnLayout } from './columnDetect'
import { useDialogs } from '../components/Dialogs'
import { Icon } from '../components/Icon'
import { loadPaperZoom, savePaperZoom } from './zoomMemory'

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
  // Reopening a paper restores the zoom it was last read at — otherwise every
  // open of a two-column paper started at fit-width and needed the same
  // double-tap again.
  const [zoom, setZoom] = useState(() => loadPaperZoom(paper.id) ?? 1)
  const [containerWidth, setContainerWidth] = useState(0)
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [selection, setSelection] = useState<PageSelection | null>(null)
  const [annotType, setAnnotType] = useState<AnnotationType>('highlight')
  const [editing, setEditing] = useState<Annotation | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  // Immersive reading: a single tap hides the top bar and scrubber so the page
  // gets the whole screen — the standard phone reader behaviour.
  const [chromeVisible, setChromeVisible] = useState(true)
  const [searchQuery, setSearchQuery] = useState<string | null>(null)
  const [returnScrollTop, setReturnScrollTop] = useState<number | null>(null)
  const [outline, setOutline] = useState<OutlineEntry[]>([])
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [tool, setTool] = useState<PlacementTool>('none')
  const [textless, setTextless] = useState(false)
  const [scanNoticeDismissed, setScanNoticeDismissed] = useState(false)
  const [columnLayout, setColumnLayout] = useState<ColumnLayout | null>(null)
  const [columnMode, setColumnMode] = useState(false)
  const [activeColumn, setActiveColumn] = useState(0)
  const dialogs = useDialogs()

  const contentRef = useRef<HTMLDivElement>(null)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom

  useEffect(() => {
    savePaperZoom(paper.id, zoom)
  }, [paper.id, zoom])
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
        // First paint used to wait for a getPage() round-trip per page — a
        // 300-page thesis stared at a blank screen for seconds. Papers have
        // uniform pages, so lay out immediately with page 1's size as the
        // estimate and correct any pages that differ in the background.
        const firstPage = await pdf.getPage(1)
        if (cancelled) return
        const firstViewport = firstPage.getViewport({ scale: 1 })
        const estimate: PageDim = { w: firstViewport.width, h: firstViewport.height }
        setDoc(pdf)
        setDims(Array.from({ length: pdf.numPages }, () => estimate))
        void (async () => {
          const real: PageDim[] = Array.from({ length: pdf.numPages }, () => estimate)
          let corrected = false
          for (let i = 2; i <= pdf.numPages; i += 1) {
            try {
              const page = await pdf.getPage(i)
              if (cancelled) return
              const viewport = page.getViewport({ scale: 1 })
              if (
                Math.abs(viewport.width - estimate.w) > 0.5 ||
                Math.abs(viewport.height - estimate.h) > 0.5
              ) {
                real[i - 1] = { w: viewport.width, h: viewport.height }
                corrected = true
              }
            } catch {
              // Keep the estimate for an unreadable page.
            }
          }
          // One relayout at the end, and only for genuinely mixed-size
          // documents — the common all-uniform paper never relayouts.
          if (!cancelled && corrected) setDims(real)
        })()
        // Infer the column layout from a few body pages. Papers are uniform, so
        // the first page that reads as two columns settles it; page 1 alone is
        // unreliable (title blocks and abstracts often span the full width).
        void (async () => {
          let found: ColumnLayout | null = null
          let textItems = 0
          for (let i = 1; i <= Math.min(4, pdf.numPages); i += 1) {
            try {
              const page = await pdf.getPage(i)
              if (cancelled) return
              const content = await page.getTextContent()
              textItems += content.items.length
              if (!found) {
                const pageWidth = page.getViewport({ scale: 1 }).width
                const spans = content.items.flatMap((item) =>
                  'width' in item && 'transform' in item
                    ? [{ x: item.transform[4] as number, width: item.width }]
                    : []
                )
                const layout = detectColumns(spans, pageWidth)
                if (layout.columns.length > 1) found = layout
              }
            } catch {
              // Skip an unreadable page; the reader stays single-column.
            }
          }
          if (cancelled) return
          if (found) setColumnLayout(found)
          // Practically no extractable text means an image-only scan, where
          // selection, search and column detection can never work.
          setTextless(textItems < 8)
        })()

        // Section bookmarks, when the publisher embedded them.
        void pdf
          .getOutline()
          .then((nodes) => {
            if (!cancelled && nodes?.length) setOutline(flattenOutline(nodes))
          })
          .catch(() => {
            // A malformed outline just means no section navigation.
          })
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

  // Keep the screen awake while reading — a long page can otherwise dim and
  // lock mid-paragraph. The lock is dropped by the OS whenever the tab is
  // backgrounded, so re-acquire it when we come back.
  useEffect(() => {
    const wakeLock = navigator.wakeLock
    if (!wakeLock) return
    let sentinel: WakeLockSentinel | null = null
    let disposed = false

    const acquire = async (): Promise<void> => {
      if (disposed || document.visibilityState !== 'visible') return
      try {
        sentinel = await wakeLock.request('screen')
      } catch {
        // Denied or unsupported (e.g. low battery) — reading still works.
      }
    }
    void acquire()

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void acquire()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [])

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

    // Single-finger tap tracking: one tap toggles the chrome, two zoom.
    let tapStart: { x: number; y: number; t: number } | null = null
    let lastTapTime = 0
    let lastTapX = 0
    let lastTapY = 0
    let singleTapTimer: number | null = null

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length === 1) {
        const t = e.touches[0]
        tapStart = { x: t.clientX, y: t.clientY, t: Date.now() }
      }
      if (e.touches.length !== 2) return
      tapStart = null
      if (singleTapTimer !== null) {
        window.clearTimeout(singleTapTimer)
        singleTapTimer = null
      }
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

    const handleTap = (e: TouchEvent): void => {
      const start = tapStart
      tapStart = null
      if (!start || e.touches.length > 0) return
      const t = e.changedTouches[0]
      if (!t) return
      // A clean tap: little movement, short duration (not a scroll or long
      // press for text selection).
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 12) return
      if (Date.now() - start.t > 250) return
      // Tapping an annotation opens its editor; never treat that as a page tap.
      if ((e.target as Element | null)?.closest?.('.pm-annotation')) return
      // A tap that dismisses an active text selection shouldn't also toggle.
      if (!document.getSelection()?.isCollapsed) return

      const now = Date.now()
      const near = Math.hypot(t.clientX - lastTapX, t.clientY - lastTapY) < 40
      if (now - lastTapTime < 300 && near) {
        // Second tap: cancel the pending chrome toggle and zoom instead.
        if (singleTapTimer !== null) window.clearTimeout(singleTapTimer)
        singleTapTimer = null
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
        return
      }

      lastTapTime = now
      lastTapX = t.clientX
      lastTapY = t.clientY
      // Wait out the double-tap window before toggling, so a double-tap to
      // zoom doesn't flash the chrome.
      if (singleTapTimer !== null) window.clearTimeout(singleTapTimer)
      singleTapTimer = window.setTimeout(() => {
        singleTapTimer = null
        setChromeVisible((visible) => !visible)
      }, 300)
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
        handleTap(e)
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
      if (singleTapTimer !== null) window.clearTimeout(singleTapTimer)
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

  /** Place a note or area annotation without needing a text selection — the
   *  only way to annotate a scanned paper, and handy for figures. */
  const placeAnnotation = useCallback(
    async (pageNumber: number, type: 'note' | 'area', rect: Annotation['rects'][number]) => {
      const annotation: Annotation = {
        id: crypto.randomUUID(),
        paperId: paper.id,
        pageNumber,
        type,
        rects: [rect],
        color: ANNOTATION_COLORS[0],
        note: null,
        text: null,
        createdAt: new Date().toISOString(),
        updatedAt: Date.now()
      }
      await db.putAnnotation(annotation)
      setAnnotations((prev) => [...prev, annotation])
      setTool('none')
      // Notes exist to carry a memo, so go straight to typing it.
      if (type === 'note') setEditing(annotation)
    },
    [paper.id]
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

  /** Zoom so one column fills the screen and pin the horizontal scroll to it.
   *  `atPage` starts the column at that page's top; otherwise the current
   *  vertical position is kept (scaled to the new zoom). */
  const goToColumn = useCallback(
    (index: number, atPage?: number) => {
      const columns = columnLayout?.columns
      const currentLayout = layoutRef.current
      if (!columns || !scrollEl || !currentLayout) return
      const column = columns[index]
      if (!column) return
      const width = Math.max(0.05, column.end - column.start)
      const target = clamp(1 / width, MIN_ZOOM, MAX_ZOOM)
      const ratio = target / zoomRef.current
      const nextPageWidth = Math.max(1, (containerWidth - SIDE_PADDING * 2) * target)
      pendingScrollRef.current = {
        left: column.start * nextPageWidth,
        top:
          atPage !== undefined
            ? currentLayout.tops[clamp(atPage, 1, currentLayout.tops.length) - 1] * ratio
            : scrollEl.scrollTop * ratio
      }
      setActiveColumn(index)
      setZoom(target)
    },
    [columnLayout, scrollEl, containerWidth]
  )

  const toggleColumnMode = useCallback(() => {
    if (columnMode) {
      setColumnMode(false)
      setZoomAnchoredAtCenter(1)
      return
    }
    setColumnMode(true)
    goToColumn(0, currentPage)
  }, [columnMode, goToColumn, currentPage, setZoomAnchoredAtCenter])

  /** Reading order is p1c1 → p1c2 → p2c1 …, which a plain vertical scroll
   *  cannot express, so advancing is an explicit step. */
  const advanceColumn = useCallback(() => {
    const total = columnLayout?.columns.length ?? 1
    if (activeColumn + 1 < total) goToColumn(activeColumn + 1, currentPage)
    else goToColumn(0, currentPage + 1)
  }, [activeColumn, columnLayout, goToColumn, currentPage])

  const retreatColumn = useCallback(() => {
    if (activeColumn > 0) goToColumn(activeColumn - 1, currentPage)
    else goToColumn((columnLayout?.columns.length ?? 1) - 1, Math.max(1, currentPage - 1))
  }, [activeColumn, columnLayout, goToColumn, currentPage])

  // Following a citation should be a round trip: remember exactly where the
  // reader was so "돌아가기" lands back on the sentence being read.
  const followDestination = useCallback(
    async (dest: string | unknown[]) => {
      if (!doc || !scrollEl) return
      const pageNumber = await destinationToPageNumber(doc, dest)
      if (!pageNumber) return
      setReturnScrollTop(scrollEl.scrollTop)
      jumpToPage(pageNumber)
    },
    [doc, scrollEl, jumpToPage]
  )

  const goBackFromLink = useCallback(() => {
    if (!scrollEl || returnScrollTop === null) return
    scrollEl.scrollTop = returnScrollTop
    setReturnScrollTop(null)
  }, [scrollEl, returnScrollTop])

  const jumpToOutlineEntry = useCallback(
    async (entry: OutlineEntry) => {
      setOutlineOpen(false)
      if (entry.url) {
        window.open(entry.url, '_blank', 'noopener,noreferrer')
        return
      }
      if (!doc) return
      const pageNumber = await destinationToPageNumber(doc, entry.dest)
      if (pageNumber) jumpToPage(pageNumber)
    },
    [doc, jumpToPage]
  )

  const promptPageJump = useCallback(async () => {
    if (!dims) return
    const raw = await dialogs.prompt({
      title: '페이지 이동',
      message: `1 – ${dims.length} 사이의 페이지 번호`,
      defaultValue: String(currentPage),
      confirmLabel: '이동',
      numericRange: { min: 1, max: dims.length }
    })
    const pageNumber = raw ? Number.parseInt(raw, 10) : NaN
    if (Number.isFinite(pageNumber)) jumpToPage(pageNumber)
  }, [dims, currentPage, jumpToPage, dialogs])

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
      <header className={chromeVisible ? 'reader-topbar' : 'reader-topbar hidden'}>
        <button className="icon-button" aria-label="뒤로" onClick={props.onClose}>
          <Icon name="back" size={22} />
        </button>
        <span className="reader-title">{paper.title}</span>
        <button className="reader-page-indicator" onClick={() => void promptPageJump()}>
          {currentPage} / {dims?.length ?? paper.pageCount ?? '–'}
        </button>
        <button
          className="icon-button"
          aria-label="축소"
          onClick={() => setZoomAnchoredAtCenter(zoom / 1.25)}
        >
          <Icon name="minus" size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="확대"
          onClick={() => setZoomAnchoredAtCenter(zoom * 1.25)}
        >
          <Icon name="plus" size={20} />
        </button>
        <button
          className="icon-button"
          aria-label="본문 검색"
          onClick={() => setSearchOpen((open) => !open)}
        >
          <Icon name="search" size={20} />
        </button>
        {columnLayout && columnLayout.columns.length > 1 && (
          <button
            className={columnMode ? 'icon-button active' : 'icon-button'}
            aria-label={columnMode ? '단 모드 끄기' : '단 모드 켜기'}
            aria-pressed={columnMode}
            onClick={toggleColumnMode}
          >
            <Icon name="columns" size={20} />
          </button>
        )}
        {outline.length > 0 && (
          <button className="icon-button" aria-label="목차" onClick={() => setOutlineOpen(true)}>
            <Icon name="outline" size={20} />
          </button>
        )}
        <button
          className={tool !== 'none' ? 'icon-button active' : 'icon-button'}
          aria-label="주석 도구"
          aria-pressed={tool !== 'none'}
          onClick={() => setTool((current) => (current === 'none' ? 'note' : 'none'))}
        >
          <Icon name="annotate" size={20} />
        </button>
        <button className="icon-button" aria-label="주석 목록" onClick={() => setListOpen(true)}>
          <Icon name="marks" size={20} />
        </button>
      </header>

      {textless && !scanNoticeDismissed && (
        <div className="reader-notice">
          <span>
            스캔된 이미지 PDF입니다. 텍스트 선택·검색은 되지 않지만, 주석 도구로 메모와 영역
            표시는 할 수 있습니다.
          </span>
          <button
            className="icon-button small"
            aria-label="안내 닫기"
            onClick={() => setScanNoticeDismissed(true)}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}

      {tool !== 'none' && (
        <div className="reader-tool-bar">
          <button
            className={tool === 'note' ? 'column-step primary' : 'column-step'}
            onClick={() => setTool('note')}
          >
            <Icon name="note" size={17} /> 메모 찍기
          </button>
          <button
            className={tool === 'area' ? 'column-step primary' : 'column-step'}
            onClick={() => setTool('area')}
          >
            <Icon name="area" size={17} /> 영역 표시
          </button>
          <button className="column-step" onClick={() => setTool('none')}>
            취소
          </button>
        </div>
      )}

      {searchOpen && doc && (
        <ReaderSearchBar
          doc={doc}
          onJump={(pageNumber) => jumpToPage(pageNumber)}
          onQueryChange={setSearchQuery}
          onClose={() => {
            setSearchOpen(false)
            setSearchQuery(null)
          }}
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
                  searchQuery={searchQuery}
                  onFollowDestination={(dest) => void followDestination(dest)}
                  tool={tool}
                  onPlaceAnnotation={(page, type, rect) =>
                    void placeAnnotation(page, type, rect)
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {returnScrollTop !== null && (
        <button className="reader-return-chip" onClick={goBackFromLink}>
          ↩ 읽던 곳으로
        </button>
      )}

      {columnMode && columnLayout && (
        <div className={chromeVisible ? 'reader-column-bar' : 'reader-column-bar hidden'}>
          <button className="column-step" onClick={retreatColumn}>
            ◀ 이전 단
          </button>
          <span className="column-indicator">
            {activeColumn + 1} / {columnLayout.columns.length} 단
          </span>
          <button className="column-step primary" onClick={advanceColumn}>
            다음 단 ▶
          </button>
        </div>
      )}

      {dims && dims.length > 1 && (
        <div className={chromeVisible ? 'reader-scrubber' : 'reader-scrubber hidden'}>
          <input
            className="reader-scrubber-range"
            type="range"
            min={1}
            max={dims.length}
            value={currentPage}
            aria-label="페이지 이동 슬라이더"
            onChange={(e) => jumpToPage(Number(e.target.value))}
          />
          <span className="reader-scrubber-label">
            {currentPage} / {dims.length}
          </span>
        </div>
      )}

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

      {outlineOpen && (
        <OutlineSheet
          entries={outline}
          onJump={(entry) => void jumpToOutlineEntry(entry)}
          onClose={() => setOutlineOpen(false)}
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
