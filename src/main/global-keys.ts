/**
 * 修飾キー操作を検知してコールバックを呼ぶ（Windows=Alt、それ以外=Control）。
 * - idle: ダブルタップ（短時間に2回押し）で発火 — 録音開始用
 * - stop: 単押しで発火 — 録音中の終了用
 *
 * Electron の globalShortcut は単独修飾キーを登録できないため、ネイティブの
 * グローバルキーフック(uiohook-napi)で代替する。macOS では「入力監視」権限が必要。
 * ネイティブモジュールのロード/起動失敗でアプリ全体を巻き込まないよう、全て try/catch でガードする。
 */

const DOUBLE_TAP_WINDOW_MS = 400
// uiohook-napi のキーコード（左右の Control / Alt）
const CTRL_KEYCODES = new Set([29, 3613])
const ALT_KEYCODES = new Set([56, 3640])
const TARGET_KEYCODES = process.platform === 'win32' ? ALT_KEYCODES : CTRL_KEYCODES

export type CtrlKeyMode = 'idle' | 'stop'

type Uiohook = {
  on(event: 'keyup', cb: (e: { keycode: number }) => void): void
  removeAllListeners(event: 'keyup'): void
  start(): void
  stop(): void
}

let hook: Uiohook | null = null
let running = false
let uiohookLoadFailed = false
let mode: CtrlKeyMode = 'idle'
let lastTapAt = 0
let trigger: () => void = () => {}

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

function onKeyup(e: { keycode: number }): void {
  if (!TARGET_KEYCODES.has(e.keycode)) return
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

/** 修飾キー検知モードを切り替える。 */
export function setCtrlKeyMode(next: CtrlKeyMode): void {
  mode = next
  lastTapAt = 0
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
    h.on('keyup', onKeyup)
    h.start()
    running = true
  } catch (err) {
    uiohookLoadFailed = true
    // start 失敗時にリスナーが残ると次回起動で二重登録→二重発火するため除去する
    try {
      h.removeAllListeners('keyup')
    } catch {
      /* noop */
    }
    console.error('[kotodama] uiohook start failed:', err instanceof Error ? err.message : err)
  }
}

/** 修飾キー検知を停止する。 */
export function stopDoubleCtrl(): void {
  if (!running || !hook) return
  try {
    hook.removeAllListeners('keyup')
    hook.stop()
  } catch (err) {
    console.error('[kotodama] uiohook stop failed:', err instanceof Error ? err.message : err)
  }
  running = false
  mode = 'idle'
  lastTapAt = 0
}
