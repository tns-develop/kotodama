/// <reference types="vite/client" />
import type { KotodamaApi } from '@shared/ipc'

declare global {
  interface Window {
    api: KotodamaApi
  }
}

export {}
