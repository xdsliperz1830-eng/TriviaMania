// AdMob ad unit for the interstitial shown between rounds.
//
// This is Google's public TEST unit: it always serves a test ad and earns
// nothing, which is what every build must use until the app is live in AdMob.
// Before the first Play Store release, create an interstitial ad unit in
// AdMob, put its id here, and put the AdMob *app* id in
// app/app/src/main/res/values/strings.xml (admob_app_id). scripts/release.mjs
// refuses to build a release while either is still a test id.
export const TEST_INTERSTITIAL = 'ca-app-pub-3940256099942544/1033173712'
export const TEST_APP_ID = 'ca-app-pub-3940256099942544~3347511713'

export const INTERSTITIAL_ID = TEST_INTERSTITIAL
