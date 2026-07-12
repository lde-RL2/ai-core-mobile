import { useCallback, useEffect, useState } from 'react'
import {
  loadSyncState,
  updateSyncState,
  usesGoogleDrive,
  usesNotion,
  type SyncTarget
} from '../sync/state'
import {
  getAggregateSyncStatus,
  getProviderSyncStatus
} from '../sync/status'
import { driveSignIn, driveSignOut, getDriveAuthStatus } from '../sync/driveAuth'
import { getAccountEmail } from '../sync/driveClient'
import { refreshDriveSyncStatus } from '../sync/driveSync'
import {
  disconnectNotion,
  isNotionConnected,
  refreshNotionSyncStatus,
  testNotionConnection
} from '../sync/notionSync'
import { getLastSyncAt, markAllLocalDirty, syncNow } from '../sync/engine'

const TARGET_OPTIONS: { value: SyncTarget; label: string }[] = [
  { value: 'none', label: '사용 안 함' },
  { value: 'google-drive', label: 'Drive' },
  { value: 'notion', label: 'Notion' },
  { value: 'both', label: '둘 다' }
]

function isNativeApp(): boolean {
  const capacitor = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
  return capacitor?.isNativePlatform?.() ?? false
}

function statusLabel(status: string, error: string | null): string {
  switch (status) {
    case 'disabled':
      return '꺼짐'
    case 'idle':
      return '대기 중 ✓'
    case 'syncing':
      return '동기화 중…'
    case 'error':
      return `오류: ${error ?? '알 수 없음'}`
    default:
      return status
  }
}

