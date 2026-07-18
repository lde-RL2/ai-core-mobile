import { useEffect, useRef, useState } from 'react'
import type { Paper, ReadingState, Tag } from '../types'
import { importPdfFile } from '../storage/importPaper'
import { SORT_LABELS, type PaperSort } from '../sortPapers'
import { Icon } from './Icon'
import { requestThumbnail } from '../storage/thumbs'

/** First-page preview. Falls back to a paper-toned placeholder while the
 *  thumbnail is being generated (or when the PDF cannot be rendered). */
function PaperThumb({ paperId }: { paperId: string }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    void requestThumbnail(paperId).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [paperId])

  return url ? (
    <img className="paper-thumb" src={url} alt="" loading="lazy" />
  ) : (
    <span className="paper-thumb placeholder" aria-hidden>
      <Icon name="library" size={17} />
    </span>
  )
}

interface LibraryScreenProps {
  papers: Paper[]
  totalCount: number
  filterLabel: string | null
  onClearFilter: () => void
  search: string
  setSearch: (value: string) => void
  sort: PaperSort
  setSort: (sort: PaperSort) => void
  resumePaper: Paper | null
  tagIdsByPaper: Map<string, string[]>
  tagsById: Map<string, Tag>
  readingByPaper: Map<string, ReadingState>
  selectedCollectionId: string | null
  onOpenPaper: (paperId: string) => void
  onOpenDetail: (paperId: string) => void
  onImported: () => void
  showSettingsButton: boolean
  onOpenSettings: () => void
}

/** Cards rendered per batch. The list grows as the user scrolls instead of
 *  mounting a card per paper — a few hundred papers would otherwise put a few
 *  thousand nodes in the document and make scrolling stutter on a phone. */
const BATCH = 40

function formatAuthors(authors: string | null): string {
  if (!authors) return '저자 미상'
  return authors.length > 80 ? `${authors.slice(0, 77)}…` : authors
}

interface ImportProgress {
  done: number
  total: number
  currentName: string
}

/** A quota failure surfaced as a raw browser error; say what actually
 *  happened and where to check. */
function importErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  const text = error instanceof Error ? error.message : String(error)
  if (name === 'QuotaExceededError' || /quota/i.test(text)) {
    return '기기 저장 공간이 부족해 가져오지 못했습니다. 설정 → 저장 공간에서 사용량을 확인하거나 안 읽는 논문을 정리해 보세요.'
  }
  return text || '가져오기에 실패했습니다'
}

