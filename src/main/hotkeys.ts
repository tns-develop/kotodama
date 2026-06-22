import { globalShortcut } from 'electron'
import { startDoubleCtrl, stopDoubleCtrl } from './global-keys'
import { onCtrlKey, toggleRecording } from './recording'

/** ホットキー管理。登録失敗時は直前の有効キーへ自動復帰する。 */
let activeHotkey = ''

export function registerHotkey(accelerator: string): boolean {
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
  // 失敗時は直前のキーへ復帰し、無反応状態を避ける
  if (activeHotkey && activeHotkey !== accelerator) {
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
