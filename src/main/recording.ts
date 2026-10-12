/**
 * 録音セッションのライフサイクル管理。
 * 状態（recording / currentState / sttSession）をこのモジュールが所有する。
 */
import { globalShortcut } from 'electron'
import { IPC, LongRecordingAction, RecordingState, RecordingStatePayload } from '@shared/ipc'
import { loadApiKey, loadConfig } from './store'
import { createSttAdapter, SttSession } from './realtime'
import { injectText } from './text-injector'
import { postProcess } from './post-process'
import { captureSelectionIfAny } from './selection'
import { applyVoiceEdit } from './voice-edit'
import { setCtrlKeyMode } from './global-keys'
import { ensureMicrophoneAccess, runMacPermissionOnboarding } from './permissions'
import { broadcast, closeLongRecordingDialog, hideOverlay, openLongRecordingDialog, openSettingsWindow, sendToggle, showOverlay } from './windows'
import { updateTray } from './tray'

let sttSession: SttSession | null = null
let recording = false
let currentState: RecordingState = 'idle'
let finalizeTimer: ReturnType<typeof setTimeout> | null = null
let appendedBytes = 0
/** 非 null なら音声編集モード。書き換え対象の選択テキストを保持する */
let editOriginalText: string | null = null
/** startRecording の前処理中フラグ。選択検出の待ち時間中の多重起動を防ぐ */
let starting = false

/** オーバーレイに出す選択テキストの表示上限 */
const SELECTION_PREVIEW_LENGTH = 24

// 意図しない長期録音による STT トークン消費を抑える
const LONG_RECORDING_THRESHOLD_MS = 120_000
const LONG_RECORDING_DIALOG_TIMEOUT_MS = 20_000

let longRecordingTimer: ReturnType<typeof setTimeout> | null = null
let longRecordingAutoStopTimer: ReturnType<typeof setTimeout> | null = null
let longRecordingPromptOpen = false

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

/** 選択テキストを1行に畳んで先頭だけ返す（オーバーレイのチップ表示用）。 */
function buildSelectionPreview(): string | undefined {
  if (!editOriginalText) return undefined
  const flat = editOriginalText.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  return flat.length > SELECTION_PREVIEW_LENGTH
    ? `${flat.slice(0, SELECTION_PREVIEW_LENGTH)}…`
    : flat
}

function buildStatePayload(state: RecordingState, message?: string): RecordingStatePayload {
  return {
    state,
    message,
    mode: editOriginalText ? 'edit' : 'dictate',
    selectionPreview: buildSelectionPreview()
  }
}

function setState(state: RecordingState, message?: string): void {
  currentState = state
  broadcast(IPC.recordingState, buildStatePayload(state, message))
  updateTray(currentState, recording)
}

/** rendererReady 時に現在状態を再送する。 */
export function broadcastCurrentState(): void {
  broadcast(IPC.recordingState, buildStatePayload(currentState))
}

/** completed 待ちの保険タイマーを止める */
function clearFinalizeTimer(): void {
  if (finalizeTimer) {
    clearTimeout(finalizeTimer)
    finalizeTimer = null
  }
}

/** 長時間録音まわりのタイマーとダイアログをリセット */
function clearLongRecordingTimers(): void {
  if (longRecordingTimer) {
    clearTimeout(longRecordingTimer)
    longRecordingTimer = null
  }
  if (longRecordingAutoStopTimer) {
    clearTimeout(longRecordingAutoStopTimer)
    longRecordingAutoStopTimer = null
  }
  longRecordingPromptOpen = false
  closeLongRecordingDialog()
}

/** 閾値経過後に確認ダイアログを出すタイマーを開始 */
function startLongRecordingWatch(): void {
  clearLongRecordingTimers()
  longRecordingTimer = setTimeout(() => {
    longRecordingTimer = null
    showLongRecordingPrompt()
  }, LONG_RECORDING_THRESHOLD_MS)
}

