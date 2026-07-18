import { useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

interface SearchMatch {
  page: number
  snippet: string
}

interface ReaderSearchBarProps {
  doc: PDFDocumentProxy
  onJump: (page: number) => void
  /** Publishes the committed term so the pages can highlight it. */
  onQueryChange: (query: string | null) => void
  onClose: () => void
}

const MAX_MATCHES = 200

export function ReaderSearchBar(props: ReaderSearchBarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SearchMatch[] | null>(null)
  const [searching, setSearching] = useState(false)
  const pageTextsRef = useRef<Map<number, string>>(new Map())
  const runIdRef = useRef(0)

  async function getPageText(pageNumber: number): Promise<string> {
    const cached = pageTextsRef.current.get(pageNumber)
    if (cached !== undefined) return cached
    const page = await props.doc.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
    pageTextsRef.current.set(pageNumber, text)
    return text
  }

  async function runSearch(): Promise<void> {
    const needle = query.trim().toLocaleLowerCase()
    if (needle.length < 2) {
      setMatches(null)
      props.onQueryChange(null)
      return
    }
    const runId = ++runIdRef.current
    props.onQueryChange(query.trim())
    setSearching(true)
    setMatches([])
    const found: SearchMatch[] = []
    for (let pageNumber = 1; pageNumber <= props.doc.numPages; pageNumber += 1) {
      const text = await getPageText(pageNumber)
      if (runId !== runIdRef.current) return
      const lower = text.toLocaleLowerCase()
      let index = 0
      while (found.length < MAX_MATCHES) {
        index = lower.indexOf(needle, index)
        if (index === -1) break
        const start = Math.max(0, index - 40)
        const end = Math.min(text.length, index + needle.length + 48)
        found.push({
          page: pageNumber,
          snippet: `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
        })
        index += needle.length
      }
      if (found.length >= MAX_MATCHES) break
      if (pageNumber % 10 === 0) setMatches([...found])
    }
    if (runId === runIdRef.current) {
      setMatches(found)
      setSearching(false)
    }
  }

  return (
    <div className="reader-search">
      <div className="reader-search-row">
        <input
          className="search-input"
          type="search"
          autoFocus
          placeholder="PDF 본문 검색 (2자 이상)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runSearch()
          }}
        />
        <button className="chip-button" onClick={() => void runSearch()}>
          검색
        </button>
        <button className="icon-button" aria-label="검색 닫기" onClick={props.onClose}>
          ✕
        </button>
      </div>
      {(matches !== null || searching) && (
        <div className="reader-search-results">
          <p className="reader-search-count">
            {searching ? '검색 중…' : `결과 ${matches?.length ?? 0}개`}
            {matches !== null && matches.length >= MAX_MATCHES ? ' (최대 표시)' : ''}
          </p>
          {matches?.map((match, index) => (
            <button
              key={index}
              className="reader-search-item"
              onClick={() => props.onJump(match.page)}
            >
              <span className="reader-search-snippet">{match.snippet}</span>
              <span className="annotation-list-page">p.{match.page}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
