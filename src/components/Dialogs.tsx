// In-app replacements for window.confirm / window.prompt. The native dialogs
// cannot be themed, ignore the app's dark/paper tones, and look foreign inside
// an installed PWA or Android WebView. These render as bottom sheets and are
// awaited exactly like their native counterparts.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

export interface PromptOptions {
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  /** Renders a numeric keypad and validates the value is within range. */
  numericRange?: { min: number; max: number }
}

interface Dialogs {
  confirm: (options: ConfirmOptions) => Promise<boolean>
  prompt: (options: PromptOptions) => Promise<string | null>
}

type Request =
  | { kind: 'confirm'; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; resolve: (value: string | null) => void }

const DialogContext = createContext<Dialogs | null>(null)

export function useDialogs(): Dialogs {
  const dialogs = useContext(DialogContext)
  if (!dialogs) throw new Error('useDialogs must be used inside <DialogProvider>')
  return dialogs
}

export function DialogProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [request, setRequest] = useState<Request | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setRequest({ kind: 'confirm', options, resolve })),
    []
  )

  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setValue(options.defaultValue ?? '')
        setRequest({ kind: 'prompt', options, resolve })
      }),
    []
  )

  const close = useCallback(
    (result: boolean | string | null) => {
      if (!request) return
      if (request.kind === 'confirm') request.resolve(result === true)
      else request.resolve(typeof result === 'string' ? result : null)
      setRequest(null)
    },
    [request]
  )

  // Focus the field so the keyboard opens immediately, matching window.prompt.
  useEffect(() => {
    if (request?.kind === 'prompt') {
      const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [request])

  // The hardware/browser back button dismisses the dialog instead of the app.
  useEffect(() => {
    if (!request) return
    const onPop = (e: PopStateEvent): void => {
      e.stopImmediatePropagation()
      close(request.kind === 'confirm' ? false : null)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [request, close])

  const numericRange = request?.kind === 'prompt' ? request.options.numericRange : undefined
  const trimmed = value.trim()
  const promptInvalid =
    request?.kind === 'prompt' &&
    (!trimmed ||
      (numericRange !== undefined &&
        (!Number.isFinite(Number(trimmed)) ||
          Number(trimmed) < numericRange.min ||
          Number(trimmed) > numericRange.max)))

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {props.children}
      {request && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onClick={() => close(request.kind === 'confirm' ? false : null)}
        >
          <div
            className="dialog-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={request.options.title}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="dialog-title">{request.options.title}</h3>
            {request.options.message && (
              <p className="dialog-message">{request.options.message}</p>
            )}

            {request.kind === 'prompt' && (
              <input
                ref={inputRef}
                className="field-input dialog-input"
                value={value}
                inputMode={numericRange ? 'numeric' : 'text'}
                placeholder={request.options.placeholder}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !promptInvalid) close(value.trim())
                }}
              />
            )}

            <div className="dialog-actions">
              <button
                className="dialog-button"
                onClick={() => close(request.kind === 'confirm' ? false : null)}
              >
                {request.kind === 'confirm' ? (request.options.cancelLabel ?? '취소') : '취소'}
              </button>
              <button
                className={
                  request.kind === 'confirm' && request.options.danger
                    ? 'dialog-button primary danger'
                    : 'dialog-button primary'
                }
                disabled={promptInvalid}
                onClick={() => close(request.kind === 'confirm' ? true : value.trim())}
              >
                {request.options.confirmLabel ?? '확인'}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  )
}
