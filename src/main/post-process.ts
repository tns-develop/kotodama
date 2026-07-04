import { AppConfig } from '@shared/ipc'

/** LLM 表記最適化に使う最安クラスのモデル（2026-03-17 リリース）。 */
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

const SYSTEM_PROMPT = `あなたは日本語音声文字起こしの後処理アシスタントです。
入力テキストを以下のルールに従って修正し、修正後の本文だけを返してください。

【修正すべきこと】
- 同音異義語・同訓異字を文脈に合う漢字に直す（例: 音楽を聞く→聴く、彼に会う/条件に合う）
- 明らかな誤変換を正す（例: 年のため→念のため）
- 送り仮名の表記ゆれを自然な形に統一する
- 文の切れ目に句読点（、。）が不足していれば最低限補う

【してはいけないこと】
- 言い回し・語順・文体を変える
- 敬語とタメ口を相互変換する
- 内容を要約・追記・削除する
- ひらがなが自然な語を無理に漢字にする（例: できる、わかる、ことはそのまま）
- 話し言葉を書き言葉に直す`

/**
 * gpt-5.4-nano で表記最適化する。タイムアウト・失敗時は null を返し、呼び出し側で
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
        temperature: 0,
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
 * 2. config.llmCorrection が true のとき LLM 表記最適化（失敗時は 1 の結果を使う）
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
