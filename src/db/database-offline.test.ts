import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Player } from '../domain/types'

const readStore = vi.fn()
const writeStore = vi.fn()

vi.mock('./cloud', () => ({
  canUseCloud: () => true,
  canReachCloud: () => true,
  readStore: (...args: unknown[]) => readStore(...args),
  writeStore: (...args: unknown[]) => writeStore(...args),
}))

const { createPlayer, db, flushPendingUpload, loadFromStore, resetUploadState } = await import('./database')

const player: Player = {
  id: 'p1',
  name: 'Анна',
  note: '',
  avatarId: 'fox',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('local copy when cloud is down', () => {
  beforeEach(async () => {
    resetUploadState()
    readStore.mockReset()
    writeStore.mockReset()
    await db.open()
    await db.players.clear()
    await db.matches.clear()
    await db.settings.clear()
  })

  it('keeps a player locally if the cloud write fails, then uploads later', async () => {
    writeStore.mockRejectedValue(new Error('offline'))
    await createPlayer(player)
    expect((await db.players.get('p1'))?.name).toBe('Анна')

    writeStore.mockResolvedValue(undefined)
    await flushPendingUpload()
    expect(writeStore).toHaveBeenCalled()
    const uploaded = writeStore.mock.calls.at(-1)?.[0] as { players: Player[] }
    expect(uploaded.players.map((item) => item.id)).toContain('p1')
  })

  it('keeps the local roster if the cloud cannot be read on open', async () => {
    await db.players.add(player)
    readStore.mockRejectedValue(new Error('offline'))
    await loadFromStore()
    expect(await db.players.count()).toBe(1)
    expect((await db.players.get('p1'))?.name).toBe('Анна')
  })

  it('loads the shared roster when there is no local copy', async () => {
    readStore.mockResolvedValue({
      version: 1,
      exportedAt: '2026-01-02T00:00:00.000Z',
      players: [player],
      matches: [],
      settings: DEFAULT_SETTINGS,
    })
    await loadFromStore()
    expect((await db.players.get('p1'))?.name).toBe('Анна')
  })
})
