/** アプリ起動。トレイ常駐 + 非表示ワーカーで動作する。 */
import { app, globalShortcut, session as electronSession } from 'electron'
import { hasApiKey, loadConfig } from './store'
import { stopDoubleCtrl } from './global-keys'
import { createWorkerWindow, openSettingsWindow } from './windows'
import { initTray } from './tray'
import { closeSession, getCurrentState, isRecording, toggleRecording } from './recording'
import { applyDoubleControl, registerHotkey } from './hotkeys'
import { registerIpcHandlers } from './ipc-handlers'

process.on('uncaughtException', (err) => console.error('[kotodama] uncaughtException:', err))
process.on('unhandledRejection', (reason) => console.error('[kotodama] unhandledRejection:', reason))

app.whenReady().then(() => {
  // マイクのみ許可
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  if (process.platform === 'darwin') app.dock?.hide()

  createWorkerWindow()

  initTray(
    {
      toggleRecording: () => void toggleRecording(),
      openSettings: () => openSettingsWindow(),
      quit: () => app.quit()
    },
    getCurrentState(),
    isRecording()
  )

  registerIpcHandlers()
  const config = loadConfig()
  registerHotkey(config.hotkey)
  applyDoubleControl(config.doubleControl)
  console.log(
    `[kotodama] ready: tray & worker window initialized. hotkey=${config.hotkey}, apiKey=${hasApiKey() ? 'set' : 'unset'}`
  )
})

app.on('window-all-closed', () => {
  // トレイ常駐アプリのため、ウィンドウが閉じても終了しない
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopDoubleCtrl()
  closeSession()
})
