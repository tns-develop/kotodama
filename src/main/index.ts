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
  RecordingStatePayload,
  SetConfigResult
} from '@shared/ipc'
import { hasApiKey, loadApiKey, loadConfig, saveApiKey, saveConfig } from './store'
import { createSttAdapter, SttSession } from './realtime'
import { injectText } from './text-injector'
import { postProcess } from './post-process'
import { setCtrlKeyMode, startDoubleCtrl, stopDoubleCtrl } from './global-keys'
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

function showOverlay(): void {
  const win = ensureOverlayWindow()
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const [w, h] = win.getSize()
  // カーソルの少し下・やや右にピルを置く（カーソル自体を隠さないため）。
  // 録音開始時のみ配置し、録音中の常時追従はしない。
  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(value, max))
  const x = clamp(cursor.x + 16, workArea.x, workArea.x + workArea.width - w)
  const y = clamp(cursor.y + 20, workArea.y, workArea.y + workArea.height - h)
  win.setPosition(Math.round(x), Math.round(y))
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

/**
 * トレイアイコン。`resources/trayTemplate.png`（+ @2x）があればそれを使い、
 * 無ければ従来の黒丸を実行時生成する。差し替え手順・仕様は README 参照。
 */
function createTrayIcon(): Electron.NativeImage {
  const base = app.isPackaged ? process.resourcesPath : app.getAppPath()
  const fromFile = nativeImage.createFromPath(join(base, 'resources', 'trayTemplate.png'))
  if (!fromFile.isEmpty()) {
    fromFile.setTemplateImage(true)
    return fromFile
  }
  return createFallbackTrayIcon()
}

function createFallbackTrayIcon(): Electron.NativeImage {
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
  // 録音中だけ一時登録していた Escape を必ず解除する（成功・エラー・切断のどの経路でも通る）
  globalShortcut.unregister('Escape')
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
  // 貼り付けに必要な権限の案内（未許可でも録音自体は継続）
  void guideAccessibilityIfNeeded()

  const config = loadConfig()
  recording = true
  setCtrlKeyMode('stop')
  appendedBytes = 0
  // 録音中だけ Escape をグローバル登録し、コミットせず中断できるようにする（best-effort）
  globalShortcut.register('Escape', () => cancelRecording())
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

/** 録音中の中断。commit を呼ばないため文字起こし結果は貼り付けられない。 */
function cancelRecording(): void {
  if (!recording) return
  teardownSession('idle')
}

/** 現在有効に登録できているホットキー。登録失敗時の復帰先に使う。 */
let activeHotkey = ''

function registerHotkey(accelerator: string): boolean {
  globalShortcut.unregisterAll()
  try {
    const ok = globalShortcut.register(accelerator, () => void toggleRecording())
    if (ok) {
      activeHotkey = accelerator
      return true
    }
    console.error(`ホットキーの登録に失敗しました: ${accelerator}`)
  } catch (err) {
    console.error('ホットキー登録エラー:', err)
  }
  // 失敗時は直前の有効ホットキーへ復帰させ、無反応状態を避ける
  if (activeHotkey && activeHotkey !== accelerator) {
    try {
      globalShortcut.register(activeHotkey, () => void toggleRecording())
    } catch {
      /* noop */
    }
  }
  return false
}

/** Control キー用。toggleRecording は finalizing 中も start するため使わない。 */
function onCtrlKey(): void {
  if (recording) void stopRecording()
  else if (currentState !== 'finalizing') void startRecording()
}

function applyDoubleControl(enabled: boolean): void {
  if (enabled) startDoubleCtrl(onCtrlKey)
  else stopDoubleCtrl()
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
  ipcMain.on(IPC.closeSettings, () => settingsWindow?.close())

  ipcMain.handle(IPC.getConfig, () => loadConfig())
  ipcMain.handle(IPC.setConfig, (_e, partial: Partial<AppConfig>): SetConfigResult => {
    let merged = saveConfig(partial)
    const hotkeyOk = registerHotkey(merged.hotkey)
    // 登録に失敗したら直前の有効ホットキーへ戻して保存し直す
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
  sttSession?.close()
})
