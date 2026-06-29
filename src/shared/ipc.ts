export const IPC = {
  // renderer -> main
  audioPcm: 'audio:pcm',
  audioError: 'audio:error',
  rendererReady: 'renderer:ready',
  getConfig: 'config:get',
  setConfig: 'config:set',
  hasApiKey: 'apikey:has',
  saveApiKey: 'apikey:save',
  openSettings: 'settings:open',
  closeSettings: 'settings:close',
  permissionsGetStatus: 'permissions:getStatus',
  permissionsOpenPane: 'permissions:openPane',
  permissionsCopyAppPath: 'permissions:copyAppPath',
  permissionsRequestMic: 'permissions:requestMic',
  // main -> renderer
  recordingToggle: 'recording:toggle',
  recordingState: 'recording:state',
  transcriptDelta: 'transcript:delta',
  transcriptCompleted: 'transcript:completed'
} as const

export type TranscriptionDelay = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface AppConfig {
  /** ストリーミングSTTモデル。差し替え可能にするため設定で保持 */
  model: string
  /** 言語ヒント (例: "ja")。空文字なら自動判定 */
  language: string
  /** 遅延/精度トレードオフ */
  delay: TranscriptionDelay
  /** 録音トグルのグローバルホットキー (Electron accelerator)。空文字なら未登録 */
  hotkey: string
  /** completed テキストを LLM で文脈補正するか (gpt-5.4-nano)。既定 false */
  llmCorrection: boolean
  /** 修飾キー ダブルタップで録音開始・録音中は 1 回で終了するか（Windows=Alt、他=Control / uiohook） */
  doubleControl: boolean
  /** 録音開始/終了時に効果音を鳴らすか。既定 true */
  soundEnabled: boolean
  /** 入力監視の案内ダイアログを「後で」にしたか */
  inputMonitoringGuideDismissed: boolean
}

export function getDefaultConfig(platform: NodeJS.Platform): AppConfig {
  return {
    model: 'gpt-realtime-whisper',
    language: 'ja',
    delay: 'minimal',
    hotkey: platform === 'win32' ? '' : 'CommandOrControl+Shift+R',
    llmCorrection: false,
    doubleControl: true,
    soundEnabled: true,
    inputMonitoringGuideDismissed: false
  }
}

export const DEFAULT_CONFIG: AppConfig = getDefaultConfig('darwin')

/** setConfig の結果。ホットキー登録の成否を UI に伝える。 */
export interface SetConfigResult {
  config: AppConfig
  /** 指定ホットキーの登録に成功したか（失敗時は config.hotkey は直前の有効値に戻る） */
  hotkeyOk: boolean
}

export type RecordingState = 'idle' | 'connecting' | 'recording' | 'finalizing' | 'error'

export interface RecordingStatePayload {
  state: RecordingState
  message?: string
}

export interface ToggleRecordingPayload {
  active: boolean
}

export type MacPermissionKind = 'microphone' | 'accessibility' | 'inputMonitoring'

export type MacPermissionState =
  | 'granted'
  | 'denied'
  | 'notDetermined'
  | 'needsSetup'
  | 'likelyOk'
  | 'failed'
  | 'notApplicable'
  | 'unknown'

export interface MacPermissionStatus {
  microphone: MacPermissionState
  accessibility: MacPermissionState
  inputMonitoring: MacPermissionState
  /** 配布 .app の絶対パス。開発時は空 */
  appBundlePath: string
  isPackaged: boolean
}

/** preload が contextBridge で renderer に公開する API */
/** イベント購読の解除関数 */
export type Unsubscribe = () => void

export interface KotodamaApi {
  platform: NodeJS.Platform
  onToggle(cb: (active: boolean) => void): Unsubscribe
  onState(cb: (payload: RecordingStatePayload) => void): Unsubscribe
  onDelta(cb: (text: string) => void): Unsubscribe
  onCompleted(cb: (text: string) => void): Unsubscribe
  sendPcm(buf: ArrayBuffer): void
  reportAudioError(message: string): void
  rendererReady(): void
  getConfig(): Promise<AppConfig>
  setConfig(config: Partial<AppConfig>): Promise<SetConfigResult>
  hasApiKey(): Promise<boolean>
  saveApiKey(key: string): Promise<boolean>
  openSettings(): void
  closeSettings(): void
  /** macOS のみ。他 OS では null */
  getMacPermissions(doubleControl: boolean): Promise<MacPermissionStatus | null>
  openMacPrivacyPane(kind: MacPermissionKind): Promise<void>
  copyMacAppPath(): Promise<boolean>
  requestMicAccess(): Promise<boolean>
}
