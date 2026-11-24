// The Daily Challenge rules, kept free of Reddit and Redis so they can be
// tested on their own.
import { createHmac } from 'node:crypto'
import { BANK, RULES } from './bank.gen.ts'

export type Item = { id: string; order: number[] }

/** A little slack for the trip to the server and back, so a quick tap is not docked speed bonus. */
export const LATENCY_ALLOWANCE_MS = 600
/** An answer arriving this long after the timer ran out still counts as a time-out, not as cheating. */
export const GRACE_MS = 2000
/** Answers faster than this are noted for moderators (reading the question takes longer). */
export const FAST_MS = 1200

/** Today's date in UTC, the same day for every player wherever they are. */
export function utcDay(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10)
}

export function monthOf(day: string): string {
  return day.slice(0, 7)
}

export function previousMonth(day: string): string {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7))
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/** A stream of numbers in [0, 1) from a secret and a day: unknown before the day, the same for everyone on it. */
function stream(secret: string, day: string): () => number {
  let counter = 0
  let pool: Buffer = Buffer.alloc(0)
  return () => {
    if (pool.length < 4) {
      pool = createHmac('sha256', secret).update(`${day}:${counter++}`).digest()
    }
    const n = pool.readUInt32BE(0)
    pool = pool.subarray(4)
    return n / 2 ** 32
  }
}

function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * Today's ten: one question from each category, in a shuffled order, each
 * with its answers shuffled. order[k] is the index into the question's
 * answers (a[0] is always the right one) shown in place k.
 */
export function dailyItems(secret: string, day: string): Item[] {
  const rnd = stream(secret, day)
  const picks = Object.keys(BANK).map((cat) => {
    const ids = BANK[cat]!
    return ids[Math.floor(rnd() * ids.length)]!
  })
  return shuffle(picks, rnd).map((id) => ({ id, order: shuffle([0, 1, 2, 3], rnd) }))
}

export type Scored = { correct: boolean; points: number; speedBonus: number; streakBonus: number; streak: number; timedOut: boolean }

/**
 * The game's own formula (index.html, Game.answer), on the server's clock.
 * pick is an index into the question's answers; 0 is right, -1 is a time-out.
 */
export function score(pick: number, elapsedMs: number, streakBefore: number): Scored {
  const limit = RULES.timeLimit * 1000
  const timedOut = pick < 0 || elapsedMs > limit + GRACE_MS
  if (timedOut || pick !== 0) return { correct: false, points: 0, speedBonus: 0, streakBonus: 0, streak: 0, timedOut }
  const used = Math.min(limit, Math.max(0, elapsedMs - LATENCY_ALLOWANCE_MS))
  const timeLeft = (limit - used) / 1000
  const streak = streakBefore + 1
  const speedBonus = Math.round(RULES.maxSpeedBonus * (timeLeft / RULES.timeLimit))
  const streakBonus = Math.min(RULES.maxStreakBonus, (streak - 1) * RULES.streakStep)
  return { correct: true, points: RULES.basePoints + speedBonus + streakBonus, speedBonus, streakBonus, streak, timedOut: false }
}

/*
 * Leaderboard order. Redis sorted sets order by one number, so the tie-breaks
 * are packed into it below the points:
 *   month: points, then more days played, then less total answer time
 *   day:   points, then less total answer time
 * Points stay well under 2^53 / 1e9, so the packing is exact.
 */
const TIME_CAP = 999_999 // tenths of a second

export function monthRank(points: number, days: number, timeMs: number): number {
  const tenths = Math.min(TIME_CAP, Math.round(timeMs / 100))
  return points * 1e9 + Math.min(999, days) * 1e6 + (TIME_CAP - tenths)
}

export function dayRank(points: number, timeMs: number): number {
  const tenths = Math.min(TIME_CAP, Math.round(timeMs / 100))
  return points * 1e6 + (TIME_CAP - tenths)
}

export function pointsOf(rank: number, board: 'day' | 'month' | 'blitz'): number {
  if (board === 'blitz') return rank
  return Math.floor(rank / (board === 'month' ? 1e9 : 1e6))
}

/** Highest believable Block Blitz score; anything above is ignored. */
export const MAX_BLITZ = 5_000_000
