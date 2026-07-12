import { Component, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('[app] uncaught render error:', error)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="fatal-error">
        <h1>문제가 발생했습니다</h1>
        <p className="settings-note">{this.state.error.message}</p>
        <p className="settings-note faint">
          라이브러리 데이터는 기기에 안전하게 저장되어 있습니다.
        </p>
        <button className="primary-button" onClick={() => window.location.reload()}>
          다시 시작
        </button>
      </div>
    )
  }
}
