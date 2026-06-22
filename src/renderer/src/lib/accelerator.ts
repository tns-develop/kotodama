const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/** keydown を Electron accelerator 文字列へ変換する。修飾キー単独なら null。 */
export function eventToAccelerator(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  let key = e.key
  if (key === ' ') key = 'Space'
  else if (/^[a-z]$/.test(key)) key = key.toUpperCase()
  else if (key.length === 1) key = key.toUpperCase()
  // F1〜F24 や矢印キーなどは e.key の表記をそのまま使う

  parts.push(key)
  return parts.join('+')
}

/** 修飾キー＋通常キーの最小条件を満たすかの簡易バリデーション。 */
export function isValidAccelerator(accel: string): boolean {
  const tokens = accel.split('+').filter(Boolean)
  if (tokens.length < 2) return false
  const modifiers = new Set([
    'Command',
    'Cmd',
    'Control',
    'Ctrl',
    'CommandOrControl',
    'CmdOrCtrl',
    'Alt',
    'Option',
    'AltGr',
    'Shift',
    'Super',
    'Meta'
  ])
  const hasModifier = tokens.some((t) => modifiers.has(t))
  const hasKey = tokens.some((t) => !modifiers.has(t))
  return hasModifier && hasKey
}

export function keySavedPlaceholder(saved: boolean): string {
  return saved ? '••••••••（変更する場合のみ入力）' : 'sk-...'
}
