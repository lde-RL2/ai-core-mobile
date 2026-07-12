import { useRef, useState } from 'react'
import type { Paper, ReadingState, Tag } from '../types'
import { importPdfFile } from '../storage/importPaper'

interface LibraryScreenProps {
  papers: Paper[]
  totalCount: number
  filterLabel: string | null
  onClearFilter: () => void
  search: string
  setSearch: (value: string) => void
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

function formatAuthors(authors: string | null): string {
  if (!authors) return '저자 미상'
  return authors.length > 80 ? `${authors.slice(0, 77)}…` : authors
}

export function LibraryScreen(props: LibraryScreenProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState<number | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  async function handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return
    setImportError(null)
    const list = Array.from(files).filter(
      (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
    )
    if (list.length === 0) return
    setImporting(list.length)
    try {
      for (const file of list) {
        await importPdfFile(file, props.selectedCollectionId)
        setImporting((n) => (n === null ? null : n - 1))
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '가져오기에 실패했습니다')
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
          <h1>{props.filterLabel ?? '라이브러리'}</h1>
          <div className="screen-header-actions">
            {props.filterLabel && (
              <button className="chip-button" onClick={props.onClearFilter}>
                전체 보기
              </button>
            )}
            {props.showSettingsButton && (
              <button className="icon-button" aria-label="설정" onClick={props.onOpenSettings}>
                ⚙️
              </button>
            )}
          </div>
        </div>
        <input
          className="search-input"
          type="search"
          placeholder="제목·저자·메모 검색"
          value={props.search}
          onChange={(e) => props.setSearch(e.target.value)}
        />
      </header>

      {importError && <div className="inline-error">{importError}</div>}

      <div className="paper-list">
        {props.papers.length === 0 && (
          <div className="empty-state">
            {props.totalCount === 0 ? (
              <>
                <p>아직 논문이 없습니다.</p>
                <p>오른쪽 아래 + 버튼으로 PDF를 가져오세요.</p>
              </>
            ) : (
              <p>검색/필터 조건에 맞는 논문이 없습니다.</p>
            )}
          </div>
        )}
        {props.papers.map((paper) => {
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
                ⋯
              </button>
            </article>
          )
        })}
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
        {importing !== null ? `${importing}…` : '+'}
      </button>
    </div>
  )
}
