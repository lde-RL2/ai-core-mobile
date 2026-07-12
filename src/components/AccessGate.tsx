import { useState } from 'react'

/** Build-time shared passcode for friends-only deployments. When the
 *  VITE_ACCESS_CODE env var is unset at build time the gate is disabled.
 *  This is a courtesy lock to keep strangers out of a shared link, not real
 *  security — the code ships inside the client bundle. All library data
 *  stays on each visitor's own device either way. */
export const ACCESS_CODE: string | undefined = import.meta.env.VITE_ACCESS_CODE

const STORAGE_KEY = 'aicore.access'

export function isUnlocked(): boolean {
  return !ACCESS_CODE || localStorage.getItem(STORAGE_KEY) === ACCESS_CODE
}

interface AccessGateProps {
  onUnlock: () => void
}

export function AccessGate(props: AccessGateProps): React.JSX.Element {
  const [value, setValue] = useState('')
  const [wrong, setWrong] = useState(false)

  function submit(): void {
    if (value.trim() === ACCESS_CODE) {
      localStorage.setItem(STORAGE_KEY, value.trim())
      props.onUnlock()
    } else {
      setWrong(true)
    }
  }

  return (
    <div className="access-gate">
      <div className="access-card">
        <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width={72} height={72} />
        <h1>AI-Core Mobile</h1>
        <p className="settings-note">공유받은 접근 코드를 입력하세요.</p>
        <input
          className="field-input"
          type="password"
          inputMode="text"
          autoFocus
          placeholder="접근 코드"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setWrong(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
        />
        {wrong && <p className="settings-note gate-error">코드가 올바르지 않습니다.</p>}
        <button className="primary-button" onClick={submit}>
          입장
        </button>
      </div>
    </div>
  )
}
