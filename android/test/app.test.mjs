// The Android build (www/) in Chromium, with the real platform layer and a
// fake ad service: ads come only between rounds, the game waits for them,
// and the back button behaves. Run after `npm run build:web`.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..')
const WWW = path.join(APP, 'www')
// Playwright comes from the game's own package, one folder up.
const { chromium } = createRequire(path.join(APP, '..', 'package.json'))('playwright')

let dir, browser

before(async () => {
  if (!fs.existsSync(path.join(WWW, 'index.html'))) throw new Error('run `npm run build:web` first')
  dir = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'bb-android-'))
  fs.cpSync(WWW, dir, { recursive: true })
  await build({ entryPoints: [path.join(HERE, 'fake-entry.js')], bundle: true, format: 'iife', outfile: path.join(dir, 'platform.js'), logLevel: 'warning' })
  browser = await chromium.launch()
})

after(async () => {
  await browser?.close()
  if (dir) fs.rmSync(dir, { recursive: true, force: true })
})

async function open(query = '') {
  const page = await browser.newPage({ viewport: { width: 360, height: 640 } })
  const problems = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text()) })
  page.on('request', (r) => { if (!r.url().startsWith('file:')) problems.push(`network: ${r.url()}`) })
  await page.goto(`file://${dir}/index.html${query}`)
  await page.waitForTimeout(500)
  return { page, problems }
}

const log = (page) => page.evaluate(() => window.__android.log.slice())

/** Play a five-question round to the results screen. */
async function playRound(page) {
  await page.evaluate('state.roundSize = 5; Game.start()')
  await page.waitForTimeout(200)
  for (let i = 0; i < 12 && !(await page.locator('#results').isVisible()); i++) {
    if (await page.evaluate('state.locked')) await page.locator('#nextBtn').click()
    else await page.locator(`.ans[data-idx="${await page.evaluate('state.round[state.index].correctIndex')}"]`).click()
    await page.waitForTimeout(120)
  }
  assert.ok(await page.locator('#results').isVisible(), 'the round reaches the results')
}

test('the Android build runs the game with its own platform layer and no network', async () => {
  const { page, problems } = await open()
  assert.equal(await page.evaluate('Platform.version'), 'android')
  await page.waitForTimeout(200)
  assert.deepEqual(await log(page), ['init', 'load'], 'ads start after the game is up, one loaded ahead')
  assert.equal(await page.locator('#privacyBtn').count(), 1)
  await page.locator('#langBtn').click()
  assert.equal(await page.locator('#privacyBtn').isVisible(), false, 'no privacy link outside the EU and UK')
  assert.deepEqual(problems, [])
  await page.close()
})

test('ads come only between rounds: the third round, on Play again, and the game waits for them', async () => {
  const { page, problems } = await open()
  for (const round of [1, 2]) {
    await playRound(page)
    await page.locator('#againBtn').click()
    await page.waitForTimeout(200)
    assert.ok(await page.locator('#quiz').isVisible(), `round ${round}: no ad, straight into the next round`)
    await page.evaluate('Game.quitToHome()')
  }
  assert.ok(!(await log(page)).includes('show'), 'no ad during or after the first two rounds')

  await playRound(page)
  assert.ok(!(await log(page)).includes('show'), 'no ad over the results: the player sees their score first')
  await page.locator('#againBtn').click()
  await page.waitForTimeout(150)
  assert.ok(await page.locator('#fakeAd').isVisible(), 'the ad shows when the player moves on')
  assert.ok(!(await page.locator('#quiz').isVisible()), 'and the next round waits behind it')
  await page.locator('#againBtn').click({ force: true }).catch(() => {})
  await page.waitForTimeout(1000)
  assert.ok(!(await page.locator('#fakeAd').count()), 'the ad closes')
  assert.ok(await page.locator('#quiz').isVisible(), 'then the round starts')
  const shows = (await log(page)).filter((x) => x === 'show').length
  assert.equal(shows, 1, 'one ad, even with a second tap while it loaded')

  // The next finished round is too soon (every second round, 2.5 min apart).
  await page.evaluate('Game.quitToHome()')
  await playRound(page)
  await page.locator('#homeBtn').click()
  await page.waitForTimeout(300)
  assert.ok(await page.locator('#home').isVisible())
  assert.equal((await log(page)).filter((x) => x === 'show').length, 1)
  assert.deepEqual(problems, [])
  await page.close()
})

test('the Block Blitz game-over card is a round end too', async () => {
  const { page, problems } = await open()
  await page.evaluate(() => localStorage.setItem('brainblast.ads', JSON.stringify({ rounds: 5, sinceAd: 5, lastAdAt: 0, ads: 1 })))
  await page.reload()
  await page.waitForTimeout(600)
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
  assert.ok(!(await log(page)).includes('show'), 'no ad over the game-over card')
  await page.locator('#bkHome').click()
  await page.waitForTimeout(150)
  assert.ok(await page.locator('#fakeAd').isVisible(), 'the ad shows on the way home')
  await page.waitForTimeout(1000)
  assert.ok(await page.locator('#home').isVisible())
  assert.deepEqual(problems, [])
  await page.close()
})

test('the back button closes what is open, leaves the results, and from home leaves the app', async () => {
  const { page, problems } = await open()
  await page.locator('#langBtn').click()
  await page.evaluate(() => window.__android.back())
  assert.ok(!(await page.locator('#langModal').isVisible()), 'closes a dialog')
  await playRound(page)
  await page.evaluate(() => window.__android.back())
  await page.waitForTimeout(300)
  assert.ok(await page.locator('#home').isVisible(), 'from the results, back goes home')
  await page.evaluate(() => window.__android.back())
  assert.ok((await log(page)).includes('minimize'), 'from home, back leaves the app')
  assert.deepEqual(problems, [])
  await page.close()
})

test('in the EU and UK the language dialog links to the ad privacy options', async () => {
  const { page, problems } = await open('?eu')
  await page.waitForTimeout(200)
  await page.locator('#langBtn').click()
  assert.ok(await page.locator('#privacyBtn').isVisible())
  await page.locator('#privacyBtn').click()
  await page.waitForTimeout(100)
  assert.ok((await log(page)).includes('privacy'))
  assert.deepEqual(problems, [])
  await page.close()
})
