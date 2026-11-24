// Server tests: the rules on their own, then every endpoint through onReq
// against an in-memory Redis, with the clock under the test's control.
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, mock, test } from 'node:test'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Context, reddit, runWithContext, settings } from '@devvit/web/server'
import { FakeRedis } from './testing.ts'
import { BANK, RULES } from './bank.gen.ts'
import { dailyItems, dayRank, monthRank, pointsOf, previousMonth, score } from './rules.ts'
import { onReq } from './server.ts'

/* ---------------------------------------------------------------- fakes */

let db: FakeRedis
let settingValues: Record<string, unknown>
let posts: { title: string }[]
let accountsCreated: Record<string, Date>

const DAY = Date.UTC(2031, 2, 14, 9, 0, 0)   // 2031-03-14, 09:00 UTC
const TODAY = '2031-03-14'

beforeEach(() => {
  db = new FakeRedis()
  db.install()
  settingValues = { monthlyPrize: 'Top player wins a $20 gift card.', dailyPost: true }
  posts = []
  accountsCreated = {}
  mock.method(settings as any, 'get', async (name: string) => settingValues[name])
  mock.method(reddit as any, 'submitCustomPost', async (o: { title: string }) => {
    posts.push(o); return { id: 't3_post', url: 'https://reddit.com/r/test/comments/post' }
  })
  mock.method(reddit as any, 'getUserById', async (id: string) =>
    accountsCreated[id] ? { createdAt: accountsCreated[id] } : undefined)
  mock.timers.enable({ apis: ['Date'], now: DAY })
})

afterEach(() => {
  mock.timers.reset()
  mock.restoreAll()
})

function tick(ms: number) { mock.timers.tick(ms) }

type Who = { userId?: string; username?: string }

async function call(who: Who, method: 'GET' | 'POST', url: string, body?: unknown): Promise<{ status: number; json: any }> {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]) as unknown as IncomingMessage
  req.url = url
  req.method = method
  let status = 0
  let text = ''
  const done = new Promise<void>((resolve) => {
    const rsp = {
      writeHead(s: number) { status = s; return rsp },
      end(b: string) { text = b; resolve() },
    } as unknown as ServerResponse
    const ctx = { subredditName: 'testsub', postId: 't3_post', userId: who.userId, username: who.username } as unknown as Context
    void runWithContext(ctx, () => onReq(req, rsp))
  })
  await done
  return { status, json: JSON.parse(text) }
}

const alice = { userId: 't2_alice', username: 'alice' }
const bob = { userId: 't2_bob', username: 'bob' }
const nobody = {}

/** Play a whole day: answer each question right (true), wrong (false) or let it time out (null), waiting `ms` before each. */
async function playDay(who: Who, picks: (boolean | null)[], ms = 2000) {
  const start = await call(who, 'POST', '/api/daily/start', { date: TODAY })
  assert.equal(start.status, 200)
  let total = 0
  for (let i = 0; i < picks.length; i++) {
    if (i > 0) assert.equal((await call(who, 'POST', '/api/daily/next', { date: TODAY, i })).status, 200)
    tick(ms)
    const p = picks[i]
    if (p === null) continue
    const a = await call(who, 'POST', '/api/daily/answer', { date: TODAY, i, pick: p ? 0 : 2 })
    assert.equal(a.status, 200)
    total = a.json.total
  }
  return total
}

/* ---------------------------------------------------------------- rules */

test('the bank matches the game: ten categories, each with questions', () => {
  assert.equal(Object.keys(BANK).length, 10)
  for (const ids of Object.values(BANK)) assert.ok(ids.length >= 30)
  assert.deepEqual(RULES, { timeLimit: 15, basePoints: 100, maxSpeedBonus: 50, streakStep: 10, maxStreakBonus: 50 })
})

test("a day's questions: one per category, shuffled answers, fixed for the day, secret beforehand", () => {
  const a = dailyItems('s3cret', TODAY)
  assert.equal(a.length, 10)
  const cats = a.map((it) => Object.keys(BANK).find((c) => BANK[c]!.includes(it.id)))
  assert.equal(new Set(cats).size, 10, 'one question from each category')
  for (const it of a) assert.deepEqual([...it.order].sort(), [0, 1, 2, 3], 'answers are a shuffle of the four')
  assert.deepEqual(dailyItems('s3cret', TODAY), a, 'the same for everyone on the day')
  assert.notDeepEqual(dailyItems('s3cret', '2031-03-15'), a, 'a new set the next day')
  assert.notDeepEqual(dailyItems('other', TODAY), a, 'another secret gives other questions')
  // The right answer lands in every position across days, not always the same place.
  const where = new Set<number>()
  for (let d = 1; d <= 9; d++) for (const it of dailyItems('s3cret', `2031-04-0${d}`)) where.add(it.order.indexOf(0))
  assert.equal(where.size, 4)
})

