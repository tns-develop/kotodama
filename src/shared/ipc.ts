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
}

export const DEFAULT_CONFIG: AppConfig = {
  model: 'gpt-realtime-whisper',
  language: 'ja',
  delay: 'minimal',
  hotkey: 'CommandOrControl+Shift+R'
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
export interface KotodamaApi {
  onToggle(cb: (active: boolean) => void): void
  onState(cb: (payload: RecordingStatePayload) => void): void
  onDelta(cb: (text: string) => void): void
  onCompleted(cb: (text: string) => void): void
  sendPcm(buf: ArrayBuffer): void
  reportAudioError(message: string): void
  rendererReady(): void
  getConfig(): Promise<AppConfig>
  setConfig(config: Partial<AppConfig>): Promise<AppConfig>
  hasApiKey(): Promise<boolean>
  saveApiKey(key: string): Promise<boolean>
  openSettings(): void
}
