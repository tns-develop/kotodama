import { join } from 'node:path'
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session as electronSession,
  Tray,
  globalShortcut
} from 'electron'
import {
  AppConfig,
  IPC,
  RecordingState,
  RecordingStatePayload
} from '@shared/ipc'
import { hasApiKey, loadApiKey, loadConfig, saveApiKey, saveConfig } from './store'
import { createSttAdapter, SttSession } from './realtime'
import { injectText } from './text-injector'
import { ensureMicrophoneAccess, guideAccessibilityIfNeeded } from './permissions'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']

process.on('uncaughtException', (err) => console.error('[kotodama] uncaughtException:', err))
process.on('unhandledRejection', (reason) => console.error('[kotodama] unhandledRejection:', reason))

let workerWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null

let sttSession: SttSession | null = null
let recording = false
let currentState: RecordingState = 'idle'
let finalizeTimer: ReturnType<typeof setTimeout> | null = null
let appendedBytes = 0 // 診断用: 今回のセッションでサーバーへ送った音声バイト数

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

function createWorkerWindow(): void {
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

function openSettingsWindow(): void {
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

function ensureOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow
  overlayWindow = new BrowserWindow({
    width: 460,
    height: 120,
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

function showOverlay(): void {
  const win = ensureOverlayWindow()
  const { workArea } = screen.getPrimaryDisplay()
  const [w, h] = win.getSize()
  win.setPosition(
    Math.round(workArea.x + (workArea.width - w) / 2),
    Math.round(workArea.y + workArea.height - h - 80)
  )
  win.showInactive()
}

function hideOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of [workerWindow, overlayWindow, settingsWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

function setState(state: RecordingState, message?: string): void {
  currentState = state
  const payload: RecordingStatePayload = { state, message }
  broadcast(IPC.recordingState, payload)
  updateTray()
}

function createTrayIcon(): Electron.NativeImage {
  const size = 18
  const buffer = Buffer.alloc(size * size * 4)
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2
  const radius = size / 2 - 1
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = Math.hypot(x - cx, y - cy) <= radius
      const i = (y * size + x) * 4
      buffer[i] = 0 // R
      buffer[i + 1] = 0 // G
      buffer[i + 2] = 0 // B
      buffer[i + 3] = inside ? 255 : 0 // A
    }
  }
  const image = nativeImage.createFromBitmap(buffer, { width: size, height: size })
  image.setTemplateImage(true)
  return image
}

function updateTray(): void {
  if (!tray) return
  const labels: Record<RecordingState, string> = {
    idle: '待機中',
    connecting: '接続中…',
    recording: '録音中●',
    finalizing: '確定処理中…',
    error: 'エラー'
  }
  tray.setToolTip(`kotodama (${labels[currentState]})`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `状態: ${labels[currentState]}`, enabled: false },
      { type: 'separator' },
      { label: recording ? '録音を停止' : '録音を開始', click: () => void toggleRecording() },
      { label: '設定…', click: () => openSettingsWindow() },
      { type: 'separator' },
      { label: '終了', click: () => app.quit() }
    ])
  )
}

/**
 * 録音セッションの後始末を1か所に集約する。成功・エラー・切断のどの経路からでも
 * 必ずここを通すことで「recording が true のまま固着して復帰不能になる」事故を防ぐ。
 */
