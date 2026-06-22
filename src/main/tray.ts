import { join } from 'node:path'
import { app, Menu, nativeImage, Tray } from 'electron'
import { RecordingState } from '@shared/ipc'

let tray: Tray | null = null

export interface TrayHandlers {
  toggleRecording: () => void
  openSettings: () => void
  quit: () => void
}

let handlers: TrayHandlers | null = null

// Overlay 側とは表記が異なるため別定義
const STATE_LABELS: Record<RecordingState, string> = {
  idle: '待機中',
  connecting: '接続中…',
  recording: '録音中●',
  finalizing: '確定処理中…',
  error: 'エラー'
}

/**
 * アイコン生成。resources/trayTemplate.png があればそれを使い、
 * 無ければ黒丸を実行時生成する。
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

/** フォールバック: 18×18 の黒丸を RGBA バッファで生成。 */
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

/** トレイを生成し、メニューのクリック動作を注入する。 */
export function initTray(trayHandlers: TrayHandlers, state: RecordingState, recording: boolean): void {
  handlers = trayHandlers
  tray = new Tray(createTrayIcon())
  updateTray(state, recording)
}

export function updateTray(state: RecordingState, recording: boolean): void {
  if (!tray || !handlers) return
  tray.setToolTip(`Kotodama (${STATE_LABELS[state]})`)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `状態: ${STATE_LABELS[state]}`, enabled: false },
      { type: 'separator' },
      { label: recording ? '録音を停止' : '録音を開始', click: () => handlers?.toggleRecording() },
      { label: '設定…', click: () => handlers?.openSettings() },
      { type: 'separator' },
      { label: '終了', click: () => handlers?.quit() }
    ])
  )
}
