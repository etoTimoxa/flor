export type Team = 'red' | 'blue'

export interface Player {
  id: string
  name: string
  note: string
  avatarId: string
  active: boolean
  createdAt: string
}

export interface GoalEvent {
  id: string
  team: Team
  playerId: string | null
  period: number
  elapsedSeconds: number
  createdAt: string
}

export type MatchStatus = 'ready' | 'active' | 'period-break' | 'completed'

export interface MatchTimer {
  durationSeconds: number
  remainingAtPause: number
  startedAt: number | null
  running: boolean
}

export interface FloorballMatch {
  id: string
  status: MatchStatus
  redPlayerIds: string[]
  bluePlayerIds: string[]
  periodCount: number
  periodDurationSeconds: number
  currentPeriod: number
  timer: MatchTimer
  goals: GoalEvent[]
  notes: string
  startedAt: string
  endedAt: string | null
}

export interface AppSettings {
  id: 'main'
  periodMinutes: number
  soundEnabled: boolean
}

export interface BackupPayload {
  version: 1
  exportedAt: string
  players: Player[]
  matches: FloorballMatch[]
  settings: AppSettings
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'main',
  periodMinutes: 10,
  soundEnabled: true,
}

export const createId = () => crypto.randomUUID()
