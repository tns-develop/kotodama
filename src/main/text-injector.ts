import { clipboard } from 'electron'

/**
 * 確定テキストを「現在フォーカス中のアプリのカーソル位置」へ挿入する。
 *
 * 方式: クリップボードにコピー → ネイティブのキーシミュレーションで Cmd/Ctrl+V。
 * 直接タイピング(keyboard.type)は日本語IMEや対象アプリで取りこぼし・文字化けが
 * 起きやすいため、ペースト方式を採用する。
 *
 * macOS では「アクセシビリティ権限」が無いとキー送出が無反応になる(ハマり所No.1)。
 */
export async function injectText(text: string): Promise<void> {
  if (!text) return

  // nut.js はネイティブモジュールのため動的 import（rebuild 前でもアプリ起動は可能にする）
  const { keyboard, Key } = await import('@nut-tree-fork/nut-js')
  keyboard.config.autoDelayMs = 0

  const previous = clipboard.readText()
  clipboard.writeText(text)
  // クリップボード反映を待つ
  await delay(60)

  const modifier = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl
  await keyboard.pressKey(modifier, Key.V)
  await keyboard.releaseKey(modifier, Key.V)

  // 貼り付け完了を待ってから元のクリップボードへ復帰
  await delay(120)
  if (previous) clipboard.writeText(previous)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