test("scoring follows the game's formula on the server's clock", () => {
  assert.equal(score(0, 0, 0).points, 150, 'instant right answer: 100 + 50 speed')
  assert.equal(score(0, 500, 0).points, 150, 'the trip to the server is not docked')
  assert.equal(score(0, 7_500 + 600, 0).points, 125, 'half the time left: half the speed bonus')
  assert.equal(score(0, 15_000 + 600, 0).points, 100, 'right at the buzzer: base points only')
  assert.equal(score(0, 0, 3).streakBonus, 30, 'fourth in a row: +30')
  assert.equal(score(0, 0, 9).streakBonus, 50, 'the streak bonus is capped at 50')
  assert.deepEqual([score(2, 0, 4).points, score(2, 0, 4).streak], [0, 0], 'wrong: nothing, and the streak breaks')
  assert.equal(score(-1, 3000, 4).timedOut, true)
  assert.equal(score(0, 17_500, 0).points, 0, 'too late, past the grace period: counts as a time-out')
})

test('leaderboard order: points first, then days played, then less time', () => {
  assert.ok(monthRank(1000, 1, 0) > monthRank(999, 31, 0))
  assert.ok(monthRank(1000, 5, 90_000) > monthRank(1000, 4, 10_000))
  assert.ok(monthRank(1000, 5, 40_000) > monthRank(1000, 5, 41_000))
  assert.equal(pointsOf(monthRank(43_210, 20, 123_456), 'month'), 43_210)
  assert.ok(dayRank(1500, 20_000) > dayRank(1500, 21_000))
  assert.equal(pointsOf(dayRank(1500, 20_000), 'day'), 1500)
  assert.equal(previousMonth('2031-01-05'), '2030-12')
  assert.equal(previousMonth('2031-03-01'), '2031-02')
})

/* ---------------------------------------------------------------- endpoints */

test('init: who is playing, the server day and clock, and their save', async () => {
  const out = await call(nobody, 'GET', '/api/init')
  assert.deepEqual([out.json.loggedIn, out.json.today, out.json.now, out.json.progress], [false, TODAY, DAY, null])
  await call(alice, 'POST', '/api/progress', { progress: { best: { 10: 900 } } })
  const mine = await call(alice, 'GET', '/api/init')
  assert.deepEqual([mine.json.loggedIn, mine.json.username, mine.json.progress], [true, 'alice', { best: { 10: 900 } }])
})

test('saves need a login and have a size limit', async () => {
  assert.equal((await call(nobody, 'POST', '/api/progress', { progress: {} })).status, 401)
  const big = { seen: 'x'.repeat(120_000) }
  assert.equal((await call(alice, 'POST', '/api/progress', { progress: big })).status, 413)
})

test('unknown routes and wrong methods are 404s', async () => {
  assert.equal((await call(alice, 'GET', '/api/nope')).status, 404)
  assert.equal((await call(alice, 'GET', '/api/daily/start')).status, 404)
})

test('the Daily Challenge needs a login and today’s date', async () => {
  assert.equal((await call(nobody, 'POST', '/api/daily/start', { date: TODAY })).status, 401)
  assert.equal((await call(alice, 'POST', '/api/daily/start', { date: '2031-03-13' })).status, 409)
})

