// Wires the Android platform layer to the real Capacitor plugins and hands it
// to the game as window.BrainBlastPlatform. Bundled to www/platform.js, which
// the page loads before the game's own script.
import { App } from '@capacitor/app'
import { AdMob, InterstitialAdPluginEvents, MaxAdContentRating } from '@capacitor-community/admob'
import { INTERSTITIAL_ID, TEST_INTERSTITIAL } from './ads-config.js'
import { createPlatform } from './platform-core.js'

const testing = INTERSTITIAL_ID === TEST_INTERSTITIAL

const ads = {
  async init() {
    await AdMob.initialize({
      initializeForTesting: testing,
      // A general-audience trivia game: no ads rated above "Teen".
      maxAdContentRating: MaxAdContentRating.Teen,
    })
    let info = await AdMob.requestConsentInfo()
    if (info.status === 'REQUIRED' && info.isConsentFormAvailable) {
      info = await AdMob.showConsentForm()
    }
    return {
      canRequestAds: info.canRequestAds,
      privacyOptionsRequired: info.privacyOptionsRequirementStatus === 'REQUIRED',
    }
  },
  async load() {
    await AdMob.prepareInterstitial({ adId: INTERSTITIAL_ID, isTesting: testing })
  },
  show() {
    // showInterstitial resolves when the ad opens; wait for it to close.
    return new Promise((resolve, reject) => {
      const handles = []
      const done = (fn) => (arg) => { handles.forEach((h) => h.remove()); fn(arg) }
      Promise.all([
        AdMob.addListener(InterstitialAdPluginEvents.Dismissed, done(resolve)),
        AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, done(reject)),
      ]).then((hs) => {
        handles.push(...hs)
        return AdMob.showInterstitial()
      }).catch(done(reject))
    })
  },
  privacyOptions() {
    return AdMob.showPrivacyOptionsForm()
  },
}

const app = {
  onPause(fn) { App.addListener('pause', fn) },
  onResume(fn) { App.addListener('resume', fn) },
  onBack(fn) { App.addListener('backButton', fn) },
  minimize() { App.minimizeApp() },
}

const storage = {
  get: (k) => localStorage.getItem(k),
  set: (k, v) => localStorage.setItem(k, v),
}

window.BrainBlastPlatform = createPlatform({ ads, app, storage, log: (...a) => console.warn('[ads]', ...a) })
