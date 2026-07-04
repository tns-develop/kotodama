import { ipcMain } from 'electron'
import { AppConfig, IPC, LongRecordingAction, MacPermissionKind, SetConfigResult } from '@shared/ipc'
import { hasApiKey, loadConfig, saveApiKey, saveConfig } from './store'
import {
  appendAudio,
  broadcastCurrentState,
  failSessionWithAudioError,
  handleLongRecordingResponse
} from './recording'
import { applyDoubleControl, getActiveHotkey, registerHotkey } from './hotkeys'
import { closeSettingsWindow, openSettingsWindow } from './windows'
import {
  clearInputMonitoringDismissIfResolved,
  copyMacAppBundlePath,
  ensureMicrophoneAccess,
  getMacPermissionStatus,
  guideInputMonitoringIfNeeded,
  openMacPrivacyPane
} from './permissions'

/**
 * renderer → main の IPC チャネルを登録する。
 * アプリ起動時に 1 回だけ呼び出す。双方向通信のうち main 側の受信口をここに集約する。
 */
export function registerIpcHandlers(): void {
  // --- 録音セッション（renderer がマイク PCM をストリーミング） ---

  /** 16-bit PCM チャンクを Realtime API セッションへ転送 */
  ipcMain.on(IPC.audioPcm, (_e, chunk: ArrayBuffer) => appendAudio(chunk))
  /** getUserMedia 失敗など、renderer 側の音声取得エラーをセッション失敗として扱う */
  ipcMain.on(IPC.audioError, (_e, message: string) => failSessionWithAudioError(message))
  /** オーバーレイ等の renderer 起動完了。現在の録音状態を即座に同期する */
  ipcMain.on(IPC.rendererReady, () => broadcastCurrentState())
  /** 長時間録音の確認ダイアログでユーザーが「続ける / 停止」を選んだ結果 */
  ipcMain.on(IPC.longRecordingResponse, (_e, action: LongRecordingAction) => {
    handleLongRecordingResponse(action)
  })

  // --- 設定ウィンドウ ---

  ipcMain.on(IPC.openSettings, () => openSettingsWindow())
  ipcMain.on(IPC.closeSettings, () => closeSettingsWindow())

  // --- アプリ設定（invoke/handle: 戻り値あり） ---

  ipcMain.handle(IPC.getConfig, () => loadConfig())
  ipcMain.handle(IPC.setConfig, (_e, partial: Partial<AppConfig>): SetConfigResult => {
    const previous = loadConfig()

    // inputMonitoringGuideDismissed は main 専用フラグ。
    // renderer の Partial 更新では触らないため、未指定時は既存値を保持する。
    const mergedInput: Partial<AppConfig> = {
      ...partial,
      inputMonitoringGuideDismissed:
        partial.inputMonitoringGuideDismissed ?? previous.inputMonitoringGuideDismissed
    }
    let merged = saveConfig(mergedInput)

    // ホットキー文字列を OS グローバルショートカットとして再登録
    const hotkeyOk = registerHotkey(merged.hotkey)
    const activeHotkey = getActiveHotkey()
    // 登録失敗時は直前の有効キーへロールバック（activeHotkey が空文字でも有効＝Windows デフォルト）
    if (!hotkeyOk && merged.hotkey.trim() !== activeHotkey) {
      merged = saveConfig({ hotkey: activeHotkey })
    }

    // doubleControl 変更時は uiohook の開始/停止を反映
    applyDoubleControl(merged.doubleControl)
    // 入力監視が不要になったら「案内を後でにした」フラグをクリア
    clearInputMonitoringDismissIfResolved(merged.doubleControl)
    // OFF → ON に切り替わった初回のみ、macOS 入力監視の案内を表示
    if (!previous.doubleControl && merged.doubleControl) {
      void guideInputMonitoringIfNeeded()
    }

    return { config: merged, hotkeyOk }
  })

  // --- OpenAI API キー（OS キーチェーン等に保存） ---

  ipcMain.handle(IPC.hasApiKey, () => hasApiKey())
  ipcMain.handle(IPC.saveApiKey, (_e, key: string) => {
    saveApiKey(key)
    return true
  })

  // --- macOS プライバシー権限（他 OS では getStatus のみ null を返す） ---

  /** マイク・アクセシビリティ・入力監視の付与状態を取得 */
  ipcMain.handle(IPC.permissionsGetStatus, (_e, doubleControl: boolean) => {
    if (process.platform !== 'darwin') return null
    return getMacPermissionStatus(doubleControl)
  })
  /** システム設定の該当プライバシーペインを開く */
  ipcMain.handle(IPC.permissionsOpenPane, (_e, kind: MacPermissionKind) =>
    openMacPrivacyPane(kind)
  )
  /** 配布 .app のパスをクリップボードへコピー（手動追加用） */
  ipcMain.handle(IPC.permissionsCopyAppPath, () => copyMacAppBundlePath())
  /** マイク権限ダイアログを表示し、許可をリクエスト */
  ipcMain.handle(IPC.permissionsRequestMic, () => ensureMicrophoneAccess())
}
