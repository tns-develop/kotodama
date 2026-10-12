import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { app, dialog, shell, systemPreferences } from 'electron'
import { MacPermissionKind, MacPermissionState, MacPermissionStatus } from '@shared/ipc'
import { isDoubleCtrlRunning, wasUiohookLoadFailed, wasUiohookStartFailed } from './global-keys'
import { loadConfig } from './store'

const execFileAsync = promisify(execFile)

const PRIVACY_QUERY: Record<MacPermissionKind, string> = {
  accessibility: 'Privacy_Accessibility',
  microphone: 'Privacy_Microphone'
}

/** electron-builder.yml の appId。許可のリセット対象 */
const BUNDLE_ID = 'com.example.kotodama'
const TCC_SERVICES = ['Accessibility', 'Microphone', 'ListenEvent'] as const

let onboardingDismissedThisSession = false
let onboardingRunning = false
let restartRequired = false
let relaunchPromptShown = false
let watcher: ReturnType<typeof setInterval> | null = null

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

export function getMacPermissionStatus(): MacPermissionStatus {
  return {
    microphone: micState(),
    accessibility: accessibilityState(),
    restartRequired,
    isPackaged: app.isPackaged
  }
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

function stopWatcher(): void {
  if (!watcher) return
  clearInterval(watcher)
  watcher = null
}

/** 許可後もフックが起動しなければ、再起動しないと反映されない。 */
export function reportHookState(): void {
  if (process.platform !== 'darwin') return
  const needsHook = loadConfig().doubleControl
  if (!needsHook || isDoubleCtrlRunning() || wasUiohookLoadFailed()) {
    restartRequired = false
    return
  }
  if (accessibilityState() === 'granted' && wasUiohookStartFailed()) {
    restartRequired = true
    void promptRelaunchOnce()
  }
}

async function promptRelaunchOnce(): Promise<void> {
  if (relaunchPromptShown) return
  relaunchPromptShown = true
  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['再起動', '後で'],
    defaultId: 0,
    cancelId: 1,
    title: '再起動が必要です',
    message: 'アクセシビリティの変更を反映するには Kotodama の再起動が必要です。',
    detail: '再起動後に、貼り付けと Control ダブルタップが使えるようになります。'
  })
  if (response === 0) relaunchApp()
}

export function relaunchApp(): void {
  app.relaunch()
  app.quit()
}

/**
 * 権限が足りなければ起動のたびに案内する。配布ビルドのみ。
 * 「後で」はそのセッション中だけ案内を止める。
 */
export async function runMacPermissionOnboarding(): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged) return
  if (onboardingDismissedThisSession || onboardingRunning) return
  if (micState() === 'granted' && accessibilityState() === 'granted') return

  onboardingRunning = true
  try {
    const mic = micState()
    if (mic === 'notDetermined') {
      const granted = await ensureMicrophoneAccess()
      if (!granted && micState() === 'denied') await openMacPrivacyPane('microphone')
    } else if (mic !== 'granted') {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['システム設定を開く', '後で'],
        defaultId: 0,
        cancelId: 1,
        title: 'マイクの許可が必要です',
        message: '音声入力にはマイクの許可が必要です。',
        detail: '拒否されていると、Kotodama からは許可ダイアログを再表示できません。'
      })
      if (response === 1) {
        onboardingDismissedThisSession = true
        return
      }
      await openMacPrivacyPane('microphone')
    }

    if (accessibilityState() === 'granted') return
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['許可する', '後で'],
      defaultId: 0,
      cancelId: 1,
      title: 'アクセシビリティ権限が必要です',
      message: '貼り付けと Control ダブルタップにはアクセシビリティ権限が必要です。',
      detail: '次の確認で Kotodama が一覧に追加されます。スイッチをオンにしてください。オンにしても動かないときは、Kotodama を再起動してください。'
    })
    if (response === 1) {
      onboardingDismissedThisSession = true
      return
    }
    systemPreferences.isTrustedAccessibilityClient(true)
  } finally {
    onboardingRunning = false
  }
}

/** 許可が揃うまで確認し、揃ったら修飾キー検知を再起動する。 */
export function startPermissionWatcher(retryDoubleControl: () => void): void {
  if (process.platform !== 'darwin' || !app.isPackaged || watcher) return
  const tick = (): void => {
    if (micState() !== 'granted' || accessibilityState() !== 'granted') return
    retryDoubleControl()
    reportHookState()
    const needsHook = loadConfig().doubleControl
    if (!needsHook || isDoubleCtrlRunning() || wasUiohookLoadFailed() || restartRequired) {
      stopWatcher()
    }
  }
  watcher = setInterval(tick, 2000)
  tick()
}

/** 古い許可が残ってオンなのに効かないとき、許可を消してから再起動する。 */
export async function resetMacPermissions(): Promise<void> {
  if (process.platform !== 'darwin') return
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['リセットして再起動', 'キャンセル'],
    defaultId: 1,
    cancelId: 1,
    title: '権限をリセット',
    message: 'マイクとアクセシビリティの許可を削除して、Kotodama を再起動します。',
    detail: '一覧でオンのまま効かないときに使ってください。再起動後に許可を取り直します。'
  })
  if (response !== 0) return

  const failures: string[] = []
  for (const service of TCC_SERVICES) {
    try {
      await execFileAsync('tccutil', ['reset', service, BUNDLE_ID])
    } catch (err) {
      failures.push(service)
      console.error(
        `[kotodama] tccutil reset ${service} failed:`,
        err instanceof Error ? err.message : err
      )
    }
  }
  if (failures.length > 0) {
    await dialog.showMessageBox({
      type: 'warning',
      title: '権限をリセットできませんでした',
      message: 'システム設定から Kotodama の許可を削除してください。',
      detail:
        '「プライバシーとセキュリティ」のマイクとアクセシビリティで Kotodama を選び、「−」で削除してから、アプリを再起動してください。'
    })
    return
  }
  relaunchApp()
}
