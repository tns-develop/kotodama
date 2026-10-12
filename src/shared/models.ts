/** 既存 config の STT を一度だけ新既定へ寄せるための世代。saveConfig が落とさないよう AppConfig にも載せる。 */
export const MODEL_CATALOG_REV = 1

export const STT_MODELS = [
  { id: 'gpt-live-transcribe', label: 'GPT Live Transcribe' },
  { id: 'gpt-realtime-whisper', label: 'GPT Realtime Whisper' }
] as const

export const DEFAULT_STT_MODEL = STT_MODELS[0].id

export const CORRECTION_MODELS = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna (low)', reasoningEffort: 'low' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna (medium)', reasoningEffort: 'medium' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 nano' }
] as const

export const DEFAULT_CORRECTION_MODEL = CORRECTION_MODELS[0].id

export type ChatSampling = { reasoning_effort: string } | { temperature: number }

/**
 * whisper は単数 `language`。live-transcribe は `languages` 配列。
 * 両方送るとセッション更新が拒否される。
 */
export function sttLanguageFields(
  model: string,
  language: string
): { language: string } | { languages: string[] } {
  if (model === 'gpt-realtime-whisper') return { language }
  return { languages: [language] }
}

/** Luna は temperature を送ると 400 になりうる。nano に戻したときだけ 0 を送る。 */
export function chatSamplingForModel(model: string): ChatSampling {
  const found = CORRECTION_MODELS.find((m) => m.id === model)
  if (found && 'reasoningEffort' in found && found.reasoningEffort) {
    return { reasoning_effort: found.reasoningEffort }
  }
  return { temperature: 0 }
}
