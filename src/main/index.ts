/** アプリ起動。トレイ常駐 + 非表示ワーカーで動作する。 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, type App, globalShortcut, session as electronSession } from 'electron'
import { hasApiKey, loadConfig } from './store'
import { stopDoubleCtrl } from './global-keys'
import { createWorkerWindow, openSettingsWindow } from './windows'
import { initTray } from './tray'
import { closeSession, getCurrentState, isRecording, toggleRecording } from './recording'
import { applyDoubleControl, registerHotkey } from './hotkeys'
import { registerIpcHandlers } from './ipc-handlers'
import { runMacPermissionOnboarding, startPermissionWatcher } from './permissions'

process.on('uncaughtException', (err) => console.error('[kotodama] uncaughtException:', err))
process.on('unhandledRejection', (reason) => console.error('[kotodama] unhandledRejection:', reason))

app.setName('Kotodama')
applyTagVersion()

/**
 * electron-vite は out/main/index.js を起動するので、getAppPath() は
 * リポジトリ直下にならない。scripts/ が見つかるまで親を辿る。
 */
function versionScriptPath(): string | null {
  let dir = app.getAppPath()
  while (true) {
    const script = join(dir, 'scripts', 'app-version.mjs')
    if (existsSync(script)) return script
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * 開発時だけ、最寄り git タグをアプリ版にする。
 * パッケージ後は .git が無いので、ビルド時に extraMetadata へ埋め込んだ版を使う。
 * Electron 42 の型定義に setVersion が無いが、実行時 API は残っている。
 */
function applyTagVersion(): void {
  if (app.isPackaged) return
  const script = versionScriptPath()
  if (!script) {
    console.error('[kotodama] version from tag failed: scripts/app-version.mjs が見つかりません')
    return
  }
  try {
    const version = execFileSync('node', [script], {
      cwd: dirname(dirname(script)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    if (!/^\d+\.\d+\.\d+$/.test(version)) return
    ;(app as App & { setVersion(version: string): void }).setVersion(version)
  } catch (err) {
    console.error(
      '[kotodama] version from tag failed:',
      err instanceof Error ? err.message : err
    )
  }
}

const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!app.isReady()) return
    openSettingsWindow()
  })

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
    if (app.isPackaged) {
      void runMacPermissionOnboarding()
      startPermissionWatcher(() => applyDoubleControl(loadConfig().doubleControl))
    }
    console.log(
      `[kotodama] ready: tray & worker window initialized. version=${app.getVersion()}, hotkey=${config.hotkey}, apiKey=${hasApiKey() ? 'set' : 'unset'}`
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
}
