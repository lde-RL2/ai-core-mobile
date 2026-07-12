// Browser port of the desktop app's notionClient.ts. The Notion API blocks
// cross-origin browser requests, so every call goes through the user's own
// Cloudflare Worker proxy (workers/notion-proxy.js): `<proxy>/notion/...`
// forwards to api.notion.com and `<proxy>/file?url=` streams the S3 file
// downloads that also lack CORS headers. The token never leaves the device
// except inside the Authorization header of each proxied request.
import { loadSyncState } from './state'

const NOTION_VERSION = '2026-03-11'
const DIRECT_UPLOAD_LIMIT = 20 * 1024 * 1024
const MULTIPART_CHUNK_SIZE = 10 * 1024 * 1024

export interface NotionPage {
  id: string
  in_trash?: boolean
  url?: string
  properties?: Record<string, unknown>
}

interface NotionBlock {
  id: string
  type: string
  child_database?: { title?: string }
}

interface NotionList<T> {
  results: T[]
  has_more: boolean
  next_cursor: string | null
}

function proxyBase(): string {
  const proxy = loadSyncState().notionProxyUrl?.trim().replace(/\/+$/, '')
  if (!proxy) throw new Error('Notion 프록시 URL이 설정되지 않았습니다.')
  return proxy
}

function accessToken(): string {
  const token = loadSyncState().notionAccessToken
  if (!token) throw new Error('Notion access token is not configured.')
  return token
}

async function notionFetch<T>(path: string, init: RequestInit = {}, retryCount = 0): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken()}`)
  headers.set('Notion-Version', NOTION_VERSION)
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${proxyBase()}/notion${path}`, { ...init, headers })
  if (response.status === 429 && retryCount < 4) {
    const waitSeconds = Math.max(1, Number(response.headers.get('retry-after') ?? 1))
    await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
    return notionFetch<T>(path, init, retryCount + 1)
  }
  if (!response.ok) {
    const body = await response.text()
    let detail = body.slice(0, 400)
    try {
      const parsed = JSON.parse(body) as { message?: string; code?: string }
      detail = parsed.message ?? parsed.code ?? detail
    } catch {
      // The plain response is already useful.
    }
    throw new Error(`Notion API ${response.status}: ${detail}`)
  }
  return (await response.json()) as T
}

export async function getNotionBot(): Promise<{
  name?: string
  bot?: { workspace_name?: string; workspace_limits?: { max_file_upload_size_in_bytes?: number } }
}> {
  return notionFetch('/users/me')
}

export async function retrieveDatabase(databaseId: string): Promise<{
  id: string
  data_sources?: { id: string; name: string }[]
}> {
  return notionFetch(`/databases/${databaseId}`)
}

export async function retrieveDataSource(dataSourceId: string): Promise<{ id: string }> {
  return notionFetch(`/data_sources/${dataSourceId}`)
}

export async function retrieveNotionPage(pageId: string): Promise<NotionPage> {
  return notionFetch(`/pages/${pageId}`)
}

export async function findPapersDatabase(parentPageId: string): Promise<{
  id: string
  data_sources?: { id: string; name: string }[]
} | null> {
  let cursor: string | null = null
  do {
    const query = new URLSearchParams({ page_size: '100' })
    if (cursor) query.set('start_cursor', cursor)
    const result = await notionFetch<NotionList<NotionBlock>>(
      `/blocks/${parentPageId}/children?${query}`
    )
    const database = result.results.find(
      (block) => block.type === 'child_database' && block.child_database?.title === 'AI-Core Papers'
    )
    if (database) return retrieveDatabase(database.id)
    cursor = result.has_more ? result.next_cursor : null
  } while (cursor)
  return null
}

