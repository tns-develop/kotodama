import { ipcMain } from 'electron'
import { AppConfig, IPC, MacPermissionKind, SetConfigResult } from '@shared/ipc'
import { hasApiKey, loadConfig, saveApiKey, saveConfig } from './store'
import { appendAudio, broadcastCurrentState, failSessionWithAudioError } from './recording'
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

export function registerIpcHandlers(): void {
  ipcMain.on(IPC.audioPcm, (_e, chunk: ArrayBuffer) => appendAudio(chunk))
  ipcMain.on(IPC.audioError, (_e, message: string) => failSessionWithAudioError(message))
  ipcMain.on(IPC.rendererReady, () => broadcastCurrentState())
  ipcMain.on(IPC.openSettings, () => openSettingsWindow())
  ipcMain.on(IPC.closeSettings, () => closeSettingsWindow())

  ipcMain.handle(IPC.getConfig, () => loadConfig())
  ipcMain.handle(IPC.setConfig, (_e, partial: Partial<AppConfig>): SetConfigResult => {
    const previous = loadConfig()
    // inputMonitoringGuideDismissed は main 専用。renderer 未指定時は既存値を保持
    const mergedInput: Partial<AppConfig> = {
      ...partial,
      inputMonitoringGuideDismissed:
        partial.inputMonitoringGuideDismissed ?? previous.inputMonitoringGuideDismissed
    }
    let merged = saveConfig(mergedInput)
    const hotkeyOk = registerHotkey(merged.hotkey)
    // ホットキー登録失敗時は直前の有効キーへ戻す
    const activeHotkey = getActiveHotkey()
    if (!hotkeyOk && activeHotkey && merged.hotkey !== activeHotkey) {
      merged = saveConfig({ hotkey: activeHotkey })
    }
    applyDoubleControl(merged.doubleControl)
    clearInputMonitoringDismissIfResolved(merged.doubleControl)
    if (!previous.doubleControl && merged.doubleControl) {
      void guideInputMonitoringIfNeeded()
    }
    return { config: merged, hotkeyOk }
  })
  ipcMain.handle(IPC.hasApiKey, () => hasApiKey())
  ipcMain.handle(IPC.saveApiKey, (_e, key: string) => {
    saveApiKey(key)
    return true
  })

  ipcMain.handle(IPC.permissionsGetStatus, (_e, doubleControl: boolean) => {
    if (process.platform !== 'darwin') return null
    return getMacPermissionStatus(doubleControl)
  })
  ipcMain.handle(IPC.permissionsOpenPane, (_e, kind: MacPermissionKind) =>
    openMacPrivacyPane(kind)
  )
  ipcMain.handle(IPC.permissionsCopyAppPath, () => copyMacAppBundlePath())
  ipcMain.handle(IPC.permissionsRequestMic, () => ensureMicrophoneAccess())
}
