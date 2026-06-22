/**
 * ウィンドウ管理モジュール。worker / settings / overlay の生成・表示・IPC送信を担う。
 */
import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { IPC, ToggleRecordingPayload } from '@shared/ipc'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

let workerWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

function loadRenderer(win: BrowserWindow, hash = ''): void {
  if (RENDERER_DEV_URL) {
    void win.loadURL(hash ? `${RENDERER_DEV_URL}#${hash}` : RENDERER_DEV_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), hash ? { hash } : undefined)
  }
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

export function createWorkerWindow(): void {
  workerWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true
    }
  })
  loadRenderer(workerWindow)
}

export function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 460,
    resizable: false,
    title: 'kotodama 設定',
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true
    }
  })
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  loadRenderer(settingsWindow, 'settings')
}

export function closeSettingsWindow(): void {
  settingsWindow?.close()
}

function ensureOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow
  overlayWindow = new BrowserWindow({
    width: 460,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath(),
      sandbox: false,
      contextIsolation: true
    }
  })
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.setIgnoreMouseEvents(true)
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
  loadRenderer(overlayWindow, 'overlay')
  return overlayWindow
}

export function showOverlay(): void {
  const win = ensureOverlayWindow()
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const [w, h] = win.getSize()
  // カーソル近傍に配置（カーソルを隠さないようオフセット）。開始時のみ配置。
  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(value, max))
  const x = clamp(cursor.x + 16, workArea.x, workArea.x + workArea.width - w)
  const y = clamp(cursor.y + 20, workArea.y, workArea.y + workArea.height - h)
  win.setPosition(Math.round(x), Math.round(y))
  win.showInactive()
}

export function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
}

/** 全ウィンドウへ同一チャンネルで送信する。 */
export function broadcast(channel: string, payload?: unknown): void {
  for (const win of [workerWindow, overlayWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

/** worker へ録音トグルを送る。 */
export function sendToggle(active: boolean): void {
  const payload: ToggleRecordingPayload = { active }
  workerWindow?.webContents.send(IPC.recordingToggle, payload)
}
