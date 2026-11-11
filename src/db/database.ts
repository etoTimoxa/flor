import Dexie, { type EntityTable } from 'dexie'
import { pickAvatar } from '../domain/avatars'
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BackupPayload,
  type FloorballMatch,
  type Player,
} from '../domain/types'
import { canReachCloud, canUseCloud, readStore, writeStore } from './cloud'

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
const PENDING_KEY = 'flor-pending-upload'
let snapshotPaused = false
let snapshotTimer: ReturnType<typeof setTimeout> | undefined
let dataEpoch = 0
let writeGeneration = 0
let watchingCloud = false
let cloudWrite: Promise<void> = Promise.resolve()
let pendingMemory = false

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
  const payload: BackupPayload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    matches: await db.matches.toArray(),
    settings: (await db.settings.get('main')) ?? DEFAULT_SETTINGS,
  }
  store.setItem(SNAPSHOT_KEY, JSON.stringify(payload))
}

function queueSnapshot() {
  if (snapshotPaused) return
  if (!snapshotStore()) return
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    void saveLocalSnapshot()
  }, 300)
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
              queueSnapshot()
              return result
            })
          },
        }
      },
    }
  },
})

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

export async function applySharedState(
  value: BackupPayload,
  options: { preserveRunningMatch?: boolean } = {},
): Promise<void> {
  const taken: string[] = []
  const players = value.players.map((player) => {
    const avatarId = player.avatarId || pickAvatar(taken)
    taken.push(avatarId)
    return { ...player, avatarId, note: player.note ?? '' }
  })
  let matches = value.matches.map((match) => ({
    ...match,
    notes: match.notes ?? '',
    periodCount: match.periodCount ?? match.currentPeriod ?? 0,
  }))
  snapshotPaused = true
  try {
    if (options.preserveRunningMatch) {
      const live = (await db.matches.toArray()).find((match) => match.status !== 'completed' && match.timer.running)
      if (live) {
        const index = matches.findIndex((match) => match.id === live.id)
        if (index >= 0) matches[index] = live
        else matches = [...matches, live]
      }
    }
    const playerIds = new Set(players.map((player) => player.id))
    const matchIds = new Set(matches.map((match) => match.id))
    await db.transaction('rw', db.players, db.matches, db.settings, async () => {
      const [localPlayers, localMatches] = await Promise.all([
        db.players.toArray(),
        db.matches.toArray(),
      ])
      await Promise.all([
        ...localPlayers.filter((player) => !playerIds.has(player.id)).map((player) => db.players.delete(player.id)),
        ...localMatches.filter((match) => !matchIds.has(match.id)).map((match) => db.matches.delete(match.id)),
      ])
      if (players.length) await db.players.bulkPut(players)
      if (matches.length) await db.matches.bulkPut(matches)
      await db.settings.put({
        id: 'main',
        periodMinutes: value.settings.periodMinutes || DEFAULT_SETTINGS.periodMinutes,
        soundEnabled: value.settings.soundEnabled !== false,
      })
    })
  } finally {
    snapshotPaused = false
    await saveLocalSnapshot()
  }
}

function hasPendingUpload() {
  return pendingMemory || snapshotStore()?.getItem(PENDING_KEY) === '1'
}

function setPendingUpload() {
  pendingMemory = true
  snapshotStore()?.setItem(PENDING_KEY, '1')
}

function clearPendingUpload() {
  pendingMemory = false
  snapshotStore()?.removeItem(PENDING_KEY)
}

export function resetUploadState() {
  pendingMemory = false
  dataEpoch = 0
  writeGeneration += 1
  cloudWrite = Promise.resolve()
  snapshotStore()?.removeItem(PENDING_KEY)
}

async function currentLocal(): Promise<BackupPayload> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    matches: await db.matches.toArray(),
    settings: (await db.settings.get('main')) ?? DEFAULT_SETTINGS,
  }
}

async function hasLocalData() {
  const [playerCount, matchCount] = await Promise.all([db.players.count(), db.matches.count()])
  return playerCount + matchCount > 0
}

async function restoreLocalSnapshotIfEmpty() {
  const store = snapshotStore()
  if (!store) return
  if (await hasLocalData()) return
  const raw = store.getItem(SNAPSHOT_KEY)
  if (!raw) return
  try {
    snapshotPaused = true
    await importBackup(JSON.parse(raw), { skipCloud: true })
  } catch {
    store.removeItem(SNAPSHOT_KEY)
  } finally {
    snapshotPaused = false
  }
}

