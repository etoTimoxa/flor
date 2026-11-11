import Dexie, { type EntityTable } from 'dexie'
import { pickAvatar } from '../domain/avatars'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BackupPayload,
  type FloorballMatch,
  type Player,
} from '../domain/types'
import { queueCloudPush, startCloudSync } from './sync'

const TOMBSTONE_KEY = 'flor-tombstones'

function tombstoneStore() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function readTombstones() {
  const raw = tombstoneStore()?.getItem(TOMBSTONE_KEY)
  if (!raw) return { players: [] as string[], matches: [] as string[] }
  try {
    const parsed = JSON.parse(raw) as { players?: unknown; matches?: unknown }
    return {
      players: Array.isArray(parsed.players) ? parsed.players.filter((id): id is string => typeof id === 'string') : [],
      matches: Array.isArray(parsed.matches) ? parsed.matches.filter((id): id is string => typeof id === 'string') : [],
    }
  } catch {
    return { players: [] as string[], matches: [] as string[] }
  }
}

function writeTombstones(players: string[], matches: string[]) {
  tombstoneStore()?.setItem(TOMBSTONE_KEY, JSON.stringify({
    players: [...new Set(players)],
    matches: [...new Set(matches)],
  }))
}

function rememberDeleted(tableName: string, ids: string[]) {
  if (tableName !== 'players' && tableName !== 'matches') return
  const current = readTombstones()
  if (tableName === 'players') writeTombstones([...current.players, ...ids], current.matches)
  else writeTombstones(current.players, [...current.matches, ...ids])
}

function forgetDeleted(tableName: string, ids: string[]) {
  if (!ids.length || (tableName !== 'players' && tableName !== 'matches')) return
  const drop = new Set(ids)
  const current = readTombstones()
  if (tableName === 'players') writeTombstones(current.players.filter((id) => !drop.has(id)), current.matches)
  else writeTombstones(current.players, current.matches.filter((id) => !drop.has(id)))
}

class FloorballDatabase extends Dexie {
  players!: EntityTable<Player, 'id'>
  matches!: EntityTable<FloorballMatch, 'id'>
  settings!: EntityTable<AppSettings, 'id'>

  constructor() {
    super('floorball-tracker')
    this.version(1).stores({
      players: 'id, name, active, createdAt',
      matches: 'id, status, startedAt, endedAt',
      settings: 'id',
    })
    this.version(2).stores({
      players: 'id, name, active, createdAt',
      matches: 'id, status, startedAt, endedAt',
      settings: 'id',
    }).upgrade(async (transaction) => {
      const taken: string[] = []
      await transaction.table('players').toCollection().modify((player: Player) => {
        if (!player.avatarId) {
          player.avatarId = pickAvatar(taken)
          taken.push(player.avatarId)
        }
      })
      await transaction.table('matches').toCollection().modify((match: FloorballMatch) => {
        if (typeof match.notes !== 'string') match.notes = ''
      })
    })
  }
}

export const db = new FloorballDatabase()

const SNAPSHOT_KEY = 'flor-local-backup'
let snapshotPaused = false
let snapshotTimer: ReturnType<typeof setTimeout> | undefined

function snapshotStore() {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

async function saveLocalSnapshot() {
  const store = snapshotStore()
  if (!store || snapshotPaused) return
  const tombstones = readTombstones()
  const payload: BackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    matches: await db.matches.toArray(),
    settings: (await db.settings.get('main')) ?? DEFAULT_SETTINGS,
    deletedPlayerIds: tombstones.players,
    deletedMatchIds: tombstones.matches,
  }
  store.setItem(SNAPSHOT_KEY, JSON.stringify(payload))
}

function queueSnapshot() {
  if (snapshotPaused) return
  if (snapshotStore()) {
    if (snapshotTimer) clearTimeout(snapshotTimer)
    snapshotTimer = setTimeout(() => {
      void saveLocalSnapshot()
    }, 300)
  }
  queueCloudPush()
}

