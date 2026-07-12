// Google sign-in for browsers/PWAs via Google Identity Services (GIS) token
// flow. Unlike the desktop app (refresh token + client secret), browsers get
// short-lived access tokens; when one expires we retry silently and fall back
// to asking the user to press "로그인" again.
//
// IMPORTANT: the OAuth client must be a "Web application" client created in
// the SAME Google Cloud project as the desktop app's client — the drive.file
// scope only shows files created by the same project.
import { loadSyncState, updateSyncState } from './state'

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const GSI_SRC = 'https://accounts.google.com/gsi/client'
const TOKEN_STORAGE_KEY = 'aicore.driveToken'

export type AuthStatus = 'no_credentials' | 'signed_out' | 'signed_in'

interface TokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: TokenResponse) => void
            error_callback?: (error: { type?: string; message?: string }) => void
          }) => TokenClient
          revoke: (token: string, callback?: () => void) => void
        }
      }
    }
  }
}

interface StoredToken {
  accessToken: string
  expiresAt: number
}

function loadStoredToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    return raw ? (JSON.parse(raw) as StoredToken) : null
  } catch {
    return null
  }
}

function storeToken(token: StoredToken | null): void {
  if (token) sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(token))
  else sessionStorage.removeItem(TOKEN_STORAGE_KEY)
}

let gsiLoaded: Promise<void> | null = null

function loadGsi(): Promise<void> {
  if (gsiLoaded) return gsiLoaded
  gsiLoaded = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GSI_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      gsiLoaded = null
      reject(new Error('Google 로그인 스크립트를 불러올 수 없습니다 (네트워크 확인)'))
    }
    document.head.appendChild(script)
  })
  return gsiLoaded
}

function requestToken(prompt: string): Promise<StoredToken> {
  const clientId = loadSyncState().googleClientId
  if (!clientId) throw new Error('Google OAuth 클라이언트 ID가 설정되지 않았습니다')
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts?.oauth2
    if (!oauth2) {
      reject(new Error('Google 로그인 스크립트가 준비되지 않았습니다'))
      return
    }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(
            new Error(response.error_description ?? response.error ?? 'Google 로그인이 취소되었습니다')
          )
          return
        }
        const token: StoredToken = {
          accessToken: response.access_token,
          expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000
        }
        storeToken(token)
        resolve(token)
      },
      error_callback: (error) => {
        reject(new Error(error.message ?? error.type ?? 'Google 로그인 창이 닫혔습니다'))
      }
    })
    client.requestAccessToken({ prompt })
  })
}

export function getDriveAuthStatus(): AuthStatus {
  if (!loadSyncState().googleClientId) return 'no_credentials'
  const token = loadStoredToken()
  if (token) return 'signed_in'
  return localStorage.getItem('aicore.driveSignedIn') === '1' ? 'signed_in' : 'signed_out'
}

/** Interactive sign-in; must be called from a user gesture (button tap). */
export async function driveSignIn(): Promise<void> {
  await loadGsi()
  await requestToken('consent')
  localStorage.setItem('aicore.driveSignedIn', '1')
}

export async function driveSignOut(): Promise<void> {
  const token = loadStoredToken()
  storeToken(null)
  localStorage.removeItem('aicore.driveSignedIn')
  updateSyncState({ driveFolderIds: null })
  if (token) {
    try {
      await loadGsi()
      window.google?.accounts?.oauth2?.revoke(token.accessToken)
    } catch {
      // Revocation is best-effort.
    }
  }
}

/** Returns a valid access token, refreshing silently when possible.
 *  Throws when interactive sign-in is required again. */
export async function getDriveAccessToken(): Promise<string> {
  const cached = loadStoredToken()
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.accessToken
  if (getDriveAuthStatus() !== 'signed_in') throw new Error('Google Drive에 로그인되어 있지 않습니다')
  await loadGsi()
  try {
    // With an active Google session this completes without user interaction.
    const token = await requestToken('')
    return token.accessToken
  } catch (error) {
    storeToken(null)
    localStorage.removeItem('aicore.driveSignedIn')
    throw new Error(
      `Google 세션이 만료되었습니다. 설정에서 다시 로그인해 주세요. (${
        error instanceof Error ? error.message : String(error)
      })`
    )
  }
}

export function invalidateDriveAccessToken(): void {
  storeToken(null)
}