test('a full day: questions one at a time, scored by the server, on the boards', async () => {
  const start = await call(alice, 'POST', '/api/daily/start', { date: TODAY })
  assert.equal(start.json.count, 10)
  const secret = db.strings.get('secret')!
  const items = dailyItems(secret, TODAY)
  assert.deepEqual(start.json.item, items[0], 'the first question is the day’s first')

  tick(500)
  const a0 = await call(alice, 'POST', '/api/daily/answer', { date: TODAY, i: 0, pick: 0 })
  assert.equal(a0.json.correct, true)
  assert.equal(a0.json.total, 150, 'a quick right answer earns the full speed bonus')
  const again = await call(alice, 'POST', '/api/daily/answer', { date: TODAY, i: 0, pick: 0 })
  assert.equal(again.json.repeat, true, 'a repeated answer is not scored twice')
  assert.equal(again.json.total, 150)

  assert.equal((await call(alice, 'POST', '/api/daily/next', { date: TODAY, i: 2 })).status, 409, 'no skipping ahead')
  const n1 = await call(alice, 'POST', '/api/daily/next', { date: TODAY, i: 1 })
  assert.deepEqual(n1.json, items[1])
  const n1again = await call(alice, 'POST', '/api/daily/next', { date: TODAY, i: 1 })
  assert.deepEqual(n1again.json, items[1], 'asking again for the current question (a lost reply) is fine')

  tick(20_000)
  const late = await call(alice, 'POST', '/api/daily/answer', { date: TODAY, i: 1, pick: 0 })
  assert.equal(late.json.points, 0, 'an answer after the timer and grace scores nothing')

  // Question 2 is never answered: asking for 3 counts it as a time-out.
  await call(alice, 'POST', '/api/daily/next', { date: TODAY, i: 2 })
  tick(3000)
  await call(alice, 'POST', '/api/daily/next', { date: TODAY, i: 3 })
  const answerLate = await call(alice, 'POST', '/api/daily/answer', { date: TODAY, i: 2, pick: 0 })
  assert.equal(answerLate.status, 409, 'a question left behind cannot be answered later')

  let total = 150
  for (let i = 3; i < 10; i++) {
    if (i > 3) await call(alice, 'POST', '/api/daily/next', { date: TODAY, i })
    tick(2000)
    total = (await call(alice, 'POST', '/api/daily/answer', { date: TODAY, i, pick: 0 })).json.total
  }
  // Seven in a row at 2 s: speed 50 - round(50*1.4/15)=45 each; streak bonus 0,10,...,50 capped.
  const expect = 150 + [0, 10, 20, 30, 40, 50, 50].reduce((s, b) => s + 100 + 45 + b, 0)
  assert.equal(total, expect)

  const replay = await call(alice, 'POST', '/api/daily/start', { date: TODAY })
  assert.deepEqual(replay.json.played, { score: expect, correct: 8 }, 'one scored try a day')

  const day = await call(alice, 'GET', '/api/leaderboard?board=day')
  assert.deepEqual(day.json.rows, [{ rank: 1, name: 'alice', score: expect, me: true }])
  assert.equal(day.json.prize, null, 'the prize line is only on the monthly board')
  const month = await call(alice, 'GET', '/api/leaderboard?board=month')
  assert.equal(month.json.rows[0].score, expect)
  assert.equal(month.json.prize, 'Top player wins a $20 gift card.')
})

test('a round started and then abandoned counts as played, with what it scored', async () => {
  await call(alice, 'POST', '/api/daily/start', { date: TODAY })
  tick(500)
  await call(alice, 'POST', '/api/daily/answer', { date: TODAY, i: 0, pick: 0 })
  const again = await call(alice, 'POST', '/api/daily/start', { date: TODAY })
  assert.deepEqual(again.json.played, { score: 150, correct: 1 })
  assert.equal((await call(alice, 'POST', '/api/daily/next', { date: TODAY, i: 1 })).status, 409, 'and it cannot carry on')
})

test('a round may finish just after midnight', async () => {
  mock.timers.setTime(Date.UTC(2031, 2, 14, 23, 59, 50))
  await call(alice, 'POST', '/api/daily/start', { date: TODAY })
  tick(20_000)
  assert.equal((await call(alice, 'POST', '/api/daily/answer', { date: TODAY, i: 0, pick: 0 })).status, 200)
  assert.equal((await call(alice, 'POST', '/api/daily/next', { date: TODAY, i: 1 })).status, 200)
})

test('the monthly board adds up days, and ties go to more days played', async () => {
  const a = await playDay(alice, [true, true, true, true, true, true, true, true, true, true])
  const b = await playDay(bob, [true, true, true, true, true, true, true, true, true, true])
  assert.equal(a, b)
  mock.timers.setTime(Date.UTC(2031, 2, 15, 9))
  const start = await call(bob, 'POST', '/api/daily/start', { date: '2031-03-15' })
  assert.equal(start.status, 200)
  // Bob played a second day but has scored nothing on it yet: same points, more days.
  const month = await call(alice, 'GET', '/api/leaderboard?board=month')
  assert.deepEqual(month.json.rows.map((r: any) => [r.name, r.score]), [['bob', b], ['alice', a]])
  assert.deepEqual(month.json.me, { rank: 2, score: a })
  const day = await call(alice, 'GET', '/api/leaderboard?board=day')
  assert.deepEqual(day.json.rows.map((r: any) => [r.name, r.score]), [['bob', 0]], 'the day board is today’s only')
  assert.equal(day.json.me, null)
})

test('Block Blitz keeps each player’s best and ignores impossible scores', async () => {
  await call(alice, 'POST', '/api/blitz', { score: 900 })
  await call(alice, 'POST', '/api/blitz', { score: 400 })
  await call(bob, 'POST', '/api/blitz', { score: 1200 })
  assert.equal((await call(bob, 'POST', '/api/blitz', { score: 99_000_000 })).status, 400)
  assert.equal((await call(nobody, 'POST', '/api/blitz', { score: 10 })).status, 401)
  const b = await call(alice, 'GET', '/api/leaderboard?board=blitz')
  assert.deepEqual(b.json.rows.map((r: any) => [r.rank, r.name, r.score, r.me]), [[1, 'bob', 1200, false], [2, 'alice', 900, true]])
})

