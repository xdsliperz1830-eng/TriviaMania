// The Reddit build in a real browser, against the app's real server code.
//
// A local web server stands in for Reddit: it serves public/ and sends every
// /api/ request to the app's onReq, with an in-memory Redis. Who is playing
// comes from an x-test-user header (Reddit adds the real identity itself).
// Run after `npm run build` (npm test does both).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createRequire } from 'node:module'
import { after, before, mock, test } from 'node:test'
import { type Context, reddit, runWithContext, settings } from '@devvit/web/server'
import { onReq } from '../src/server/server.ts'
import { FakeRedis } from '../src/server/testing.ts'

// Playwright is installed by the game's own package, one folder up.
const { chromium } = createRequire(path.resolve('..', 'package.json'))('playwright')

const PUB = path.resolve('public')
const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }

let server: http.Server
let base = ''
let browser: any
const db = new FakeRedis()
const apiCalls: string[] = []

before(async () => {
  db.install()
  mock.method(settings as any, 'get', async (name: string) => (name === 'monthlyPrize' ? 'Top player this month wins a $20 gift card.' : true))
  mock.method(reddit as any, 'submitCustomPost', async () => ({ id: 't3_x', url: 'https://reddit.com' }))
  server = http.createServer((req, rsp) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname.startsWith('/api/')) {
      apiCalls.push(url.pathname)
      const user = req.headers['x-test-user'] as string | undefined
      const ctx = { subredditName: 'testsub', postId: 't3_x', userId: user ? `t2_${user}` : undefined, username: user } as unknown as Context
      void runWithContext(ctx, () => onReq(req, rsp))
      return
    }
    const file = path.join(PUB, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''))
    if (!file.startsWith(PUB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { rsp.writeHead(404).end(); return }
    rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(rsp)
  })
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', () => res()))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  browser = await chromium.launch()
})

after(async () => {
  await browser?.close()
  server?.close()
  mock.restoreAll()
})

