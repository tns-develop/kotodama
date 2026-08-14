import { useEffect, useRef, useState } from 'react'
import type { LongRecordingAction } from '@shared/ipc'

function parseExpiresAt(): number {
  const hash = window.location.hash.replace(/^#\/?/, '')
  const query = hash.includes('?') ? hash.split('?').slice(1).join('?') : ''
  const params = new URLSearchParams(query)
  const raw = params.get('expiresAt')
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : Date.now() + 20_000
}

function remainingSeconds(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000))
}

/** 閾値経過後の録音継続確認。無応答時は main 側タイマーと合わせて stop を送る。 */
export function LongRecordingDialogView() {
  const expiresAt = parseExpiresAt()
  const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(expiresAt))
  const responded = useRef(false)

  const respond = (action: LongRecordingAction): void => {
    if (responded.current) return
    responded.current = true
    window.api.respondLongRecording(action)
  }

  useEffect(() => {
    const tick = (): void => {
      const left = remainingSeconds(expiresAt)
      setSecondsLeft(left)
      if (left <= 0) respond('stop')
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [expiresAt])

  return (
    <div className="long-recording-dialog">
      <p className="long-recording-dialog__message">2分以上録音しています。続けますか？</p>
      <p className="long-recording-dialog__countdown">{secondsLeft}秒後に自動停止します</p>
      <div className="actions long-recording-dialog__actions">
        <button type="button" className="secondary" onClick={() => respond('continue')}>
          続ける
        </button>
        <button type="button" onClick={() => respond('stop')}>
          停止して出力
        </button>
      </div>
    </div>
  )
}
