// Reddit's side of the game. Loaded before game.js, it defines
// window.BrainBlastPlatform, which the game uses in place of its YouTube
// layer (see "Another host can replace this object" in ../index.html).
//
// Saves go to the app's server (localStorage is wiped whenever the app is
// updated), the Daily Challenge is run and scored by the server, and the
// leaderboards come from it too. A logged-out player can still play
// everything; their progress stays on the device and the Daily Challenge runs
// locally, unscored.
import { showLoginPrompt } from '@devvit/web/client'

type Init = { today: string; now: number; loggedIn: boolean; username: string | null; progress: unknown }

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const rsp = await fetch(`/api/${path}`, body === undefined
    ? { method: 'GET' }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!rsp.ok) throw new ApiError(rsp.status, `${path}: ${rsp.status}`)
  return rsp.json() as Promise<T>
}

/** Retry once on a network failure or server error; a 4xx is an answer, not a glitch. */
async function retrying<T>(path: string, body?: unknown): Promise<T> {
  try {
    return await api<T>(path, body)
  } catch (e) {
    if (e instanceof ApiError && e.status < 500) throw e
    await new Promise((r) => setTimeout(r, 400))
    return api<T>(path, body)
  }
}

function timeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))])
}

// Start at once: the game waits for its saved progress before showing the home screen.
const started = Date.now()
let skewMs = 0
let loggedIn = false
const ready: Promise<Init | null> = timeout(
  api<Init>('init').then((r) => {
    // The day turns over on the server's clock, not the device's.
    skewMs = r.now - (started + Date.now()) / 2
    loggedIn = r.loggedIn
    return r
  }),
  4000,
  null,
).catch(() => null)

const daily = {
  start: (date: string) => retrying('daily/start', { date }),
  next: (date: string, i: number) => retrying('daily/next', { date, i }),
  answer: (date: string, i: number, pick: number) => retrying('daily/answer', { date, i, pick }),
}

let readySent = false

const platform = {
  inPlayables: false,
  version: 'reddit',

  firstFrameReady() {},
  gameReady() { readySent = true },
  isReady() { return readySent },

  // The game already pauses itself when the page is hidden.
  onPause(_fn: () => void) {},
  onResume(_fn: () => void) {},
  audioEnabled() { return true },
  onAudioEnabledChange(_fn: (on: boolean) => void) {},

  sendScore(_value: number) {},       // scores go to the server as they happen
  logError() {},

  language() {
    return Promise.resolve((navigator.languages && navigator.languages[0]) || navigator.language || 'en')
  },

  load() {
    return ready.then((r) => (r && r.progress && typeof r.progress === 'object' ? r.progress : null))
  },

  save(payload: unknown) {
    if (!loggedIn) return Promise.resolve(false)
    return api('progress', { progress: payload }).then(() => true, () => false)
  },

  /** Today's Daily Challenge, in UTC: one day for the whole subreddit. */
  dailyDate() {
    return new Date(Date.now() + skewMs).toISOString().slice(0, 10)
  },

  /** Only a logged-in player's Daily Challenge is run by the server (it needs to know who is playing). */
  get daily() {
    return loggedIn ? daily : undefined
  },

  leaderboard(board: string) {
    return retrying(`leaderboard?board=${encodeURIComponent(board)}`)
  },

  login() { showLoginPrompt() },

  blitzScore(score: number) {
    if (loggedIn) api('blitz', { score }).catch(() => {})
  },
}

;(window as unknown as { BrainBlastPlatform: typeof platform }).BrainBlastPlatform = platform
