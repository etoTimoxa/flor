import { describe, expect, it } from 'vitest'
import { fingerprint, mergePayloads } from './merge'
import type { BackupPayload, FloorballMatch, Player } from '../domain/types'

const player = (id: string, name: string): Player => ({
  id,
  name,
  note: '',
  avatarId: 'fox',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
})

const match = (id: string, extra: Partial<FloorballMatch> = {}): FloorballMatch => ({
  id,
  status: 'ready',
  redPlayerIds: ['p1'],
  bluePlayerIds: ['p2'],
  periodCount: 0,
  periodDurationSeconds: 60,
  currentPeriod: 0,
  timer: {
    durationSeconds: 60,
    remainingAtPause: 60,
    startedAt: null,
    running: false,
  },
  goals: [],
  notes: '',
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: null,
  ...extra,
})

const payload = (extra: Partial<BackupPayload> = {}): BackupPayload => ({
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  players: [player('p1', 'Анна')],
  matches: [],
  settings: { id: 'main', periodMinutes: 10, soundEnabled: true },
  ...extra,
})

describe('mergePayloads', () => {
  it('keeps a local match when the remote copy has only players', () => {
    const local = payload({
      matches: [match('m1', { status: 'completed', endedAt: '2026-01-01T00:10:00.000Z' })],
      exportedAt: '2026-01-02T00:00:00.000Z',
    })
    const remote = payload({ exportedAt: '2026-01-01T00:00:00.000Z' })
    const merged = mergePayloads(local, remote)
    expect(merged.matches).toHaveLength(1)
    expect(merged.matches[0].id).toBe('m1')
    expect(merged.players).toHaveLength(1)
  })

  it('keeps a remote match the local phone has not seen yet', () => {
    const local = payload()
    const remote = payload({
      matches: [match('m2', { status: 'completed' })],
    })
    expect(mergePayloads(local, remote).matches.map((item) => item.id)).toEqual(['m2'])
  })

  it('unions players from both phones', () => {
    const local = payload({ players: [player('p1', 'Анна'), player('p2', 'Борис')] })
    const remote = payload({ players: [player('p1', 'Анна'), player('p3', 'Вика')] })
    const merged = mergePayloads(local, remote)
    expect(merged.players.map((item) => item.id).sort()).toEqual(['p1', 'p2', 'p3'])
  })

  it('prefers the completed match over an in-progress copy', () => {
    const local = payload({ matches: [match('m1', { status: 'active', currentPeriod: 1 })] })
    const remote = payload({
      matches: [match('m1', {
        status: 'completed',
        currentPeriod: 2,
        endedAt: '2026-01-01T00:20:00.000Z',
        goals: [{
          id: 'g1',
          team: 'red',
          playerId: 'p1',
          period: 1,
          elapsedSeconds: 12,
          createdAt: '2026-01-01T00:05:00.000Z',
        }],
      })],
    })
    expect(mergePayloads(local, remote).matches[0].status).toBe('completed')
    expect(mergePayloads(local, remote).matches[0].goals).toHaveLength(1)
  })

  it('drops matches that were deleted on either phone', () => {
    const local = payload({
      matches: [match('m1')],
      deletedMatchIds: ['m1'],
    })
    const remote = payload({ matches: [match('m1', { status: 'completed' })] })
    expect(mergePayloads(local, remote).matches).toEqual([])
  })

  it('builds the same fingerprint regardless of row order', () => {
    const left = payload({ players: [player('p2', 'Борис'), player('p1', 'Анна')] })
    const right = payload({ players: [player('p1', 'Анна'), player('p2', 'Борис')] })
    expect(fingerprint(left)).toBe(fingerprint(right))
  })

  it('ignores extra fields left by IndexedDB', () => {
    const clean = payload({ matches: [match('m1')] })
    const dirty = payload({
      matches: [{ ...match('m1'), leftover: true } as FloorballMatch],
    })
    expect(fingerprint(clean)).toBe(fingerprint(dirty))
  })
})
