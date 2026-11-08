export interface FunnyAvatar {
  id: string
  emoji: string
  title: string
  bg: string
}

export const AVATARS: FunnyAvatar[] = [
  { id: 'fox', emoji: '🦊', title: 'Кафедральный лис', bg: '#ead7c3' },
  { id: 'duck', emoji: '🦆', title: 'Утка с кафедры', bg: '#d7e6dc' },
  { id: 'owl', emoji: '🦉', title: 'Сова учёного совета', bg: '#ddd6ea' },
  { id: 'bear', emoji: '🐻', title: 'Медведь методсовета', bg: '#e6d5c4' },
  { id: 'cat', emoji: '🐱', title: 'Кот с пересдачи', bg: '#ead9d4' },
  { id: 'penguin', emoji: '🐧', title: 'Пингвин в галстуке', bg: '#d5dde8' },
  { id: 'raccoon', emoji: '🦝', title: 'Енот из деканата', bg: '#e2d6ca' },
  { id: 'sloth', emoji: '🦥', title: 'Доцент неспешный', bg: '#e8dccb' },
  { id: 'tiger', emoji: '🐯', title: 'Тигр первой пары', bg: '#ead3bf' },
  { id: 'panda', emoji: '🐼', title: 'Панда после комиссии', bg: '#e4e2de' },
  { id: 'frog', emoji: '🐸', title: 'Лягушка с кафедры', bg: '#d7e6d2' },
  { id: 'cactus', emoji: '🌵', title: 'Кактус приёмной', bg: '#d8e4d4' },
  { id: 'potato', emoji: '🥔', title: 'Картофель столовой', bg: '#e6d8c6' },
  { id: 'octopus', emoji: '🐙', title: 'Восемь пар в неделю', bg: '#e5d4dc' },
  { id: 'snail', emoji: '🐌', title: 'Улитка аккредитации', bg: '#e8dcc8' },
  { id: 'shark', emoji: '🦈', title: 'Акула зачётки', bg: '#d2dce6' },
  { id: 'ghost', emoji: '👻', title: 'Призрак нагрузки', bg: '#e6e4df' },
  { id: 'robot', emoji: '🤖', title: 'Бот электронки', bg: '#d7e2e8' },
  { id: 'mushroom', emoji: '🍄', title: 'Гриб после совещания', bg: '#ead4d4' },
  { id: 'chicken', emoji: '🐔', title: 'Курица с планёрки', bg: '#eadcc8' },
  { id: 'dragon', emoji: '🐲', title: 'Дракон расписания', bg: '#d6e4d4' },
  { id: 'unicorn', emoji: '🦄', title: 'Единорог гранта', bg: '#e6d6e4' },
  { id: 'alien', emoji: '👽', title: 'Иногородний коллега', bg: '#d6e6d8' },
  { id: 'banana', emoji: '🍌', title: 'Банан из автомата', bg: '#eee4c4' },
]

export function avatarById(id: string | undefined): FunnyAvatar {
  return AVATARS.find((item) => item.id === id) ?? AVATARS[0]
}

export function pickAvatar(taken: string[] = []): string {
  const unused = AVATARS.filter((item) => !taken.includes(item.id))
  const pool = unused.length ? unused : AVATARS
  return pool[Math.floor(Math.random() * pool.length)].id
}
