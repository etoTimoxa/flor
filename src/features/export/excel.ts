import {
  playedPeriods,
  playerName,
  rosterText,
  scoreOf,
  winnerLabel,
} from '../../domain/statistics'
import type { FloorballMatch, Player } from '../../domain/types'

export function formatGoalMinute(elapsedSeconds: number) {
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function chronologicalCompleted(matches: FloorballMatch[]) {
  return matches
    .filter((match) => match.status === 'completed')
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
}

export function matchSheetName(index: number, match: FloorballMatch) {
  const day = new Date(match.startedAt).toLocaleDateString('ru-RU')
  const score = `${scoreOf(match, 'red')}-${scoreOf(match, 'blue')}`
  return `${index}. ${day} ${score}`.replace(/[:\\/?*[\]']/g, ' ').trim().slice(0, 31)
}

export function summarySheetAoa(matches: FloorballMatch[], players: Player[]) {
  const completed = chronologicalCompleted(matches)
  const rows: (string | number)[][] = [[
    '№',
    'Дата',
    'Время',
    'Счёт',
    'Победитель',
    'Красные',
    'Синие',
    'Таймов',
    'Заметка',
  ]]

  completed.forEach((match, index) => {
    const started = new Date(match.startedAt)
    rows.push([
      index + 1,
      started.toLocaleDateString('ru-RU'),
      started.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
      `${scoreOf(match, 'red')} : ${scoreOf(match, 'blue')}`,
      winnerLabel(match),
      rosterText(players, match.redPlayerIds),
      rosterText(players, match.bluePlayerIds),
      playedPeriods(match),
      match.notes?.trim() || '',
    ])
  })

  return rows
}

export function matchProtocolAoa(match: FloorballMatch, players: Player[], index: number) {
  const started = new Date(match.startedAt)
  const periods = Math.max(1, playedPeriods(match))
  const redNames = match.redPlayerIds.map((id) => playerName(players, id))
  const blueNames = match.bluePlayerIds.map((id) => playerName(players, id))
  const rosterLines = Math.max(redNames.length, blueNames.length, 1)
  const goals = [...match.goals].sort(
    (left, right) => left.period - right.period || left.elapsedSeconds - right.elapsedSeconds,
  )

  const rows: (string | number)[][] = [
    [`Матч ${index}`],
    ['Дата', started.toLocaleDateString('ru-RU')],
    ['Время', started.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })],
    ['Счёт', `${scoreOf(match, 'red')} : ${scoreOf(match, 'blue')}`],
    ['Победитель', winnerLabel(match)],
    ['Таймов', playedPeriods(match)],
    ['Заметка', match.notes?.trim() || ''],
    [],
    ['Составы'],
    ['Красные', 'Синие'],
  ]

  for (let line = 0; line < rosterLines; line += 1) {
    rows.push([redNames[line] ?? '', blueNames[line] ?? ''])
  }

  rows.push([], ['Счёт по таймам'], ['Тайм', 'Красные', 'Синие'])
  for (let period = 1; period <= periods; period += 1) {
    rows.push([
      period,
      match.goals.filter((goal) => goal.period === period && goal.team === 'red').length,
      match.goals.filter((goal) => goal.period === period && goal.team === 'blue').length,
    ])
  }

  rows.push([], ['Голы'], ['Тайм', 'Время', 'Команда', 'Игрок'])
  if (!goals.length) {
    rows.push(['', '', '', 'Без голов'])
  } else {
    for (const goal of goals) {
      rows.push([
        goal.period,
        formatGoalMinute(goal.elapsedSeconds),
        goal.team === 'red' ? 'Красные' : 'Синие',
        playerName(players, goal.playerId),
      ])
    }
  }

  return rows
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function columnWidths(rows: (string | number)[][]) {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((cell, index) => {
      const length = String(cell ?? '').length
      widths[index] = Math.min(42, Math.max(widths[index] ?? 10, length + 2))
    })
  }
  return widths.map((wch) => ({ wch }))
}

export async function exportMatchesToExcel(matches: FloorballMatch[], players: Player[]) {
  const XLSX = await import('xlsx')
  const completed = chronologicalCompleted(matches)
  const workbook = XLSX.utils.book_new()

  const summary = summarySheetAoa(completed, players)
  const summarySheet = XLSX.utils.aoa_to_sheet(summary)
  summarySheet['!cols'] = columnWidths(summary)
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Сводка')

  const usedNames = new Set(['Сводка'])
  completed.forEach((match, index) => {
    const protocol = matchProtocolAoa(match, players, index + 1)
    const sheet = XLSX.utils.aoa_to_sheet(protocol)
    sheet['!cols'] = columnWidths(protocol)
    let name = matchSheetName(index + 1, match)
    if (usedNames.has(name)) name = `${index + 1} матч`.slice(0, 31)
    usedNames.add(name)
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  })

  const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  downloadBlob(
    new Blob([new Uint8Array(bytes)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    `flor-matches-${new Date().toISOString().slice(0, 10)}.xlsx`,
  )
}
