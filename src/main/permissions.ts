import { dialog, shell, systemPreferences } from 'electron'

/**
 * マイク権限を要求する。macOS では初回にダイアログが出る。
 * Info.plist の NSMicrophoneUsageDescription が無いとクラッシュ/無音になる。
 */
export async function ensureMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') return true
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return true
  try {
    return await systemPreferences.askForMediaAccess('microphone')
  } catch {
    return false
  }
}

/**
 * アクセシビリティ権限を確認する。未許可だとキー送出(=貼り付け)が無反応になる
 * ため、ユーザーをシステム設定へ案内する。
 */
export function ensureAccessibilityAccess(promptIfNeeded = true): boolean {
  if (process.platform !== 'darwin') return true
  const trusted = systemPreferences.isTrustedAccessibilityClient(promptIfNeeded)
  return trusted
}

export async function guideAccessibilityIfNeeded(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (systemPreferences.isTrustedAccessibilityClient(false)) return

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['システム設定を開く', '後で'],
    defaultId: 0,
    cancelId: 1,
    title: 'アクセシビリティ権限が必要です',
    message: 'カーソル位置への貼り付けにはアクセシビリティ権限が必要です。',
    detail:
      '「システム設定 > プライバシーとセキュリティ > アクセシビリティ」で kotodama（開発中は Electron / ターミナル）を許可してください。'
  })
  if (response === 0) {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
    )
  }
}
