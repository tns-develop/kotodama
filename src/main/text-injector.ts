import { clipboard } from 'electron'

/**
 * 確定テキストを「現在フォーカス中のアプリのカーソル位置」へ挿入する。
 *
 * 方式: クリップボードにコピー → ネイティブのキーシミュレーションで Cmd/Ctrl+V。
 * 直接タイピング(keyboard.type)は日本語IMEや対象アプリで取りこぼし・文字化けが
 * 起きやすいため、ペースト方式を採用する。
 * 貼り付け後もクリップボードに聞き取りテキストが残る（再貼り付け可能）。
 *
 * macOS では「アクセシビリティ権限」が無いとキー送出が無反応になる(ハマり所No.1)。
 */
export async function injectText(text: string): Promise<void> {
  if (!text) return

  // nut.js はネイティブモジュールのため動的 import（rebuild 前でもアプリ起動は可能にする）
  const { keyboard, Key } = await import('@nut-tree-fork/nut-js')
  keyboard.config.autoDelayMs = 0

  clipboard.writeText(text)
  // クリップボード反映を待つ
  await delay(60)

  const modifier = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl
  await keyboard.pressKey(modifier, Key.V)
  await keyboard.releaseKey(modifier, Key.V)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
