import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AppConfig, DEFAULT_CONFIG } from '@shared/ipc'

function apiKeyPath(): string {
  return join(app.getPath('userData'), 'apikey.bin')
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function saveApiKey(key: string): void {
  const trimmed = key.trim()
  if (!trimmed) return
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OSの暗号化基盤が利用できないため、APIキーを安全に保存できません。')
  }
  writeFileSync(apiKeyPath(), safeStorage.encryptString(trimmed))
}

export function loadApiKey(): string | null {
  const path = apiKeyPath()
  if (!existsSync(path)) return null
  try {
    return safeStorage.decryptString(readFileSync(path))
  } catch {
    return null
  }
}

export function hasApiKey(): boolean {
  return loadApiKey() !== null
}

export function loadConfig(): AppConfig {
  const path = configPath()
  if (!existsSync(path)) return { ...DEFAULT_CONFIG }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: Partial<AppConfig>): AppConfig {
  const merged = { ...loadConfig(), ...config }
  writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}
