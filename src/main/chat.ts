import { chatSamplingForModel } from '@shared/models'

/**
 * OpenAI Chat Completions の単発呼び出し。表記補正（post-process）と
 * 音声編集（voice-edit）で共用する。
 */
const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'

export interface ChatCompletionRequest {
  model: string
  systemPrompt: string
  userContent: string
  apiKey: string
  timeoutMs: number
  /** ログに出す処理名（どちらの用途で失敗したか判別するため） */
  label: string
}

/**
 * 応答本文を返す。タイムアウト・失敗時は null を返す（例外は投げない）。
 * 呼び出し側でフォールバックさせ、音声入力の本線を止めないための方針。
 */
export async function requestChatCompletion({
  model,
  systemPrompt,
  userContent,
  apiKey,
  timeoutMs,
  label
}: ChatCompletionRequest): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        ...chatSamplingForModel(model),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      console.error(`[kotodama] ${label} failed: HTTP ${res.status}`)
      return null
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = data.choices?.[0]?.message?.content?.trim()
    return content || null
  } catch (err) {
    console.error(`[kotodama] ${label} error:`, err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timer)
  }
}