/** A page as `user` (or logged out), failing on any page error or request leaving the web view's origin. */
async function open(file: string, user?: string, viewport = { width: 390, height: 844 }) {
  const page = await browser.newPage({ viewport })
  if (user) await page.setExtraHTTPHeaders({ 'x-test-user': user })
  const problems: string[] = []
  page.on('pageerror', (e: Error) => problems.push(`pageerror: ${e.message}`))
  page.on('console', (m: any) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`) })
  page.on('request', (r: any) => { if (!r.url().startsWith(base) && !r.url().startsWith('data:')) problems.push(`external request: ${r.url()}`) })
  await page.goto(`${base}/${file}`)
  await page.waitForTimeout(500)
  return { page, problems }
}

async function answerAll(page: any, right: boolean) {
  for (let i = 0; i < 30; i++) {
    if (await page.locator('#results').isVisible()) return
    if (await page.evaluate('state.locked')) {
      await page.locator('#nextBtn').click()
      await page.waitForTimeout(250)
      continue
    }
    const k = await page.evaluate(`state.round[state.index].correctIndex + ${right ? 0 : 1}`) % 4
    await page.locator(`.ans[data-idx="${k}"]`).click()
    await page.waitForTimeout(150)
  }
}

test('the launch card loads fast, offline-safe, and opens nothing by itself', async () => {
  const t0 = Date.now()
  const { page, problems } = await open('splash.html', 'alice')
  assert.ok(Date.now() - t0 < 3000)
  assert.ok(await page.locator('#play').isVisible())
  assert.equal(await page.locator('#board').innerText(), 'Top player this month wins a $20 gift card.')
  assert.deepEqual(problems, [])
  await page.close()
})

test('logged in: the Daily Challenge is run and scored by the server, and lands on the boards', async () => {
  const { page, problems } = await open('game.html', 'alice')
  assert.equal(await page.evaluate('Platform.version'), 'reddit')
  assert.equal(await page.locator('#bestChip').getAttribute('role'), 'button', 'the Best chip opens the leaderboard')
  apiCalls.length = 0
  await page.locator('#dailyBtn').click()
  await page.locator('#dailyPlay').click()
  await page.waitForTimeout(400)
  assert.ok(await page.locator('#quiz').isVisible(), 'the round starts')
  await answerAll(page, true)
  await page.waitForTimeout(1200)
  assert.ok(await page.locator('#results').isVisible(), 'and reaches the results')
  const score = await page.evaluate('state.score')
  assert.ok(score >= 10 * 100, `ten right answers score at least 1000 (${score})`)
  assert.equal(apiCalls.filter((c) => c === '/api/daily/answer').length, 10, 'every answer went to the server')
  assert.equal(apiCalls.filter((c) => c === '/api/daily/next').length, 9)

  // The server's record matches what the player saw.
  const round = Object.fromEntries(db.hashes.get(`round:${new Date().toISOString().slice(0, 10)}:t2_alice`) ?? [])
  assert.equal(Number(round.total), score)
  assert.equal(round.done, '1')

  await page.locator('#homeBtn').click()
  await page.waitForTimeout(300)
  await page.locator('#bestChip').click()
  await page.waitForTimeout(300)
  const rows = await page.locator('.lb-row').allInnerTexts()
  assert.equal(rows.length, 1)
  assert.match(rows[0], /alice/)
  assert.match(rows[0], new RegExp(String(score)))
  await page.locator('.lb-tab[data-board="month"]').click()
  await page.waitForTimeout(300)
  assert.match(await page.locator('#lbPrize').innerText(), /\$20/)
  assert.deepEqual(problems, [])
  await page.close()
})

test('progress follows the player to another device; the day stays played', async () => {
  // Saves are debounced; give the last one time to land.
  await new Promise((r) => setTimeout(r, 1500))
  const { page, problems } = await open('game.html', 'alice')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.waitForTimeout(600)
  await page.locator('#dailyBtn').click()
  assert.ok(await page.locator('#dailyPlay').isDisabled(), 'today is already played (from the server save)')
  assert.notEqual(await page.locator('#dailyToday').innerText(), '–')
  assert.deepEqual(problems, [])
  await page.close()
})

test('logged out: everything plays, the daily runs on the device, and the board asks to log in', async () => {
  const { page, problems } = await open('game.html')
  apiCalls.length = 0
  await page.locator('#dailyBtn').click()
  await page.locator('#dailyPlay').click()
  await page.waitForTimeout(300)
  assert.ok(await page.locator('#quiz').isVisible())
  await answerAll(page, false)
  await page.waitForTimeout(1200)
  assert.ok(await page.locator('#results').isVisible())
  assert.equal(apiCalls.filter((c) => c.startsWith('/api/daily')).length, 0, 'no server round for a player it can’t identify')
  await page.locator('#homeBtn').click()
  await page.waitForTimeout(300)
  await page.locator('#bestChip').click()
  await page.waitForTimeout(300)
  assert.ok(await page.locator('#lbLogin').isVisible(), 'a log-in button')
  assert.equal(await page.locator('.lb-row').count(), 1, 'the board is still readable')
  assert.deepEqual(problems, [])
  await page.close()
})

test('Block Blitz scores reach the Block Blitz board', async () => {
  const { page, problems } = await open('game.html', 'bob')
  await page.evaluate('Blocks.start(); Blocks.testSetup({ autoPick: 0 })')
  await page.waitForTimeout(400)
  for (let i = 0; i < 14 && !(await page.evaluate('Blocks.debug().over')); i++) {
    await page.locator('#bkBoard .bk-block:not(.pop)').first().click()
    await page.waitForTimeout(350)
    const d = await page.evaluate('Blocks.debug()')
    if (!d.open) { await page.waitForTimeout(400); continue }
    await page.locator(`#bkAnswers .ans[data-idx="${(d.correctIndex + 1) % 4}"]`).click()
    await page.waitForTimeout(2300)
  }
  assert.ok(await page.evaluate('Blocks.debug().over'))
  await page.waitForTimeout(300)
  assert.ok(db.zsets.get('lb:blitz')?.has('t2_bob'), 'bob is on the Block Blitz board')
  assert.deepEqual(problems, [])
  await page.close()
})

test('languages load from the app’s own files', async () => {
  const { page, problems } = await open('game.html?lang=de', 'carol')
  assert.equal(await page.locator('.tagline').innerText(), 'Wie viel weißt du wirklich?')
  assert.deepEqual(problems, [])
  await page.close()
})

test('the game fits Reddit’s expanded view on desktop and phones', async () => {
  for (const viewport of [{ width: 360, height: 640 }, { width: 1280, height: 720 }]) {
    const { page, problems } = await open('game.html', 'alice', viewport)
    const fit = await page.evaluate(() => ({ x: document.documentElement.scrollWidth <= innerWidth + 1, y: document.documentElement.scrollHeight <= innerHeight + 1 }))
    assert.deepEqual(fit, { x: true, y: true }, `no page scroll at ${viewport.width}x${viewport.height}`)
    assert.deepEqual(problems, [])
    await page.close()
  }
})