function watchCloudReconnect() {
  if (watchingCloud || typeof window === 'undefined') return
  watchingCloud = true
  window.addEventListener('online', () => { void flushPendingUpload() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushPendingUpload()
  })
}

export async function flushPendingUpload(): Promise<void> {
  if (!hasPendingUpload() || !canReachCloud()) return
  const generation = writeGeneration
  const task = async () => {
    if (generation !== writeGeneration || !hasPendingUpload() || !canReachCloud()) return
    await writeStore(await currentLocal())
    if (generation === writeGeneration) clearPendingUpload()
  }
  cloudWrite = cloudWrite.then(task, task)
  try {
    await cloudWrite
  } catch {
    if (generation === writeGeneration) setPendingUpload()
  }
}

async function enqueueCloudPut() {
  if (!canReachCloud()) {
    setPendingUpload()
    return
  }
  const epoch = dataEpoch
  const generation = writeGeneration
  const task = async () => {
    if (generation !== writeGeneration) return
    if (!canReachCloud()) {
      setPendingUpload()
      return
    }
    await writeStore(await currentLocal())
    if (generation === writeGeneration && epoch === dataEpoch) clearPendingUpload()
  }
  cloudWrite = cloudWrite.then(task, task)
  try {
    await cloudWrite
  } catch {
    if (generation === writeGeneration) setPendingUpload()
  }
}

async function refreshFromCloud() {
  if (!canReachCloud() || hasPendingUpload()) return
  const epoch = dataEpoch
  const state = await readStore()
  if (epoch !== dataEpoch || hasPendingUpload()) return
  await applySharedState(state)
}

export async function loadFromStore(): Promise<void> {
  watchCloudReconnect()
  await restoreLocalSnapshotIfEmpty()
  if (!canReachCloud()) return
  if (hasPendingUpload()) {
    void flushPendingUpload()
    return
  }
  if (await hasLocalData()) {
    void refreshFromCloud().catch(() => undefined)
    return
  }
  try {
    await applySharedState(await readStore())
  } catch {
    await restoreLocalSnapshotIfEmpty()
  }
}

export async function getSettings(): Promise<AppSettings> {
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

async function commit(mutator: (state: BackupPayload) => void) {
  const local = await currentLocal()
  mutator(local)
  local.exportedAt = new Date().toISOString()
  dataEpoch += 1
  await applySharedState(local)
  if (!canUseCloud()) return
  setPendingUpload()
  void enqueueCloudPut()
}

export async function createPlayer(player: Player) {
  await commit((state) => {
    state.players = [...state.players.filter((item) => item.id !== player.id), player]
  })
}

export async function updatePlayer(id: string, patch: Partial<Player>) {
  await commit((state) => {
    state.players = state.players.map((player) => player.id === id ? { ...player, ...patch } : player)
  })
}

export async function deletePlayer(id: string) {
  await commit((state) => {
    state.players = state.players.filter((player) => player.id !== id)
  })
}

export async function createMatch(match: FloorballMatch) {
  await commit((state) => {
    state.matches = [...state.matches.filter((item) => item.id !== match.id), match]
  })
}

export async function updateMatch(
  id: string,
  patch: Partial<FloorballMatch> | ((match: FloorballMatch) => FloorballMatch),
) {
  await commit((state) => {
    state.matches = state.matches.map((match) => {
      if (match.id !== id) return match
      return typeof patch === 'function' ? patch(match) : { ...match, ...patch }
    })
  })
}

export async function deleteMatch(id: string) {
  await commit((state) => {
    state.matches = state.matches.filter((match) => match.id !== id)
  })
}

export async function saveSettings(patch: Partial<AppSettings>) {
  await commit((state) => {
    state.settings = {
      id: 'main',
      periodMinutes: patch.periodMinutes ?? state.settings.periodMinutes,
      soundEnabled: patch.soundEnabled ?? state.settings.soundEnabled,
    }
  })
}

export async function exportBackup(): Promise<BackupPayload> {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    matches: await db.matches.toArray(),
    settings: await getSettings(),
  }
}

export async function importBackup(value: unknown, options: { skipCloud?: boolean } = {}): Promise<void> {
  if (!isBackup(value)) throw new Error('Файл не похож на резервную копию приложения.')
  if (options.skipCloud) {
    await applySharedState(value)
    return
  }
  await commit((state) => {
    state.players = value.players
    state.matches = value.matches
    state.settings = value.settings
  })
}

export async function clearAllData(): Promise<void> {
  await commit((state) => {
    state.players = []
    state.matches = []
    state.settings = DEFAULT_SETTINGS
  })
  snapshotStore()?.removeItem(SNAPSHOT_KEY)
}
