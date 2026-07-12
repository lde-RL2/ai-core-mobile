import type {
  Annotation,
  Collection,
  Paper,
  ReadingState,
  Tag
} from '../types'

const DB_NAME = 'ai-core-mobile'
const DB_VERSION = 1

const STORES = {
  papers: 'papers',
  pdfFiles: 'pdfFiles',
  collections: 'collections',
  paperCollections: 'paperCollections',
  tags: 'tags',
  paperTags: 'paperTags',
  annotations: 'annotations',
  readingState: 'readingState'
} as const

interface PaperCollectionLink {
  key: string
  paperId: string
  collectionId: string
}

interface PaperTagLink {
  key: string
  paperId: string
  tagId: string
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORES.papers)) {
        db.createObjectStore(STORES.papers, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORES.pdfFiles)) {
        db.createObjectStore(STORES.pdfFiles)
      }
      if (!db.objectStoreNames.contains(STORES.collections)) {
        db.createObjectStore(STORES.collections, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORES.paperCollections)) {
        const store = db.createObjectStore(STORES.paperCollections, { keyPath: 'key' })
        store.createIndex('paperId', 'paperId')
        store.createIndex('collectionId', 'collectionId')
      }
      if (!db.objectStoreNames.contains(STORES.tags)) {
        db.createObjectStore(STORES.tags, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORES.paperTags)) {
        const store = db.createObjectStore(STORES.paperTags, { keyPath: 'key' })
        store.createIndex('paperId', 'paperId')
        store.createIndex('tagId', 'tagId')
      }
      if (!db.objectStoreNames.contains(STORES.annotations)) {
        const store = db.createObjectStore(STORES.annotations, { keyPath: 'id' })
        store.createIndex('paperId', 'paperId')
      }
      if (!db.objectStoreNames.contains(STORES.readingState)) {
        db.createObjectStore(STORES.readingState, { keyPath: 'paperId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB를 열 수 없습니다'))
  })
  return dbPromise
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('저장소 요청이 실패했습니다'))
  })
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | Promise<T>
): Promise<T> {
  const db = await openDb()
  const tx = db.transaction(name, mode)
  const result = fn(tx.objectStore(name))
  const value = result instanceof IDBRequest ? await reqAsPromise(result) : await result
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('트랜잭션이 실패했습니다'))
    tx.onabort = () => reject(tx.error ?? new Error('트랜잭션이 중단되었습니다'))
  })
  return value
}

// ---------- papers ----------

export async function listPapers(): Promise<Paper[]> {
  const papers = await withStore<Paper[]>(STORES.papers, 'readonly', (s) => s.getAll())
  return papers.sort((a, b) => (a.addedAt < b.addedAt ? 1 : -1))
}

export async function getPaper(id: string): Promise<Paper | undefined> {
  return withStore<Paper | undefined>(STORES.papers, 'readonly', (s) => s.get(id))
}

export async function putPaper(paper: Paper): Promise<void> {
  await withStore(STORES.papers, 'readwrite', (s) => s.put(paper))
}

export async function savePdfFile(paperId: string, blob: Blob): Promise<void> {
  await withStore(STORES.pdfFiles, 'readwrite', (s) => s.put(blob, paperId))
}

export async function getPdfFile(paperId: string): Promise<Blob | undefined> {
  return withStore<Blob | undefined>(STORES.pdfFiles, 'readonly', (s) => s.get(paperId))
}

export async function deletePaper(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(
    [
      STORES.papers,
      STORES.pdfFiles,
      STORES.paperCollections,
      STORES.paperTags,
      STORES.annotations,
      STORES.readingState
    ],
    'readwrite'
  )
  tx.objectStore(STORES.papers).delete(id)
  tx.objectStore(STORES.pdfFiles).delete(id)
  tx.objectStore(STORES.readingState).delete(id)
  for (const [storeName, index] of [
    [STORES.paperCollections, 'paperId'],
    [STORES.paperTags, 'paperId'],
    [STORES.annotations, 'paperId']
  ] as const) {
    const store = tx.objectStore(storeName)
    const req = store.index(index).getAllKeys(id)
    req.onsuccess = () => {
      for (const key of req.result) store.delete(key)
    }
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('논문 삭제에 실패했습니다'))
  })
}

// ---------- collections ----------

export async function listCollections(): Promise<Collection[]> {
  const rows = await withStore<Collection[]>(STORES.collections, 'readonly', (s) => s.getAll())
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export async function createCollection(
  name: string,
  parentId: string | null = null
): Promise<Collection> {
  const collection: Collection = { id: crypto.randomUUID(), name, parentId }
  await withStore(STORES.collections, 'readwrite', (s) => s.put(collection))
  return collection
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const existing = await withStore<Collection | undefined>(
    STORES.collections,
    'readonly',
    (s) => s.get(id)
  )
  if (!existing) return
  await withStore(STORES.collections, 'readwrite', (s) => s.put({ ...existing, name }))
}

export async function deleteCollection(id: string): Promise<void> {
  const all = await listCollections()
  const doomed = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const c of all) {
      if (c.parentId && doomed.has(c.parentId) && !doomed.has(c.id)) {
        doomed.add(c.id)
        grew = true
      }
    }
  }
  const db = await openDb()
  const tx = db.transaction([STORES.collections, STORES.paperCollections], 'readwrite')
  const colStore = tx.objectStore(STORES.collections)
  const linkStore = tx.objectStore(STORES.paperCollections)
  for (const collectionId of doomed) {
    colStore.delete(collectionId)
    const req = linkStore.index('collectionId').getAllKeys(collectionId)
    req.onsuccess = () => {
      for (const key of req.result) linkStore.delete(key)
    }
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('컬렉션 삭제에 실패했습니다'))
  })
}

