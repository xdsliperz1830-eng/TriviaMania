// Player-facing endpoints: saves, the server-run Daily Challenge, leaderboards.
import { randomBytes } from 'node:crypto'
import { context, redis, settings } from '@devvit/web/server'
import { RULES } from './bank.gen.ts'
import {
  type Item, FAST_MS, MAX_BLITZ, dailyItems, dayRank, monthOf, monthRank, pointsOf, score, utcDay,
} from './rules.ts'

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

const DAY_TTL_S = 60 * 60 * 24 * 3          // a day's round state outlives the day by a little
const BOARD_TTL_S = 60 * 60 * 24 * 45       // a day's board, for "yesterday" and the month close
const MAX_SAVE_BYTES = 100_000
const QUESTIONS_PER_DAY = 10

export const keys = {
  secret: 'secret',
  names: 'names',
  save: (uid: string) => `save:${uid}`,
  round: (day: string, uid: string) => `round:${day}:${uid}`,
  dayBoard: (day: string) => `lb:day:${day}`,
  monthBoard: (month: string) => `lb:month:${month}`,
  monthStats: (month: string, uid: string) => `stats:${month}:${uid}`,
  blitzBoard: 'lb:blitz',
  results: (month: string) => `results:${month}`,
  posted: (day: string) => `posted:${day}`,
}

function now(): number { return Date.now() }

function expiry(seconds: number): Date { return new Date(now() + seconds * 1000) }

function requireUser(): string {
  const uid = context.userId
  if (!uid) throw new HttpError(401, 'log in to play for the leaderboard')
  return uid
}

async function rememberName(uid: string): Promise<void> {
  if (context.username) await redis.hSet(keys.names, { [uid]: context.username })
}

/** The secret behind each day's questions: made once per subreddit, never sent to players. */
export async function secret(): Promise<string> {
  const have = await redis.get(keys.secret)
  if (have) return have
  await redis.set(keys.secret, randomBytes(32).toString('hex'), { nx: true })
  return (await redis.get(keys.secret))!
}

async function todaysItems(day: string): Promise<Item[]> {
  return dailyItems(await secret(), day)
}

/* ---------------------------------------------------------------- init / saves */

export async function init() {
  const uid = context.userId
  let progress: unknown = null
  if (uid) {
    const raw = await redis.get(keys.save(uid))
    if (raw) { try { progress = JSON.parse(raw) } catch { progress = null } }
  }
  return { today: utcDay(now()), now: now(), loggedIn: !!uid, username: context.username ?? null, progress }
}

export async function saveProgress(body: { progress?: unknown }) {
  const uid = requireUser()
  const raw = JSON.stringify(body?.progress ?? null)
  if (raw.length > MAX_SAVE_BYTES) throw new HttpError(413, 'save too large')
  await redis.set(keys.save(uid), raw)
  return { ok: true }
}

/* ---------------------------------------------------------------- daily */

type Round = { cur: number; servedAt: number; answered: boolean; total: number; correct: number; streak: number; time: number; fast: number; done: boolean }

async function readRound(day: string, uid: string): Promise<Round | null> {
  const h = await redis.hGetAll(keys.round(day, uid))
  if (!h || h.cur === undefined) return null
  return {
    cur: Number(h.cur), servedAt: Number(h.servedAt), answered: h.answered === '1',
    total: Number(h.total), correct: Number(h.correct), streak: Number(h.streak),
    time: Number(h.time), fast: Number(h.fast), done: h.done === '1',
  }
}

async function writeRound(day: string, uid: string, r: Round): Promise<void> {
  const k = keys.round(day, uid)
  await redis.hSet(k, {
    cur: String(r.cur), servedAt: String(r.servedAt), answered: r.answered ? '1' : '0',
    total: String(r.total), correct: String(r.correct), streak: String(r.streak),
    time: String(r.time), fast: String(r.fast), done: r.done ? '1' : '0',
  })
  await redis.expire(k, DAY_TTL_S)
}

/** Points and tie-break data for the month, and both boards, after a change to today's round. */
async function publish(day: string, uid: string, r: Round, delta: { points: number; time: number; fast: number; answers: number; days: number }) {
  const month = monthOf(day)
  const sk = keys.monthStats(month, uid)
  if (delta.points) await redis.hIncrBy(sk, 'points', delta.points)
  if (delta.time) await redis.hIncrBy(sk, 'time', delta.time)
  if (delta.fast) await redis.hIncrBy(sk, 'fast', delta.fast)
  if (delta.answers) await redis.hIncrBy(sk, 'answers', delta.answers)
  if (delta.days) await redis.hIncrBy(sk, 'days', delta.days)
  const s = await redis.hGetAll(sk)
  await redis.zAdd(keys.monthBoard(month), { member: uid, score: monthRank(Number(s.points ?? 0), Number(s.days ?? 0), Number(s.time ?? 0)) })
  const dk = keys.dayBoard(day)
  await redis.zAdd(dk, { member: uid, score: dayRank(r.total, r.time) })
  await redis.expire(dk, BOARD_TTL_S)
}

function checkDay(day: unknown): string {
  const today = utcDay(now())
  if (day !== today) throw new HttpError(409, `the day is ${today}`)
  return today
}

/** An in-progress round may finish a little after midnight; its day is the one it started on. */
function roundDay(day: unknown): string {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError(400, 'bad day')
  const started = Date.parse(`${day}T00:00:00Z`)
  if (!(now() >= started && now() < started + 26 * 3600_000)) throw new HttpError(409, 'that round is over')
  return day
}

