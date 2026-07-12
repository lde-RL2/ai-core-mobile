// Browser port of the desktop app's driveClient.ts (Buffer → Uint8Array).
import { getDriveAccessToken, invalidateDriveAccessToken } from './driveAuth'

const API_URL = 'https://www.googleapis.com/drive/v3'
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3'

export interface DriveFile {
  id: string
  name: string
  mimeType?: string
  appProperties?: Record<string, string>
  modifiedTime?: string
}

async function driveFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getDriveAccessToken()
  const response = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` }
  })
  if (response.status === 401 && retry) {
    invalidateDriveAccessToken()
    return driveFetch(url, init, false)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Drive API ${response.status} for ${url.split('?')[0]}: ${body.slice(0, 300)}`)
  }
  return response
}

export async function listFiles(q: string): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      q,
      fields: 'nextPageToken, files(id, name, mimeType, appProperties, modifiedTime)',
      pageSize: '1000',
      spaces: 'drive'
    })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await driveFetch(`${API_URL}/files?${params}`)
    const data = (await response.json()) as { files: DriveFile[]; nextPageToken?: string }
    files.push(...(data.files ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return files
}

export async function createFolder(
  name: string,
  parentId: string | null,
  appProperties: Record<string, string> = {}
): Promise<DriveFile> {
  const response = await driveFetch(`${API_URL}/files?fields=id,name,appProperties`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentId ? [parentId] : undefined,
      appProperties
    })
  })
  return (await response.json()) as DriveFile
}

export async function uploadFile(options: {
  name: string
  parentId: string
  mimeType: string
  content: Uint8Array
  appProperties?: Record<string, string>
}): Promise<DriveFile> {
  const boundary = `pm-boundary-${Date.now()}`
  const metadata = {
    name: options.name,
    parents: [options.parentId],
    appProperties: options.appProperties ?? {}
  }
  const encoder = new TextEncoder()
  const body = new Blob([
    encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(metadata) +
        `\r\n--${boundary}\r\nContent-Type: ${options.mimeType}\r\n\r\n`
    ),
    Uint8Array.from(options.content).buffer,
    encoder.encode(`\r\n--${boundary}--`)
  ])
  const response = await driveFetch(
    `${UPLOAD_URL}/files?uploadType=multipart&fields=id,name,appProperties`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    }
  )
  return (await response.json()) as DriveFile
}

/** Replace an existing file's content and (optionally) its appProperties. */
export async function updateFile(
  fileId: string,
  mimeType: string,
  content: Uint8Array,
  appProperties?: Record<string, string>
): Promise<void> {
  await driveFetch(`${UPLOAD_URL}/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': mimeType },
    body: new Blob([Uint8Array.from(content).buffer])
  })
  if (appProperties) {
    await driveFetch(`${API_URL}/files/${fileId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties })
    })
  }
}

export async function downloadFile(fileId: string): Promise<Uint8Array> {
  const response = await driveFetch(`${API_URL}/files/${fileId}?alt=media`)
  return new Uint8Array(await response.arrayBuffer())
}

export async function trashFile(fileId: string): Promise<void> {
  await driveFetch(`${API_URL}/files/${fileId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: true })
  })
}

export async function getAccountEmail(): Promise<string> {
  const response = await driveFetch(`${API_URL}/about?fields=user(emailAddress)`)
  const data = (await response.json()) as { user?: { emailAddress?: string } }
  return data.user?.emailAddress ?? 'unknown'
}
