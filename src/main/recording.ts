/**
 * 録音セッションのライフサイクル管理。
 * 状態（recording / currentState / sttSession）をこのモジュールが所有する。
 */
import { globalShortcut } from 'electron'
import { IPC, RecordingState, RecordingStatePayload } from '@shared/ipc'
import { loadApiKey, loadConfig } from './store'
import { createSttAdapter, SttSession } from './realtime'
import { injectText } from './text-injector'
import { postProcess } from './post-process'
import { setCtrlKeyMode } from './global-keys'
import { ensureMicrophoneAccess, guideAccessibilityIfNeeded } from './permissions'
import { broadcast, hideOverlay, openSettingsWindow, sendToggle, showOverlay } from './windows'
import { updateTray } from './tray'

let sttSession: SttSession | null = null
let recording = false
let currentState: RecordingState = 'idle'
let finalizeTimer: ReturnType<typeof setTimeout> | null = null
let appendedBytes = 0

export function isRecording(): boolean {
  return recording
}

export function getCurrentState(): RecordingState {
  return currentState
}

/** PCM を STT セッションへ転送する。 */
export function appendAudio(chunk: ArrayBuffer): void {
  if (!sttSession) return
  appendedBytes += chunk.byteLength
  sttSession.appendAudio(chunk)
}

function setState(state: RecordingState, message?: string): void {
  currentState = state
  const payload: RecordingStatePayload = { state, message }
  broadcast(IPC.recordingState, payload)
  updateTray(currentState, recording)
}

/** rendererReady 時に現在状態を再送する。 */
export function broadcastCurrentState(): void {
  broadcast(IPC.recordingState, { state: currentState } satisfies RecordingStatePayload)
}

/**
 * セッション後始末。全経路がここを通り recording 固着を防ぐ。
 */
function teardownSession(finalState: RecordingState, message?: string): void {
  globalShortcut.unregister('Escape')
  if (finalizeTimer) {
    clearTimeout(finalizeTimer)
    finalizeTimer = null
  }
  recording = false
  sttSession?.close()
  sttSession = null
  // マイクを確実に停止
  sendToggle(false)
  setState(finalState, message)
  // エラー時は 6 秒後にピルを隠す
  if (finalState === 'error') {
    console.error('[kotodama] session error:', message ?? '(詳細不明)')
    setTimeout(() => currentState === 'error' && hideOverlay(), 6000)
  } else {
    hideOverlay()
  }
  setCtrlKeyMode('idle')
}

async function startRecording(): Promise<void> {
  const apiKey = loadApiKey()
  if (!apiKey) {
    console.error('[kotodama] session error: APIキーが未設定です')
    setState('error', 'APIキーが未設定です')
    openSettingsWindow()
    return
  }

  const micGranted = await ensureMicrophoneAccess()
  if (!micGranted) {
    console.error('[kotodama] session error: マイク権限がありません')
    setState('error', 'マイク権限がありません')
    return
  }
  // アクセシビリティ権限の案内（未許可でも録音は継続）
  void guideAccessibilityIfNeeded()

  const config = loadConfig()
  recording = true
  setCtrlKeyMode('stop')
  appendedBytes = 0
  // Escape で中断できるようにする（best-effort）
  globalShortcut.register('Escape', () => cancelRecording())
  setState('connecting')
  showOverlay()
  console.log(`[kotodama] connecting: model=${config.model}, lang=${config.language || 'auto'}, delay=${config.delay}`)

  const adapter = createSttAdapter(config.model)
  sttSession = adapter.connect(apiKey, config, {
    onOpen: () => {
      setState('recording')
      sendToggle(true)
    },
    onDelta: (text) => broadcast(IPC.transcriptDelta, text),
    onCompleted: async (text) => {
      broadcast(IPC.transcriptCompleted, text)
      if (text.trim()) {
        try {
          const finalText = await postProcess(text, config, apiKey)
          await injectText(finalText)
        } catch (err) {
          teardownSession('error', err instanceof Error ? err.message : '貼り付けに失敗しました')
          return
        }
      }
      teardownSession('idle')
    },
    onError: (message) => teardownSession('error', message),
    onClose: () => {
      // 正常終了時は recording=false 済み。録音中の予期しない切断のみ後始末する。
      if (recording) teardownSession('error', '接続が切断されました')
    }
  })
}

async function stopRecording(): Promise<void> {
  if (!recording) return
  // recording を先に false にして onClose の二重後始末を防ぐ
  recording = false
  setState('finalizing')
  sendToggle(false)

  // 最後の PCM が届いてから commit（短すぎると弾かれるため 250ms 待つ）
  setTimeout(() => {
    const ms = Math.round((appendedBytes / 48000) * 1000)
    console.log(`[kotodama] committing: sent ${appendedBytes} bytes (~${ms}ms of audio)`)
    sttSession?.commit()
  }, 250)

  // completed が来ない場合のタイムアウト保険
  finalizeTimer = setTimeout(() => teardownSession('idle'), 8000)
}

export async function toggleRecording(): Promise<void> {
  if (recording) await stopRecording()
  else await startRecording()
}

/** 録音中断（commit しないため結果は貼り付けられない）。 */
function cancelRecording(): void {
  if (!recording) return
  teardownSession('idle')
}

/** Ctrl ダブルタップ用。finalizing 中は開始しない。 */
export function onCtrlKey(): void {
  if (recording) void stopRecording()
  else if (currentState !== 'finalizing') void startRecording()
}

/** renderer 側の音声初期化失敗をエラー表示する。 */
export function failSessionWithAudioError(message: string): void {
  teardownSession('error', `マイク/音声の初期化に失敗: ${message}`)
}

export function closeSession(): void {
  sttSession?.close()
}
