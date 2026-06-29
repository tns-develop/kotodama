import { useCallback, useEffect, useState } from 'react'
import {
  getDefaultConfig,
  type AppConfig,
  type MacPermissionKind,
  type MacPermissionState,
  type MacPermissionStatus,
  type TranscriptionDelay
} from '@shared/ipc'
import { eventToAccelerator, isValidAccelerator, keySavedPlaceholder } from '../lib/accelerator'
import { listAudioInputDevices, type AudioInputDevice } from '../lib/audio-devices'

const DELAY_OPTIONS: TranscriptionDelay[] = ['minimal', 'low', 'medium', 'high', 'xhigh']

const PERMISSION_LABELS: Record<MacPermissionState, string> = {
  granted: '許可済み',
  denied: '拒否',
  notDetermined: '未設定',
  needsSetup: '要設定',
  likelyOk: '動作中（推定）',
  failed: 'エラー',
  notApplicable: '—',
  unknown: '不明'
}

function permissionBadgeClass(state: MacPermissionState): string {
  if (state === 'granted' || state === 'likelyOk') return 'perm-badge perm-badge--ok'
  if (state === 'notApplicable') return 'perm-badge perm-badge--na'
  if (state === 'failed' || state === 'denied') return 'perm-badge perm-badge--bad'
  return 'perm-badge perm-badge--warn'
}

