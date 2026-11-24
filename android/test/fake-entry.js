// Test stand-in for src/platform.js: the real platform layer, with a fake ad
// service that covers the screen for a moment and a fake Android back button.
import { createPlatform } from '../src/platform-core.js'

const params = new URLSearchParams(location.search)
const log = []
const handlers = {}
window.__android = { log, back: () => handlers.back(), pause: () => handlers.pause(), resume: () => handlers.resume() }

const ads = {
  init: async () => { log.push('init'); return { canRequestAds: true, privacyOptionsRequired: params.has('eu') } },
  load: async () => { log.push('load') },
  show: () => new Promise((resolve) => {
    log.push('show')
    const ad = document.createElement('div')
    ad.id = 'fakeAd'
    ad.style.cssText = 'position:fixed;inset:0;z-index:99;background:#000;color:#fff;display:grid;place-items:center'
    ad.textContent = 'TEST AD'
    document.body.appendChild(ad)
    setTimeout(() => { ad.remove(); log.push('closed'); resolve() }, 800)
  }),
  privacyOptions: async () => { log.push('privacy') },
}

const app = {
  onPause: (f) => { handlers.pause = f },
  onResume: (f) => { handlers.resume = f },
  onBack: (f) => { handlers.back = f },
  minimize: () => log.push('minimize'),
}

const storage = { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) }
window.BrainBlastPlatform = createPlatform({ ads, app, storage })
