// The Android platform layer, with every outside dependency passed in, so the
// same code runs on the phone (src/platform.js wires the real Capacitor
// plugins) and in the tests (with fakes).
//
// deps:
//   ads      { init(): Promise<{ canRequestAds, privacyOptionsRequired }>,
//              load(): Promise<void>, show(): Promise<void> (resolves when dismissed),
//              privacyOptions(): Promise<void> }
//   app      { onPause(fn), onResume(fn), onBack(fn), minimize() }
//   storage  { get(key), set(key, value) }
//   now      () => ms
import { createPacer } from './pacing.js'

const SHOW_TIMEOUT_MS = 90_000   // an ad that never reports closing must not trap the player

export function createPlatform({ ads, app, storage, now = Date.now, log = () => {} }) {
  const pacer = createPacer(storage, now)
  let canRequestAds = false
  let privacyRequired = false
  let loaded = false
  let loading = null
  let readySent = false

  function load() {
    if (!canRequestAds || loaded || loading) return loading
    loading = Promise.resolve()
      .then(() => ads.load())
      .then(() => { loaded = true }, (e) => log('ad load failed', e))
      .then(() => { loading = null })
    return loading
  }

  // Consent first (the EU and UK need it before any ad request), then load
  // one ad ahead. Started once the game is up, so it never slows the start.
  function startAds() {
    Promise.resolve()
      .then(() => ads.init())
      .then((r) => {
        canRequestAds = !!(r && r.canRequestAds)
        privacyRequired = !!(r && r.privacyOptionsRequired)
        return load()
      })
      .catch((e) => log('ads unavailable', e))
  }

  const pauseFns = [], resumeFns = []
  app.onPause(() => pauseFns.forEach((f) => f()))
  app.onResume(() => resumeFns.forEach((f) => f()))

  // Android's back button: close what is open (the game's own Escape), and
  // from the home screen with nothing open, leave the app as Home would.
  app.onBack(() => {
    const doc = globalThis.document
    const home = doc && doc.getElementById('home')
    const openDialog = doc && doc.querySelector('.daily-modal:not([hidden])')
    if (home && home.classList.contains('active') && !openDialog) { app.minimize(); return }
    doc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  })

  return {
    inPlayables: false,
    version: 'android',

    firstFrameReady() {},
    gameReady() {
      if (readySent) return
      readySent = true
      startAds()
    },
    isReady() { return readySent },

    onPause(fn) { pauseFns.push(fn) },
    onResume(fn) { resumeFns.push(fn) },
    audioEnabled() { return true },
    onAudioEnabledChange() {},

    sendScore() {},
    logError() {},

    language() {
      const nav = globalThis.navigator
      return Promise.resolve((nav && ((nav.languages && nav.languages[0]) || nav.language)) || 'en')
    },

    // Progress stays in the WebView's localStorage, which the game writes itself.
    load() { return Promise.resolve(null) },
    save() { return Promise.resolve(false) },

    /** Leaving a finished round: show an ad if one is due and ready, and resolve once it is closed. */
    adBreak() {
      const due = pacer.finished()
      if (!due || !loaded) { if (due) load(); return Promise.resolve(false) }
      loaded = false
      const shown = Promise.resolve().then(() => ads.show())
      const capped = Promise.race([shown, new Promise((res) => setTimeout(res, SHOW_TIMEOUT_MS))])
      return capped
        .then(() => { pacer.shown(); return true }, (e) => { log('ad show failed', e); return false })
        .finally(() => { load() })
    },

    /** Shown in the game (language dialog) only where the law needs it: lets a player change their ad consent. */
    get privacyOptions() {
      return privacyRequired ? () => ads.privacyOptions().catch(() => {}) : undefined
    },

    /** For tests and debugging. */
    _pacer: pacer,
  }
}