test('logged-out players can read the boards', async () => {
  await call(bob, 'POST', '/api/blitz', { score: 50 })
  const out = await call(nobody, 'GET', '/api/leaderboard?board=blitz')
  assert.equal(out.json.loggedIn, false)
  assert.equal(out.json.rows.length, 1)
  assert.equal((await call(nobody, 'GET', '/api/leaderboard?board=all')).status, 400)
})

test('the launch card: players today, and this player’s score', async () => {
  await playDay(bob, [true, false])
  const card = await call(alice, 'GET', '/api/splash')
  assert.deepEqual([card.json.players, card.json.played, card.json.prize], [1, false, 'Top player wins a $20 gift card.'])
  const mine = await call(bob, 'GET', '/api/splash')
  assert.deepEqual([mine.json.played, mine.json.score], [true, 145], 'right at 2 s: 100 + 45 speed')
  settingValues.monthlyPrize = '   '
  assert.equal((await call(alice, 'GET', '/api/splash')).json.prize, null, 'a blank prize setting means no prize')
})

/* ---------------------------------------------------------------- moderators and scheduled jobs */

test('the daily post goes up once a day, and can be turned off', async () => {
  await call(nobody, 'POST', '/internal/cron/daily-post', {})
  await call(nobody, 'POST', '/internal/cron/daily-post', {})
  assert.equal(posts.length, 1)
  assert.match(posts[0]!.title, /Daily Challenge · Friday, March 14/)
  mock.timers.setTime(Date.UTC(2031, 2, 15, 0, 5))
  settingValues.dailyPost = false
  await call(nobody, 'POST', '/internal/cron/daily-post', {})
  assert.equal(posts.length, 1)
})

test('the month close freezes standings with checks for moderators', async () => {
  accountsCreated.t2_alice = new Date(Date.UTC(2020, 0, 1))
  accountsCreated.t2_bob = new Date(Date.UTC(2031, 2, 10))      // four days old at the end of March
  await playDay(alice, [true, true, true, true, true, true, true, true, true, true], 4000)
  await playDay(bob, [true, true, true, true, true, true, true, true, true, true], 300)
  mock.timers.setTime(Date.UTC(2031, 3, 1, 0, 15))
  await call(nobody, 'POST', '/internal/cron/month-close', {})
  const frozen = JSON.parse(db.strings.get('results:2031-03')!)
  assert.deepEqual(frozen.rows.map((r: any) => r.name), ['bob', 'alice'])
  const [b, a] = frozen.rows
  assert.ok(b.flags.some((f: string) => f.includes('30 days')), 'a new account is flagged')
  assert.ok(b.flags.some((f: string) => f.includes('under 1.2 s')), 'very fast answers are flagged')
  assert.deepEqual(a.flags, [], 'a normal player has no flags')
  assert.equal(a.days, 1)

  const menu = await call(nobody, 'POST', '/internal/menu/results', {})
  const text = menu.json.showForm.form.fields[0].defaultValue as string
  assert.equal(menu.json.showForm.name, 'results')
  assert.match(text, /LAST MONTH \(final\)/)
  assert.match(text, /1\. u\/bob/)
  assert.match(text, /THIS MONTH SO FAR\n2031-04: no Daily Challenge scores/)
})

test('a player can delete their data', async () => {
  await call(alice, 'POST', '/api/progress', { progress: { a: 1 } })
  await playDay(alice, [true])
  await call(alice, 'POST', '/api/blitz', { score: 10 })
  const ask = await call(alice, 'POST', '/internal/menu/delete-data', {})
  assert.equal(ask.json.showForm.name, 'deleteData')
  const no = await call(alice, 'POST', '/internal/form/delete-data', { confirm: false })
  assert.match(no.json.showToast, /Nothing/)
  await call(alice, 'POST', '/internal/form/delete-data', { confirm: true })
  for (const board of ['day', 'month', 'blitz']) {
    const out = await call(bob, 'GET', `/api/leaderboard?board=${board}`)
    assert.equal(out.json.rows.length, 0, `gone from the ${board} board`)
  }
  assert.equal((await call(alice, 'GET', '/api/init')).json.progress, null)
  assert.equal(db.hashes.get('names')?.has('t2_alice'), false)
})

test('install makes the secret and the first post; new-post links to it', async () => {
  await call(nobody, 'POST', '/internal/on/app/install', {})
  assert.ok(db.strings.get('secret')?.length === 64)
  const out = await call(nobody, 'POST', '/internal/menu/new-post', {})
  assert.equal(out.json.navigateTo, 'https://reddit.com/r/test/comments/post')
  assert.equal(posts.length, 2)
})
