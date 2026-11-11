import { DEFAULT_SETTINGS, type BackupPayload } from '../domain/types'
import { canonicalize } from './merge'

const DEFAULT_SYNC_URL = 'https://s3.regru.cloud/flor/state.json'
const configuredUrl = import.meta.env.VITE_SYNC_URL
const SYNC_URL = configuredUrl === '' ? '' : (configuredUrl || DEFAULT_SYNC_URL)

let lastOkAt = 0
let lastError = ''

export function canUseCloud() {
  return Boolean(SYNC_URL)
    && typeof fetch === 'function'
    && !import.meta.env.VITEST
    && import.meta.env.MODE !== 'test'
}

export function getCloudSyncInfo() {
  return {
    enabled: canUseCloud(),
    lastOkAt,
    lastError,
    busy: false,
  }
}

export function isCloudSyncEnabled() {
  return canUseCloud()
}

function notify() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event('flor-sync'))
}

function emptyState(): BackupPayload {
  return canonicalize({
    version: 1,
    exportedAt: new Date().toISOString(),
    players: [],
    matches: [],
    settings: DEFAULT_SETTINGS,
  })
}

function isPayload(value: unknown): value is BackupPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<BackupPayload>
  return Array.isArray(payload.players) && Array.isArray(payload.matches) && !!payload.settings
}

function fetchCloud(init: RequestInit = {}, timeoutMs = 8000) {
  return Promise.race([
    fetch(SYNC_URL, { credentials: 'omit', mode: 'cors', ...init }),
    new Promise<Response>((_, reject) => {
      window.setTimeout(() => reject(new Error('timeout')), timeoutMs)
    }),
  ])
}

export async function readStore(): Promise<BackupPayload> {
  const response = await fetchCloud()
  if (response.status === 404) {
    lastOkAt = Date.now()
    lastError = ''
    notify()
    return emptyState()
  }
  if (!response.ok) {
    lastError = 'нет связи'
    notify()
    throw new Error(`read ${response.status}`)
  }
  const raw = await response.json() as unknown
  lastOkAt = Date.now()
  lastError = ''
  notify()
  if (!isPayload(raw)) return emptyState()
  return canonicalize(raw)
}

export async function writeStore(state: BackupPayload): Promise<void> {
  const payload = canonicalize({ ...state, exportedAt: new Date().toISOString() })
  const response = await fetchCloud({
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    lastError = 'нет связи'
    notify()
    throw new Error(`write ${response.status}`)
  }
  lastOkAt = Date.now()
  lastError = ''
  notify()
}

export async function mutateStore(mutator: (state: BackupPayload) => void): Promise<BackupPayload> {
  let lastErrorMessage = 'Не удалось сохранить в общую базу'
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const state = await readStore()
    mutator(state)
    try {
      await writeStore(state)
      return canonicalize(state)
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : lastErrorMessage
    }
  }
  throw new Error(lastErrorMessage)
}
