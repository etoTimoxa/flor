import { DEFAULT_SETTINGS, type BackupPayload } from '../domain/types'
import { applySharedState, db, readTombstones } from './database'
import { canonicalize, fingerprint, mergePayloads } from './merge'

const DEFAULT_SYNC_URL = 'https://s3.regru.cloud/flor/state.json'
const configuredUrl = import.meta.env.VITE_SYNC_URL
const SYNC_URL = configuredUrl === '' ? '' : (configuredUrl || DEFAULT_SYNC_URL)
const LAST_OK_KEY = 'flor-sync-ok'
const LAST_FP_KEY = 'flor-sync-fp'
const FETCH_MS = 12000

let started = false
let busy = false
let lastFingerprint = ''
let lastOkAt = 0
let lastError = ''
let pushTimer: ReturnType<typeof setTimeout> | undefined
let queue: Promise<void> = Promise.resolve()

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

function loadPersisted() {
  try {
    lastOkAt = Number(localStorage.getItem(LAST_OK_KEY)) || 0
    lastFingerprint = localStorage.getItem(LAST_FP_KEY) || ''
  } catch {
    lastOkAt = 0
    lastFingerprint = ''
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
    busy,
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
  try {
    localStorage.setItem(LAST_OK_KEY, String(lastOkAt))
    localStorage.setItem(LAST_FP_KEY, fp)
  } catch {
    // Private mode can block storage; memory still keeps the successful sync.
  }
  notify()
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

async function fetchSync(url: string, init: RequestInit = {}): Promise<Response | null> {
  const result = await Promise.race([
    fetch(url, { credentials: 'omit', ...init }).then((response) => response, () => null),
    sleep(FETCH_MS).then(() => 'timeout' as const),
  ])
  if (!result || result === 'timeout') return null
  return result
}

function hasLiveMatch(payload: BackupPayload) {
  return payload.matches.some((match) => match.status !== 'completed')
}

function enqueue(task: () => Promise<void>) {
  const run = queue.then(task, task)
  queue = run.then(() => undefined, () => undefined)
  return run
}

async function pushPayload(payload: BackupPayload) {
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
  if (!response) return
  if (response.ok) markOk(fp)
}

async function syncRound(forcePush = false) {
  if (!canSync()) return
  busy = true
  notify()
  try {
    const localPayload = await readLocal()
    const response = await fetchSync(`${SYNC_URL}?t=${Date.now()}`)
    if (!response || !response.ok) {
      if (forcePush || localPayload.matches.length || localPayload.players.length) {
        await pushPayload(localPayload)
      }
      return
    }
    const remoteRaw = await response.json() as unknown
    if (!isPayload(remoteRaw)) {
      await pushPayload(localPayload)
      return
    }
    const remote = canonicalize(remoteRaw)
    const merged = canonicalize(mergePayloads(localPayload, remote))
    const localFp = fingerprint(localPayload)
    const remoteFp = fingerprint(remote)
    const mergedFp = fingerprint(merged)
    if (mergedFp === localFp && mergedFp === remoteFp) {
      markOk(mergedFp)
      return
    }
    if (mergedFp !== localFp && !hasLiveMatch(localPayload)) {
      await applySharedState(merged)
    }
    const latest = hasLiveMatch(localPayload) ? localPayload : await readLocal()
    const latestMerged = canonicalize(mergePayloads(latest, remote))
    if (forcePush || fingerprint(latestMerged) !== remoteFp) {
      await pushPayload(latestMerged)
      return
    }
    markOk(fingerprint(latestMerged))
  } catch {
    // Keep the last successful state on screen; the next round will retry.
  } finally {
    busy = false
    notify()
  }
}

export function queueCloudPush() {
  if (!canSync()) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    void enqueue(() => syncRound(true))
  }, 400)
}

export async function flushCloudPush() {
  if (!canSync()) return
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = undefined
  }
  await enqueue(() => syncRound(true))
}

export function startCloudSync() {
  if (started || !canSync()) return
  started = true
  loadPersisted()
  notify()
  void enqueue(() => syncRound(false))
  window.setInterval(() => {
    void enqueue(() => syncRound(false))
  }, 5000)
  window.addEventListener('online', () => {
    void enqueue(() => syncRound(true))
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void enqueue(() => syncRound(false))
  })
}