export async function assignPaperToCollection(
  paperId: string,
  collectionId: string
): Promise<void> {
  const link: PaperCollectionLink = {
    key: `${paperId}::${collectionId}`,
    paperId,
    collectionId
  }
  await withStore(STORES.paperCollections, 'readwrite', (s) => s.put(link))
}

export async function removePaperFromCollection(
  paperId: string,
  collectionId: string
): Promise<void> {
  await withStore(STORES.paperCollections, 'readwrite', (s) =>
    s.delete(`${paperId}::${collectionId}`)
  )
}

export async function listCollectionsForPaper(paperId: string): Promise<string[]> {
  const links = await withStore<PaperCollectionLink[]>(
    STORES.paperCollections,
    'readonly',
    (s) => s.index('paperId').getAll(paperId)
  )
  return links.map((l) => l.collectionId)
}

export async function putCollection(collection: Collection): Promise<void> {
  await withStore(STORES.collections, 'readwrite', (s) => s.put(collection))
}

export async function listAllPaperCollectionLinks(): Promise<
  { paperId: string; collectionId: string }[]
> {
  return withStore<PaperCollectionLink[]>(STORES.paperCollections, 'readonly', (s) => s.getAll())
}

export async function listPaperIdsInCollection(collectionId: string): Promise<Set<string>> {
  const links = await withStore<PaperCollectionLink[]>(
    STORES.paperCollections,
    'readonly',
    (s) => s.index('collectionId').getAll(collectionId)
  )
  return new Set(links.map((l) => l.paperId))
}

// ---------- tags ----------

export async function listTags(): Promise<Tag[]> {
  const rows = await withStore<Tag[]>(STORES.tags, 'readonly', (s) => s.getAll())
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

export async function createTag(name: string): Promise<Tag> {
  const existing = (await listTags()).find((t) => t.name === name)
  if (existing) return existing
  const tag: Tag = { id: crypto.randomUUID(), name }
  await withStore(STORES.tags, 'readwrite', (s) => s.put(tag))
  return tag
}

export async function putTag(tag: Tag): Promise<void> {
  await withStore(STORES.tags, 'readwrite', (s) => s.put(tag))
}

export async function deleteTag(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction([STORES.tags, STORES.paperTags], 'readwrite')
  tx.objectStore(STORES.tags).delete(id)
  const linkStore = tx.objectStore(STORES.paperTags)
  const req = linkStore.index('tagId').getAllKeys(id)
  req.onsuccess = () => {
    for (const key of req.result) linkStore.delete(key)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('태그 삭제에 실패했습니다'))
  })
}

export async function assignPaperToTag(paperId: string, tagId: string): Promise<void> {
  const link: PaperTagLink = { key: `${paperId}::${tagId}`, paperId, tagId }
  await withStore(STORES.paperTags, 'readwrite', (s) => s.put(link))
}

export async function removePaperFromTag(paperId: string, tagId: string): Promise<void> {
  await withStore(STORES.paperTags, 'readwrite', (s) => s.delete(`${paperId}::${tagId}`))
}

export async function listTagIdsForPaper(paperId: string): Promise<string[]> {
  const links = await withStore<PaperTagLink[]>(STORES.paperTags, 'readonly', (s) =>
    s.index('paperId').getAll(paperId)
  )
  return links.map((l) => l.tagId)
}

export async function listAllPaperTagLinks(): Promise<{ paperId: string; tagId: string }[]> {
  return withStore<PaperTagLink[]>(STORES.paperTags, 'readonly', (s) => s.getAll())
}

// ---------- annotations ----------

export async function listAnnotations(paperId: string): Promise<Annotation[]> {
  const rows = await withStore<Annotation[]>(STORES.annotations, 'readonly', (s) =>
    s.index('paperId').getAll(paperId)
  )
  return rows.sort(
    (a, b) => a.pageNumber - b.pageNumber || (a.createdAt < b.createdAt ? -1 : 1)
  )
}

export async function listAllAnnotations(): Promise<Annotation[]> {
  return withStore<Annotation[]>(STORES.annotations, 'readonly', (s) => s.getAll())
}

export async function putAnnotation(annotation: Annotation): Promise<void> {
  await withStore(STORES.annotations, 'readwrite', (s) => s.put(annotation))
}

export async function deleteAnnotation(id: string): Promise<void> {
  await withStore(STORES.annotations, 'readwrite', (s) => s.delete(id))
}

// ---------- reading state ----------

export async function getReadingState(paperId: string): Promise<ReadingState | undefined> {
  return withStore<ReadingState | undefined>(STORES.readingState, 'readonly', (s) =>
    s.get(paperId)
  )
}

export async function listReadingStates(): Promise<ReadingState[]> {
  return withStore<ReadingState[]>(STORES.readingState, 'readonly', (s) => s.getAll())
}

export async function setReadingState(
  paperId: string,
  lastPage: number,
  scrollFraction: number
): Promise<void> {
  const state: ReadingState = { paperId, lastPage, scrollFraction, updatedAt: Date.now() }
  await withStore(STORES.readingState, 'readwrite', (s) => s.put(state))
}

// ---------- storage housekeeping ----------

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
  const { usage = 0, quota = 0 } = await navigator.storage.estimate()
  return { usage, quota }
}