export async function dailyStart(body: { date?: unknown }) {
  const uid = requireUser()
  const day = checkDay(body?.date)
  const existing = await readRound(day, uid)
  if (existing) {
    // One scored try a day: a round that was started (then reloaded, or
    // played on another device) is over, with what it scored.
    if (!existing.done) { existing.done = true; await writeRound(day, uid, existing) }
    return { played: { score: existing.total, correct: existing.correct } }
  }
  const r: Round = { cur: 0, servedAt: now(), answered: false, total: 0, correct: 0, streak: 0, time: 0, fast: 0, done: false }
  await writeRound(day, uid, r)
  await rememberName(uid)
  await publish(day, uid, r, { points: 0, time: 0, fast: 0, answers: 0, days: 1 })
  const items = await todaysItems(day)
  return { count: QUESTIONS_PER_DAY, item: items[0] }
}

export async function dailyNext(body: { date?: unknown; i?: unknown }) {
  const uid = requireUser()
  const day = roundDay(body?.date)
  const i = Number(body?.i)
  const r = await readRound(day, uid)
  if (!r || r.done) throw new HttpError(409, 'no round in progress')
  const items = await todaysItems(day)
  // A repeat of the last request (its reply was lost): same question, same clock.
  if (i === r.cur && !r.answered) return items[i]
  if (i !== r.cur + 1 || i >= QUESTIONS_PER_DAY) throw new HttpError(409, 'out of order')
  const limit = RULES.timeLimit * 1000
  if (!r.answered) {
    // The last question was never answered: it timed out.
    r.streak = 0
    r.time += limit
    await publish(day, uid, r, { points: 0, time: limit, fast: 0, answers: 1, days: 0 })
  }
  r.cur = i
  r.servedAt = now()
  r.answered = false
  await writeRound(day, uid, r)
  return items[i]
}

export async function dailyAnswer(body: { date?: unknown; i?: unknown; pick?: unknown }) {
  const uid = requireUser()
  const day = roundDay(body?.date)
  const i = Number(body?.i)
  const pick = Number(body?.pick)
  if (!Number.isInteger(pick) || pick < -1 || pick > 3) throw new HttpError(400, 'bad pick')
  const r = await readRound(day, uid)
  if (!r || i !== r.cur) throw new HttpError(409, 'not the current question')
  if (r.answered) return { total: r.total, repeat: true }
  const elapsed = now() - r.servedAt
  const s = score(pick, elapsed, r.streak)
  const limit = RULES.timeLimit * 1000
  const time = Math.min(limit, Math.max(0, elapsed))
  const fast = s.correct && elapsed < FAST_MS ? 1 : 0
  r.answered = true
  r.streak = s.streak
  r.total += s.points
  r.correct += s.correct ? 1 : 0
  r.time += time
  r.fast += fast
  r.done = i === QUESTIONS_PER_DAY - 1
  await writeRound(day, uid, r)
  await publish(day, uid, r, { points: s.points, time, fast, answers: 1, days: 0 })
  return { correct: s.correct, timedOut: s.timedOut, points: s.points, speedBonus: s.speedBonus, streakBonus: s.streakBonus, total: r.total }
}

/* ---------------------------------------------------------------- Block Blitz */

export async function blitz(body: { score?: unknown }) {
  const uid = requireUser()
  const s = Number(body?.score)
  if (!Number.isInteger(s) || s < 0 || s > MAX_BLITZ) throw new HttpError(400, 'bad score')
  const before = await redis.zScore(keys.blitzBoard, uid)
  if (before === undefined || before === null || s > before) {
    await rememberName(uid)
    await redis.zAdd(keys.blitzBoard, { member: uid, score: s })
  }
  return { best: Math.max(s, Number(before ?? 0)) }
}

/* ---------------------------------------------------------------- leaderboards */

export type Board = 'day' | 'month' | 'blitz'

export function boardKey(board: Board, day: string): string {
  return board === 'day' ? keys.dayBoard(day) : board === 'month' ? keys.monthBoard(monthOf(day)) : keys.blitzBoard
}

export async function namesFor(uids: string[]): Promise<string[]> {
  if (!uids.length) return []
  const got = await redis.hMGet(keys.names, uids)
  return uids.map((_, i) => got[i] ?? 'player')
}

export async function leaderboard(board: string | null) {
  if (board !== 'day' && board !== 'month' && board !== 'blitz') throw new HttpError(400, 'bad board')
  const uid = context.userId
  const day = utcDay(now())
  const key = boardKey(board, day)
  const top = await redis.zRange(key, 0, 9, { by: 'rank', reverse: true })
  const names = await namesFor(top.map((t) => t.member))
  const rows = top.map((t, i) => ({ rank: i + 1, name: names[i]!, score: pointsOf(t.score, board), me: t.member === uid }))
  let me: { rank: number; score: number } | null = null
  if (uid) {
    const s = await redis.zScore(key, uid)
    if (s !== undefined && s !== null) {
      const asc = await redis.zRank(key, uid)
      const count = await redis.zCard(key)
      if (asc !== undefined && asc !== null) me = { rank: count - asc, score: pointsOf(s, board) }
    }
  }
  const prize = board === 'month' ? await prizeLine() : null
  return { board, rows, me, prize, loggedIn: !!uid }
}

/** The moderators' prize text (a subreddit setting), or null when there is no prize. */
async function prizeLine(): Promise<string | null> {
  const text = await settings.get<string>('monthlyPrize')
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, 300) : null
}

/** For the launch card: how many have played today, and whether this player has. */
export async function splash() {
  const day = utcDay(now())
  const players = await redis.zCard(keys.dayBoard(day))
  const uid = context.userId
  const mine = uid ? await readRound(day, uid) : null
  return { today: day, players, played: !!mine, score: mine ? mine.total : null, prize: await prizeLine() }
}
