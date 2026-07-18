import type { OutlineEntry } from './pdfDest'

interface OutlineSheetProps {
  entries: OutlineEntry[]
  onJump: (entry: OutlineEntry) => void
  onClose: () => void
}

/** Section navigation from the PDF's own bookmarks — for a paper this is
 *  Introduction / Methods / Results rather than blind page scrubbing. */
export function OutlineSheet(props: OutlineSheetProps): React.JSX.Element {
  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-body">
          <h2 className="sheet-title">목차</h2>
          {props.entries.length === 0 && (
            <p className="empty-hint">이 PDF에는 목차 정보가 없습니다.</p>
          )}
          <div className="outline-list">
            {props.entries.map((entry, index) => (
              <button
                key={`${entry.title}-${index}`}
                className="outline-item"
                style={{ paddingLeft: `${12 + Math.min(entry.depth, 4) * 16}px` }}
                onClick={() => props.onJump(entry)}
              >
                <span className={entry.depth === 0 ? 'outline-title top' : 'outline-title'}>
                  {entry.title}
                </span>
                {entry.url && <span className="outline-external">↗</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
