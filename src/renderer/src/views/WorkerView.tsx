import { useEffect, useRef, useState } from 'react'
import { type RecordingState } from '@shared/ipc'
import { startMic, type MicHandle } from '../audio'
import { playSE } from '../lib/sound'

/** 非表示ワーカー。main からの指示でマイクを制御し、PCM を送る。 */
export function WorkerView() {
  const micRef = useRef<MicHandle | null>(null)
  const startingRef = useRef(false)
  const prevStateRef = useRef<RecordingState>('idle')
  const [state, setState] = useState<RecordingState>('idle')

  useEffect(() => {
    const offState = window.api.onState((p) => {
      const prev = prevStateRef.current
      // 開始音: recording 遷移時 / 終了音: idle 復帰時
      if (p.state === 'recording' && prev !== 'recording') void playSE('start')
      else if (p.state === 'idle' && (prev === 'recording' || prev === 'finalizing')) void playSE('stop')
      prevStateRef.current = p.state
      setState(p.state)
    })
    const offToggle = window.api.onToggle(async (active) => {
      if (active) {
        if (micRef.current || startingRef.current) return
        startingRef.current = true
        try {
          const cfg = await window.api.getConfig()
          micRef.current = await startMic(
            (buf) => window.api.sendPcm(buf),
            cfg.microphoneDeviceId || undefined
          )
        } catch (err) {
          const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
          console.error('マイク取得に失敗:', err)
          window.api.reportAudioError(detail)
        } finally {
          startingRef.current = false
        }
      } else {
        micRef.current?.stop()
        micRef.current = null
      }
    })
    window.api.rendererReady()
    return () => {
      offState()
      offToggle()
    }
  }, [])

  return (
    <div className="worker">
      kotodama worker — <span>{state}</span>
    </div>
  )
}
