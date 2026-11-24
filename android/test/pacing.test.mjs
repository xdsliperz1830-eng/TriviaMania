// The ad pacing rules and the platform layer, in Node with fakes.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PACING, createPacer } from '../src/pacing.js'
import { createPlatform } from '../src/platform-core.js'

function memory() {
  const m = new Map()
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v), map: m }
}

test('the first ad waits for the third round, then every second round', () => {
  let t = 0
  const p = createPacer(memory(), () => t)
  const due = []
  for (let r = 1; r <= 9; r++) {
    t += 10 * 60_000                     // ten minutes a round: the clock never limits here
    const d = p.finished()
    if (d) p.shown()
    due.push(d)
  }
  assert.deepEqual(due, [false, false, true, false, true, false, true, false, true])
  assert.equal(PACING.firstAfter, 3)
})

test('never two ads within two and a half minutes, however many rounds', () => {
  let t = 0
  const p = createPacer(memory(), () => t)
  p.finished(); p.finished()
  assert.equal(p.finished(), true); p.shown()
  t += 30_000; p.finished()
  t += 30_000; assert.equal(p.finished(), false, 'two rounds on, but only a minute later')
  t += 30_000; assert.equal(p.finished(), false)
  t += 60_000; assert.equal(p.finished(), true, 'two and a half minutes after the last ad')
})

test('the count and the clock survive a restart; a bad save or a clock set back does not block ads', () => {
  const store = memory()
  let t = 1_000_000
  let p = createPacer(store, () => t)
  p.finished(); p.finished(); p.finished(); p.shown()
  p = createPacer(store, () => t + 10_000)
  p.finished()
  assert.equal(p.finished(), false, 'restarting the app does not reset the gap')
  assert.equal(createPacer(store, () => t + 999_999).state().rounds, 5)

  store.set('brainblast.ads', '{not json')
  assert.deepEqual(createPacer(store, () => t).state(), { rounds: 0, sinceAd: 0, lastAdAt: 0, ads: 0 })

  const back = memory()
  const q = createPacer(back, () => t)
  q.finished(); q.finished(); q.finished(); q.shown()
  t -= 3_600_000                          // the phone's clock went back an hour
  q.finished()
  assert.equal(q.finished(), true)
})

/* ---------------------------------------------------------------- platform layer */

function fakes({ consent = true, privacy = false, loadFails = false, showFails = false } = {}) {
  const calls = []
  const handlers = {}
  return {
    calls,
    handlers,
    ads: {
      init: async () => { calls.push('init'); return { canRequestAds: consent, privacyOptionsRequired: privacy } },
      load: async () => { calls.push('load'); if (loadFails) throw new Error('no fill') },
      show: async () => { calls.push('show'); if (showFails) throw new Error('could not show') },
      privacyOptions: async () => { calls.push('privacy') },
    },
    app: {
      onPause: (f) => { handlers.pause = f }, onResume: (f) => { handlers.resume = f },
      onBack: (f) => { handlers.back = f }, minimize: () => calls.push('minimize'),
    },
  }
}

const settle = () => new Promise((r) => setTimeout(r, 0))

test('ads start only after the game is ready, with consent, one loaded ahead', async () => {
  const f = fakes()
  const p = createPlatform({ ...f, storage: memory() })
  await settle()
  assert.deepEqual(f.calls, [], 'nothing at start-up')
  p.firstFrameReady(); p.gameReady(); p.gameReady()
  await settle(); await settle()
  assert.deepEqual(f.calls, ['init', 'load'])
  assert.equal(p.privacyOptions, undefined, 'no privacy link where the law does not need one')
})

test('an ad break shows a loaded ad only when one is due, then loads the next', async () => {
  const f = fakes()
  let t = 0
  const p = createPlatform({ ...f, storage: memory(), now: () => t })
  p.gameReady()
  await settle(); await settle()
  assert.equal(await p.adBreak('quiz'), false)
  assert.equal(await p.adBreak('daily'), false)
  t = 1_000_000
  assert.equal(await p.adBreak('blocks'), true, 'the third round shows the ad')
  await settle()
  assert.deepEqual(f.calls, ['init', 'load', 'show', 'load'])
})

test('without consent there are no ads, and the game is never held up', async () => {
  const f = fakes({ consent: false, privacy: true })
  const p = createPlatform({ ...f, storage: memory(), now: () => 1e9 })
  p.gameReady()
  await settle(); await settle()
  for (let i = 0; i < 5; i++) assert.equal(await p.adBreak('quiz'), false)
  assert.deepEqual(f.calls, ['init'])
  assert.equal(typeof p.privacyOptions, 'function', 'the player can still change their choice')
  await p.privacyOptions()
  assert.ok(f.calls.includes('privacy'))
})

test('a failed load or show never blocks the game', async () => {
  const noFill = fakes({ loadFails: true })
  const p = createPlatform({ ...noFill, storage: memory(), now: () => 1e9 })
  p.gameReady()
  await settle(); await settle()
  for (let i = 0; i < 3; i++) assert.equal(await p.adBreak('quiz'), false)

  const broken = fakes({ showFails: true })
  const q = createPlatform({ ...broken, storage: memory(), now: () => 1e9 })
  q.gameReady()
  await settle(); await settle()
  await q.adBreak('quiz'); await q.adBreak('quiz')
  assert.equal(await q.adBreak('quiz'), false, 'a show that fails resolves, and the game goes on')
})

test('pause and resume reach the game', () => {
  const f = fakes()
  const p = createPlatform({ ...f, storage: memory() })
  const seen = []
  p.onPause(() => seen.push('pause'))
  p.onResume(() => seen.push('resume'))
  f.handlers.pause(); f.handlers.resume()
  assert.deepEqual(seen, ['pause', 'resume'])
})
