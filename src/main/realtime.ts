import WebSocket from 'ws'
import { AppConfig } from '@shared/ipc'

export interface SttCallbacks {
  onDelta: (text: string) => void
  onCompleted: (text: string) => void
  onError: (message: string) => void
  onOpen?: () => void
  onClose?: () => void
}

export interface SttSession {
  /** PCM16(24kHz, mono) チャンクを送る */
  appendAudio(pcm: ArrayBuffer | Buffer | Uint8Array): void
  /** 入力バッファを確定し、最終文字起こしを要求する */
  commit(): void
  /** セッションを閉じる */
  close(): void
  readonly isOpen: boolean
}

/**
 * モデルを差し替え可能にするための抽象。より優れたモデルが出たら、
 * この interface を実装した別アダプタへ載せ替える。
 */
export interface SttAdapter {
  readonly id: string
  connect(apiKey: string, config: AppConfig, cb: SttCallbacks): SttSession
}

const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription'

/**
 * OpenAI Realtime API の gpt-realtime-whisper を使ったストリーミング文字起こし。
 * セキュア構成: main プロセスで ws を張り、Authorization ヘッダで接続する。
 */
export class GptRealtimeWhisperAdapter implements SttAdapter {
  readonly id = 'gpt-realtime-whisper'

  connect(apiKey: string, config: AppConfig, cb: SttCallbacks): SttSession {
    // GA(/v1/realtime) では 'OpenAI-Beta: realtime=v1' を送ると Beta API 扱いになり
    // "The Realtime Beta API is no longer supported" で切断される。GA はヘッダ不要。
    const ws = new WebSocket(REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    })

    // 接続確立前に届いた音声は貯めておき、open 後にまとめて送る
    const pending: string[] = []
    let opened = false

    const sendJson = (payload: unknown): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
    }

    ws.on('open', () => {
      opened = true
      // 現行GA仕様: audio.input.* にネスト。gpt-realtime-whisper は turn_detection=null で手動 commit。
      sendJson({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: {
                model: config.model,
                ...(config.language ? { language: config.language } : {}),
                delay: config.delay
              },
              turn_detection: null
            }
          }
        }
      })
      for (const audio of pending.splice(0)) {
        sendJson({ type: 'input_audio_buffer.append', audio })
      }
      cb.onOpen?.()
    })

    ws.on('message', (raw: WebSocket.RawData) => {
      let evt: { type?: string; delta?: string; transcript?: string; error?: { message?: string } }
      try {
        evt = JSON.parse(raw.toString())
      } catch {
        return
      }
      const type = evt.type ?? ''
      if (type.endsWith('input_audio_transcription.delta')) {
        if (evt.delta) cb.onDelta(evt.delta)
      } else if (type.endsWith('input_audio_transcription.completed')) {
        cb.onCompleted(evt.transcript ?? '')
      } else if (type === 'error') {
        cb.onError(evt.error?.message ?? 'Realtime API error')
      }
    })

    // ハンドシェイク失敗(401/403/429 等)は 'error' だと "Unexpected server response: 401"
    // のような薄い文言しか得られない。'unexpected-response' で本文を読み、APIの
    // 具体的なエラー(invalid_api_key / tier 不足 等)を拾って onError に渡す。
    let handledUnexpected = false
    ws.on('unexpected-response', (_req, res) => {
      handledUnexpected = true
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        let detail = body
        try {
          const parsed = JSON.parse(body) as { error?: { message?: string } }
          if (parsed.error?.message) detail = parsed.error.message
        } catch {
          /* body は素のテキストのまま使う */
        }
        cb.onError(`接続に失敗しました (HTTP ${res.statusCode}): ${detail || '応答本文なし'}`)
      })
    })

    ws.on('error', (err: Error) => {
      // unexpected-response で詳細を出す場合は、後続の薄い error を重複通知しない
      if (handledUnexpected) return
      cb.onError(err.message)
    })
    ws.on('close', () => cb.onClose?.())

    return {
      get isOpen() {
        return ws.readyState === WebSocket.OPEN
      },
      appendAudio(pcm) {
        const buf = Buffer.isBuffer(pcm)
          ? pcm
          : Buffer.from(pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm))
        const audio = buf.toString('base64')
        if (!opened) {
          pending.push(audio)
          return
        }
        sendJson({ type: 'input_audio_buffer.append', audio })
      },
      commit() {
        sendJson({ type: 'input_audio_buffer.commit' })
      },
      close() {
        try {
          ws.close()
        } catch {
          /* noop */
        }
      }
    }
  }
}

export function createSttAdapter(model: string): SttAdapter {
  switch (model) {
    case 'gpt-realtime-whisper':
    default:
      return new GptRealtimeWhisperAdapter()
  }
}
