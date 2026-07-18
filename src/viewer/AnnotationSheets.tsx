import { useEffect, useRef, useState } from 'react'
import type { Annotation, AnnotationType } from '../types'
import { ANNOTATION_COLORS } from '../types'

interface SelectionToolbarProps {
  annotType: AnnotationType
  setAnnotType: (type: AnnotationType) => void
  onApply: (color: string, withNote: boolean) => void
  onCopy: () => void
}

export function SelectionToolbar(props: SelectionToolbarProps): React.JSX.Element {
  return (
    <div className="selection-toolbar">
      <div className="selection-colors">
        {ANNOTATION_COLORS.map((color) => (
          <button
            key={color}
            className="color-swatch"
            style={{ backgroundColor: color }}
            aria-label={`${props.annotType === 'highlight' ? '하이라이트' : '밑줄'} ${color}`}
            onClick={() => props.onApply(color, false)}
          />
        ))}
      </div>
      <div className="selection-actions">
        <div className="segmented compact">
          <button
            className={props.annotType === 'highlight' ? 'segment active' : 'segment'}
            onClick={() => props.setAnnotType('highlight')}
          >
            형광펜
          </button>
          <button
            className={props.annotType === 'underline' ? 'segment active' : 'segment'}
            onClick={() => props.setAnnotType('underline')}
          >
            밑줄
          </button>
        </div>
        <button
          className="chip-button"
          onClick={() => props.onApply(ANNOTATION_COLORS[0], true)}
        >
          메모
        </button>
        <button className="chip-button" onClick={props.onCopy}>
          복사
        </button>
      </div>
    </div>
  )
}

interface AnnotationEditSheetProps {
  annotation: Annotation
  onSave: (update: { type: AnnotationType; color: string; note: string | null }) => void
  onDelete: () => void
  onClose: () => void
}

const TYPE_LABELS: Record<AnnotationType, string> = {
  highlight: '형광펜',
  underline: '밑줄',
  area: '영역 표시',
  note: '스티키 메모'
}

export function AnnotationEditSheet(props: AnnotationEditSheetProps): React.JSX.Element {
  const [type, setType] = useState<AnnotationType>(props.annotation.type)
  const [color, setColor] = useState(props.annotation.color)
  const [note, setNote] = useState(props.annotation.note ?? '')
  // Area/sticky-note rects are not text selections, so they cannot be
  // converted into highlight/underline (or back).
  const spatial = props.annotation.type === 'area' || props.annotation.type === 'note'

  // The backdrop tap saves, but the hardware back button unmounts the whole
  // reader without passing through it — a memo mid-typing was lost. Flush any
  // dirty edit on unmount unless an explicit save/delete already handled it.
  const latestRef = useRef({ type, color, note })
  latestRef.current = { type, color, note }
  const doneRef = useRef(false)
  const propsRef = useRef(props)
  propsRef.current = props

  useEffect(() => {
    return () => {
      if (doneRef.current) return
      const current = latestRef.current
      const original = propsRef.current.annotation
      const nextNote = current.note.trim() || null
      if (
        current.type === original.type &&
        current.color === original.color &&
        nextNote === (original.note ?? null)
      ) {
        return
      }
      propsRef.current.onSave({ type: current.type, color: current.color, note: nextNote })
    }
  }, [])

  function save(): void {
    doneRef.current = true
    props.onSave({ type, color, note: note.trim() || null })
  }

  return (
    <div className="sheet-backdrop" onClick={save}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-body">
          {props.annotation.text && (
            <blockquote className="annotation-quote">{props.annotation.text}</blockquote>
          )}
          <div className="selection-colors">
            {ANNOTATION_COLORS.map((swatch) => (
              <button
                key={swatch}
                className={swatch === color ? 'color-swatch selected' : 'color-swatch'}
                style={{ backgroundColor: swatch }}
                aria-label={`색상 ${swatch}`}
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
          {spatial ? (
            <p className="empty-hint">
              {TYPE_LABELS[props.annotation.type]} — 데스크톱 앱에서 만든 주석입니다. 색과 메모를
              수정할 수 있습니다.
            </p>
          ) : (
            <div className="segmented">
              <button
                className={type === 'highlight' ? 'segment active' : 'segment'}
                onClick={() => setType('highlight')}
              >
                형광펜
              </button>
              <button
                className={type === 'underline' ? 'segment active' : 'segment'}
                onClick={() => setType('underline')}
              >
                밑줄
              </button>
            </div>
          )}
          <textarea
            className="field-input"
            rows={3}
            placeholder="메모"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="sheet-actions">
            <button className="primary-button" onClick={save}>
              저장
            </button>
            <button
              className="danger-button"
              onClick={() => {
                doneRef.current = true
                props.onDelete()
              }}
            >
              삭제
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

interface AnnotationListSheetProps {
  annotations: Annotation[]
  onJump: (annotation: Annotation) => void
  onClose: () => void
}

export function AnnotationListSheet(props: AnnotationListSheetProps): React.JSX.Element {
  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-body">
          <h2 className="sheet-title">주석 {props.annotations.length}개</h2>
          {props.annotations.length === 0 && (
            <p className="empty-hint">본문에서 텍스트를 길게 눌러 선택하면 주석을 만들 수 있습니다.</p>
          )}
          <div className="annotation-list">
            {props.annotations.map((annotation) => (
              <button
                key={annotation.id}
                className="annotation-list-item"
                onClick={() => props.onJump(annotation)}
              >
                <span
                  className="color-dot"
                  style={{ backgroundColor: annotation.color }}
                  aria-hidden
                />
                <span className="annotation-list-text">
                  <span className="annotation-list-quote">
                    {annotation.text || TYPE_LABELS[annotation.type]}
                  </span>
                  {annotation.note && (
                    <span className="annotation-list-note">{annotation.note}</span>
                  )}
                </span>
                <span className="annotation-list-page">p.{annotation.pageNumber}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
