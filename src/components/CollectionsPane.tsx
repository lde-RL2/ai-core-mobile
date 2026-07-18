import { useMemo, useState } from 'react'
import type { Collection, Tag } from '../types'
import * as db from '../storage/db'
import { useDialogs } from './Dialogs'

interface CollectionsPaneProps {
  collections: Collection[]
  tags: Tag[]
  selectedCollectionId: string | null
  selectedTagId: string | null
  onSelectCollection: (id: string | null) => void
  onSelectTag: (id: string | null) => void
  refresh: () => void
}

interface TreeNode {
  collection: Collection
  children: TreeNode[]
}

function buildTree(collections: Collection[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>()
  for (const c of collections) nodes.set(c.id, { collection: c, children: [] })
  const roots: TreeNode[] = []
  for (const node of nodes.values()) {
    const parent = node.collection.parentId ? nodes.get(node.collection.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

export function CollectionsPane(props: CollectionsPaneProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const tree = useMemo(() => buildTree(props.collections), [props.collections])
  const dialogs = useDialogs()

  function toggleCollapsed(id: string): void {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function createCollection(parentId: string | null): Promise<void> {
    const name = await dialogs.prompt({
      title: '새 컬렉션',
      placeholder: '컬렉션 이름',
      confirmLabel: '만들기'
    })
    if (!name) return
    await db.createCollection(name, parentId)
    props.refresh()
  }

  async function renameCollection(collection: Collection): Promise<void> {
    const name = await dialogs.prompt({
      title: '컬렉션 이름 변경',
      defaultValue: collection.name,
      confirmLabel: '저장'
    })
    if (!name || name === collection.name) return
    await db.renameCollection(collection.id, name)
    props.refresh()
  }

  async function deleteCollection(collection: Collection): Promise<void> {
    const ok = await dialogs.confirm({
      title: `"${collection.name}" 컬렉션을 삭제할까요?`,
      message: '하위 컬렉션도 함께 삭제됩니다. 논문 파일은 남습니다.',
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await db.deleteCollection(collection.id)
    if (props.selectedCollectionId === collection.id) props.onSelectCollection(null)
    props.refresh()
  }

  async function createTag(): Promise<void> {
    const name = await dialogs.prompt({
      title: '새 태그',
      placeholder: '태그 이름',
      confirmLabel: '만들기'
    })
    if (!name) return
    await db.createTag(name)
    props.refresh()
  }

  async function deleteTag(tag: Tag): Promise<void> {
    const ok = await dialogs.confirm({
      title: `태그 #${tag.name}을(를) 삭제할까요?`,
      message: '이 태그가 달린 논문은 그대로 남습니다.',
      confirmLabel: '삭제',
      danger: true
    })
    if (!ok) return
    await db.deleteTag(tag.id)
    if (props.selectedTagId === tag.id) props.onSelectTag(null)
    props.refresh()
  }

  function renderNode(node: TreeNode, depth: number): React.JSX.Element {
    const { collection, children } = node
    const isCollapsed = collapsed.has(collection.id)
    const selected = props.selectedCollectionId === collection.id
    return (
      <div key={collection.id}>
        <div
          className={selected ? 'tree-row selected' : 'tree-row'}
          style={{ paddingLeft: 12 + depth * 18 }}
        >
          <button
            className="tree-caret"
            aria-label={isCollapsed ? '펼치기' : '접기'}
            style={{ visibility: children.length > 0 ? 'visible' : 'hidden' }}
            onClick={() => toggleCollapsed(collection.id)}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <button className="tree-label" onClick={() => props.onSelectCollection(collection.id)}>
            📁 {collection.name}
          </button>
          <span className="tree-actions">
            <button
              className="icon-button small"
              aria-label="하위 컬렉션 추가"
              onClick={() => void createCollection(collection.id)}
            >
              ＋
            </button>
            <button
              className="icon-button small"
              aria-label="이름 변경"
              onClick={() => void renameCollection(collection)}
            >
              ✎
            </button>
            <button
              className="icon-button small danger"
              aria-label="삭제"
              onClick={() => void deleteCollection(collection)}
            >
              ✕
            </button>
          </span>
        </div>
        {!isCollapsed && children.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <div className="screen collections-screen">
      <header className="screen-header">
        <div className="screen-header-row">
          <h1>컬렉션</h1>
          <button className="chip-button" onClick={() => void createCollection(null)}>
            + 새 컬렉션
          </button>
        </div>
      </header>

      <div className="collections-body">
        <div
          className={props.selectedCollectionId === null && props.selectedTagId === null
            ? 'tree-row selected'
            : 'tree-row'}
          style={{ paddingLeft: 12 }}
        >
          <span className="tree-caret" style={{ visibility: 'hidden' }}>
            ▾
          </span>
          <button className="tree-label" onClick={() => props.onSelectCollection(null)}>
            📚 전체 라이브러리
          </button>
        </div>
        {tree.map((node) => renderNode(node, 0))}
        {props.collections.length === 0 && (
          <p className="empty-hint">컬렉션을 만들어 논문을 정리해 보세요.</p>
        )}

        <div className="tags-section">
          <div className="screen-header-row">
            <h2>태그</h2>
            <button className="chip-button" onClick={() => void createTag()}>
              + 태그
            </button>
          </div>
          <div className="tag-cloud">
            {props.tags.map((tag) => (
              <span
                key={tag.id}
                className={props.selectedTagId === tag.id ? 'chip selectable selected' : 'chip selectable'}
              >
                <button className="chip-label" onClick={() => props.onSelectTag(tag.id)}>
                  #{tag.name}
                </button>
                <button
                  className="chip-remove"
                  aria-label="태그 삭제"
                  onClick={() => void deleteTag(tag)}
                >
                  ×
                </button>
              </span>
            ))}
            {props.tags.length === 0 && <p className="empty-hint">태그가 없습니다.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
