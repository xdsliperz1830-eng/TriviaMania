// The launch card in the feed. Play opens the full game; nothing starts on its own.
import { requestExpandedMode } from '@devvit/web/client'

type Splash = { today: string; players: number; played: boolean; score: number | null; prize: string | null }

const $ = (id: string) => document.getElementById(id)!

$('play').addEventListener('click', (ev) => requestExpandedMode(ev as MouseEvent, 'game'))

// A line about today, filled in when the server answers. The card works without it.
fetch('/api/splash')
  .then((r) => (r.ok ? (r.json() as Promise<Splash>) : null))
  .then((s) => {
    if (!s) return
    if (s.played && s.score !== null) $('today').textContent = `You scored ${s.score} in today's Daily Challenge. Play on for fun!`
    else if (s.players > 0) $('today').textContent = `${s.players} ${s.players === 1 ? 'player has' : 'players have'} taken today's Daily Challenge. Your turn!`
    $('board').textContent = s.prize ?? ''
  })
  .catch(() => {})
