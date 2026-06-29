import { globalShortcut } from 'electron'
import { startDoubleCtrl, stopDoubleCtrl } from './global-keys'
import { onCtrlKey, toggleRecording } from './recording'

/** ホットキー管理。登録失敗時は直前の有効キーへ自動復帰する。 */
let activeHotkey = ''

export function registerHotkey(accelerator: string): boolean {
  globalShortcut.unregisterAll()
  const trimmed = accelerator.trim()
  if (!trimmed) {
    activeHotkey = ''
    return true
  }
  try {
    const ok = globalShortcut.register(trimmed, () => void toggleRecording())
    if (ok) {
      activeHotkey = trimmed
      return true
    }
    console.error(`ホットキーの登録に失敗しました: ${trimmed}`)
  } catch (err) {
    console.error('ホットキー登録エラー:', err)
  }
  // 失敗時は直前のキーへ復帰し、無反応状態を避ける
  if (activeHotkey && activeHotkey !== trimmed) {
    try {
      globalShortcut.register(activeHotkey, () => void toggleRecording())
    } catch {
      /* noop */
    }
  }
  return false
}

export function getActiveHotkey(): string {
  return activeHotkey
}

export function applyDoubleControl(enabled: boolean): void {
  if (enabled) startDoubleCtrl(onCtrlKey)
  else stopDoubleCtrl()
}
