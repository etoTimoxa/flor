import type { FloorballMatch, Player, Team } from './types'

export const scoreOf = (match: FloorballMatch, team: Team) =>
  match.goals.filter((goal) => goal.team === team).length

export function playedPeriods(match: FloorballMatch): number {
  const fromGoals = match.goals.reduce((max, goal) => Math.max(max, goal.period), 0)
  return Math.max(match.periodCount, match.currentPeriod, fromGoals, 0)
}

export function winnerOf(match: FloorballMatch): 'red' | 'blue' | 'draw' {
  const red = scoreOf(match, 'red')
  const blue = scoreOf(match, 'blue')
  if (red > blue) return 'red'
  if (blue > red) return 'blue'
  return 'draw'
}

export function winnerLabel(match: FloorballMatch): string {
  const winner = winnerOf(match)
  if (winner === 'red') return 'Красные'
  if (winner === 'blue') return 'Синие'
  return 'Ничья'
}

export function playerName(players: Player[], id: string | null): string {
  if (!id) return 'Автор не указан'
  return players.find((player) => player.id === id)?.name ?? 'Удалённый игрок'
}

export function rosterText(players: Player[], ids: string[]): string {
  return ids.map((id) => playerName(players, id)).join(', ') || '—'
}

export function goalsText(match: FloorballMatch, players: Player[]): string {
  if (!match.goals.length) return 'Без голов'
  return match.goals.map((goal) => {
    const team = goal.team === 'red' ? 'К' : 'С'
    return `${team} ${playerName(players, goal.playerId)} (тайм ${goal.period})`
  }).join('; ')
}

export interface MatchJournalRow {
  date: string
  time: string
  score: string
  winner: string
  redTeam: string
  blueTeam: string
  goals: string
  periods: number
  notes: string
}

export function matchJournal(matches: FloorballMatch[], players: Player[]): MatchJournalRow[] {
  return matches
    .filter((match) => match.status === 'completed')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .map((match) => {
      const started = new Date(match.startedAt)
      return {
        date: started.toLocaleDateString('ru-RU'),
        time: started.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
        score: `${scoreOf(match, 'red')} : ${scoreOf(match, 'blue')}`,
        winner: winnerLabel(match),
        redTeam: rosterText(players, match.redPlayerIds),
        blueTeam: rosterText(players, match.bluePlayerIds),
        goals: goalsText(match, players),
        periods: playedPeriods(match),
        notes: match.notes?.trim() || '',
      }
    })
}
