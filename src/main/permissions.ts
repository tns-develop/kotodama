import { app, clipboard, dialog, shell, systemPreferences } from 'electron'
import { resolve } from 'node:path'
import {
  MacPermissionKind,
  MacPermissionState,
  MacPermissionStatus
} from '@shared/ipc'
import { isDoubleCtrlRunning, wasUiohookLoadFailed } from './global-keys'
import { loadConfig, saveConfig } from './store'

const PRIVACY_QUERY: Record<MacPermissionKind, string> = {
  inputMonitoring: 'Privacy_ListenEvent',
  accessibility: 'Privacy_Accessibility',
  microphone: 'Privacy_Microphone'
}

let inputMonitoringGuideShownThisSession = false

function micState(): MacPermissionState {
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') return 'granted'
  if (status === 'denied') return 'denied'
  if (status === 'not-determined') return 'notDetermined'
  return 'unknown'
}

function accessibilityState(): MacPermissionState {
  return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'needsSetup'
}

function inputMonitoringState(doubleControlEnabled: boolean): MacPermissionState {
  if (!doubleControlEnabled) return 'notApplicable'
  if (wasUiohookLoadFailed()) return 'failed'
  if (isDoubleCtrlRunning()) return 'likelyOk'
  return 'needsSetup'
}

/** 配布 .app の絶対パス。開発時は空文字。 */
export function getMacAppBundlePath(): string {
  if (process.platform !== 'darwin' || !app.isPackaged) return ''
  return resolve(app.getPath('exe'), '../../..')
}

/** .app パスをクリップボードへ。成功時 true。 */
export function copyMacAppBundlePath(): boolean {
  const path = getMacAppBundlePath()
  if (!path) return false
  clipboard.writeText(path)
  return true
}

/** プライバシー設定ペインを開く（macOS 13+ は System Settings URL、それ以前はレガシー URL）。 */
export async function openMacPrivacyPane(kind: MacPermissionKind): Promise<void> {
  if (process.platform !== 'darwin') return
  const query = PRIVACY_QUERY[kind]
  const major = parseInt(process.getSystemVersion().split('.')[0] ?? '0', 10)
  const url =
    major >= 13
      ? `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?${query}`
      : `x-apple.systempreferences:com.apple.preference.security?${query}`
  await shell.openExternal(url)
}

export function getMacPermissionStatus(doubleControlEnabled: boolean): MacPermissionStatus {
  return {
    microphone: micState(),
    accessibility: accessibilityState(),
    inputMonitoring: inputMonitoringState(doubleControlEnabled),
    appBundlePath: getMacAppBundlePath(),
    isPackaged: app.isPackaged
  }
}

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
  return systemPreferences.isTrustedAccessibilityClient(promptIfNeeded)
}

export async function guideAccessibilityIfNeeded(): Promise<void> {
  if (process.platform !== 'darwin') return
  if (systemPreferences.isTrustedAccessibilityClient(false)) return

  const appName = app.getName()
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['システム設定を開く', '後で'],
    defaultId: 0,
    cancelId: 1,
    title: 'アクセシビリティ権限が必要です',
    message: 'カーソル位置への貼り付けにはアクセシビリティ権限が必要です。',
    detail:
      app.isPackaged
        ? `「システム設定 > プライバシーとセキュリティ > アクセシビリティ」で ${appName} を許可してください。`
        : `「システム設定 > プライバシーとセキュリティ > アクセシビリティ」で ${appName}（開発中は Electron / ターミナル）を許可してください。`
  })
  if (response === 0) {
    await openMacPrivacyPane('accessibility')
  }
}

/** 入力監視権限の設定案内。doubleControl ON かつ未設定時のみ。 */
export async function guideInputMonitoringIfNeeded(): Promise<void> {
  if (process.platform !== 'darwin') return

  const config = loadConfig()
  if (!config.doubleControl) return
  if (config.inputMonitoringGuideDismissed) return
  if (inputMonitoringGuideShownThisSession) return

  const { inputMonitoring } = getMacPermissionStatus(true)
  if (inputMonitoring !== 'needsSetup' && inputMonitoring !== 'failed') return

  inputMonitoringGuideShownThisSession = true

  const appName = app.getName()
  const bundlePath = getMacAppBundlePath()
  const pathHint = bundlePath
    ? `\n\nアプリの場所:\n${bundlePath}`
    : '\n\n（開発中は Electron 本体を許可するか、配布ビルドで Kotodama.app を追加してください）'

  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['システム設定を開く', 'アプリの場所をコピー', '後で'],
    defaultId: 0,
    cancelId: 2,
    title: '入力監視の設定が必要です',
    message: `Control ダブルタップの録音開始には「入力監視」権限が必要です。`,
    detail:
      `① システム設定 > プライバシーとセキュリティ > 入力監視を開く\n` +
      `② 一覧に ${appName} が無い場合は「＋」を押し、.app を選択して追加\n` +
      `③ 追加後、${appName} のトグルを ON にする` +
      pathHint
  })

  if (response === 0) {
    await openMacPrivacyPane('inputMonitoring')
  } else if (response === 1) {
    if (!copyMacAppBundlePath()) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'コピーできません',
        message: '配布ビルド（.app）でのみパスをコピーできます。',
        detail: '開発中はシステム設定で Electron を許可してください。'
      })
    }
  } else {
    saveConfig({ inputMonitoringGuideDismissed: true })
  }
}

/** 入力監視が likelyOk になったら、または failed が解消されたら dismiss フラグをリセットする。 */
export function clearInputMonitoringDismissIfResolved(doubleControlEnabled: boolean): void {
  const config = loadConfig()
  if (!config.inputMonitoringGuideDismissed) return
  const { inputMonitoring } = getMacPermissionStatus(doubleControlEnabled)
  if (inputMonitoring === 'likelyOk' || inputMonitoring === 'notApplicable') {
    saveConfig({ inputMonitoringGuideDismissed: false })
  }
}
