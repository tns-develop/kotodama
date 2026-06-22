/** 効果音再生。失敗しても握りつぶす（本処理に影響させない）。 */
export async function playSE(kind: 'start' | 'stop'): Promise<void> {
  try {
    // 毎回取得してトグル変更を即時反映する
    const cfg = await window.api.getConfig()
    if (!cfg.soundEnabled) return
    const audio = new Audio(kind === 'start' ? './sounds/start.mp3' : './sounds/stop.mp3')
    await audio.play()
  } catch {
    /* noop */
  }
}