export function LibraryScreen(props: LibraryScreenProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState<ImportProgress | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [shown, setShown] = useState(BATCH)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // A new filter/search/sort result starts from the top again.
  useEffect(() => setShown(BATCH), [props.papers])

  // Grow the rendered window as the sentinel below the list comes into view.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown((count) => Math.min(count + BATCH, props.papers.length))
        }
      },
      { rootMargin: '600px 0px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [props.papers.length])

  const visiblePapers = props.papers.slice(0, shown)

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    setImportError(null)
    const list = Array.from(files).filter(
      (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    )
    if (list.length === 0) return
    try {
      for (const [index, file] of list.entries()) {
        setImporting({ done: index, total: list.length, currentName: file.name })
        await importPdfFile(file, props.selectedCollectionId)
      }
    } catch (error) {
      setImportError(importErrorMessage(error))
    } finally {
      setImporting(null)
      props.onImported()
    }
  }

  return (
    <div
      className="screen library-screen"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        void handleFiles(e.dataTransfer.files)
      }}
    >
      <header className="screen-header">
        <div className="screen-header-row">
          <div className="screen-title-block">
            <h1>{props.filterLabel ?? '라이브러리'}</h1>
            <p className="screen-subtitle">
              {props.papers.length === props.totalCount
                ? `논문 ${props.totalCount}편`
                : `${props.papers.length} / ${props.totalCount}편`}
            </p>
          </div>
          <div className="screen-header-actions">
            {props.filterLabel && (
              <button className="chip-button" onClick={props.onClearFilter}>
                전체 보기
              </button>
            )}
            {props.showSettingsButton && (
              <button className="icon-button" aria-label="설정" onClick={props.onOpenSettings}>
                <Icon name="settings" size={21} />
              </button>
            )}
          </div>
        </div>
        <div className="search-field">
          <Icon name="search" size={17} className="search-field-icon" />
          <input
            className="search-input"
            type="search"
            placeholder="제목·저자·메모 검색"
            value={props.search}
            onChange={(e) => props.setSearch(e.target.value)}
          />
          {props.search && (
            <button
              className="search-clear"
              aria-label="검색어 지우기"
              onClick={() => props.setSearch('')}
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
        <div className="sort-row">
          <div className="segmented compact">
            {(Object.keys(SORT_LABELS) as PaperSort[]).map((option) => (
              <button
                key={option}
                className={props.sort === option ? 'segment active' : 'segment'}
                onClick={() => props.setSort(option)}
              >
                {SORT_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </header>

      {importError && <div className="inline-error">{importError}</div>}

      {importing && (
        <div className="import-progress" role="status">
          <div className="import-progress-row">
            <span className="import-progress-name">{importing.currentName}</span>
            <span className="import-progress-count">
              {importing.done + 1} / {importing.total}
            </span>
          </div>
          <div className="import-progress-track" aria-hidden>
            <div
              className="import-progress-fill"
              style={{ width: `${((importing.done + 0.5) / importing.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {props.resumePaper && (
        <button
          className="resume-card"
          onClick={() => props.onOpenPaper(props.resumePaper!.id)}
        >
          <span className="resume-thumb">
            <PaperThumb paperId={props.resumePaper.id} />
          </span>
          <span className="resume-body">
            <span className="resume-label">이어서 읽기</span>
            <span className="resume-title">{props.resumePaper.title}</span>
            <span className="resume-progress">
              {(() => {
                const reading = props.readingByPaper.get(props.resumePaper.id)
                const total = props.resumePaper.pageCount
                return reading && total
                  ? `${reading.lastPage} / ${total}쪽 · ${Math.min(100, Math.round((reading.lastPage / total) * 100))}%`
                  : '이어서 보기'
              })()}
            </span>
          </span>
        </button>
      )}

      <div className="paper-list">
        {props.papers.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden>
              <Icon name={props.totalCount === 0 ? 'library' : 'search'} size={34} />
            </span>
            {props.totalCount === 0 ? (
              <>
                <p className="empty-title">아직 논문이 없습니다</p>
                <p>오른쪽 아래 + 버튼으로 PDF를 가져오세요.</p>
              </>
            ) : (
              <>
                <p className="empty-title">결과가 없습니다</p>
                <p>다른 검색어나 필터를 시도해 보세요.</p>
              </>
            )}
          </div>
        )}
        {visiblePapers.map((paper) => {
          const reading = props.readingByPaper.get(paper.id)
          const progress =
            reading && paper.pageCount
              ? Math.min(100, Math.round((reading.lastPage / paper.pageCount) * 100))
              : null
          const tagIds = props.tagIdsByPaper.get(paper.id) ?? []
          return (
            <article
              key={paper.id}
              className="paper-card"
              onClick={() => props.onOpenPaper(paper.id)}
            >
              <PaperThumb paperId={paper.id} />
              <div className="paper-card-body">
                <h2 className="paper-title">{paper.title}</h2>
                <p className="paper-meta">
                  {formatAuthors(paper.authors)}
                  {paper.year ? ` · ${paper.year}` : ''}
                  {paper.pageCount ? ` · ${paper.pageCount}쪽` : ''}
                </p>
                {(tagIds.length > 0 || progress !== null) && (
                  <div className="paper-chips">
                    {progress !== null && <span className="chip chip-progress">{progress}%</span>}
                    {tagIds.map((tagId) => {
                      const tag = props.tagsById.get(tagId)
                      return tag ? (
                        <span key={tagId} className="chip">
                          #{tag.name}
                        </span>
                      ) : null
                    })}
                  </div>
                )}
              </div>
              <button
                className="icon-button paper-more"
                aria-label="상세 정보"
                onClick={(e) => {
                  e.stopPropagation()
                  props.onOpenDetail(paper.id)
                }}
              >
                <Icon name="more" size={19} />
              </button>
            </article>
          )
        })}
        <div ref={sentinelRef} aria-hidden />
        {shown < props.papers.length && (
          <p className="list-more">{props.papers.length - shown}개 더 불러오는 중…</p>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <button
        className="fab"
        aria-label="PDF 가져오기"
        disabled={importing !== null}
        onClick={() => fileInputRef.current?.click()}
      >
        {importing !== null ? `${importing.total - importing.done}…` : <Icon name="plus" size={26} />}
      </button>
    </div>
  )
}
