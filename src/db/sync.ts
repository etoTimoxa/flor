import { DEFAULT_SETTINGS, type BackupPayload } from '../domain/types'
import { db, importBackup, readTombstones } from './database'
import { canonicalize, fingerprint, mergePayloads } from './merge'

const DEFAULT_SYNC_URL = 'https://s3.regru.cloud/flor/state.json'
const configuredUrl = import.meta.env.VITE_SYNC_URL
const SYNC_URL = configuredUrl === '' ? '' : (configuredUrl || DEFAULT_SYNC_URL)
const PUSH_COOLDOWN_MS = 1500

let started = false
let pushing = false
let pulling = false
let paused = false
let pendingPush = false
let lastFingerprint = ''
let lastOkAt = 0
let lastPushAt = 0
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
    busy: pushing || pulling,
  }
}

async function readLocal(): Promise<BackupPayload> {
  const tombstones = readTombstones()
  return canonicalize({
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    matches: await db.matches.toArray(),
    settings: (await db.settings.get('main')) ?? DEFAULT_SETTINGS,
    deletedPlayerIds: tombstones.players,
    deletedMatchIds: tombstones.matches,
  })
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

async function fetchSync(url: string, init: RequestInit = {}) {
  return fetch(url, { credentials: 'omit', ...init })
}

function hasLiveMatch(payload: BackupPayload) {
  return payload.matches.some((match) => match.status !== 'completed')
}

async function pull() {
  if (!canSync() || paused || pushing || pulling) return
  if (lastPushAt && Date.now() - lastPushAt < PUSH_COOLDOWN_MS) return
  pulling = true
  notify()
  try {
    const response = await fetchSync(`${SYNC_URL}?t=${Date.now()}`)
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
    const remoteRaw = await response.json() as unknown
    if (!isPayload(remoteRaw)) {
      lastError = 'Общая база вернула непонятные данные'
      notify()
      return
    }
    const localPayload = await readLocal()
    const remote = canonicalize(remoteRaw)
    const merged = canonicalize(mergePayloads(localPayload, remote))
    const remoteFp = fingerprint(remote)
    const localFp = fingerprint(localPayload)
    const mergedFp = fingerprint(merged)
    if (mergedFp === localFp && mergedFp === remoteFp) {
      markOk(mergedFp)
      return
    }
    if (mergedFp !== localFp && !hasLiveMatch(localPayload)) {
      paused = true
      await importBackup(merged)
      paused = false
    }
    const latest = await readLocal()
    const latestMerged = canonicalize(mergePayloads(latest, remote))
    const latestFp = fingerprint(latestMerged)
    if (latestFp !== fingerprint(remote)) {
      await pushPayload(latestMerged)
      return
    }
    markOk(latestFp)
  } catch {
    lastError = 'Нет связи с общей базой'
    notify()
  } finally {
    paused = false
    pulling = false
    notify()
    if (pendingPush) {
      pendingPush = false
      queueCloudPush()
    }
  }
}

async function pushPayload(payload: BackupPayload) {
  if (!canSync() || paused) return
  const canonical = canonicalize({ ...payload, exportedAt: new Date().toISOString() })
  const fp = fingerprint(canonical)
  if (fp === lastFingerprint) {
    markOk(fp)
    return
  }
  const response = await fetchSync(SYNC_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(canonical),
  })
  if (response.ok) {
    lastPushAt = Date.now()
    markOk(fp)
  } else {
    lastError = `Не удалось записать в общую базу (${response.status})`
    notify()
  }
}

async function push() {
  if (!canSync() || paused || pushing) return
  pushing = true
  notify()
  try {
    await pushPayload(await readLocal())
  } catch {
    lastError = 'Нет связи с общей базой'
    notify()
  } finally {
    pushing = false
    notify()
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

export async function flushCloudPush() {
  if (!canSync()) return
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = undefined
  }
  pendingPush = false
  paused = false
  await push()
}

export function startCloudSync() {
  if (started || !canSync()) return
  started = true
  void pull()
  window.setInterval(() => { void pull() }, 4000)
  window.addEventListener('online', () => { void pull(); void push() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pull()
  })
}
