import { clipboard } from 'electron'
import { pressWithModifier } from './keyboard'

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

  clipboard.writeText(text)
  // クリップボード反映を待つ
  await new Promise((resolve) => setTimeout(resolve, 60))

  await pressWithModifier('V')
}
