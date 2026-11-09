const hornUrl = `${import.meta.env.BASE_URL}horn.mp3`

let horn: HTMLAudioElement | null = null

function getHorn() {
  if (!horn) {
    horn = new Audio(hornUrl)
    horn.preload = 'auto'
    horn.setAttribute('playsinline', 'true')
  }
  return horn
}

export async function unlockAudio(): Promise<void> {
  const audio = getHorn()
  try {
    audio.muted = true
    await audio.play()
    audio.pause()
    audio.currentTime = 0
    audio.muted = false
  } catch {
    // iOS may still block until a later gesture.
  }
}

export async function playFinalHorn(): Promise<void> {
  const audio = getHorn()
  try {
    audio.muted = false
    audio.volume = 1
    audio.currentTime = 0
    await audio.play()
  } catch {
    await unlockAudio()
    try {
      audio.muted = false
      audio.currentTime = 0
      await audio.play()
    } catch {
      // Safari can still refuse if the last gesture is gone.
    }
  }
}
