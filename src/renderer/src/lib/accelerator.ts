const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift'])

type KeyLike = Pick<
  KeyboardEvent,
  'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'
>

/** KeyboardEvent.code を Electron accelerator のキー部分へ変換。未対応なら null。 */
export function codeToAcceleratorKey(code: string): string | null {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (/^F\d+$/.test(code)) return code
  const named: Record<string, string> = {
    Space: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Enter: 'Enter',
    Return: 'Return',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Escape: 'Escape',
    Tab: 'Tab',
    CapsLock: 'Capslock',
    NumLock: 'Numlock',
    ScrollLock: 'Scrolllock',
    PrintScreen: 'PrintScreen',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backquote: '`'
  }
  return named[code] ?? null
}

/** keydown を Electron accelerator 文字列へ変換する。修飾キー単独なら null。 */
export function eventToAccelerator(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null
  if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) return null
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  const fromCode = e.code ? codeToAcceleratorKey(e.code) : null
  let key = fromCode ?? e.key
  if (key === ' ') key = 'Space'
  else if (/^[a-z]$/.test(key)) key = key.toUpperCase()
  else if (key.length === 1 && !fromCode) key = key.toUpperCase()

  // Windows で Ctrl 押下時 e.key が制御文字になる場合、code 変換も失敗なら無視
  if (!fromCode && key.length === 1 && key.charCodeAt(0) < 32) return null

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