export function SettingsView() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [message, setMessage] = useState('')
  const [recordingKey, setRecordingKey] = useState(false)
  const [recordingHint, setRecordingHint] = useState('')
  const [macPerms, setMacPerms] = useState<MacPermissionStatus | null>(null)
  const [permMessage, setPermMessage] = useState('')
  const [resetPending, setResetPending] = useState(false)
  const [audioDevices, setAudioDevices] = useState<AudioInputDevice[]>([])

  const refreshAudioDevices = useCallback(async () => {
    setAudioDevices(await listAudioInputDevices())
  }, [])

  const refreshMacPermissions = useCallback(async (doubleControl: boolean) => {
    const status = await window.api.getMacPermissions(doubleControl)
    setMacPerms(status)
  }, [])

  useEffect(() => {
    void (async () => {
      const loaded = await window.api.getConfig()
      setConfig(loaded)
      setKeySaved(await window.api.hasApiKey())
      await refreshMacPermissions(loaded.doubleControl)
      await refreshAudioDevices()
    })()
  }, [refreshMacPermissions, refreshAudioDevices])

  // キー録音: capture フェーズでウィンドウ全体の keydown を捕捉
  useEffect(() => {
    if (!recordingKey) {
      setRecordingHint('')
      return
    }
    window.focus()
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      if (e.repeat) return
      if (e.key === 'Escape') {
        setRecordingKey(false)
        return
      }
      const accel = eventToAccelerator(e)
      if (accel) {
        setConfig((prev) => (prev ? { ...prev, hotkey: accel } : prev))
        setRecordingKey(false)
        return
      }
      setRecordingHint('修飾キー＋通常キーを押してください（例: Ctrl+Shift+R）')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recordingKey])

  // ESC で閉じる（キー録音中は上の capture が優先されるため無視）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (recordingKey) return
      window.api.closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recordingKey])

  const update = <K extends keyof AppConfig>(key: K, value: AppConfig[K]): void => {
    setConfig((prev) => (prev ? { ...prev, [key]: value } : prev))
    if (key === 'doubleControl' && typeof value === 'boolean') {
      void refreshMacPermissions(value)
    }
  }

  const openPane = async (kind: MacPermissionKind): Promise<void> => {
    await window.api.openMacPrivacyPane(kind)
  }

  const copyAppPath = async (): Promise<void> => {
    const ok = await window.api.copyMacAppPath()
    setPermMessage(ok ? 'アプリの場所をコピーしました' : '配布ビルドでのみコピーできます')
    setTimeout(() => setPermMessage(''), 2500)
  }

  const requestMic = async (): Promise<void> => {
    await window.api.requestMicAccess()
    if (config) await refreshMacPermissions(config.doubleControl)
    await refreshAudioDevices()
  }

  if (!config) return <div className="settings">読み込み中…</div>

  const isWin = window.api.platform === 'win32'
  const doubleTapLabel = isWin
    ? 'Alt+Ctrl を同時に押して離す（1回で開始 / 録音中も1回で終了）'
    : 'Control ダブルタップで録音開始 / 録音中は Control 1 回で終了'

  const onSave = async (): Promise<void> => {
    const hotkeyEmpty = !config.hotkey.trim()
    if (hotkeyEmpty && !config.doubleControl) {
      setMessage('ホットキーまたはダブルタップのいずれかを有効にしてください')
      return
    }
    if (!hotkeyEmpty && !isValidAccelerator(config.hotkey)) {
      setMessage('ホットキーが無効です（修飾キー＋通常キーの組み合わせが必要）')
      return
    }
    try {
      if (apiKeyInput.trim()) {
        await window.api.saveApiKey(apiKeyInput.trim())
        setApiKeyInput('')
        setKeySaved(true)
      }
      const result = await window.api.setConfig({
        language: config.language,
        delay: config.delay,
        hotkey: config.hotkey.trim(),
        llmCorrection: config.llmCorrection,
        doubleControl: config.doubleControl,
        soundEnabled: config.soundEnabled,
        microphoneDeviceId: config.microphoneDeviceId,
        ...(resetPending ? { inputMonitoringGuideDismissed: false } : {})
      })
      setResetPending(false)
      setConfig(result.config)
      await refreshMacPermissions(result.config.doubleControl)
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

  const onReset = (): void => {
    const defaults = getDefaultConfig(window.api.platform)
    setConfig({ ...defaults })
    setResetPending(true)
    void refreshMacPermissions(defaults.doubleControl)
    setMessage('初期値に戻しました（未保存）')
  }

  return (
    <div className="settings">
      <h1>Kotodama 設定</h1>

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
        <span>使用するマイク</span>
        <select
          value={config.microphoneDeviceId}
          onChange={(e) => update('microphoneDeviceId', e.target.value)}
        >
          <option value="">システム既定</option>
          {audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
          {config.microphoneDeviceId &&
            !audioDevices.some((d) => d.deviceId === config.microphoneDeviceId) && (
              <option value={config.microphoneDeviceId}>以前のデバイス（未接続）</option>
            )}
        </select>
        <small>マイク権限許可後にデバイス名が表示されます。</small>
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
        <small>
          {isWin
            ? '空欄の場合は Alt+Ctrl 1回のみ。「キーを録音」は globalShortcut 用（例: Ctrl+Shift+R）'
            : 'Electron アクセラレータ形式（例: CommandOrControl+Shift+R）。直接入力も可'}
        </small>
        {recordingHint && <small className="recording-hint">{recordingHint}</small>}
      </div>

      <label className="field field--row">
        <input
          type="checkbox"
          checked={config.doubleControl}
          onChange={(e) => update('doubleControl', e.target.checked)}
        />
        <span>{doubleTapLabel}</span>
      </label>

      {macPerms && (
        <section className="permissions">
          <h2>macOS 権限</h2>
          <p className="permissions-note">
            配布ビルドではシステム設定に <strong>Kotodama</strong> が表示されます。入力監視は一覧に無い場合「＋」で
            .app を追加してください。
          </p>

          <div className="perm-row">
            <div className="perm-info">
              <span className="perm-name">マイク</span>
              <span className={permissionBadgeClass(macPerms.microphone)}>
                {PERMISSION_LABELS[macPerms.microphone]}
              </span>
            </div>
            <div className="perm-actions">
              <button type="button" className="secondary" onClick={() => void requestMic()}>
                許可を要求
              </button>
              <button type="button" className="secondary" onClick={() => void openPane('microphone')}>
                設定を開く
              </button>
            </div>
          </div>

          <div className="perm-row">
            <div className="perm-info">
              <span className="perm-name">アクセシビリティ</span>
              <span className={permissionBadgeClass(macPerms.accessibility)}>
                {PERMISSION_LABELS[macPerms.accessibility]}
              </span>
              <small>貼り付け（Cmd+V）に必要</small>
            </div>
            <div className="perm-actions">
              <button type="button" className="secondary" onClick={() => void openPane('accessibility')}>
                設定を開く
              </button>
            </div>
          </div>

          <div className="perm-row">
            <div className="perm-info">
              <span className="perm-name">入力監視</span>
              <span className={permissionBadgeClass(macPerms.inputMonitoring)}>
                {PERMISSION_LABELS[macPerms.inputMonitoring]}
              </span>
              <small>Control ダブルタップに必要（状態は推定）</small>
            </div>
            <div className="perm-actions">
              <button
                type="button"
                className="secondary"
                disabled={!config.doubleControl}
                onClick={() => void openPane('inputMonitoring')}
              >
                設定を開く
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!config.doubleControl || !macPerms.isPackaged}
                onClick={() => void copyAppPath()}
              >
                場所をコピー
              </button>
            </div>
          </div>

          {macPerms.appBundlePath && (
            <p className="permissions-path">
              <code>{macPerms.appBundlePath}</code>
            </p>
          )}
          {permMessage && <p className="perm-message">{permMessage}</p>}
        </section>
      )}

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
