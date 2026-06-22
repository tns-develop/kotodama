import { useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG, type AppConfig, type RecordingState, type TranscriptionDelay } from '@shared/ipc'
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

/** 録音開始/終了の効果音。音源未配置や再生失敗時は握りつぶし、本処理に影響させない。 */
async function playSE(kind: 'start' | 'stop'): Promise<void> {
  try {
    // 鳴らす直前に取得することでトグルを即時反映（state 遷移ごとには呼ばない）
    const cfg = await window.api.getConfig()
    if (!cfg.soundEnabled) return
    const audio = new Audio(kind === 'start' ? './sounds/start.mp3' : './sounds/stop.mp3')
    await audio.play()
  } catch {
    /* noop */
  }
}

/** 隠しウィンドウ。ホットキー通知を受けてマイクを開始/停止し、PCM を main へ送る。 */
function WorkerView() {
  const micRef = useRef<MicHandle | null>(null)
  const startingRef = useRef(false)
  const prevStateRef = useRef<RecordingState>('idle')
  const [state, setState] = useState<RecordingState>('idle')

  useEffect(() => {
    const offState = window.api.onState((p) => {
      const prev = prevStateRef.current
      // 開始音: recording へ遷移時 / 終了音: 正常完了(recording|finalizing → idle)時のみ
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

const DELAY_OPTIONS: TranscriptionDelay[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [message, setMessage] = useState('')
  const [recordingKey, setRecordingKey] = useState(false)

  useEffect(() => {
    void (async () => {
      setConfig(await window.api.getConfig())
      setKeySaved(await window.api.hasApiKey())
    })()
  }, [])

  // キー録音中はウィンドウ全体で keydown を捕捉する。ボタンの onKeyDown 依存だと
  // フォーカス状態によって拾えないため、確実に取れるこの方式にする。
  useEffect(() => {
    if (!recordingKey) return
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      if (e.key === 'Escape') {
        setRecordingKey(false)
        return
      }
      const accel = eventToAccelerator(e)
      if (accel) {
        setConfig((prev) => (prev ? { ...prev, hotkey: accel } : prev))
        setRecordingKey(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recordingKey])

  // ESC で設定画面を閉じる（保存はしない）。キー録音中はキャンセル優先のため
  // 上の capture ハンドラに任せ、ここでは閉じない。
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (recordingKey) return
      window.api.closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recordingKey])

  if (!config) return <div className="settings">読み込み中…</div>

  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]): void =>
    setConfig({ ...config, [key]: value })

  const onSave = async (): Promise<void> => {
    if (!isValidAccelerator(config.hotkey)) {
      setMessage('ホットキーが無効です（修飾キー＋通常キーの組み合わせが必要）')
      return
    }
    try {
      if (apiKeyInput.trim()) {
        await window.api.saveApiKey(apiKeyInput.trim())
        setApiKeyInput('')
        setKeySaved(true)
      }
      const result = await window.api.setConfig(config)
      setConfig(result.config)
      if (!result.hotkeyOk) {
        setMessage('ホットキーを登録できませんでした（他アプリと競合の可能性）。前の設定に戻しました')
        return
      }
      setMessage('保存しました')
      setTimeout(() => setMessage(''), 2000)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存に失敗しました')
    }
  }

  // フォームを既定値へ戻すだけ。保存は別途「保存」を押すまで行わない。APIキーは対象外。
  const onReset = (): void => {
    setConfig({ ...DEFAULT_CONFIG })
    setMessage('初期値に戻しました（未保存）')
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

      <label className="field field--row">
        <input
          type="checkbox"
          checked={config.llmCorrection}
          onChange={(e) => update('llmCorrection', e.target.checked)}
        />
        <span>漢字変換をLLMで文脈補正する（gpt-5.4-nano / 追加課金あり）</span>
      </label>

      <div className="field">
        <span>録音トグルのホットキー</span>
        <div className="hotkey-row">
          <input
            type="text"
            value={config.hotkey}
            placeholder="例: CommandOrControl+Shift+R"
            onChange={(e) => update('hotkey', e.target.value.trim())}
          />
          <button
            type="button"
            className={`record-key${recordingKey ? ' record-key--active' : ''}`}
            onClick={() => setRecordingKey((v) => !v)}
          >
            {recordingKey ? 'キーを押す…' : 'キーを録音'}
          </button>
        </div>
        <small>Electron アクセラレータ形式（例: CommandOrControl+Shift+R）。直接入力も可</small>
      </div>

      <label className="field field--row">
        <input
          type="checkbox"
          checked={config.doubleControl}
          onChange={(e) => update('doubleControl', e.target.checked)}
        />
        <span>Control ダブルタップで録音開始、録音中は Control 1 回で終了（macOS は「入力監視」権限が必要）</span>
      </label>

      <label className="field field--row">
        <input
          type="checkbox"
          checked={config.soundEnabled}
          onChange={(e) => update('soundEnabled', e.target.checked)}
        />
        <span>録音の開始・終了時に効果音を鳴らす</span>
      </label>

      <div className="actions">
        <button onClick={() => void onSave()}>保存</button>
        <button className="secondary" onClick={() => window.api.closeSettings()}>
          キャンセル
        </button>
        <button className="secondary" onClick={onReset}>
          初期値に戻す
        </button>
        {message && <span className="message">{message}</span>}
      </div>
    </div>
  )
}

function keySavedPlaceholder(saved: boolean): string {
  return saved ? '••••••••（変更する場合のみ入力）' : 'sk-...'
}

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/** keydown を Electron accelerator 文字列へ変換する。修飾キー単独なら null。 */
function eventToAccelerator(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = e.key
  if (key === ' ') key = 'Space'
  else if (/^[a-z]$/.test(key)) key = key.toUpperCase()
  else if (key.length === 1) key = key.toUpperCase()
  // F1〜F24 や矢印キーなどは e.key の表記をそのまま使う

  parts.push(key)
  return parts.join('+')
}

/** 修飾キー＋通常キーの最小条件を満たすかの簡易バリデーション。 */
function isValidAccelerator(accel: string): boolean {
  const tokens = accel.split('+').filter(Boolean)
  if (tokens.length < 2) return false
  const modifiers = new Set([
    'Command',
    'Cmd',
    'Control',
    'Ctrl',
    'CommandOrControl',
    'CmdOrCtrl',
    'Alt',
    'Option',
    'AltGr',
    'Shift',
    'Super',
    'Meta'
  ])
  const hasModifier = tokens.some((t) => modifiers.has(t))
  const hasKey = tokens.some((t) => !modifiers.has(t))
  return hasModifier && hasKey
}

/** 録音中の浮遊ピル。delta を逐次プレビュー表示し、確定で本文を一瞬表示する。 */
function OverlayView() {
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
