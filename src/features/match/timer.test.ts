import { describe, expect, it } from 'vitest'
import { formatTime, pauseTimer, remainingSeconds, resumeTimer } from './timer'

describe('match timer', () => {
  it('uses timestamps so background throttling does not change the result', () => {
    const timer = {
      durationSeconds: 600,
      remainingAtPause: 600,
      startedAt: 1_000,
      running: true,
    }
    expect(remainingSeconds(timer, 31_999)).toBe(570)
    expect(pauseTimer(timer, 31_999)).toEqual({
      ...timer,
      remainingAtPause: 570,
      startedAt: null,
      running: false,
    })
  })

  it('resumes from the saved remainder and never goes below zero', () => {
    const resumed = resumeTimer({
      durationSeconds: 60,
      remainingAtPause: 8,
      startedAt: null,
      running: false,
    }, 5_000)
    expect(remainingSeconds(resumed, 20_000)).toBe(0)
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(125)).toBe('02:05')
  })
})
