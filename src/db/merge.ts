import { DEFAULT_SETTINGS, type BackupPayload, type FloorballMatch, type Player } from '../domain/types'

function uniqueIds(values?: Array<string | undefined>) {
  return [...new Set((values ?? []).filter((value): value is string => Boolean(value)))]
}

function byId<T extends { id: string }>(rows: T[]) {
  return new Map(rows.map((row) => [row.id, row]))
}

function matchRank(match: FloorballMatch) {
  const statusRank = {
    completed: 4,
    active: 3,
    'period-break': 2,
    ready: 1,
  }[match.status] ?? 0
  return statusRank * 1_000_000
    + (match.goals?.length ?? 0) * 1_000
    + (match.currentPeriod ?? 0) * 10
    + (match.endedAt ? 1 : 0)
}

function pickMatch(left: FloorballMatch, right: FloorballMatch) {
  const leftRank = matchRank(left)
  const rightRank = matchRank(right)
  if (rightRank !== leftRank) return rightRank > leftRank ? right : left
  const leftTime = left.endedAt || left.startedAt || ''
  const rightTime = right.endedAt || right.startedAt || ''
  return rightTime >= leftTime ? right : left
}

function pickPlayer(left: Player, right: Player) {
  const leftTime = left.createdAt || ''
  const rightTime = right.createdAt || ''
  if (right.name.length !== left.name.length && right.createdAt === left.createdAt) {
    return right.name.length >= left.name.length ? right : left
  }
  return rightTime >= leftTime ? right : left
}

function normalizePlayer(player: Player): Player {
  return {
    id: player.id,
    name: player.name,
    note: player.note ?? '',
    avatarId: player.avatarId ?? '',
    active: player.active !== false,
    createdAt: player.createdAt,
  }
}

function normalizeMatch(match: FloorballMatch): FloorballMatch {
  return {
    id: match.id,
    status: match.status,
    redPlayerIds: [...(match.redPlayerIds ?? [])],
    bluePlayerIds: [...(match.bluePlayerIds ?? [])],
    periodCount: match.periodCount ?? match.currentPeriod ?? 0,
    periodDurationSeconds: match.periodDurationSeconds ?? 0,
    currentPeriod: match.currentPeriod ?? 0,
    timer: {
      durationSeconds: match.timer?.durationSeconds ?? 0,
      remainingAtPause: match.timer?.remainingAtPause ?? 0,
      startedAt: match.timer?.startedAt ?? null,
      running: Boolean(match.timer?.running),
    },
    goals: (match.goals ?? []).map((goal) => ({
      id: goal.id,
      team: goal.team,
      playerId: goal.playerId ?? null,
      period: goal.period ?? 1,
      elapsedSeconds: goal.elapsedSeconds ?? 0,
      createdAt: goal.createdAt,
    })),
    notes: match.notes ?? '',
    startedAt: match.startedAt,
    endedAt: match.endedAt ?? null,
  }
}

export function canonicalize(payload: BackupPayload): BackupPayload {
  return {
    version: 1,
    exportedAt: payload.exportedAt || '',
    players: [...payload.players].map(normalizePlayer).sort((left, right) => left.id.localeCompare(right.id)),
    matches: [...payload.matches].map(normalizeMatch).sort((left, right) => left.id.localeCompare(right.id)),
    settings: {
      id: 'main',
      periodMinutes: payload.settings?.periodMinutes || DEFAULT_SETTINGS.periodMinutes,
      soundEnabled: payload.settings?.soundEnabled !== false,
    },
    deletedPlayerIds: uniqueIds(payload.deletedPlayerIds).sort(),
    deletedMatchIds: uniqueIds(payload.deletedMatchIds).sort(),
  }
}

export function fingerprint(payload: BackupPayload) {
  const canonical = canonicalize(payload)
  return JSON.stringify({
    players: canonical.players,
    matches: canonical.matches,
    settings: canonical.settings,
    deletedPlayerIds: canonical.deletedPlayerIds,
    deletedMatchIds: canonical.deletedMatchIds,
  })
}

export function mergePayloads(local: BackupPayload, remote: BackupPayload): BackupPayload {
  const deletedPlayerIds = uniqueIds([
    ...(local.deletedPlayerIds ?? []),
    ...(remote.deletedPlayerIds ?? []),
  ])
  const deletedMatchIds = uniqueIds([
    ...(local.deletedMatchIds ?? []),
    ...(remote.deletedMatchIds ?? []),
  ])
  const deletedPlayers = new Set(deletedPlayerIds)
  const deletedMatches = new Set(deletedMatchIds)

  const players = byId(remote.players.filter((player) => !deletedPlayers.has(player.id)))
  for (const player of local.players) {
    if (deletedPlayers.has(player.id)) continue
    const existing = players.get(player.id)
    players.set(player.id, existing ? pickPlayer(existing, player) : player)
  }

  const matches = byId(remote.matches.filter((match) => !deletedMatches.has(match.id)))
  for (const match of local.matches) {
    if (deletedMatches.has(match.id)) continue
    const existing = matches.get(match.id)
    matches.set(match.id, existing ? pickMatch(existing, match) : match)
  }

  const remoteSettingsTime = remote.exportedAt || ''
  const localSettingsTime = local.exportedAt || ''
  const settings = (localSettingsTime >= remoteSettingsTime ? local.settings : remote.settings)
    ?? DEFAULT_SETTINGS

  return {
    version: 1,
    exportedAt: localSettingsTime >= remoteSettingsTime ? (local.exportedAt || remote.exportedAt) : (remote.exportedAt || local.exportedAt),
    players: [...players.values()],
    matches: [...matches.values()],
    settings: {
      id: 'main',
      periodMinutes: settings.periodMinutes || DEFAULT_SETTINGS.periodMinutes,
      soundEnabled: settings.soundEnabled !== false,
    },
    deletedPlayerIds,
    deletedMatchIds,
  }
}
