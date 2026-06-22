import { ipcMain } from 'electron'
import { AppConfig, IPC, SetConfigResult } from '@shared/ipc'
import { hasApiKey, loadConfig, saveApiKey, saveConfig } from './store'
import { appendAudio, broadcastCurrentState, failSessionWithAudioError } from './recording'
import { applyDoubleControl, getActiveHotkey, registerHotkey } from './hotkeys'
import { closeSettingsWindow, openSettingsWindow } from './windows'

export function registerIpcHandlers(): void {
  ipcMain.on(IPC.audioPcm, (_e, chunk: ArrayBuffer) => appendAudio(chunk))
  ipcMain.on(IPC.audioError, (_e, message: string) => failSessionWithAudioError(message))
  ipcMain.on(IPC.rendererReady, () => broadcastCurrentState())
  ipcMain.on(IPC.openSettings, () => openSettingsWindow())
  ipcMain.on(IPC.closeSettings, () => closeSettingsWindow())

  ipcMain.handle(IPC.getConfig, () => loadConfig())
  ipcMain.handle(IPC.setConfig, (_e, partial: Partial<AppConfig>): SetConfigResult => {
    let merged = saveConfig(partial)
    const hotkeyOk = registerHotkey(merged.hotkey)
    // ホットキー登録失敗時は直前の有効キーへ戻す
    const activeHotkey = getActiveHotkey()
    if (!hotkeyOk && activeHotkey && merged.hotkey !== activeHotkey) {
      merged = saveConfig({ hotkey: activeHotkey })
    }
    applyDoubleControl(merged.doubleControl)
    return { config: merged, hotkeyOk }
  })
  ipcMain.handle(IPC.hasApiKey, () => hasApiKey())
  ipcMain.handle(IPC.saveApiKey, (_e, key: string) => {
    saveApiKey(key)
    return true
  })
}
