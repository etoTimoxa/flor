import type { MatchTimer } from '../../domain/types'

export function remainingSeconds(timer: MatchTimer, now = Date.now()): number {
  if (!timer.running || timer.startedAt === null) {
    return Math.max(0, timer.remainingAtPause)
  }
  const elapsed = Math.floor((now - timer.startedAt) / 1000)
  return Math.max(0, timer.remainingAtPause - elapsed)
}

export function pauseTimer(timer: MatchTimer, now = Date.now()): MatchTimer {
  return {
    ...timer,
    remainingAtPause: remainingSeconds(timer, now),
    startedAt: null,
    running: false,
  }
}

export function resumeTimer(timer: MatchTimer, now = Date.now()): MatchTimer {
  if (timer.remainingAtPause <= 0) return timer
  return { ...timer, startedAt: now, running: true }
}

export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.max(0, totalSeconds % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
