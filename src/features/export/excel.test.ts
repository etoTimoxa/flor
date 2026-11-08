import { describe, expect, it } from 'vitest'
import type { FloorballMatch, Player } from '../../domain/types'
import {
  chronologicalCompleted,
  matchProtocolAoa,
  matchSheetName,
  summarySheetAoa,
} from './excel'

const players: Player[] = [
  { id: 'a', name: 'Анна', note: '', avatarId: 'fox', active: true, createdAt: '2026-01-01' },
  { id: 'b', name: 'Борис', note: '', avatarId: 'duck', active: true, createdAt: '2026-01-01' },
]

const match: FloorballMatch = {
  id: 'm1',
  status: 'completed',
  redPlayerIds: ['a'],
  bluePlayerIds: ['b'],
  periodCount: 2,
  periodDurationSeconds: 600,
  currentPeriod: 2,
  timer: {
    durationSeconds: 600,
    remainingAtPause: 0,
    startedAt: null,
    running: false,
  },
  goals: [
    { id: 'g1', team: 'red', playerId: 'a', period: 1, elapsedSeconds: 10, createdAt: '2026-01-01' },
    { id: 'g2', team: 'red', playerId: null, period: 2, elapsedSeconds: 20, createdAt: '2026-01-01' },
    { id: 'g3', team: 'blue', playerId: 'b', period: 2, elapsedSeconds: 30, createdAt: '2026-01-01' },
  ],
  notes: 'Борис чуть не забил в свою',
  startedAt: '2026-01-01T18:00:00.000Z',
  endedAt: '2026-01-01T18:30:00.000Z',
}

describe('excel protocols', () => {
  it('orders completed matches oldest first and skips live ones', () => {
    const newer = { ...match, id: 'm2', startedAt: '2026-02-01T18:00:00.000Z' }
    const live = { ...match, id: 'm3', status: 'active' as const }
    expect(chronologicalCompleted([newer, live, match]).map((item) => item.id)).toEqual(['m1', 'm2'])
  })

  it('builds a summary row per match', () => {
    const [header, row] = summarySheetAoa([match], players)
    expect(header[0]).toBe('№')
    expect(row).toEqual(expect.arrayContaining([1, '2 : 1', 'Красные', 'Анна', 'Борис', 2]))
  })

  it('puts roster, period scores and goals into a match sheet', () => {
    const rows = matchProtocolAoa(match, players, 1)
    expect(rows[0][0]).toBe('Матч 1')
    expect(rows).toContainEqual(['Анна', 'Борис'])
    expect(rows).toContainEqual([1, 1, 0])
    expect(rows).toContainEqual([2, 1, 1])
    expect(rows).toContainEqual([1, '0:10', 'Красные', 'Анна'])
    expect(rows).toContainEqual([2, '0:30', 'Синие', 'Борис'])
  })

  it('keeps sheet names short and unique by match number', () => {
    const name = matchSheetName(1, match)
    expect(name.length).toBeLessThanOrEqual(31)
    expect(name.startsWith('1.')).toBe(true)
  })
})
