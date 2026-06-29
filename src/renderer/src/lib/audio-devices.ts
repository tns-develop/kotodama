export interface AudioInputDevice {
  deviceId: string
  label: string
}

function isSelectableDeviceId(deviceId: string): boolean {
  return deviceId !== '' && deviceId !== 'default'
}

/** Chromium はラベル取得のために一度 getUserMedia が必要なことが多い。 */
async function unlockDeviceLabels(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
  } catch {
    /* 権限未許可でも列挙は続行（ラベルは空のまま） */
  }
}

export async function listAudioInputDevices(): Promise<AudioInputDevice[]> {
  await unlockDeviceLabels()
  const devices = await navigator.mediaDevices.enumerateDevices()
  let index = 0
  return devices
    .filter((d) => d.kind === 'audioinput' && isSelectableDeviceId(d.deviceId))
    .map((d) => {
      index += 1
      return {
        deviceId: d.deviceId,
        label: d.label || `マイク ${index}`
      }
    })
}