/** 確認ダイアログを表示。無応答なら 20 秒後に自動停止 */
function showLongRecordingPrompt(): void {
  if (!recording || longRecordingPromptOpen) return
  longRecordingPromptOpen = true
  const expiresAt = Date.now() + LONG_RECORDING_DIALOG_TIMEOUT_MS
  openLongRecordingDialog(expiresAt)
  longRecordingAutoStopTimer = setTimeout(() => {
    longRecordingAutoStopTimer = null
    handleLongRecordingResponse('stop')
  }, LONG_RECORDING_DIALOG_TIMEOUT_MS)
}

/** ダイアログ応答を処理。「続ける」なら監視を再開、「停止」なら録音終了 */
export function handleLongRecordingResponse(action: LongRecordingAction): void {
  if (!longRecordingPromptOpen) return
  longRecordingPromptOpen = false
  if (longRecordingAutoStopTimer) {
    clearTimeout(longRecordingAutoStopTimer)
    longRecordingAutoStopTimer = null
  }
  closeLongRecordingDialog()
  if (action === 'stop') {
    void stopRecording()
    return
  }
  if (recording) startLongRecordingWatch()
}

/**
 * セッション後始末。全経路がここを通り recording 固着を防ぐ。
 */
function teardownSession(finalState: RecordingState, message?: string): void {
  clearLongRecordingTimers()
  globalShortcut.unregister('Escape')
  clearFinalizeTimer()
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
  // 次のセッションへ持ち越さないようクリアする（上の setState より後なので、
  // このセッションの最終状態は編集モードのまま renderer へ届く）
  editOriginalText = null
}

async function startRecording(): Promise<void> {
  // 選択検出の待ち時間中は recording が false のままなので、多重起動をここで弾く
  if (recording || starting) return
  starting = true

  const apiKey = loadApiKey()
  if (!apiKey) {
    starting = false
    console.error('[kotodama] session error: APIキーが未設定です')
    setState('error', 'APIキーが未設定です')
    openSettingsWindow()
    return
  }

  const micGranted = await ensureMicrophoneAccess()
  if (!micGranted) {
    starting = false
    console.error('[kotodama] session error: マイク権限がありません')
    setState('error', 'マイク権限がありません')
    return
  }
  // 未許可でも録音は続ける。案内は配布ビルドのウィザードに任せる
  void runMacPermissionOnboarding()

  const config = loadConfig()
  // 選択テキストがあれば音声編集モードに入る。await を含むため recording=true より前に
  // 済ませる（recording=true から adapter.connect までは同期で通す必要がある）
  editOriginalText = config.voiceEditEnabled ? await captureSelectionIfAny() : null
  if (editOriginalText) {
    console.log(`[kotodama] voice edit mode: ${editOriginalText.length} chars selected`)
  }

  starting = false
  recording = true
  setCtrlKeyMode('stop')
  appendedBytes = 0
  // Escape で中断できるようにする（best-effort）
  globalShortcut.register('Escape', () => cancelRecording())
  setState('connecting')
  showOverlay()
  console.log(`[kotodama] connecting: model=${config.model}, lang=${config.language || 'auto'}, delay=${config.delay}`)

  // teardown で editOriginalText がクリアされても書き換えを完了できるよう、
  // config/apiKey と同様にこのセッションの値をローカルへ固定する
  const editOriginal = editOriginalText

  const adapter = createSttAdapter(config.model)
  sttSession = adapter.connect(apiKey, config, {
    onOpen: () => {
      setState('recording')
      sendToggle(true)
      startLongRecordingWatch()
    },
    onDelta: (text) => broadcast(IPC.transcriptDelta, text),
    onCompleted: async (text) => {
      // completed が来た時点で保険タイマーは役目を終える。後処理（LLM は最大 8s）中に
      // 発火すると、遅れて再開したこの処理が次のセッションを teardown してしまう
      clearFinalizeTimer()
      broadcast(IPC.transcriptCompleted, text)
      if (text.trim()) {
        try {
          if (editOriginal) {
            // 失敗時は貼り付けない（選択範囲を壊さない）
            const edited = await applyVoiceEdit(editOriginal, text, apiKey, config.correctionModel)
            if (!edited) {
              teardownSession('error', 'テキストの編集に失敗しました')
              return
            }
            await injectText(edited)
          } else {
            const finalText = await postProcess(text, config, apiKey)
            await injectText(finalText)
          }
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
  clearLongRecordingTimers()
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
