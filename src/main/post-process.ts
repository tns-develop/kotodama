import { AppConfig } from '@shared/ipc'
import { requestChatCompletion } from './chat'

/** Luna medium は nano より遅いことがある。失敗時はルール辞書へ落ちる。 */
const LLM_TIMEOUT_MS = 8000

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
  const corrected = await requestChatCompletion({
    model: config.correctionModel,
    systemPrompt: SYSTEM_PROMPT,
    userContent: ruled,
    apiKey,
    timeoutMs: LLM_TIMEOUT_MS,
    label: 'llm correction'
  })
  return corrected ?? ruled
}
