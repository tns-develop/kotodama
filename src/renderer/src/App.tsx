import { useEffect, useRef, useState } from 'react'
import type { AppConfig, RecordingState, TranscriptionDelay } from '@shared/ipc'
import { startMic, type MicHandle } from './audio'

type View = 'worker' | 'settings' | 'overlay'

function currentView(): View {
  const hash = window.location.hash.replace(/^#\/?/, '')
  if (hash === 'settings') return 'settings'
  if (hash === 'overlay') return 'overlay'
  return 'worker'
}

export function App() {
  const [view] = useState<View>(currentView())
  if (view === 'settings') return <SettingsView />
  if (view === 'overlay') return <OverlayView />
  return <WorkerView />
}

/** 隠しウィンドウ。ホットキー通知を受けてマイクを開始/停止し、PCM を main へ送る。 */
function WorkerView() {
  const micRef = useRef<MicHandle | null>(null)
  const startingRef = useRef(false)
  const [state, setState] = useState<RecordingState>('idle')

  useEffect(() => {
    window.api.onState((p) => setState(p.state))
    window.api.onToggle(async (active) => {
      if (active) {
        if (micRef.current || startingRef.current) return
        startingRef.current = true
        try {
          micRef.current = await startMic((buf) => window.api.sendPcm(buf))
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
  }, [])

  return (
    <div className="worker">
      kotodama worker — <span>{state}</span>
    </div>
  )
}

const DELAY_OPTIONS: TranscriptionDelay[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    void (async () => {
      setConfig(await window.api.getConfig())
      setKeySaved(await window.api.hasApiKey())
    })()
  }, [])

  if (!config) return <div className="settings">読み込み中…</div>

  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]): void =>
    setConfig({ ...config, [key]: value })

  const onSave = async (): Promise<void> => {
    try {
      if (apiKeyInput.trim()) {
        await window.api.saveApiKey(apiKeyInput.trim())
        setApiKeyInput('')
        setKeySaved(true)
      }
      const merged = await window.api.setConfig(config)
      setConfig(merged)
      setMessage('保存しました')
      setTimeout(() => setMessage(''), 2000)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存に失敗しました')
    }
  }

  return (
    <div className="settings">
      <h1>kotodama 設定</h1>

      <label className="field">
        <span>OpenAI APIキー {keySaved && <em>(保存済み)</em>}</span>
        <input
          type="password"
          value={apiKeyInput}
          placeholder={keySavedPlaceholder(keySaved)}
          onChange={(e) => setApiKeyInput(e.target.value)}
          autoComplete="off"
        />
        <small>safeStorage で暗号化して保存されます。</small>
      </label>

      <label className="field">
        <span>モデル</span>
        <input type="text" value={config.model} readOnly />
      </label>

      <label className="field">
        <span>言語ヒント (空欄で自動判定)</span>
        <input
          type="text"
          value={config.language}
          placeholder="ja"
          onChange={(e) => update('language', e.target.value.trim())}
        />
      </label>

      <label className="field">
        <span>遅延 / 精度 (delay)</span>
        <select
          value={config.delay}
          onChange={(e) => update('delay', e.target.value as TranscriptionDelay)}
        >
          {DELAY_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
              {d === 'minimal' ? '（最速）' : d === 'xhigh' ? '（高精度）' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>録音トグルのホットキー</span>
        <input
          type="text"
          value={config.hotkey}
          onChange={(e) => update('hotkey', e.target.value.trim())}
        />
        <small>Electron アクセラレータ形式（例: CommandOrControl+Shift+R）</small>
      </label>

      <div className="actions">
        <button onClick={() => void onSave()}>保存</button>
        {message && <span className="message">{message}</span>}
      </div>
    </div>
  )
}

function keySavedPlaceholder(saved: boolean): string {
  return saved ? '••••••••（変更する場合のみ入力）' : 'sk-...'
}

/** 録音中の浮遊ピル。delta を逐次プレビュー表示し、確定で本文を一瞬表示する。 */
function OverlayView() {
  const [state, setState] = useState<RecordingState>('idle')
  const [partial, setPartial] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    window.api.onState((p) => {
      setState(p.state)
      if (p.state === 'recording' || p.state === 'connecting') setPartial('')
      setErrorMessage(p.state === 'error' ? (p.message ?? '') : '')
    })
    window.api.onDelta((text) => setPartial((prev) => prev + text))
    window.api.onCompleted((text) => setPartial(text))
    window.api.rendererReady()
  }, [])

  const label =
    state === 'connecting'
      ? '接続中…'
      : state === 'recording'
        ? '聞き取り中'
        : state === 'finalizing'
          ? '確定処理中…'
          : state === 'error'
            ? 'エラー'
            : ''

  return (
    <div className="overlay">
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
