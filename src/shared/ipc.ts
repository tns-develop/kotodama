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
  /** 録音トグルのグローバルホットキー (Electron accelerator) */
  hotkey: string
  /** completed テキストを LLM で文脈補正するか (gpt-5.4-nano)。既定 false */
  llmCorrection: boolean
  /** Control ダブルタップで録音開始・録音中は Control 1 回で終了するか（ネイティブキーフック使用） */
  doubleControl: boolean
  /** 録音開始/終了時に効果音を鳴らすか。既定 true */
  soundEnabled: boolean
}

export const DEFAULT_CONFIG: AppConfig = {
  model: 'gpt-realtime-whisper',
  language: 'ja',
  delay: 'minimal',
  hotkey: 'CommandOrControl+Shift+R',
  llmCorrection: false,
  doubleControl: true,
  soundEnabled: true
}

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

/** preload が contextBridge で renderer に公開する API */
/** イベント購読の解除関数 */
export type Unsubscribe = () => void

export interface KotodamaApi {
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
}