function teardownSession(finalState: RecordingState, message?: string): void {
  if (finalizeTimer) {
    clearTimeout(finalizeTimer)
    finalizeTimer = null
  }
  recording = false
  sttSession?.close()
  sttSession = null
  // renderer のマイクを確実に停止（onOpen で開始済みのことがあるため）
  workerWindow?.webContents.send(IPC.recordingToggle, { active: false })
  setState(finalState, message)
  // エラーピルは少し残してから消す。それ以外は即座に隠す。
  if (finalState === 'error') {
    // npm run dev の端末(main プロセス出力)で原因を追えるようにする
    console.error('[kotodama] session error:', message ?? '(詳細不明)')
    setTimeout(() => currentState === 'error' && hideOverlay(), 6000)
  } else {
    hideOverlay()
  }
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
  // 貼り付けに必要な権限の案内（未許可でも録音自体は継続）
  void guideAccessibilityIfNeeded()

  const config = loadConfig()
  recording = true
  appendedBytes = 0
  setState('connecting')
  showOverlay()
  console.log(`[kotodama] connecting: model=${config.model}, lang=${config.language || 'auto'}, delay=${config.delay}`)

  const adapter = createSttAdapter(config.model)
  sttSession = adapter.connect(apiKey, config, {
    onOpen: () => {
      setState('recording')
      workerWindow?.webContents.send(IPC.recordingToggle, { active: true })
    },
    onDelta: (text) => broadcast(IPC.transcriptDelta, text),
    onCompleted: async (text) => {
      broadcast(IPC.transcriptCompleted, text)
      if (text.trim()) {
        try {
          await injectText(text)
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
  // graceful stop。recording を先に false にして onClose の二重後始末を防ぐ。
  recording = false
  setState('finalizing')
  workerWindow?.webContents.send(IPC.recordingToggle, { active: false })

  // 最後の音声チャンクが main に届くのを待ってから commit
  setTimeout(() => {
    // 24kHz mono PCM16 = 48,000 byte/秒。100ms 未満(=4,800 byte 未満)だと commit が弾かれる。
    const ms = Math.round((appendedBytes / 48000) * 1000)
    console.log(`[kotodama] committing: sent ${appendedBytes} bytes (~${ms}ms of audio)`)
    sttSession?.commit()
  }, 250)

  // completed が来ない場合の保険（無音など）
  finalizeTimer = setTimeout(() => teardownSession('idle'), 8000)
}

async function toggleRecording(): Promise<void> {
  if (recording) await stopRecording()
  else await startRecording()
}

function registerHotkey(accelerator: string): void {
  globalShortcut.unregisterAll()
  try {
    const ok = globalShortcut.register(accelerator, () => void toggleRecording())
    if (!ok) console.error(`ホットキーの登録に失敗しました: ${accelerator}`)
  } catch (err) {
    console.error('ホットキー登録エラー:', err)
  }
}

function registerIpcHandlers(): void {
  ipcMain.on(IPC.audioPcm, (_e, chunk: ArrayBuffer) => {
    if (sttSession) {
      appendedBytes += chunk.byteLength
      sttSession.appendAudio(chunk)
    }
  })
  ipcMain.on(IPC.audioError, (_e, message: string) => {
    // renderer の getUserMedia / AudioWorklet 失敗を可視化する（従来は renderer console に埋もれていた）
    teardownSession('error', `マイク/音声の初期化に失敗: ${message}`)
  })
  ipcMain.on(IPC.rendererReady, () => {
    broadcast(IPC.recordingState, { state: currentState } satisfies RecordingStatePayload)
  })
  ipcMain.on(IPC.openSettings, () => openSettingsWindow())

  ipcMain.handle(IPC.getConfig, () => loadConfig())
  ipcMain.handle(IPC.setConfig, (_e, partial: Partial<AppConfig>) => {
    const merged = saveConfig(partial)
    registerHotkey(merged.hotkey)
    return merged
  })
  ipcMain.handle(IPC.hasApiKey, () => hasApiKey())
  ipcMain.handle(IPC.saveApiKey, (_e, key: string) => {
    saveApiKey(key)
    return true
  })
}

app.whenReady().then(() => {
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })

  if (process.platform === 'darwin') app.dock?.hide()

  createWorkerWindow()

  tray = new Tray(createTrayIcon())
  updateTray()

  registerIpcHandlers()
  const config = loadConfig()
  registerHotkey(config.hotkey)
  console.log(
    `[kotodama] ready: tray & worker window initialized. hotkey=${config.hotkey}, apiKey=${hasApiKey() ? 'set' : 'unset'}`
  )
})

app.on('window-all-closed', () => {
  // トレイ常駐アプリのため、ウィンドウが閉じても終了しない
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  sttSession?.close()
})
