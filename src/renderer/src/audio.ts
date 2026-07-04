import workletSource from './pcm-worklet.js?raw'

export interface MicHandle {
  stop: () => void
  /** 指定 deviceId が使えずシステム既定へフォールバックしたか */
  usedFallback: boolean
}

function isDeviceUnavailableError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false
  return err.name === 'OverconstrainedError' || err.name === 'NotFoundError'
}

async function acquireMicStream(
  baseAudio: MediaTrackConstraints,
  deviceId?: string
): Promise<{ stream: MediaStream; usedFallback: boolean }> {
  if (!deviceId) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: baseAudio })
    return { stream, usedFallback: false }
  }

  const audioWithDevice: MediaTrackConstraints = {
    ...baseAudio,
    deviceId: { exact: deviceId }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioWithDevice })
    return { stream, usedFallback: false }
  } catch (err) {
    // 保存済み deviceId はビルド違いやデバイス抜き差しで無効化されることがある。
    // 権限拒否など別原因のエラーはそのまま上位へ伝える。
    if (!isDeviceUnavailableError(err)) throw err
    const stream = await navigator.mediaDevices.getUserMedia({ audio: baseAudio })
    return { stream, usedFallback: true }
  }
}

/**
 * マイクを取得し、PCM16(24kHz, mono) のチャンクを onPcm へ渡す。
 * getUserMedia は renderer(Chromium) でのみ利用可能なため音声取得はここで行い、
 * 生成した PCM を IPC で main へ送る(セキュア構成)。
 */
export async function startMic(
  onPcm: (buf: ArrayBuffer) => void,
  deviceId?: string
): Promise<MicHandle> {
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }

  const { stream, usedFallback } = await acquireMicStream(audio, deviceId)

  const ctx = new AudioContext({ sampleRate: 24000 })
  const blob = new Blob([workletSource], { type: 'application/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    await ctx.audioWorklet.addModule(url)
  } finally {
    URL.revokeObjectURL(url)
  }

  const source = ctx.createMediaStreamSource(stream)
  const node = new AudioWorkletNode(ctx, 'pcm-processor')
  node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onPcm(e.data)

  // worklet は出力に何も書かないため、destination へ繋いでも無音(フィードバックなし)。
  // グラフを能動的に駆動させるために接続する。
  source.connect(node)
  node.connect(ctx.destination)

  // 非表示ウィンドウ＋ユーザー操作なしで生成した AudioContext は suspended で始まり、
  // resume しないと process() が回らず PCM が一切生成されない（= サーバーへ無音が届く）。
  if (ctx.state === 'suspended') await ctx.resume()

  return {
    usedFallback,
    stop: () => {
      node.port.onmessage = null
      try {
        node.disconnect()
        source.disconnect()
      } catch {
        /* noop */
      }
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
    }
  }
}