export async function createPapersDatabase(parentPageId: string): Promise<{
  id: string
  data_sources: { id: string; name: string }[]
}> {
  return notionFetch('/databases', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'page_id', page_id: parentPageId },
      title: [{ type: 'text', text: { content: 'AI-Core Papers' } }],
      is_inline: false,
      initial_data_source: {
        title: [{ type: 'text', text: { content: 'AI-Core Papers' } }],
        properties: {
          Name: { title: {} },
          'AI-Core ID': { rich_text: {} },
          Authors: { rich_text: {} },
          Year: { number: { format: 'number' } },
          DOI: { rich_text: {} },
          Tags: { multi_select: { options: [] } },
          Added: { date: {} },
          Updated: { number: { format: 'number' } },
          PDF: { files: {} },
          'AI-Core Data': { files: {} }
        }
      }
    })
  })
}

export async function queryPageByAiCoreId(
  dataSourceId: string,
  aiCoreId: string
): Promise<NotionPage | null> {
  const result = await notionFetch<NotionList<NotionPage>>(`/data_sources/${dataSourceId}/query`, {
    method: 'POST',
    body: JSON.stringify({
      page_size: 2,
      filter: { property: 'AI-Core ID', rich_text: { equals: aiCoreId } }
    })
  })
  return result.results.find((page) => !page.in_trash) ?? null
}

export async function queryAllNotionPages(dataSourceId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = []
  let cursor: string | null = null
  do {
    const result: NotionList<NotionPage> = await notionFetch<NotionList<NotionPage>>(
      `/data_sources/${dataSourceId}/query`,
      {
        method: 'POST',
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
      }
    )
    pages.push(...result.results.filter((page) => !page.in_trash))
    cursor = result.has_more ? result.next_cursor : null
  } while (cursor)
  return pages
}

export async function downloadNotionFile(url: string): Promise<Uint8Array> {
  const response = await fetch(`${proxyBase()}/file?url=${encodeURIComponent(url)}`)
  if (!response.ok) {
    throw new Error(`Notion file download failed (${response.status}). Refresh sync and retry.`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

export async function createNotionPage(
  dataSourceId: string,
  properties: Record<string, unknown>
): Promise<NotionPage> {
  return notionFetch('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      icon: { type: 'emoji', emoji: '📄' },
      properties
    })
  })
}

export async function updateNotionPage(
  pageId: string,
  properties: Record<string, unknown>
): Promise<NotionPage> {
  return notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties })
  })
}

export async function trashNotionPage(pageId: string): Promise<void> {
  await notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ in_trash: true })
  })
}

async function createFileUpload(
  filename: string,
  contentType: string,
  size: number
): Promise<{ id: string }> {
  const multipart = size > DIRECT_UPLOAD_LIMIT
  return notionFetch('/file_uploads', {
    method: 'POST',
    body: JSON.stringify({
      mode: multipart ? 'multi_part' : 'single_part',
      filename,
      content_type: contentType,
      ...(multipart ? { number_of_parts: Math.ceil(size / MULTIPART_CHUNK_SIZE) } : {})
    })
  })
}

async function sendFilePart(
  uploadId: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
  partNumber?: number
): Promise<void> {
  const form = new FormData()
  form.append('file', new Blob([Uint8Array.from(bytes).buffer], { type: contentType }), filename)
  if (partNumber !== undefined) form.append('part_number', String(partNumber))
  await notionFetch(`/file_uploads/${uploadId}/send`, { method: 'POST', body: form })
}

async function completeFileUpload(uploadId: string): Promise<void> {
  await notionFetch(`/file_uploads/${uploadId}/complete`, {
    method: 'POST',
    body: JSON.stringify({})
  })
}

export async function uploadBuffer(
  filename: string,
  contentType: string,
  content: Uint8Array
): Promise<string> {
  const upload = await createFileUpload(filename, contentType, content.byteLength)
  if (content.byteLength <= DIRECT_UPLOAD_LIMIT) {
    await sendFilePart(upload.id, filename, contentType, content)
    return upload.id
  }
  const parts = Math.ceil(content.byteLength / MULTIPART_CHUNK_SIZE)
  for (let index = 0; index < parts; index += 1) {
    const start = index * MULTIPART_CHUNK_SIZE
    const end = Math.min(content.byteLength, start + MULTIPART_CHUNK_SIZE)
    await sendFilePart(upload.id, filename, contentType, content.subarray(start, end), index + 1)
  }
  await completeFileUpload(upload.id)
  return upload.id
}
