import { DEFAULT_CORRECTION_MODEL, DEFAULT_STT_MODEL, MODEL_CATALOG_REV } from './models'

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
  longRecordingResponse: 'longRecording:response',
  // main -> renderer
  recordingToggle: 'recording:toggle',
  recordingState: 'recording:state',
  transcriptDelta: 'transcript:delta',
  transcriptCompleted: 'transcript:completed'
} as const

export type TranscriptionDelay = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

/** Node.js process.platform と同値。shared は web/node 両 tsconfig から参照される */
export type KotodamaPlatform =
  | 'aix'
  | 'android'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'openbsd'
  | 'sunos'
  | 'win32'
  | 'cygwin'
  | 'netbsd'

export interface AppConfig {
  /** ストリーミングSTTモデル。差し替え可能にするため設定で保持 */
  model: string
  /** 言語ヒント (例: "ja")。空文字なら自動判定 */
  language: string
  /** 遅延/精度トレードオフ */
  delay: TranscriptionDelay
  /** 録音トグルのグローバルホットキー (Electron accelerator)。空文字なら未登録 */
  hotkey: string
  /** completed テキストを LLM で文脈補正するか。既定 false */
  llmCorrection: boolean
  /** 表記補正・音声編集の Chat Completions モデル */
  correctionModel: string
  /** 既存 STT を新既定へ寄せ済みか。設定UIには出さない */
  modelCatalogRev: number
  /** 修飾キーで録音開始/終了するか（Windows=Alt+Ctrl 1回、他=Control ダブルタップ開始・1回終了 / uiohook） */
  doubleControl: boolean
  /** 録音開始/終了時に効果音を鳴らすか。既定 true */
  soundEnabled: boolean
  /** 入力監視の案内ダイアログを「後で」にしたか */
  inputMonitoringGuideDismissed: boolean
  /** 使用するマイクの deviceId。空文字なら OS 既定 */
  microphoneDeviceId: string
  /** 録音開始時に選択テキストを検出し、音声指示で書き換えるか。既定 true */
  voiceEditEnabled: boolean
}

export function getDefaultConfig(platform: KotodamaPlatform): AppConfig {
  return {
    model: DEFAULT_STT_MODEL,
    language: 'ja',
    delay: 'minimal',
    hotkey: platform === 'win32' ? '' : 'CommandOrControl+Shift+R',
    llmCorrection: false,
    correctionModel: DEFAULT_CORRECTION_MODEL,
    modelCatalogRev: MODEL_CATALOG_REV,
    doubleControl: true,
    soundEnabled: true,
    inputMonitoringGuideDismissed: false,
    microphoneDeviceId: '',
    voiceEditEnabled: true
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

/** 録音セッションの用途。dictate=カーソル位置へ挿入 / edit=選択範囲を音声指示で書き換え */
export type RecordingMode = 'dictate' | 'edit'

export interface RecordingStatePayload {
  state: RecordingState
  message?: string
  mode?: RecordingMode
  /** 編集モード時、書き換え対象の選択テキスト先頭（オーバーレイ表示用） */
  selectionPreview?: string
}

export interface ToggleRecordingPayload {
  active: boolean
}

/** 長期録音確認ダイアログから main への応答 */
export type LongRecordingAction = 'continue' | 'stop'

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
  platform: KotodamaPlatform
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
  respondLongRecording(action: LongRecordingAction): void
}
