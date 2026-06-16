// AudioWorkletProcessor: Float32 マイク入力を Int16 PCM(リトルエンディアン)へ変換し、
// transferable な ArrayBuffer として main スレッドへ渡す。
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0] && inputs[0][0]
    if (input && input.length > 0) {
      const pcm = new Int16Array(input.length)
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]))
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      this.port.postMessage(pcm.buffer, [pcm.buffer])
    }
    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
