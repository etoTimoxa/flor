import { DEFAULT_SETTINGS, type BackupPayload } from '../domain/types'
import { db, importBackup, readTombstones } from './database'
import { fingerprint, mergePayloads } from './merge'

const DEFAULT_SYNC_URL = 'https://s3.regru.cloud/flor/state.json'
const configuredUrl = import.meta.env.VITE_SYNC_URL
const SYNC_URL = configuredUrl === '' ? '' : (configuredUrl || DEFAULT_SYNC_URL)

let started = false
let pushing = false
let pulling = false
let paused = false
let pendingPush = false
let lastFingerprint = ''
let lastOkAt = 0
let lastError = ''
let pushTimer: ReturnType<typeof setTimeout> | undefined

function canSync() {
  return Boolean(SYNC_URL)
    && typeof fetch === 'function'
    && !import.meta.env.VITEST
    && import.meta.env.MODE !== 'test'
}

function notify() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('flor-sync'))
}

export function isCloudSyncEnabled() {
  return canSync()
}

export function getCloudSyncInfo() {
  return {
    enabled: canSync(),
    lastOkAt,
    lastError,
  }
}

async function readLocal(): Promise<BackupPayload> {
  const tombstones = readTombstones()
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    matches: await db.matches.toArray(),
    settings: (await db.settings.get('main')) ?? DEFAULT_SETTINGS,
    deletedPlayerIds: tombstones.players,
    deletedMatchIds: tombstones.matches,
  }
}

function isPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<BackupPayload>
  return Array.isArray(payload.players) && Array.isArray(payload.matches) && !!payload.settings
}

function markOk(fp: string) {
  lastFingerprint = fp
  lastOkAt = Date.now()
  lastError = ''
  notify()
}

async function pull() {
  if (!canSync() || paused || pushing || pulling) return
  pulling = true
  try {
    const response = await fetch(`${SYNC_URL}?t=${Date.now()}`, { cache: 'no-store', credentials: 'omit' })
    if (response.status === 404) {
      pulling = false
      await push()
      return
    }
    if (!response.ok) {
      lastError = `Не удалось прочитать общую базу (${response.status})`
      notify()
      return
    }
    const remote = await response.json() as unknown
    if (!isPayload(remote)) {
      lastError = 'Общая база вернула непонятные данные'
      notify()
      return
    }
    const localPayload = await readLocal()
    const merged = mergePayloads(localPayload, remote)
    const remoteFp = fingerprint(remote)
    const localFp = fingerprint(localPayload)
    const mergedFp = fingerprint(merged)
    if (mergedFp === localFp && mergedFp === remoteFp) {
      markOk(mergedFp)
      return
    }
    if (mergedFp !== localFp) {
      paused = true
      await importBackup(merged)
    }
    if (mergedFp !== remoteFp) {
      pulling = false
      paused = false
      await push()
      return
    }
    markOk(mergedFp)
  } catch {
    lastError = 'Нет связи с общей базой'
    notify()
  } finally {
    paused = false
    pulling = false
    if (pendingPush) {
      pendingPush = false
      queueCloudPush()
    }
  }
}

async function push() {
  if (!canSync() || paused || pushing) return
  pushing = true
  try {
    const payload = await readLocal()
    const fp = fingerprint(payload)
    if (fp === lastFingerprint) return
    const response = await fetch(SYNC_URL, {
      method: 'PUT',
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (response.ok) {
      markOk(fp)
    } else {
      lastError = `Не удалось записать в общую базу (${response.status})`
      notify()
    }
  } catch {
    lastError = 'Нет связи с общей базой'
    notify()
  } finally {
    pushing = false
  }
}

export function queueCloudPush() {
  if (!canSync()) return
  if (paused) {
    pendingPush = true
    return
  }
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { void push() }, 400)
}

export function startCloudSync() {
  if (started || !canSync()) return
  started = true
  void pull()
  window.setInterval(() => { void pull() }, 2500)
  window.addEventListener('online', () => { void pull(); void push() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pull()
  })
}
