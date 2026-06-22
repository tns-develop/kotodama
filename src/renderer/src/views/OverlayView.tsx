import { useEffect, useState } from 'react'
import { type RecordingState } from '@shared/ipc'

const STATE_LABELS: Record<RecordingState, string> = {
  idle: '',
  connecting: '接続中…',
  recording: '聞き取り中',
  finalizing: '確定処理中…',
  error: 'エラー'
}

/** 録音状態の浮遊ピル。delta を逐次表示する。 */
export function OverlayView() {
  const [state, setState] = useState<RecordingState>('idle')
  const [partial, setPartial] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const offState = window.api.onState((p) => {
      setState(p.state)
      if (p.state === 'recording' || p.state === 'connecting') setPartial('')
      setErrorMessage(p.state === 'error' ? (p.message ?? '') : '')
    })
    const offDelta = window.api.onDelta((text) => setPartial((prev) => prev + text))
    const offCompleted = window.api.onCompleted((text) => setPartial(text))
    window.api.rendererReady()
    return () => {
      offState()
      offDelta()
      offCompleted()
    }
  }, [])

  return (
    <div className="overlay">
      <div className={`pill pill--${state}`}>
        <span className="dot" />
        <span className="label">{STATE_LABELS[state]}</span>
        {state === 'error' && errorMessage ? (
          <span className="partial error">{errorMessage}</span>
        ) : (
          partial && <span className="partial">{partial}</span>
        )}
      </div>
    </div>
  )
}
