import {
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  HashRouter,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { avatarById, pickAvatar } from './domain/avatars'
import {
  clearAllData,
  createMatch,
  createPlayer,
  db,
  deleteMatch,
  deletePlayer,
  exportBackup,
  getSettings,
  importBackup,
  saveSettings,
  updateMatch,
  updatePlayer,
} from './db/database'
import { getCloudSyncInfo, isCloudSyncEnabled } from './db/sync'
import {
  goalsText,
  playedPeriods,
  playerName,
  playerSeasonStats,
  scoreOf,
  teamSeasonStats,
  winnerLabel,
} from './domain/statistics'
import {
  DEFAULT_SETTINGS,
  createId,
  type FloorballMatch,
  type Player,
  type Team,
} from './domain/types'
import { exportMatchesToExcel } from './features/export/excel'
import { playFinalHorn, unlockAudio } from './features/match/sound'
import {
  formatTime,
  pauseTimer,
  remainingSeconds,
  resumeTimer,
} from './features/match/timer'
import './App.css'

const navItems = [
  ['/', 'Матч', 'M12 6v6l3.5 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z'],
  ['/players', 'Состав', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'],
  ['/history', 'Журнал', 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01'],
  ['/settings', 'Ещё', 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM12 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'],
] as const

function PlayerAvatar({ avatarId, size = 42 }: { avatarId?: string; size?: number }) {
  const avatar = avatarById(avatarId)
  return (
    <span
      className="funny-avatar"
      aria-hidden="true"
      style={{ width: size, height: size, background: avatar.bg, fontSize: size * 0.5 }}
    >
      {avatar.emoji}
    </span>
  )
}

function Shell() {
  const location = useLocation()
  const matchMode = location.pathname === '/match'

  useEffect(() => {
    void getSettings()
  }, [])

  return (
    <div className={`app-shell ${matchMode ? 'match-mode' : ''}`}>
      <header className="topbar">
        <img className="brand-mark" src={`${import.meta.env.BASE_URL}apple-touch-icon.png`} alt="" width={34} height={34} />
        <strong>Флор</strong>
        <SyncBadge />
      </header>
      <main className="page">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/match" element={<MatchPage />} />
          <Route path="/players" element={<PlayersPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <nav className="bottom-nav" aria-label="Основная навигация" hidden={matchMode}>
        <div className="bottom-nav-inner">
          {navItems.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={icon} />
              </svg>
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}

function useAppData() {
  const players = useLiveQuery(() => db.players.toArray())
  const matches = useLiveQuery(() => db.matches.toArray())
  const storedSettings = useLiveQuery(() => db.settings.get('main'))
  const settings = storedSettings ?? DEFAULT_SETTINGS
  const loading = players === undefined || matches === undefined
  const activeMatch = matches?.find((match) => match.status !== 'completed')
  return {
    players: players ?? [],
    matches: matches ?? [],
    settings,
    activeMatch,
    loading,
  }
}

function SyncBadge() {
  const [info, setInfo] = useState(() => getCloudSyncInfo())
  useEffect(() => {
    const refresh = () => setInfo(getCloudSyncInfo())
    window.addEventListener('flor-sync', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    const timer = window.setInterval(refresh, 1000)
    return () => {
      window.removeEventListener('flor-sync', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      window.clearInterval(timer)
    }
  }, [])
  if (!info.enabled) return null
  const label = !navigator.onLine
    ? 'офлайн'
    : info.lastError && !info.lastOkAt
      ? 'нет связи'
      : info.lastOkAt
        ? 'общая база'
        : 'синхронизация'
  return <span className={`sync-pill ${(!navigator.onLine || (info.lastError && !info.lastOkAt)) ? 'warn' : ''}`}>{label}</span>
}

function PageHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  )
}

function HomePage() {
  const { players, activeMatch } = useAppData()
  if (activeMatch) {
    const red = scoreOf(activeMatch, 'red')
    const blue = scoreOf(activeMatch, 'blue')
    return (
      <>
        <PageHeading title="Матч идёт" />
        <section className="hero-card">
          <span className="live-pill">Игра</span>
          <div className="hero-score">
            <b className="red-text">{red}</b>
            <span>:</span>
            <b className="blue-text">{blue}</b>
          </div>
          <p>
            {activeMatch.currentPeriod
              ? `Тайм ${activeMatch.currentPeriod}`
              : 'Таймер ещё не запускали'}
          </p>
          <NavLink className="primary-button" to="/match">К столу</NavLink>
        </section>
      </>
    )
  }
  return <NewMatch players={players.filter((player) => player.active)} />
}

function NewMatch({ players }: { players: Player[] }) {
  const navigate = useNavigate()
  const [red, setRed] = useState<string[]>([])
  const [blue, setBlue] = useState<string[]>([])
  const pointerStart = useRef<Record<string, number>>({})
  const assigned = new Set([...red, ...blue])
  const unassigned = players.filter((player) => !assigned.has(player.id))

  const assign = (id: string, team: Team) => {
    setRed((current) => team === 'red' ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id))
    setBlue((current) => team === 'blue' ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id))
  }

  const onPointerUp = (event: ReactPointerEvent, playerId: string) => {
    const delta = event.clientX - (pointerStart.current[playerId] ?? event.clientX)
    if (Math.abs(delta) >= 36) assign(playerId, delta < 0 ? 'red' : 'blue')
  }

  const startMatch = async () => {
    if (!red.length || !blue.length) {
      alert('Добавьте хотя бы по одному игроку в каждую команду.')
      return
    }
    await unlockAudio()
    const match: FloorballMatch = {
      id: createId(),
      status: 'ready',
      redPlayerIds: red,
      bluePlayerIds: blue,
      periodCount: 0,
      periodDurationSeconds: 10 * 60,
      currentPeriod: 0,
      timer: {
        durationSeconds: 10 * 60,
        remainingAtPause: 10 * 60,
        startedAt: null,
        running: false,
      },
      goals: [],
      notes: '',
      startedAt: new Date().toISOString(),
      endedAt: null,
    }
    await createMatch(match)
    navigate('/match', { state: { matchId: match.id } })
  }

  const byId = (id: string) => players.find((player) => player.id === id)

  return (
    <>
      <PageHeading title="Новый матч" />
      {!players.length && (
        <section className="empty-state">
          <h2>Нет игроков</h2>
          <NavLink className="primary-button" to="/players">К составу</NavLink>
        </section>
      )}
      {!!players.length && (
        <>
          <section className="team-board">
            <TeamBox team="red" ids={red} byId={byId} onMove={(id) => assign(id, 'blue')} />
            <div className="versus">VS</div>
            <TeamBox team="blue" ids={blue} byId={byId} onMove={(id) => assign(id, 'red')} />
          </section>

          <section className="card">
            <div className="section-title">
              <h2>Без команды</h2>
              <span>{unassigned.length}</span>
            </div>
            <div className="player-stack">
              {unassigned.map((player) => (
                <div
                  key={player.id}
                  className="swipe-player"
                  onPointerDown={(event) => { pointerStart.current[player.id] = event.clientX }}
                  onPointerUp={(event) => onPointerUp(event, player.id)}
                >
                  <button aria-label={`${player.name} в красную команду`} onClick={() => assign(player.id, 'red')} className="team-arrow red-bg">‹</button>
                  <div className="swipe-name">
                    <PlayerAvatar avatarId={player.avatarId} size={34} />
                    <strong>{player.name}</strong>
                  </div>
                  <button aria-label={`${player.name} в синюю команду`} onClick={() => assign(player.id, 'blue')} className="team-arrow blue-bg">›</button>
                </div>
              ))}
              {!unassigned.length && <p className="muted centered">Обе команды собраны.</p>}
            </div>
          </section>
          <button className="primary-button sticky-action" onClick={startMatch}>На стол</button>
        </>
      )}
    </>
  )
}

function TeamBox({
  team,
  ids,
  byId,
  onMove,
}: {
  team: Team
  ids: string[]
  byId: (id: string) => Player | undefined
  onMove: (id: string) => void
}) {
  return (
    <div className={`team-box ${team}`}>
      <span>{team === 'red' ? 'Красные' : 'Синие'}</span>
      <b>{ids.length}</b>
      <div>
        {ids.map((id) => {
          const player = byId(id)
          return (
            <button key={id} onClick={() => onMove(id)} title="Перекинуть в другую команду">
              <PlayerAvatar avatarId={player?.avatarId} size={22} />
              {player?.name ?? 'Игрок'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MatchPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { players, activeMatch, settings, loading } = useAppData()
  const pendingMatchId = (location.state as { matchId?: string } | null)?.matchId
  const [now, setNow] = useState(() => Date.now())
  const [sheet, setSheet] = useState<'goal' | 'menu' | null>(null)
  const [goalTeam, setGoalTeam] = useState<Team | null>(null)
  const [flash, setFlash] = useState('')
  const [finishing, setFinishing] = useState(false)
  const [customMinutes, setCustomMinutes] = useState<number | null>(null)
  const timeoutHandled = useRef(false)
  const minutes = customMinutes ?? Math.max(1, Math.round((activeMatch?.periodDurationSeconds || (settings.periodMinutes || 10) * 60) / 60))

  useEffect(() => {
    if (!activeMatch?.timer.running) return
    const interval = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(interval)
  }, [activeMatch?.timer.running])

  useEffect(() => {
    let lock: { release: () => Promise<void> } | undefined
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock
    if (activeMatch?.status === 'active' && wakeLock) {
      void wakeLock.request('screen').then((result) => { lock = result }).catch(() => undefined)
    }
    return () => { void lock?.release() }
  }, [activeMatch?.id, activeMatch?.status])

  const remaining = activeMatch ? remainingSeconds(activeMatch.timer, now) : 0

  useEffect(() => {
    if (!activeMatch || !activeMatch.timer.running || remaining > 0 || timeoutHandled.current) return
    timeoutHandled.current = true
    void updateMatch(activeMatch.id, {
      status: 'period-break',
      timer: pauseTimer(activeMatch.timer),
    }).then(() => {
      if (settings.soundEnabled) void playFinalHorn()
    })
  }, [activeMatch, remaining, settings.soundEnabled])

  useEffect(() => {
    if (activeMatch?.timer.running && remaining > 0) timeoutHandled.current = false
  }, [activeMatch?.timer.running, remaining])

  if (loading || (!activeMatch && pendingMatchId)) {
    return <div className="empty-state"><p>Загружаем матч…</p></div>
  }
  if (!activeMatch && finishing) return <div className="empty-state"><p>Сохраняем матч…</p></div>
  if (!activeMatch) return <Navigate to="/" replace />

  const idle = activeMatch.status === 'ready' || activeMatch.status === 'period-break'
  const teamPlayers = (team: Team) => {
    const ids = team === 'red' ? activeMatch.redPlayerIds : activeMatch.bluePlayerIds
    return ids.map((id) => players.find((player) => player.id === id)).filter(Boolean) as Player[]
  }

  const togglePause = async () => {
    if (idle) return
    await updateMatch(activeMatch.id, {
      timer: activeMatch.timer.running ? pauseTimer(activeMatch.timer) : resumeTimer(activeMatch.timer),
    })
    setNow(Date.now())
  }

  const addGoal = async (playerId: string | null) => {
    if (!goalTeam) return
    const period = Math.max(1, activeMatch.currentPeriod)
    const elapsedSeconds = Math.max(0, activeMatch.periodDurationSeconds - remaining)
    await updateMatch(activeMatch.id, (match) => ({
      ...match,
      goals: [...match.goals, {
        id: createId(),
        team: goalTeam,
        playerId,
        period,
        elapsedSeconds,
        createdAt: new Date().toISOString(),
      }],
    }))
    const who = playerName(players, playerId)
    setFlash(`${goalTeam === 'red' ? 'Красные' : 'Синие'} · ${who}`)
    window.setTimeout(() => setFlash(''), 1800)
    setGoalTeam(null)
    setSheet(null)
  }

  const startPeriod = async () => {
    const seconds = Math.max(1, minutes) * 60
    const nextPeriod = activeMatch.currentPeriod + 1
    await unlockAudio()
    await saveSettings({ periodMinutes: minutes })
    await updateMatch(activeMatch.id, {
      status: 'active',
      currentPeriod: nextPeriod,
      periodCount: nextPeriod,
      periodDurationSeconds: seconds,
      timer: {
        durationSeconds: seconds,
        remainingAtPause: seconds,
        startedAt: Date.now(),
        running: true,
      },
    })
  }

  const finishMatch = async () => {
    if (!confirm('Завершить матч и сохранить в журнал?')) return
    setFinishing(true)
    await updateMatch(activeMatch.id, {
      status: 'completed',
      periodCount: playedPeriods(activeMatch),
      endedAt: new Date().toISOString(),
      timer: pauseTimer(activeMatch.timer),
    })
    navigate('/history')
  }

  const removeLastGoal = async () => {
    if (!activeMatch.goals.length) return
    await updateMatch(activeMatch.id, (match) => ({
      ...match,
      goals: match.goals.slice(0, -1),
    }))
  }

  const saveNotes = (notes: string) => {
    void updateMatch(activeMatch.id, { notes })
  }

  const openGoal = () => {
    setGoalTeam(null)
    window.setTimeout(() => setSheet('goal'), 40)
  }

  return (
    <div className="desk">
      <header className="desk-top">
        <span className="desk-meta">{activeMatch.currentPeriod ? `Тайм ${activeMatch.currentPeriod}` : 'До старта'}</span>
        <span />
        <button className="desk-menu" aria-label="Меню матча" onClick={() => setSheet('menu')}>···</button>
      </header>

      <button
        className={`desk-clock ${!idle && remaining <= 10 ? 'urgent' : ''}`}
        onClick={togglePause}
      >
        {idle ? formatTime(minutes * 60) : formatTime(remaining)}
      </button>

      <div className="desk-score">
        <b className="red">{scoreOf(activeMatch, 'red')}</b>
        <span className="sep">:</span>
        <b className="blue">{scoreOf(activeMatch, 'blue')}</b>
      </div>
      <p className="flash">{flash || (!idle && !activeMatch.timer.running ? 'Пауза' : ' ')}</p>

      {idle ? (
        <div className="idle-panel">
          <div className="timer-setup">
            <button onClick={() => setCustomMinutes(Math.max(1, minutes - 1))}>−</button>
            <label>
              минут
              <input type="number" min="1" max="120" value={minutes} onChange={(event) => setCustomMinutes(Math.max(1, Number(event.target.value) || 1))} />
            </label>
            <button onClick={() => setCustomMinutes(Math.min(120, minutes + 1))}>+</button>
          </div>
          <button className="primary-button" onClick={startPeriod}>
            {activeMatch.currentPeriod ? 'Следующий тайм' : 'Начать тайм'}
          </button>
          <button className="desk-secondary" onClick={openGoal}>Записать гол</button>
        </div>
      ) : (
        <>
          <motion.button
            className="goal-hit"
            whileTap={{ scale: 0.97 }}
            onClick={openGoal}
          >
            ГОЛ
          </motion.button>
          <div className="desk-tools">
            <button onClick={togglePause}>{activeMatch.timer.running ? 'Пауза' : 'Дальше'}</button>
            <button onClick={removeLastGoal} disabled={!activeMatch.goals.length}>Отмена</button>
          </div>
        </>
      )}

      <AnimatePresence>
        {sheet && (
          <motion.div
            className="sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => { setSheet(null); setGoalTeam(null) }}
          >
            <motion.section
              className="sheet"
              role="dialog"
              aria-modal="true"
              initial={{ y: 40 }}
              animate={{ y: 0 }}
              exit={{ y: 48 }}
              transition={{ type: 'spring', damping: 28, stiffness: 280 }}
              onClick={(event) => event.stopPropagation()}
            >
              {sheet === 'goal' && !goalTeam && (
                <>
                  <h2 className="serif">Команда</h2>
                  <div className="team-choice">
                    <button className="red-bg" onClick={() => setGoalTeam('red')}>Красные</button>
                    <button className="blue-bg" onClick={() => setGoalTeam('blue')}>Синие</button>
                  </div>
                </>
              )}
              {sheet === 'goal' && goalTeam && (
                <>
                  <h2 className="serif">Кто забил</h2>
                  <div className="scorer-list">
                    {teamPlayers(goalTeam).map((player) => (
                      <button key={player.id} onClick={() => addGoal(player.id)}>
                        <PlayerAvatar avatarId={player.avatarId} size={28} />
                        {player.name}
                      </button>
                    ))}
                    <button onClick={() => addGoal(null)}>Пока без имени</button>
                  </div>
                  <button className="text-button" onClick={() => setGoalTeam(null)}>Назад</button>
                </>
              )}
              {sheet === 'menu' && (
                <>
                  <h2 className="serif">Матч</h2>
                  <div className="sheet-actions">
                    <button onClick={() => { setSheet(null); navigate('/') }}>К составам</button>
                    <button className="danger-text" onClick={finishMatch}>Завершить и сохранить</button>
                  </div>
                  <label className="notes-box">
                    Заметка
                    <textarea
                      value={activeMatch.notes ?? ''}
                      onChange={(event) => saveNotes(event.target.value)}
                      placeholder="Заметка к матчу"
                      maxLength={400}
                    />
                  </label>
                </>
              )}
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PlayersPage() {
  const players = useLiveQuery(() => db.players.orderBy('createdAt').toArray()) ?? []
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    if (editingId) {
      await updatePlayer(editingId, { name: trimmed })
    } else {
      await createPlayer({
        id: createId(),
        name: trimmed,
        note: '',
        avatarId: pickAvatar(players.map((player) => player.avatarId)),
        active: true,
        createdAt: new Date().toISOString(),
      })
    }
    setName('')
    setEditingId(null)
  }

  const edit = (player: Player) => {
    setName(player.name)
    setEditingId(player.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const removePlayer = async (player: Player) => {
    if (!confirm(`Удалить ${player.name} из состава?`)) return
    await deletePlayer(player.id)
    if (editingId === player.id) {
      setEditingId(null)
      setName('')
    }
  }

  return (
    <>
      <PageHeading title="Состав" />
      <form className="card player-form" onSubmit={submit}>
        <label>Имя<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Имя" maxLength={60} /></label>
        <button className="primary-button" type="submit">{editingId ? 'Сохранить' : 'Добавить'}</button>
        {editingId && <button type="button" className="text-button" onClick={() => { setEditingId(null); setName('') }}>Отмена</button>}
      </form>
      <div className="list">
        {players.map((player) => (
          <article className="list-card" key={player.id}>
            <PlayerAvatar avatarId={player.avatarId} size={52} />
            <div className="grow">
              <strong>{player.name}</strong>
            </div>
            <button className="icon-button" onClick={() => edit(player)}>Изм.</button>
            <button className="icon-button danger" onClick={() => void removePlayer(player)}>Удалить</button>
          </article>
        ))}
        {!players.length && <div className="empty-state"><h2>Список пуст</h2></div>}
      </div>
    </>
  )
}

function HistoryPage() {
  const { players, matches } = useAppData()
  const [tab, setTab] = useState<'matches' | 'goals' | 'wins'>('matches')
  const completed = matches
    .filter((match) => match.status === 'completed')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const season = teamSeasonStats(completed)
  const stats = playerSeasonStats(completed, players)

  return (
    <>
      <PageHeading title="Журнал" />
      {!!completed.length && (
        <>
          <div className="stat-strip">
            <span>{season.matches} матч.</span>
            <span>{season.goals} гол.</span>
            <span className="red-text">К {season.redWins}</span>
            <span className="blue-text">С {season.blueWins}</span>
            <span>Н {season.draws}</span>
          </div>
          <div className="journal-tabs">
            <button className={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}>Матчи</button>
            <button className={tab === 'goals' ? 'active' : ''} onClick={() => setTab('goals')}>Голы</button>
            <button className={tab === 'wins' ? 'active' : ''} onClick={() => setTab('wins')}>Победы</button>
          </div>
          <button className="primary-button excel-button" onClick={() => void exportMatchesToExcel(completed, players)}>
            Скачать Excel
          </button>
        </>
      )}
      {tab === 'matches' && (
        <div className="list">
          {completed.map((match) => <HistoryCard key={match.id} match={match} players={players} />)}
          {!completed.length && <div className="empty-state"><h2>Журнал пуст</h2></div>}
        </div>
      )}
      {tab === 'goals' && (
        <StatsTable
          rows={[...stats].sort((left, right) => right.goals - left.goals || right.games - left.games)}
          players={players}
          columns={['Г', 'И', 'Г/и']}
          values={(row) => [row.goals, row.games, row.games ? (row.goals / row.games).toFixed(1) : '0']}
        />
      )}
      {tab === 'wins' && (
        <StatsTable
          rows={[...stats].sort((left, right) => right.wins - left.wins || right.draws - left.draws || right.games - left.games)}
          players={players}
          columns={['И', 'В', 'Н', 'П']}
          values={(row) => [row.games, row.wins, row.draws, row.losses]}
        />
      )}
    </>
  )
}

function StatsTable({
  rows,
  players,
  columns,
  values,
}: {
  rows: ReturnType<typeof playerSeasonStats>
  players: Player[]
  columns: string[]
  values: (row: ReturnType<typeof playerSeasonStats>[number]) => Array<string | number>
}) {
  if (!rows.length) return <div className="empty-state"><h2>Пока нет статистики</h2></div>
  return (
    <div className="card stat-card">
      <table className="stat-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Игрок</th>
            {columns.map((column) => <th key={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const player = players.find((item) => item.id === row.playerId)
            return (
              <tr key={row.playerId}>
                <td>{index + 1}</td>
                <td>
                  <span className="stat-player">
                    <PlayerAvatar avatarId={player?.avatarId} size={28} />
                    {playerName(players, row.playerId)}
                  </span>
                </td>
                {values(row).map((value, cell) => <td key={cell}>{value}</td>)}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function HistoryCard({ match, players }: { match: FloorballMatch; players: Player[] }) {
  const [open, setOpen] = useState(false)
  const [team, setTeam] = useState<Team>('red')
  const [playerId, setPlayerId] = useState('')
  const [period, setPeriod] = useState(1)
  const [notes, setNotes] = useState(match.notes)
  const roster = team === 'red' ? match.redPlayerIds : match.bluePlayerIds
  const winner = winnerLabel(match)
  const periods = playedPeriods(match)

  const addMissingGoal = async () => {
    await updateMatch(match.id, (current) => ({
      ...current,
      goals: [...current.goals, {
        id: createId(),
        team,
        playerId: playerId || null,
        period: Math.min(Math.max(1, period), Math.max(1, periods)),
        elapsedSeconds: 0,
        createdAt: new Date().toISOString(),
      }],
    }))
    setPlayerId('')
  }

  const removeGoal = async (goalId: string) => {
    if (!confirm('Удалить этот гол?')) return
    await updateMatch(match.id, (current) => ({
      ...current,
      goals: current.goals.filter((goal) => goal.id !== goalId),
    }))
  }

  const removeMatch = async () => {
    if (!confirm('Удалить матч из журнала?')) return
    await deleteMatch(match.id)
  }

  return (
    <article className="history-card">
      <button className="history-summary" onClick={() => setOpen(!open)}>
        <time>{new Date(match.startedAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
        <b>{scoreOf(match, 'red')} : {scoreOf(match, 'blue')}</b>
        <span className={`winner-chip ${winner === 'Ничья' ? 'draw' : winner === 'Красные' ? 'red' : 'blue'}`}>{winner}</span>
        <span>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="history-details">
          <p className="muted">{periods ? `${periods} ${periods === 1 ? 'тайм' : 'тайма'}` : 'Таймер не запускали'} · {goalsText(match, players)}</p>
          <div className="rosters">
            <div>
              <b>Красные</b>
              {match.redPlayerIds.map((id) => {
                const player = players.find((item) => item.id === id)
                return <span key={id} className="roster-person"><PlayerAvatar avatarId={player?.avatarId} size={22} />{playerName(players, id)}</span>
              })}
            </div>
            <div>
              <b>Синие</b>
              {match.bluePlayerIds.map((id) => {
                const player = players.find((item) => item.id === id)
                return <span key={id} className="roster-person"><PlayerAvatar avatarId={player?.avatarId} size={22} />{playerName(players, id)}</span>
              })}
            </div>
          </div>
          <div className="period-scores">
            {Array.from({ length: Math.max(1, periods) }, (_, index) => index + 1).map((item) => (
              <span key={item}>
                Тайм {item}: {match.goals.filter((goal) => goal.period === item && goal.team === 'red').length}:{match.goals.filter((goal) => goal.period === item && goal.team === 'blue').length}
              </span>
            ))}
          </div>
          <h3>Голы</h3>
          {match.goals.map((goal) => (
            <div className="goal-row" key={goal.id}>
              <span className={`team-chip ${goal.team}`}>{goal.team === 'red' ? 'К' : 'С'}</span>
              <span className="grow">{playerName(players, goal.playerId)}</span>
              <small>{goal.period} тайм · {formatTime(goal.elapsedSeconds)}</small>
              <button onClick={() => removeGoal(goal.id)}>Удалить</button>
            </div>
          ))}
          <label className="notes-box">
            Заметка
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => { void updateMatch(match.id, { notes }) }}
              placeholder="Заметка к матчу"
              maxLength={400}
            />
          </label>
          <div className="correction-form">
            <h3>Добавить пропущенный гол</h3>
            <select value={team} onChange={(event) => { setTeam(event.target.value as Team); setPlayerId('') }}>
              <option value="red">Красные</option><option value="blue">Синие</option>
            </select>
            <select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>
              <option value="">Автор не указан</option>
              {roster.map((id) => <option value={id} key={id}>{playerName(players, id)}</option>)}
            </select>
            <input aria-label="Номер тайма" type="number" min="1" max={Math.max(1, periods)} value={period} onChange={(event) => setPeriod(Number(event.target.value))} />
            <button onClick={addMissingGoal}>Добавить</button>
          </div>
          <button className="danger-button" onClick={() => void removeMatch()}>Удалить матч</button>
        </div>
      )}
    </article>
  )
}

function SettingsPage() {
  const settings = useLiveQuery(() => db.settings.get('main')) ?? DEFAULT_SETTINGS
  const [message, setMessage] = useState('')

  const downloadBackup = async () => {
    const payload = await exportBackup()
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `floorball-backup-${new Date().toISOString().slice(0, 10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    setMessage('Резервная копия сохранена.')
  }

  const restoreBackup = async (file: File | undefined) => {
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      if (!confirm('Текущие данные будут заменены данными из файла. Продолжить?')) return
      await importBackup(parsed)
      setMessage('Данные успешно восстановлены.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось прочитать файл.')
    }
  }

  const erase = async () => {
    if (!confirm('Удалить игроков, матчи и настройки без возможности отмены?')) return
    await clearAllData()
    setMessage('Все данные удалены.')
  }

  return (
    <>
      <PageHeading title="Ещё" />
      <section className="card settings-list">
        <p>
          {isCloudSyncEnabled()
            ? 'Добавление, правка и удаление сразу пишутся в общее хранилище. Другие телефоны подтягивают это при открытии.'
            : 'Общая база сейчас выключена: данные остаются только на этом телефоне.'}
        </p>
        <label>
          <span><b>Финальный сигнал</b></span>
          <input type="checkbox" checked={settings.soundEnabled} onChange={(event) => { void saveSettings({ soundEnabled: event.target.checked }) }} />
        </label>
      </section>
      <section className="card backup-card">
        <h2>Резервная копия</h2>
        <button className="primary-button" onClick={downloadBackup}>Экспортировать JSON</button>
        <label className="file-button">Импортировать JSON<input type="file" accept="application/json,.json" onChange={(event) => restoreBackup(event.target.files?.[0])} /></label>
        {message && <p className="status-message">{message}</p>}
      </section>
      <section className="card danger-zone">
        <h2>Опасная зона</h2>
        <button onClick={erase}>Удалить все данные</button>
      </section>
    </>
  )
}

function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}

export default App
