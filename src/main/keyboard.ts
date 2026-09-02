/**
 * nut.js によるキー送出。貼り付け（text-injector）と選択コピー（selection）で共用する。
 *
 * macOS では「アクセシビリティ権限」が無いと送出が無反応になる(ハマり所No.1)。
 */

/** Cmd(macOS) / Ctrl(その他) と組み合わせてキーを押して離す。 */
export async function pressWithModifier(key: 'C' | 'V'): Promise<void> {
  // nut.js はネイティブモジュールのため動的 import（rebuild 前でもアプリ起動は可能にする）
  const { keyboard, Key } = await import('@nut-tree-fork/nut-js')
  keyboard.config.autoDelayMs = 0

  const modifier = process.platform === 'darwin' ? Key.LeftCmd : Key.LeftControl
  await keyboard.pressKey(modifier, Key[key])
  await keyboard.releaseKey(modifier, Key[key])
}
