/**
 * 音声編集モード（選択テキストを音声指示で書き換える）の LLM 呼び出し。
 */
import { requestChatCompletion } from './chat'

/** 表記補正と同じ最安クラスのモデルを使う。 */
const VOICE_EDIT_MODEL = 'gpt-5.4-nano'
/** 翻訳・構造変換は表記補正より生成量が多いため長めに取る */
const VOICE_EDIT_TIMEOUT_MS = 8000

const SYSTEM_PROMPT = `あなたは「選択されたテキスト」を「音声指示」に従って書き換えるアシスタントです。
入力は「元のテキスト」と「音声指示」の2つです。書き換えた結果の本文だけを返してください。

【判断基準】
- 音声指示が明確な編集指示（例: 箇条書きにして、英語に翻訳して、もっと丁寧にして）の場合は、その指示に従って元のテキストを書き換える。
- 音声指示が指示ではなく元のテキストの言い直し・訂正になっている場合は、音声指示の内容を新しい本文として採用する。
- 判断が難しい場合は編集指示として扱う。

【出力ルール】
- 出力は書き換え後の本文だけ。前置き・説明・引用符・コードブロックは含めない。
- 指示で変更を求められていない部分（言語・文体等）は元のテキストを維持する。`

/**
 * 選択テキストを音声指示に従って書き換える。失敗時は null。
 * 呼び出し側は貼り付けを中止する（選択範囲を壊さないため、元テキストの貼り直しはしない）。
 */
export async function applyVoiceEdit(
  original: string,
  instruction: string,
  apiKey: string
): Promise<string | null> {
  return requestChatCompletion({
    model: VOICE_EDIT_MODEL,
    systemPrompt: SYSTEM_PROMPT,
    userContent: `【元のテキスト】\n${original}\n\n【音声指示】\n${instruction}`,
    apiKey,
    timeoutMs: VOICE_EDIT_TIMEOUT_MS,
    label: 'voice edit'
  })
}
