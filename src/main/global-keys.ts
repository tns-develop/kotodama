/**
 * 修飾キー操作を検知してコールバックを呼ぶ（Windows=Alt+Ctrl 同時押し1回、それ以外=Control ダブルタップ）。
 * - idle: 録音開始用（Windows=Alt+Ctrl 1回 / 他 OS=Control ダブルタップ）
 * - stop: 録音中の終了用（Windows=Alt+Ctrl 1回 / 他 OS=Control 1回）
 *
 * Electron の globalShortcut は単独修飾キーを登録できないため、ネイティブの
 * グローバルキーフック(uiohook-napi)で代替する。macOS では「入力監視」権限が必要。
 * ネイティブモジュールのロード/起動失敗でアプリ全体を巻き込まないよう、全て try/catch でガードする。
 */

const DOUBLE_TAP_WINDOW_MS = 400
const IS_WIN = process.platform === 'win32'

// uiohook-napi のキーコード
const ALT_KEYCODES = new Set([56, 3640])
const CTRL_KEYCODES = new Set([29, 3613])

export type CtrlKeyMode = 'idle' | 'stop'

type HookEvent = 'keydown' | 'keyup'
type Uiohook = {
  on(event: HookEvent, cb: (e: { keycode: number }) => void): void
  removeAllListeners(event?: HookEvent): void
  start(): void
  stop(): void
}

let hook: Uiohook | null = null
let running = false
let uiohookLoadFailed = false
let mode: CtrlKeyMode = 'idle'
let lastTapAt = 0
let trigger: () => void = () => {}

// Windows: Alt+Ctrl コード用状態
let altDown = false
let ctrlDown = false
let chordEngaged = false

function loadHook(): Uiohook | null {
  if (hook) return hook
  if (uiohookLoadFailed) return null
  try {
    // 遅延 require。未対応環境でも import 時点でクラッシュさせない。
    const mod = require('uiohook-napi') as { uIOhook: Uiohook }
    hook = mod.uIOhook
    return hook
  } catch (err) {
    uiohookLoadFailed = true
    console.error('[kotodama] uiohook load failed:', err instanceof Error ? err.message : err)
    return null
  }
}

function resetWinChordState(): void {
  altDown = false
  ctrlDown = false
  chordEngaged = false
}

function onWinKeydown(e: { keycode: number }): void {
  if (ALT_KEYCODES.has(e.keycode)) altDown = true
  if (CTRL_KEYCODES.has(e.keycode)) ctrlDown = true
  if (altDown && ctrlDown) chordEngaged = true
}

function onWinKeyup(e: { keycode: number }): void {
  if (ALT_KEYCODES.has(e.keycode)) altDown = false
  if (CTRL_KEYCODES.has(e.keycode)) ctrlDown = false
  if (!altDown && !ctrlDown && chordEngaged) {
    chordEngaged = false
    trigger()
  } else if (!altDown && !ctrlDown) {
    chordEngaged = false
  }
}

function onMacKeyup(e: { keycode: number }): void {
  if (!CTRL_KEYCODES.has(e.keycode)) return
  if (mode === 'stop') {
    trigger()
    return
  }
  const now = Date.now()
  if (now - lastTapAt < DOUBLE_TAP_WINDOW_MS) {
    lastTapAt = 0
    trigger()
  } else {
    lastTapAt = now
  }
}

function removeHookListeners(h: Uiohook): void {
  try {
    if (IS_WIN) {
      h.removeAllListeners('keydown')
      h.removeAllListeners('keyup')
    } else {
      h.removeAllListeners('keyup')
    }
  } catch {
    /* noop */
  }
}

/** 修飾キー検知モードを切り替える。 */
export function setCtrlKeyMode(next: CtrlKeyMode): void {
  mode = next
  if (!IS_WIN) lastTapAt = 0
  if (IS_WIN) resetWinChordState()
}

/** uiohook が稼働中か。 */
export function isDoubleCtrlRunning(): boolean {
  return running
}

/** uiohook の load/start に失敗したか。 */
export function wasUiohookLoadFailed(): boolean {
  return uiohookLoadFailed
}

/** 修飾キー検知を開始する。多重起動は無視。 */
export function startDoubleCtrl(cb: () => void): void {
  trigger = cb
  if (running) return
  const h = loadHook()
  if (!h) return
  try {
    if (IS_WIN) {
      h.on('keydown', onWinKeydown)
      h.on('keyup', onWinKeyup)
    } else {
      h.on('keyup', onMacKeyup)
    }
    h.start()
    running = true
  } catch (err) {
    uiohookLoadFailed = true
    // start 失敗時にリスナーが残ると次回起動で二重登録→二重発火するため除去する
    removeHookListeners(h)
    console.error('[kotodama] uiohook start failed:', err instanceof Error ? err.message : err)
  }
}

/** 修飾キー検知を停止する。 */
export function stopDoubleCtrl(): void {
  if (!running || !hook) return
  try {
    removeHookListeners(hook)
    hook.stop()
  } catch (err) {
    console.error('[kotodama] uiohook stop failed:', err instanceof Error ? err.message : err)
  }
  running = false
  mode = 'idle'
  lastTapAt = 0
  if (IS_WIN) resetWinChordState()
}
