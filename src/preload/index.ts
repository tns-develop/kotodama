import { contextBridge, ipcRenderer } from 'electron'
import {
  AppConfig,
  IPC,
  KotodamaApi,
  RecordingStatePayload,
  ToggleRecordingPayload
} from '@shared/ipc'

const api: KotodamaApi = {
  onToggle: (cb) =>
    ipcRenderer.on(IPC.recordingToggle, (_e, payload: ToggleRecordingPayload) => cb(payload.active)),
  onState: (cb) =>
    ipcRenderer.on(IPC.recordingState, (_e, payload: RecordingStatePayload) => cb(payload)),
  onDelta: (cb) => ipcRenderer.on(IPC.transcriptDelta, (_e, text: string) => cb(text)),
  onCompleted: (cb) => ipcRenderer.on(IPC.transcriptCompleted, (_e, text: string) => cb(text)),
  sendPcm: (buf) => ipcRenderer.send(IPC.audioPcm, buf),
  reportAudioError: (message) => ipcRenderer.send(IPC.audioError, message),
  rendererReady: () => ipcRenderer.send(IPC.rendererReady),
  getConfig: () => ipcRenderer.invoke(IPC.getConfig) as Promise<AppConfig>,
  setConfig: (config) => ipcRenderer.invoke(IPC.setConfig, config) as Promise<AppConfig>,
  hasApiKey: () => ipcRenderer.invoke(IPC.hasApiKey) as Promise<boolean>,
  saveApiKey: (key) => ipcRenderer.invoke(IPC.saveApiKey, key) as Promise<boolean>,
  openSettings: () => ipcRenderer.send(IPC.openSettings)
}

contextBridge.exposeInMainWorld('api', api)
