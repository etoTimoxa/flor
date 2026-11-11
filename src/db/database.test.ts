import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { applySharedState, clearAllData, db, exportBackup, importBackup } from './database'
import { DEFAULT_SETTINGS, type BackupPayload, type FloorballMatch, type Player } from '../domain/types'

const player: Player = {
  id: 'p1',
  name: 'Анна',
  note: '',
  avatarId: 'fox',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const match: FloorballMatch = {
  id: 'm1',
  status: 'completed',
  redPlayerIds: ['p1'],
  bluePlayerIds: ['p1'],
  periodCount: 1,
  periodDurationSeconds: 60,
  currentPeriod: 1,
  timer: {
    durationSeconds: 60,
    remainingAtPause: 0,
    startedAt: null,
    running: false,
  },
  goals: [],
  notes: 'Первый баттл',
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: '2026-01-01T00:01:00.000Z',
}

describe('backup restore', () => {
  beforeEach(async () => {
    await db.open()
    await clearAllData()
  })

  it('restores players, matches and settings from a valid file', async () => {
    const backup: BackupPayload = {
      version: 1,
      exportedAt: '2026-01-02T00:00:00.000Z',
      players: [player],
      matches: [match],
      settings: {
        id: 'main',
        periodMinutes: 7,
        soundEnabled: false,
      },
    }

    await importBackup(backup)
    const restored = await exportBackup()
    expect(restored.players).toEqual([player])
    expect(restored.matches[0].notes).toBe('Первый баттл')
    expect(restored.settings.periodMinutes).toBe(7)
    expect(restored.settings.soundEnabled).toBe(false)
  })

  it('rejects a damaged backup file', async () => {
    await expect(importBackup({ version: 2, players: [] })).rejects.toThrow(/резервную копию/)
  })

  it('applies remote matches without wiping local players', async () => {
    await db.players.add(player)
    await applySharedState({
      version: 1,
      exportedAt: '2026-01-03T00:00:00.000Z',
      players: [player],
      matches: [match],
      settings: DEFAULT_SETTINGS,
    })
    const restored = await exportBackup()
    expect(restored.players).toHaveLength(1)
    expect(restored.matches).toHaveLength(1)
  })
})
