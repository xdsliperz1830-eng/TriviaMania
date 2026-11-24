// Phone screenshots for the Play Store listing, from the Android build (www/)
// in Chromium at 1080x1920 (a 360x640 phone at 3x). Run `npm run build:web`
// first. Real-phone screenshots are better once there is a phone; these are
// clean (no status bar, no notifications) and always match the current game.
//
//   node scripts/screenshots.mjs [lang]   -> store/<lang>/1-home.png …
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..')
const { chromium } = createRequire(path.join(APP, '..', 'package.json'))('playwright')
const lang = process.argv[2] || 'en'
const OUT = path.join(APP, 'store', lang)
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 })
// No ads or Capacitor in a plain browser: a stand-in platform that does nothing.
await page.addInitScript(() => {
  window.BrainBlastPlatform = {
    inPlayables: false, version: 'screenshots', firstFrameReady() {}, gameReady() {}, isReady: () => true,
    onPause() {}, onResume() {}, audioEnabled: () => true, onAudioEnabledChange() {}, sendScore() {}, logError() {},
    language: () => Promise.resolve('en'), load: () => Promise.resolve(null), save: () => Promise.resolve(false),
  }
  // A player with some history, so the home screen looks lived in.
  const d = new Date(Date.now() - 86400000)
  const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  localStorage.setItem('brainblitz.save', JSON.stringify({ best: { 10: 1840, blocks: 5230 }, length: 10,
    days: { last: yesterday, count: 6, best: 9 } }))
})
await page.goto(`file://${path.join(APP, 'www', 'index.html')}?lang=${lang}&debug`)
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(800)
const shot = async (name) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, name) }) }

await shot('1-home.png')

// A question mid-round, with a streak going.
await page.evaluate('state.category = "space"; Game.start()')
await page.waitForTimeout(300)
await page.evaluate('state.score = 860; state.streak = 4; state.index = 5; UI.renderQuestion(); UI.renderHud(); $("scoreVal").textContent = "860"')
await shot('2-question.png')

// The right answer, with its points.
await page.evaluate('Game.answer(state.round[state.index].correctIndex)')
await page.waitForTimeout(1600)          // let the streak banner pass
await shot('3-correct.png')

// Results of a strong round.
await page.evaluate(`state.correctCount = 9; state.bestStreak = 7; state.score = 1840;
  state.results = state.round.map((q, i) => ({ question: q.text, correct: i !== 2 })); Game.end()`)
await page.waitForTimeout(1400)
await shot('4-results.png')

// Block Blitz with a question open.
await page.evaluate('Game.quitToHome(); Blocks.start(); Blocks.testSetup({ autoPick: 0 })')
await page.waitForTimeout(800)
await shot('5-block-blitz.png')

// The Daily Challenge card.
await page.evaluate('Blocks.quit()')
await page.waitForTimeout(300)
await page.locator('#dailyBtn').click()
await shot('6-daily.png')

await browser.close()
console.log(`screenshots written to ${path.relative(process.cwd(), OUT)}`)
