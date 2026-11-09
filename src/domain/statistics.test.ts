import { describe, expect, it } from 'vitest'
import { goalsText, matchJournal, playedPeriods, playerSeasonStats, teamSeasonStats, winnerLabel } from './statistics'
import type { FloorballMatch, Player } from './types'

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

describe('match journal', () => {
  it('summarizes winner, rosters, goals and notes', () => {
    expect(winnerLabel(match)).toBe('Красные')
    expect(playedPeriods(match)).toBe(2)
    expect(goalsText(match, players)).toContain('Анна')
    const [row] = matchJournal([match], players)
    expect(row).toMatchObject({
      score: '2 : 1',
      winner: 'Красные',
      redTeam: 'Анна',
      blueTeam: 'Борис',
      periods: 2,
      notes: 'Борис чуть не забил в свою',
    })
  })

  it('ignores unfinished matches', () => {
    expect(matchJournal([{ ...match, status: 'active' }], players)).toEqual([])
  })

  it('builds goal and win grids from completed matches', () => {
    expect(teamSeasonStats([match, { ...match, status: 'active' }])).toMatchObject({
      matches: 1,
      redWins: 1,
      blueWins: 0,
      draws: 0,
      redGoals: 2,
      blueGoals: 1,
    })
    const [anna, boris] = playerSeasonStats([match], players)
    expect(anna).toMatchObject({ playerId: 'a', games: 1, goals: 1, wins: 1, losses: 0 })
    expect(boris).toMatchObject({ playerId: 'b', games: 1, goals: 1, wins: 0, losses: 1 })
  })
})
