let audioContext: AudioContext | null = null

export async function unlockAudio(): Promise<void> {
  try {
    audioContext ??= new AudioContext()
    if (audioContext.state === 'suspended') await audioContext.resume()
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    gain.gain.value = 0.0001
    oscillator.connect(gain).connect(audioContext.destination)
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.02)
  } catch {
    // iOS or headless browsers may reject audio until a later gesture.
  }
}

export async function playFinalHorn(): Promise<void> {
  await unlockAudio()
  if (!audioContext) return
  const start = audioContext.currentTime
  for (const offset of [0, 0.45, 0.9]) {
    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()
    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(740, start + offset)
    gain.gain.setValueAtTime(0.0001, start + offset)
    gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.32)
    oscillator.connect(gain).connect(audioContext.destination)
    oscillator.start(start + offset)
    oscillator.stop(start + offset + 0.34)
  }
}
