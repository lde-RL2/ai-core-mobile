import { useEffect, useState } from 'react'
import type { Collection, Paper, Tag } from '../types'
import * as db from '../storage/db'
import { useDialogs } from './Dialogs'

interface PaperDetailSheetProps {
  paper: Paper
  collections: Collection[]
  tags: Tag[]
  refresh: () => void
  onClose: () => void
  onOpen: () => void
}

export function PaperDetailSheet(props: PaperDetailSheetProps): React.JSX.Element {
  const { paper } = props
  const [title, setTitle] = useState(paper.title)
  const [notes, setNotes] = useState(paper.notes ?? '')
  const [tagIds, setTagIds] = useState<string[]>([])
  const [collectionIds, setCollectionIds] = useState<string[]>([])
  const [newTag, setNewTag] = useState('')
  const dialogs = useDialogs()

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      db.listTagIdsForPaper(paper.id),
      db.listCollectionsForPaper(paper.id)
    ]).then(([tagRows, collectionRows]) => {
      if (cancelled) return
      setTagIds(tagRows)
      setCollectionIds(collectionRows)
    })
    return () => {
      cancelled = true
    }
  }, [paper.id])

  async function saveTitleAndNotes(): Promise<void> {
    const trimmedTitle = title.trim() || paper.title
    await db.putPaper({
      ...paper,
      title: trimmedTitle,
      notes: notes.trim() || null,
      updatedAt: Date.now()
    })
    props.refresh()
  }

  async function toggleTag(tagId: string): Promise<void> {
    if (tagIds.includes(tagId)) {
      await db.removePaperFromTag(paper.id, tagId)
      setTagIds((prev) => prev.filter((id) => id !== tagId))
    } else {
      await db.assignPaperToTag(paper.id, tagId)
      setTagIds((prev) => [...prev, tagId])
    }
    props.refresh()
  }

  async function addNewTag(): Promise<void> {
    const name = newTag.trim()
    if (!name) return
    const tag = await db.createTag(name)
    await db.assignPaperToTag(paper.id, tag.id)
    setTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]))
    setNewTag('')
    props.refresh()
  }

  async function toggleCollection(collectionId: string): Promise<void> {
    if (collectionIds.includes(collectionId)) {
      await db.removePaperFromCollection(paper.id, collectionId)
      setCollectionIds((prev) => prev.filter((id) => id !== collectionId))
    } else {
      await db.assignPaperToCollection(paper.id, collectionId)
      setCollectionIds((prev) => [...prev, collectionId])
    }
    props.refresh()
  }

  async function deletePaper(): Promise<void> {
    const ok = await dialogs.confirm({
      title: `"${paper.title}"을(를) 삭제할까요?`,
      message: 'PDF와 주석이 모두 삭제됩니다.',
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await db.deletePaper(paper.id)
    props.refresh()
    props.onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={props.onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <div className="sheet-body">
          <label className="field-label" htmlFor="detail-title">
            제목
          </label>
          <textarea
            id="detail-title"
            className="field-input"
            rows={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveTitleAndNotes()}
          />
          <p className="paper-meta">
            {paper.authors ?? '저자 미상'}
            {paper.year ? ` · ${paper.year}` : ''}
            {paper.pageCount ? ` · ${paper.pageCount}쪽` : ''}
          </p>
          <p className="paper-meta faint">{paper.originalFilename}</p>

          <label className="field-label" htmlFor="detail-notes">
            메모
          </label>
          <textarea
            id="detail-notes"
            className="field-input"
            rows={4}
            placeholder="이 논문에 대한 메모"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => void saveTitleAndNotes()}
          />

          <span className="field-label">태그</span>
          <div className="tag-cloud">
            {props.tags.map((tag) => (
              <button
                key={tag.id}
                className={tagIds.includes(tag.id) ? 'chip selectable selected' : 'chip selectable'}
                onClick={() => void toggleTag(tag.id)}
              >
                #{tag.name}
              </button>
            ))}
          </div>
          <div className="tag-add-row">
            <input
              className="field-input"
              placeholder="새 태그 추가"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void addNewTag()
              }}
            />
            <button className="chip-button" onClick={() => void addNewTag()}>
              추가
            </button>
          </div>

          {props.collections.length > 0 && (
            <>
              <span className="field-label">컬렉션</span>
              <div className="collection-checklist">
                {props.collections.map((collection) => (
                  <label key={collection.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={collectionIds.includes(collection.id)}
                      onChange={() => void toggleCollection(collection.id)}
                    />
                    {collection.name}
                  </label>
                ))}
              </div>
            </>
          )}

          <div className="sheet-actions">
            <button className="primary-button" onClick={props.onOpen}>
              읽기
            </button>
            <button className="danger-button" onClick={() => void deletePaper()}>
              삭제
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
