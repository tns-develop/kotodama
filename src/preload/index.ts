import { contextBridge, ipcRenderer } from 'electron'
import {
  AppConfig,
  IPC,
  KotodamaApi,
  RecordingStatePayload,
  SetConfigResult,
  ToggleRecordingPayload
} from '@shared/ipc'

/**
 * IPC リスナーを登録し、解除関数を返す。StrictMode の二重マウントや再レンダーで
 * リスナーが多重登録され、delta が二重連結されるのを防ぐ。
 */
function listen<T>(channel: string, cb: (arg: T) => void): () => void {
  const handler = (_e: Electron.IpcRendererEvent, arg: T): void => cb(arg)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: KotodamaApi = {
  onToggle: (cb) =>
    listen<ToggleRecordingPayload>(IPC.recordingToggle, (payload) => cb(payload.active)),
  onState: (cb) => listen<RecordingStatePayload>(IPC.recordingState, (payload) => cb(payload)),
  onDelta: (cb) => listen<string>(IPC.transcriptDelta, (text) => cb(text)),
  onCompleted: (cb) => listen<string>(IPC.transcriptCompleted, (text) => cb(text)),
  sendPcm: (buf) => ipcRenderer.send(IPC.audioPcm, buf),
  reportAudioError: (message) => ipcRenderer.send(IPC.audioError, message),
  rendererReady: () => ipcRenderer.send(IPC.rendererReady),
  getConfig: () => ipcRenderer.invoke(IPC.getConfig) as Promise<AppConfig>,
  setConfig: (config) => ipcRenderer.invoke(IPC.setConfig, config) as Promise<SetConfigResult>,
  hasApiKey: () => ipcRenderer.invoke(IPC.hasApiKey) as Promise<boolean>,
  saveApiKey: (key) => ipcRenderer.invoke(IPC.saveApiKey, key) as Promise<boolean>,
  openSettings: () => ipcRenderer.send(IPC.openSettings),
  closeSettings: () => ipcRenderer.send(IPC.closeSettings)
}

contextBridge.exposeInMainWorld('api', api)
