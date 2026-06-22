import { AppConfig } from '@shared/ipc'

/** LLM 文脈補正に使う最安クラスのモデル（2026-03-17 リリース）。 */
const CORRECTION_MODEL = 'gpt-5.4-nano'
const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions'
const LLM_TIMEOUT_MS = 4000

/**
 * 同音異義の定番誤変換を補正するルール辞書。
 * STT が文脈を取り違えやすいものを最小限だけ持つ。常時・オフラインで適用する。
 */
const RULE_DICTIONARY: ReadonlyArray<readonly [RegExp, string]> = [
  [/年のため/g, '念のため'],
  [/念の為/g, '念のため'],
  [/取り合えず/g, 'とりあえず'],
  [/以外と/g, '意外と']
]

/** ルール辞書ベースの補正（コスト・レイテンシゼロ）。 */
function applyRuleDictionary(text: string): string {
  let result = text
  for (const [pattern, replacement] of RULE_DICTIONARY) {
    result = result.replace(pattern, replacement)
  }
  return result
}

const SYSTEM_PROMPT =
  '入力は日本語音声の文字起こしです。文脈に合うよう同音異義語の漢字変換ミスのみを最小限に修正してください。' +
  '言い回しの変更・要約・追記・削除はせず、句読点や改行も保持し、修正後の本文だけを返してください。'

/**
 * gpt-5.4-nano で文脈補正する。タイムアウト・失敗時は null を返し、呼び出し側で
 * ルールベース結果へフォールバックする（貼り付け自体は止めない）。
 */
async function applyLlmCorrection(text: string, apiKey: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS)
  try {
    const res = await fetch(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: CORRECTION_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ]
      }),
      signal: controller.signal
    })
    if (!res.ok) {
      console.error(`[kotodama] llm correction failed: HTTP ${res.status}`)
      return null
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const corrected = data.choices?.[0]?.message?.content?.trim()
    return corrected || null
  } catch (err) {
    console.error('[kotodama] llm correction error:', err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * completed テキストを貼り付け前に後処理する。
 * 1. ルール辞書補正（常時）
 * 2. config.llmCorrection が true のとき LLM 補正（失敗時は 1 の結果を使う）
 */
export async function postProcess(
  text: string,
  config: AppConfig,
  apiKey: string
): Promise<string> {
  const ruled = applyRuleDictionary(text)
  if (!config.llmCorrection || !ruled.trim()) return ruled
  const corrected = await applyLlmCorrection(ruled, apiKey)
  return corrected ?? ruled
}
