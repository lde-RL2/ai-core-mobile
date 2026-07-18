import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Collection, Paper, PaperTone, ReadingState, Tag, ThemeMode } from './types'
import * as db from './storage/db'
import { AccessGate, isUnlocked } from './components/AccessGate'
import { initSyncEngine } from './sync/engine'
import { LibraryScreen } from './components/LibraryScreen'
import { CollectionsPane } from './components/CollectionsPane'
import { SettingsScreen } from './components/SettingsScreen'
import { BottomNav } from './components/BottomNav'
import { PaperDetailSheet } from './components/PaperDetailSheet'
import { ReaderScreen } from './viewer/ReaderScreen'
import { findResumePaper, isPaperSort, sortPapers, type PaperSort } from './sortPapers'

type Tab = 'library' | 'collections' | 'settings'

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (): void => setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    onChange()
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const value = localStorage.getItem(key)
  return allowed.includes(value as T) ? (value as T) : fallback
}

export default function App(): React.JSX.Element {
  const isTablet = useMediaQuery('(min-width: 768px)')
  const [unlocked, setUnlocked] = useState(isUnlocked)
  const [updateReady, setUpdateReady] = useState(false)

  useEffect(() => {
    const onUpdate = (): void => setUpdateReady(true)
    window.addEventListener('aicore:update-available', onUpdate)
    return () => window.removeEventListener('aicore:update-available', onUpdate)
  }, [])

  useEffect(() => {
    initSyncEngine()
  }, [])

  const [tab, setTab] = useState<Tab>('library')
  const [papers, setPapers] = useState<Paper[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [tagLinks, setTagLinks] = useState<{ paperId: string; tagId: string }[]>([])
  const [readingStates, setReadingStates] = useState<ReadingState[]>([])

  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [collectionPaperIds, setCollectionPaperIds] = useState<Set<string> | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<PaperSort>(() => {
    const stored = localStorage.getItem('aicore.sort')
    return isPaperSort(stored) ? stored : 'added'
  })

  useEffect(() => {
    localStorage.setItem('aicore.sort', sort)
  }, [sort])

  const [openPaperId, setOpenPaperId] = useState<string | null>(null)
  const [detailPaperId, setDetailPaperId] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [theme, setTheme] = useState<ThemeMode>(() =>
    readStored('aicore.theme', 'system', ['system', 'light', 'dark'])
  )
  const [paperTone, setPaperTone] = useState<PaperTone>(() =>
    readStored('aicore.paperTone', 'normal', ['normal', 'warm', 'sepia', 'dark'])
  )

  const [reloadKey, setReloadKey] = useState(0)
  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  // Reload data after a sync pull applied remote changes.
  useEffect(() => {
    const onSyncChanged = (): void => refresh()
    window.addEventListener('aicore:sync-changed', onSyncChanged)
    return () => window.removeEventListener('aicore:sync-changed', onSyncChanged)
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [papersRows, collectionRows, tagRows, tagLinkRows, readingRows] = await Promise.all([
        db.listPapers(),
        db.listCollections(),
        db.listTags(),
        db.listAllPaperTagLinks(),
        db.listReadingStates()
      ])
      if (cancelled) return
      setPapers(papersRows)
      setCollections(collectionRows)
      setTags(tagRows)
      setTagLinks(tagLinkRows)
      setReadingStates(readingRows)
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    if (!selectedCollectionId) {
      setCollectionPaperIds(null)
      return
    }
    let cancelled = false
    void db.listPaperIdsInCollection(selectedCollectionId).then((ids) => {
      if (!cancelled) setCollectionPaperIds(ids)
    })
    return () => {
      cancelled = true
    }
  }, [selectedCollectionId, reloadKey])

  useEffect(() => {
    localStorage.setItem('aicore.theme', theme)
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme === 'system' && mql.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }, [theme])

  useEffect(() => {
    localStorage.setItem('aicore.paperTone', paperTone)
    document.documentElement.dataset.paperTone = paperTone
  }, [paperTone])

  // Android/browser back button closes overlays instead of leaving the app.
  useEffect(() => {
    const onPop = (): void => {
      if (detailPaperId) setDetailPaperId(null)
      else if (openPaperId) setOpenPaperId(null)
      else if (settingsOpen) setSettingsOpen(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [detailPaperId, openPaperId, settingsOpen])

  const pushOverlay = useCallback((name: string) => {
    window.history.pushState({ overlay: name }, '')
  }, [])

  const closeOverlay = useCallback(() => {
    if (window.history.state?.overlay) window.history.back()
    else {
      setDetailPaperId(null)
      setOpenPaperId(null)
      setSettingsOpen(false)
    }
  }, [])

  const openReader = useCallback(
    (paperId: string) => {
      setOpenPaperId(paperId)
      pushOverlay('reader')
    },
    [pushOverlay]
  )

  const openDetail = useCallback(
    (paperId: string) => {
      setDetailPaperId(paperId)
      pushOverlay('detail')
    },
    [pushOverlay]
  )

  const openSettingsOverlay = useCallback(() => {
    setSettingsOpen(true)
    pushOverlay('settings')
  }, [pushOverlay])

  const tagIdsByPaper = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const link of tagLinks) {
      const list = map.get(link.paperId) ?? []
      list.push(link.tagId)
      map.set(link.paperId, list)
    }
    return map
  }, [tagLinks])

  const tagsById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])

  const readingByPaper = useMemo(
    () => new Map(readingStates.map((r) => [r.paperId, r])),
    [readingStates]
  )

  const filteredPapers = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    const matched = papers.filter((paper) => {
      if (collectionPaperIds && !collectionPaperIds.has(paper.id)) return false
      if (selectedTagId && !(tagIdsByPaper.get(paper.id) ?? []).includes(selectedTagId)) {
        return false
      }
      if (!needle) return true
      const haystack = `${paper.title} ${paper.authors ?? ''} ${paper.notes ?? ''}`
        .toLocaleLowerCase()
      return haystack.includes(needle)
    })
    return sortPapers(matched, sort, readingByPaper)
  }, [papers, collectionPaperIds, selectedTagId, tagIdsByPaper, search, sort, readingByPaper])

  // Only offered on the unfiltered library, where it reads as "pick up where
  // you left off" rather than an odd extra row inside a filtered result.
  const resumePaper = useMemo(() => {
    if (search.trim() || selectedCollectionId || selectedTagId) return null
    return findResumePaper(papers, readingByPaper)
  }, [papers, readingByPaper, search, selectedCollectionId, selectedTagId])

  const filterLabel = useMemo(() => {
    if (selectedCollectionId) {
      return collections.find((c) => c.id === selectedCollectionId)?.name ?? '컬렉션'
    }
    if (selectedTagId) return `#${tagsById.get(selectedTagId)?.name ?? '태그'}`
    return null
  }, [selectedCollectionId, selectedTagId, collections, tagsById])

  const selectCollection = useCallback((id: string | null) => {
    setSelectedCollectionId(id)
    setSelectedTagId(null)
    setTab('library')
  }, [])

  const selectTag = useCallback((id: string | null) => {
    setSelectedTagId(id)
    setSelectedCollectionId(null)
    setTab('library')
  }, [])

  const openPaper = openPaperId ? papers.find((p) => p.id === openPaperId) : undefined
  const detailPaper = detailPaperId ? papers.find((p) => p.id === detailPaperId) : undefined

  if (!unlocked) {
    return <AccessGate onUnlock={() => setUnlocked(true)} />
  }

  const library = (
    <LibraryScreen
      papers={filteredPapers}
      totalCount={papers.length}
      filterLabel={filterLabel}
      onClearFilter={() => selectCollection(null)}
      search={search}
      setSearch={setSearch}
      sort={sort}
      setSort={setSort}
      resumePaper={resumePaper}
      tagIdsByPaper={tagIdsByPaper}
      tagsById={tagsById}
      readingByPaper={readingByPaper}
      selectedCollectionId={selectedCollectionId}
      onOpenPaper={openReader}
      onOpenDetail={openDetail}
      onImported={refresh}
      showSettingsButton={isTablet}
      onOpenSettings={openSettingsOverlay}
    />
  )

  const collectionsPane = (
    <CollectionsPane
      collections={collections}
      tags={tags}
      selectedCollectionId={selectedCollectionId}
      selectedTagId={selectedTagId}
      onSelectCollection={selectCollection}
      onSelectTag={selectTag}
      refresh={refresh}
    />
  )

  return (
    <div className={isTablet ? 'app app-tablet' : 'app app-phone'}>
      {isTablet ? (
        <div className="tablet-frame">
          <aside className="tablet-sidebar">{collectionsPane}</aside>
          <main className="tablet-main">{library}</main>
        </div>
      ) : (
        <>
          <main className="phone-main">
            {tab === 'library' && library}
            {tab === 'collections' && collectionsPane}
            {tab === 'settings' && (
              <SettingsScreen
                theme={theme}
                setTheme={setTheme}
                paperTone={paperTone}
                setPaperTone={setPaperTone}
                refresh={refresh}
              />
            )}
          </main>
          <BottomNav tab={tab} setTab={setTab} />
        </>
      )}

      {settingsOpen && (
        <div className="overlay-panel">
          <SettingsScreen
            theme={theme}
            setTheme={setTheme}
            paperTone={paperTone}
            setPaperTone={setPaperTone}
            refresh={refresh}
            onClose={closeOverlay}
          />
        </div>
      )}

      {detailPaper && (
        <PaperDetailSheet
          paper={detailPaper}
          collections={collections}
          tags={tags}
          refresh={refresh}
          onClose={closeOverlay}
          onOpen={() => {
            // Swap the detail sheet's history entry for the reader's so the
            // back button lands on the library, not the sheet.
            setDetailPaperId(null)
            setOpenPaperId(detailPaper.id)
            window.history.replaceState({ overlay: 'reader' }, '')
          }}
        />
      )}

      {openPaper && <ReaderScreen paper={openPaper} onClose={closeOverlay} refresh={refresh} />}

      {updateReady && (
        <div className="update-toast">
          <span>새 버전이 준비되었습니다.</span>
          <button className="chip-button" onClick={() => window.location.reload()}>
            새로고침
          </button>
          <button
            className="icon-button small"
            aria-label="닫기"
            onClick={() => setUpdateReady(false)}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