export function SyncSettings(): React.JSX.Element {
  const [, forceRender] = useState(0)
  const rerender = useCallback(() => forceRender((n) => n + 1), [])

  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [driveEmail, setDriveEmail] = useState<string | null>(null)

  const state = loadSyncState()
  const [clientIdInput, setClientIdInput] = useState(state.googleClientId ?? '')
  const [proxyInput, setProxyInput] = useState(state.notionProxyUrl ?? '')
  const [tokenInput, setTokenInput] = useState('')
  const [parentPageInput, setParentPageInput] = useState(state.notionParentPageId ?? '')

  useEffect(() => {
    window.addEventListener('aicore:sync-status', rerender)
    return () => window.removeEventListener('aicore:sync-status', rerender)
  }, [rerender])

  useEffect(() => {
    if (usesGoogleDrive() && getDriveAuthStatus() === 'signed_in') {
      getAccountEmail()
        .then(setDriveEmail)
        .catch(() => setDriveEmail(null))
    }
  }, [])

  async function run(label: string, task: () => Promise<void>): Promise<void> {
    setBusy(label)
    setMessage(null)
    try {
      await task()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
      rerender()
    }
  }

  function setTarget(target: SyncTarget): void {
    updateSyncState({ syncTarget: target })
    refreshDriveSyncStatus()
    refreshNotionSyncStatus()
    rerender()
  }

  const driveStatus = getProviderSyncStatus('google-drive')
  const notionStatus = getProviderSyncStatus('notion')
  const aggregate = getAggregateSyncStatus()
  const lastSyncAt = getLastSyncAt()
  const native = isNativeApp()

  return (
    <section className="settings-section">
      <h2>동기화</h2>
      <p className="settings-note faint">
        데스크톱 AI-Core와 같은 Google Drive 폴더 / Notion 데이터베이스를 사용해
        라이브러리(PDF·주석·컬렉션·태그·읽던 위치)를 기기 간에 공유합니다.
      </p>
      <div className="segmented">
        {TARGET_OPTIONS.map((option) => (
          <button
            key={option.value}
            className={state.syncTarget === option.value ? 'segment active' : 'segment'}
            onClick={() => setTarget(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {usesGoogleDrive(state.syncTarget) && (
        <div className="sync-provider">
          <h3>Google Drive</h3>
          {native ? (
            <p className="settings-note">
              안드로이드 APK에서는 Google 로그인 창이 차단됩니다. Drive 동기화는 브라우저/
              설치형 PWA에서 사용하고, APK에서는 Notion 동기화를 사용하세요.
            </p>
          ) : (
            <>
              <label className="field-label" htmlFor="drive-client-id">
                웹용 OAuth 클라이언트 ID (데스크톱 앱과 같은 Google Cloud 프로젝트)
              </label>
              <input
                id="drive-client-id"
                className="field-input"
                placeholder="xxxx.apps.googleusercontent.com"
                value={clientIdInput}
                onChange={(e) => setClientIdInput(e.target.value)}
                onBlur={() => {
                  updateSyncState({ googleClientId: clientIdInput.trim() || null })
                  rerender()
                }}
              />
              <div className="settings-button-row">
                {getDriveAuthStatus() === 'signed_in' ? (
                  <>
                    <span className="settings-note">
                      로그인됨{driveEmail ? ` (${driveEmail})` : ''}
                    </span>
                    <button
                      className="chip-button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run('로그아웃', async () => {
                          await driveSignOut()
                          setDriveEmail(null)
                          refreshDriveSyncStatus()
                        })
                      }
                    >
                      로그아웃
                    </button>
                  </>
                ) : (
                  <button
                    className="chip-button"
                    disabled={busy !== null || !state.googleClientId}
                    onClick={() =>
                      void run('Google 로그인', async () => {
                        await driveSignIn()
                        refreshDriveSyncStatus()
                        setDriveEmail(await getAccountEmail().catch(() => null))
                        await markAllLocalDirty()
                        await syncNow()
                      })
                    }
                  >
                    Google 로그인
                  </button>
                )}
              </div>
              <p className="settings-note">상태: {statusLabel(driveStatus.status, driveStatus.error)}</p>
            </>
          )}
        </div>
      )}

      {usesNotion(state.syncTarget) && (
        <div className="sync-provider">
          <h3>Notion</h3>
          <label className="field-label" htmlFor="notion-proxy">
            프록시 URL (workers/notion-proxy.js 배포 주소)
          </label>
          <input
            id="notion-proxy"
            className="field-input"
            placeholder="https://aicore-notion-proxy.<계정>.workers.dev"
            value={proxyInput}
            onChange={(e) => setProxyInput(e.target.value)}
          />
          <label className="field-label" htmlFor="notion-token">
            통합 토큰 {state.notionAccessToken ? '(저장됨 — 바꿀 때만 입력)' : ''}
          </label>
          <input
            id="notion-token"
            className="field-input"
            type="password"
            placeholder="ntn_..."
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <label className="field-label" htmlFor="notion-parent">
            부모 페이지 ID
          </label>
          <input
            id="notion-parent"
            className="field-input"
            placeholder="32자리 페이지 ID"
            value={parentPageInput}
            onChange={(e) => setParentPageInput(e.target.value)}
          />
          <div className="settings-button-row">
            <button
              className="chip-button"
              disabled={busy !== null}
              onClick={() =>
                void run('Notion 연결', async () => {
                  updateSyncState({
                    notionProxyUrl: proxyInput.trim() || null,
                    ...(tokenInput.trim() ? { notionAccessToken: tokenInput.trim() } : {}),
                    notionParentPageId: parentPageInput.trim() || null
                  })
                  setTokenInput('')
                  refreshNotionSyncStatus()
                  await markAllLocalDirty()
                  const result = await testNotionConnection()
                  setMessage(`연결됨: ${result.workspace}`)
                })
              }
            >
              저장 & 연결 테스트
            </button>
            {isNotionConnected() && (
              <button
                className="chip-button"
                disabled={busy !== null}
                onClick={() => {
                  disconnectNotion()
                  rerender()
                }}
              >
                연결 해제
              </button>
            )}
          </div>
          <p className="settings-note">상태: {statusLabel(notionStatus.status, notionStatus.error)}</p>
        </div>
      )}

      {state.syncTarget !== 'none' && (
        <div className="settings-button-row">
          <button
            className="chip-button"
            disabled={busy !== null}
            onClick={() => void run('동기화', () => syncNow())}
          >
            {busy ?? '지금 동기화'}
          </button>
          <span className="settings-note faint">
            {statusLabel(aggregate.status, aggregate.error)}
            {lastSyncAt ? ` · 마지막 ${new Date(lastSyncAt).toLocaleTimeString()}` : ''}
          </span>
        </div>
      )}

      {message && <p className="settings-note">{message}</p>}
    </section>
  )
}
