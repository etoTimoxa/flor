import { DEFAULT_SETTINGS, type BackupPayload } from '../domain/types'
import { applySharedState, db, readTombstones } from './database'
import { canonicalize, fingerprint, mergePayloads } from './merge'

const DEFAULT_SYNC_URL = 'https://s3.regru.cloud/flor/state.json'
const configuredUrl = import.meta.env.VITE_SYNC_URL
const SYNC_URL = configuredUrl === '' ? '' : (configuredUrl || DEFAULT_SYNC_URL)
const RESET_KEY = 'flor-sync-reset'

let started = false
let pushing = false
let pulling = false
let paused = false
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

function resetStaleDeviceState() {
  try {
    if (localStorage.getItem(RESET_KEY) === '5') return
    localStorage.removeItem('flor-sync-fp')
    localStorage.removeItem('flor-sync-ok')
    localStorage.removeItem('flor-tombstones')
    localStorage.setItem(RESET_KEY, '5')
  } catch {
    lastFingerprint = ''
    lastOkAt = 0
  }
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

function markOk(fp?: string) {
  if (fp) lastFingerprint = fp
  lastOkAt = Date.now()
  lastError = ''
  notify()
}

function hasLiveMatch(payload: BackupPayload) {
  return payload.matches.some((match) => match.status !== 'completed')
}

function timedFetch(url: string, init: RequestInit = {}, timeoutMs = 6000) {
  return Promise.race([
    fetch(url, { credentials: 'omit', mode: 'cors', ...init }),
    new Promise<Response>((_, reject) => {
      window.setTimeout(() => reject(new Error('timeout')), timeoutMs)
    }),
  ])
}

async function pushPayload(payload: BackupPayload) {
  if (!canSync() || paused) return
  const canonical = canonicalize({ ...payload, exportedAt: new Date().toISOString() })
  const fp = fingerprint(canonical)
  if (fp === lastFingerprint) {
    markOk(fp)
    return
  }
  pushing = true
  notify()
  try {
    const response = await timedFetch(SYNC_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(canonical),
    }, 8000)
    if (response?.ok) markOk(fp)
  } catch {
    // Retry on the next interval instead of locking the badge.
  } finally {
    pushing = false
    notify()
  }
}

async function pull() {
  if (!canSync() || paused || pushing || pulling) return
  pulling = true
  notify()
  try {
    const response = await timedFetch(SYNC_URL)
    if (!response.ok) return
    const remoteRaw = await response.json() as unknown
    if (!isPayload(remoteRaw)) return
    markOk()
    const localPayload = await readLocal()
    const remote = canonicalize(remoteRaw)
    const merged = canonicalize(mergePayloads(localPayload, remote))
    const localFp = fingerprint(localPayload)
    const remoteFp = fingerprint(remote)
    const mergedFp = fingerprint(merged)
    if (mergedFp === localFp && mergedFp === remoteFp) {
      markOk(mergedFp)
      return
    }
    if (hasLiveMatch(localPayload)) {
      pulling = false
      await pushPayload(localPayload)
      return
    }
    if (mergedFp !== localFp) {
      paused = true
      await applySharedState(merged)
      paused = false
    }
    if (mergedFp !== remoteFp) {
      pulling = false
      await pushPayload(merged)
      return
    }
    markOk(mergedFp)
  } catch {
    // Keep retrying; a timeout on iPhone must not freeze the badge.
  } finally {
    paused = false
    pulling = false
    notify()
  }
}

async function push() {
  if (!canSync() || paused || pushing) return
  await pushPayload(await readLocal())
}

export function queueCloudPush() {
  if (!canSync() || paused) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => { void push() }, 250)
}

export async function flushCloudPush() {
  if (!canSync()) return
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = undefined
  }
  paused = false
  await push()
}

export function startCloudSync() {
  if (started || !canSync()) return
  started = true
  resetStaleDeviceState()
  void pull()
  window.setInterval(() => { void pull() }, 2500)
  window.addEventListener('online', () => { void pull(); void push() })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pull()
  })
}
