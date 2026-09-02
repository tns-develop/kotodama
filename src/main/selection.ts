/**
 * フォーカス中アプリの「選択テキスト」を取得する。
 *
 * 方式: Cmd/Ctrl+C を送ってクリップボードに入った内容を読む。Cmd+C は選択状態を
 * 変えないため、この後に編集結果を貼り付けると選択範囲がそのまま置き換わる。
 * アクセシビリティ権限が無くキー送出が無反応な場合も、単に「選択なし」として
 * 通常の音声入力へフォールバックする。
 */
import { clipboard } from 'electron'
import { pressWithModifier } from './keyboard'

/** これを超える選択は編集対象にせず通常の音声入力へフォールバックする */
const MAX_EDIT_SELECTION_LENGTH = 6000
/** キー送出からクリップボードへ反映されるまでの待ち時間 */
const CLIPBOARD_SETTLE_MS = 100

/**
 * 選択テキストがあればコピーして返す。無い/長すぎる/失敗した場合は null を返し、
 * クリップボードは呼び出し前の内容へ戻す（検出用コピーの副作用を残さない）。
 */
export async function captureSelectionIfAny(): Promise<string | null> {
  const before = clipboard.readText()
  try {
    // 「コピー前後の差分」で判定すると、選択内容が偶然クリップボードと同一だった場合に
    // 選択なしと誤判定する。クリアしてから「何か入ったか」で判定する。
    clipboard.clear()

    await pressWithModifier('C')
    await new Promise((resolve) => setTimeout(resolve, CLIPBOARD_SETTLE_MS))

    const after = clipboard.readText()
    if (after && after.length <= MAX_EDIT_SELECTION_LENGTH) return after
  } catch (err) {
    console.error('[kotodama] selection capture failed:', err instanceof Error ? err.message : err)
  }
  // 選択なし / 上限超え / 失敗はすべてここを通り、元のクリップボードへ復元する
  clipboard.writeText(before)
  return null
}
