import { DEFAULT_SETTINGS, type BackupPayload } from '../domain/types'
import { db, importBackup } from './database'

const DEFAULT_SYNC_URL = 'https://s3.regru.cloud/flor/state.json'
const configuredUrl = import.meta.env.VITE_SYNC_URL
const SYNC_URL = configuredUrl === '' ? '' : (configuredUrl || DEFAULT_SYNC_URL)

let started = false
let pushing = false
let pulling = false
let paused = false
let lastFingerprint = ''
let lastOkAt = 0
let lastError = ''
let pushTimer: ReturnType<typeof setTimeout> | undefined

function fingerprint(payload: BackupPayload) {
  return JSON.stringify({
    players: payload.players,
    matches: payload.matches,
    settings: payload.settings,
  })
}

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
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    players: await db.players.toArray(),
    matches: await db.matches.toArray(),
    settings: (await db.settings.get('main')) ?? DEFAULT_SETTINGS,
  }
}

function isPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<BackupPayload>
  return Array.isArray(payload.players) && Array.isArray(payload.matches) && !!payload.settings
}

async function pull() {
  if (!canSync() || paused || pushing || pulling) return
  pulling = true
  try {
    const response = await fetch(SYNC_URL, { cache: 'no-store', credentials: 'omit' })
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
    const fp = fingerprint(remote)
    const localPayload = await readLocal()
    const local = fingerprint(localPayload)
    if (fp === local) {
      lastFingerprint = fp
      lastOkAt = Date.now()
      lastError = ''
      notify()
      return
    }
    const remoteEmpty = remote.players.length === 0 && remote.matches.length === 0
    const localHasData = localPayload.players.length > 0 || localPayload.matches.length > 0
    if (remoteEmpty && localHasData) {
      pulling = false
      await push()
      return
    }
    if (lastFingerprint && local !== lastFingerprint) {
      pulling = false
      await push()
      return
    }
    paused = true
    await importBackup(remote)
    lastFingerprint = fp
    lastOkAt = Date.now()
    lastError = ''
    notify()
  } catch {
    lastError = 'Нет связи с общей базой'
    notify()
  } finally {
    paused = false
    pulling = false
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
      lastFingerprint = fp
      lastOkAt = Date.now()
      lastError = ''
      notify()
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
  if (!canSync() || paused) return
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
