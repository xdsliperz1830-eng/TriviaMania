// Moderator tools, scheduled jobs and the install trigger.
import { context, reddit, redis, settings } from '@devvit/web/server'
import type { UiResponse } from '@devvit/web/shared'
import { keys, namesFor, secret } from './game.ts'
import { monthOf, previousMonth, utcDay } from './rules.ts'

const MIN_ACCOUNT_DAYS = 30
const TOP = 10

function subreddit(): string {
  const name = context.subredditName
  if (!name) throw new Error('no subreddit in context')
  return name
}

function prettyDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
}

async function makePost(title: string) {
  return reddit.submitCustomPost({
    subredditName: subreddit(),
    title,
    entry: 'default',
    textFallback: { text: 'Brain Blast: a trivia game with a Daily Challenge and a monthly leaderboard. Open this post in the Reddit app or on new Reddit to play.' },
  })
}

/* ---------------------------------------------------------------- posts */

export async function menuNewPost(): Promise<UiResponse> {
  const post = await makePost('Brain Blast: trivia, a Daily Challenge and Block Blitz')
  return { showToast: { text: 'Game post created.', appearance: 'success' }, navigateTo: post.url }
}

export async function cronDailyPost() {
  if ((await settings.get<boolean>('dailyPost')) === false) return {}
  const day = utcDay()
  // One post a day even if the job runs twice.
  const first = await redis.set(keys.posted(day), '1', { nx: true, expiration: new Date(Date.now() + 3 * 86400_000) })
  if (!first) return {}
  await makePost(`Brain Blast Daily Challenge · ${prettyDay(day)}`)
  return {}
}

export async function onInstall() {
  await secret()
  await makePost('Brain Blast: trivia, a Daily Challenge and Block Blitz')
  return {}
}

/* ---------------------------------------------------------------- contest results */

export type Standing = {
  rank: number; uid: string; name: string; points: number; days: number; avgSeconds: number | null
  fastAnswers: number; accountDays: number | null; flags: string[]
}

/** The month's top players with what a moderator needs to check before announcing a winner. */
export async function standings(month: string, endOfMonth: number): Promise<Standing[]> {
  const top = await redis.zRange(keys.monthBoard(month), 0, TOP - 1, { by: 'rank', reverse: true })
  const names = await namesFor(top.map((t) => t.member))
  const out: Standing[] = []
  for (let i = 0; i < top.length; i++) {
    const uid = top[i]!.member
    const s = await redis.hGetAll(keys.monthStats(month, uid))
    const answers = Number(s.answers ?? 0)
    const fast = Number(s.fast ?? 0)
    const avg = answers ? Number(s.time ?? 0) / answers / 1000 : null
    let accountDays: number | null = null
    try {
      const user = await reddit.getUserById(uid as `t2_${string}`)
      if (user) accountDays = Math.floor((endOfMonth - user.createdAt.getTime()) / 86400_000)
    } catch { accountDays = null }
    const flags: string[] = []
    if (accountDays === null) flags.push('account not found')
    else if (accountDays < MIN_ACCOUNT_DAYS) flags.push(`account under ${MIN_ACCOUNT_DAYS} days old`)
    if (answers && fast / answers > 0.3) flags.push(`${fast} of ${answers} answers under 1.2 s`)
    if (avg !== null && avg < 2) flags.push('average answer under 2 s')
    out.push({ rank: i + 1, uid, name: names[i]!, points: Number(s.points ?? 0), days: Number(s.days ?? 0),
      avgSeconds: avg === null ? null : Math.round(avg * 10) / 10, fastAnswers: fast, accountDays, flags })
  }
  return out
}

function endOf(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return Date.UTC(y!, m!, 1) - 1
}

function describe(month: string, rows: Standing[]): string {
  if (!rows.length) return `${month}: no Daily Challenge scores.`
  const lines = rows.map((r) =>
    `${r.rank}. u/${r.name}: ${r.points} pts, ${r.days} days, avg ${r.avgSeconds ?? '–'} s` +
    (r.flags.length ? `  ⚠ ${r.flags.join('; ')}` : ''))
  return `${month}\n${lines.join('\n')}`
}

/** 1st of the month: freeze last month's standings so they can't change after the close. */
export async function cronMonthClose() {
  const month = previousMonth(utcDay())
  const rows = await standings(month, endOf(month))
  await redis.set(keys.results(month), JSON.stringify({ month, closedAt: Date.now(), rows }))
  return {}
}

export async function menuResults(): Promise<UiResponse> {
  const today = utcDay()
  const last = previousMonth(today)
  const frozen = await redis.get(keys.results(last))
  const lastRows: Standing[] = frozen ? JSON.parse(frozen).rows : await standings(last, endOf(last))
  const current = await standings(monthOf(today), Date.now())
  const text =
    `LAST MONTH (${frozen ? 'final' : 'not closed yet'})\n${describe(last, lastRows)}\n\n` +
    `THIS MONTH SO FAR\n${describe(monthOf(today), current)}\n\n` +
    'Before announcing a winner: check the flags, confirm the account is 18+ and in good standing, and contact them by modmail. ' +
    'Ties go to more days played, then less total answer time (already applied to the order).'
  return {
    showForm: {
      name: 'results',
      form: {
        title: 'Brain Blast contest standings',
        acceptLabel: 'Done',
        fields: [{ type: 'paragraph', name: 'standings', label: 'Daily Challenge totals', defaultValue: text, disabled: true }],
      },
    },
  }
}

export async function formResults() {
  return {}
}

/* ---------------------------------------------------------------- a player's data */

export async function menuDeleteData(): Promise<UiResponse> {
  if (!context.userId) return { showToast: 'Log in to manage your Brain Blast data.' }
  return {
    showForm: {
      name: 'deleteData',
      form: {
        title: 'Delete my Brain Blast data',
        description: 'Removes your saved progress and your scores from every leaderboard in this subreddit. This cannot be undone.',
        acceptLabel: 'Delete',
        fields: [{ type: 'boolean', name: 'confirm', label: 'Yes, delete my data' }],
      },
    },
  }
}

export async function formDeleteData(values: { confirm?: unknown }): Promise<UiResponse> {
  const uid = context.userId
  if (!uid || values?.confirm !== true) return { showToast: 'Nothing was deleted.' }
  await deleteUser(uid)
  return { showToast: { text: 'Your Brain Blast data was deleted.', appearance: 'success' } }
}

export async function deleteUser(uid: string, today: string = utcDay()): Promise<void> {
  await redis.del(keys.save(uid))
  await redis.hDel(keys.names, [uid])
  await redis.zRem(keys.blitzBoard, [uid])
  const months = [monthOf(today), previousMonth(today)]
  for (const m of months) {
    await redis.zRem(keys.monthBoard(m), [uid])
    await redis.del(keys.monthStats(m, uid))
  }
  // Day boards and rounds live 45 days at most; clear that window.
  const start = Date.parse(`${today}T00:00:00Z`)
  for (let d = 0; d < 46; d++) {
    const day = utcDay(start - d * 86400_000)
    await redis.zRem(keys.dayBoard(day), [uid])
    if (d < 3) await redis.del(keys.round(day, uid))
  }
}
