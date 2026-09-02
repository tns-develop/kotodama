import { useEffect, useState } from 'react'
import { type RecordingMode, type RecordingState } from '@shared/ipc'

const STATE_LABELS: Record<RecordingState, string> = {
  idle: '',
  connecting: '接続中…',
  recording: '聞き取り中',
  finalizing: '確定処理中…',
  error: 'エラー'
}

/** 音声編集モードで差し替えるラベル（未定義の状態は STATE_LABELS を使う） */
const EDIT_STATE_LABELS: Partial<Record<RecordingState, string>> = {
  recording: '編集内容を聞き取り中',
  finalizing: '編集を反映中…'
}

/** 録音状態の浮遊ピル。delta を逐次表示する。 */
export function OverlayView() {
  const [state, setState] = useState<RecordingState>('idle')
  const [mode, setMode] = useState<RecordingMode>('dictate')
  const [selectionPreview, setSelectionPreview] = useState('')
  const [partial, setPartial] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const offState = window.api.onState((p) => {
      setState(p.state)
      setMode(p.mode ?? 'dictate')
      setSelectionPreview(p.selectionPreview ?? '')
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

  const label = (mode === 'edit' && EDIT_STATE_LABELS[state]) || STATE_LABELS[state]
  const showSelection =
    mode === 'edit' && selectionPreview && state !== 'idle' && state !== 'error'

  return (
    <div className="overlay">
      {showSelection && <div className="edit-chip">選択中: {selectionPreview}</div>}
      <div className={`pill pill--${state}`}>
        <span className="dot" />
        <span className="label">{label}</span>
        {state === 'error' && errorMessage ? (
          <span className="partial error">{errorMessage}</span>
        ) : (
          partial && <span className="partial">{partial}</span>
        )}
      </div>
    </div>
  )
}