db.use({
  stack: 'dbcore',
  name: 'localSnapshot',
  create(downlevelDatabase) {
    return {
      ...downlevelDatabase,
      table(tableName) {
        const table = downlevelDatabase.table(tableName)
        return {
          ...table,
          mutate(req) {
            return table.mutate(req).then((result) => {
              if (!snapshotPaused && 'keys' in req && Array.isArray(req.keys)) {
                const ids = req.keys.map((key) => String(key))
                if (req.type === 'delete') rememberDeleted(tableName, ids)
                if (req.type === 'add' || req.type === 'put') forgetDeleted(tableName, ids)
              }
              queueSnapshot()
              return result
            })
          },
        }
      },
    }
  },
})

async function restoreLocalSnapshotIfEmpty() {
  const store = snapshotStore()
  if (!store) return
  const [playerCount, matchCount] = await Promise.all([db.players.count(), db.matches.count()])
  if (playerCount || matchCount) return
  const raw = store.getItem(SNAPSHOT_KEY)
  if (!raw) return
  try {
    snapshotPaused = true
    await importBackup(JSON.parse(raw))
  } catch {
    store.removeItem(SNAPSHOT_KEY)
  } finally {
    snapshotPaused = false
  }
}

export async function getSettings(): Promise<AppSettings> {
  await restoreLocalSnapshotIfEmpty()
  startCloudSync()
  const existing = await db.settings.get('main')
  if (existing) {
    return {
      id: 'main',
      periodMinutes: existing.periodMinutes || DEFAULT_SETTINGS.periodMinutes,
      soundEnabled: existing.soundEnabled !== false,
    }
  }
  await db.settings.put(DEFAULT_SETTINGS)
  return DEFAULT_SETTINGS
}

export async function exportBackup(): Promise<BackupPayload> {
  const tombstones = readTombstones()
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    matches: await db.matches.toArray(),
    settings: await getSettings(),
    deletedPlayerIds: tombstones.players,
    deletedMatchIds: tombstones.matches,
  }
}

function isBackup(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') return false
  const backup = value as Partial<BackupPayload>
  return (
    backup.version === 1 &&
    Array.isArray(backup.players) &&
    Array.isArray(backup.matches) &&
    !!backup.settings &&
    backup.settings.id === 'main'
  )
}

export async function importBackup(value: unknown): Promise<void> {
  if (!isBackup(value)) throw new Error('Файл не похож на резервную копию приложения.')
  const taken: string[] = []
  const players = value.players.map((player) => {
    const avatarId = player.avatarId || pickAvatar(taken)
    taken.push(avatarId)
    return { ...player, avatarId, note: player.note ?? '' }
  })
  const matches = value.matches.map((match) => ({
    ...match,
    notes: match.notes ?? '',
    periodCount: match.periodCount ?? match.currentPeriod ?? 0,
  }))
  const resumeSnapshots = !snapshotPaused
  snapshotPaused = true
  try {
    writeTombstones(value.deletedPlayerIds ?? [], value.deletedMatchIds ?? [])
    await db.transaction('rw', db.players, db.matches, db.settings, async () => {
      await Promise.all([
        db.players.clear(),
        db.matches.clear(),
        db.settings.clear(),
      ])
      await db.players.bulkPut(players)
      await db.matches.bulkPut(matches)
      await db.settings.put({
        id: 'main',
        periodMinutes: value.settings.periodMinutes || DEFAULT_SETTINGS.periodMinutes,
        soundEnabled: value.settings.soundEnabled !== false,
      })
    })
  } finally {
    if (resumeSnapshots) {
      snapshotPaused = false
      queueCloudPush()
    }
  }
}

export async function clearAllData(): Promise<void> {
  snapshotPaused = true
  if (snapshotTimer) clearTimeout(snapshotTimer)
  try {
    const [playerIds, matchIds] = await Promise.all([
      db.players.toCollection().primaryKeys(),
      db.matches.toCollection().primaryKeys(),
    ])
    rememberDeleted('players', playerIds.map(String))
    rememberDeleted('matches', matchIds.map(String))
    await db.transaction('rw', db.players, db.matches, db.settings, async () => {
      await Promise.all([
        db.players.clear(),
        db.matches.clear(),
        db.settings.clear(),
      ])
      await db.settings.put(DEFAULT_SETTINGS)
    })
    snapshotStore()?.removeItem(SNAPSHOT_KEY)
  } finally {
    snapshotPaused = false
    queueCloudPush()
  }
}
