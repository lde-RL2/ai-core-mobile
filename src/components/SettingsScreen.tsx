import { useEffect, useRef, useState } from 'react'
import type { PaperTone, ThemeMode } from '../types'
import { estimateStorage, requestPersistentStorage, wipeAllData } from '../storage/db'
import { downloadBackup, exportBackup, importBackup } from '../storage/backup'
import { markAllLocalDirty } from '../sync/engine'
import { driveSignOut } from '../sync/driveAuth'
import { resetSyncState } from '../sync/state'
import { SyncSettings } from './SyncSettings'

interface SettingsScreenProps {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  paperTone: PaperTone
  setPaperTone: (tone: PaperTone) => void
  refresh: () => void
  onClose?: () => void
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'light', label: '라이트' },
  { value: 'dark', label: '다크' }
]

const TONE_OPTIONS: { value: PaperTone; label: string }[] = [
  { value: 'normal', label: '기본' },
  { value: 'warm', label: '따뜻하게' },
  { value: 'sepia', label: '세피아' },
  { value: 'dark', label: '다크' }
]

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function SettingsScreen(props: SettingsScreenProps): React.JSX.Element {
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void estimateStorage().then(setStorage)
    if (navigator.storage?.persisted) {
      void navigator.storage.persisted().then(setPersisted)
    }
  }, [])

  async function handlePersist(): Promise<void> {
    const granted = await requestPersistentStorage()
    setPersisted(granted)
  }

  async function handleExport(): Promise<void> {
    setBusy('내보내는 중…')
    setBackupMessage(null)
    try {
      downloadBackup(await exportBackup())
      setBackupMessage('백업 파일을 내려받았습니다.')
    } catch (error) {
      setBackupMessage(
        `내보내기 실패: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setBusy(null)
    }
  }

  async function handleReset(): Promise<void> {
    if (
      !window.confirm(
        '이 기기의 모든 논문, 주석, 컬렉션, 동기화 설정을 삭제할까요?\n' +
          'Drive/Notion에 동기화된 원격 데이터는 지우지 않습니다.'
      )
    ) {
      return
    }
    if (!window.confirm('정말 삭제할까요? 백업하지 않은 데이터는 되돌릴 수 없습니다.')) return
    setBusy('초기화 중…')
    try {
      await driveSignOut().catch(() => {})
      await wipeAllData()
      resetSyncState()
      window.location.reload()
    } catch (error) {
      setBackupMessage(
        `초기화 실패: ${error instanceof Error ? error.message : String(error)}`
      )
      setBusy(null)
    }
  }

  async function handleImport(file: File | undefined): Promise<void> {
    if (!file) return
    setBusy('가져오는 중…')
    setBackupMessage(null)
    try {
      const summary = await importBackup(file)
      setBackupMessage(
        `논문 ${summary.papersAdded}개 추가, ${summary.papersSkipped}개 건너뜀 (이미 있음).`
      )
      await markAllLocalDirty()
      props.refresh()
      void estimateStorage().then(setStorage)
    } catch (error) {
      setBackupMessage(
        `가져오기 실패: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="screen settings-screen">
      <header className="screen-header">
        <div className="screen-header-row">
          <h1>설정</h1>
          {props.onClose && (
            <button className="chip-button" onClick={props.onClose}>
              닫기
            </button>
          )}
        </div>
      </header>

      <div className="settings-body">
        <section className="settings-section">
          <h2>테마</h2>
          <div className="segmented">
            {THEME_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={props.theme === option.value ? 'segment active' : 'segment'}
                onClick={() => props.setTheme(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h2>PDF 종이 톤</h2>
          <div className="segmented">
            {TONE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={props.paperTone === option.value ? 'segment active' : 'segment'}
                onClick={() => props.setPaperTone(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <h2>저장 공간</h2>
          {storage ? (
            <p className="settings-note">
              사용 중 {formatBytes(storage.usage)} / 허용 {formatBytes(storage.quota)}
            </p>
          ) : (
            <p className="settings-note">저장 공간 정보를 확인할 수 없습니다.</p>
          )}
          <p className="settings-note">
            영구 저장:{' '}
            {persisted === null ? '알 수 없음' : persisted ? '허용됨 ✓' : '허용되지 않음'}
          </p>
          {persisted === false && (
            <button className="chip-button" onClick={() => void handlePersist()}>
              영구 저장 요청
            </button>
          )}
          <p className="settings-note faint">
            영구 저장이 허용되면 브라우저가 저장 공간 부족 시에도 라이브러리를 지우지 않습니다.
          </p>
        </section>

        <SyncSettings />

        <section className="settings-section">
          <h2>백업</h2>
          <div className="settings-button-row">
            <button className="chip-button" disabled={busy !== null} onClick={() => void handleExport()}>
              {busy ?? '백업 내보내기 (ZIP)'}
            </button>
            <button
              className="chip-button"
              disabled={busy !== null}
              onClick={() => importInputRef.current?.click()}
            >
              백업 가져오기
            </button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept="application/zip,.zip"
            hidden
            onChange={(e) => {
              void handleImport(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          {backupMessage && <p className="settings-note">{backupMessage}</p>}
          <p className="settings-note faint">
            PDF·주석·컬렉션·태그·읽기 상태가 모두 포함됩니다. 다른 기기의 AI-Core Mobile에서
            가져오면 라이브러리가 병합됩니다.
          </p>
        </section>

        <section className="settings-section">
          <h2>새 사용자로 초기화</h2>
          <p className="settings-note faint">
            이 기기의 논문·주석·컬렉션·동기화 설정을 모두 삭제합니다. 공용 기기이거나 다른
            계정으로 바꿀 때 사용하세요. 동기화된 원격 데이터(Drive/Notion)는 지우지 않습니다.
          </p>
          <button
            className="danger-button"
            disabled={busy !== null}
            onClick={() => void handleReset()}
          >
            모든 로컬 데이터 삭제
          </button>
        </section>

        <section className="settings-section">
          <h2>정보</h2>
          <p className="settings-note">AI-Core Mobile v0.1.0 — 로컬 우선 논문 라이브러리</p>
          <p className="settings-note faint">
            모든 데이터는 이 기기의 브라우저 저장소에만 저장됩니다.
          </p>
        </section>
      </div>
    </div>
  )
}
