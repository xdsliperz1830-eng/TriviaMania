# Brain Blast for Android

The Google Play version of Brain Blast: the same game as `../index.html`,
wrapped in a [Capacitor](https://capacitorjs.com) app, with Google AdMob ads
between rounds. Package id `app.brainblast.game` (permanent once uploaded).

## Ads

- **Interstitials only, and only between rounds.** The game calls
  `Platform.adBreak()` when the player leaves a finished round (Play again,
  Home, or the back button on the results screen or the Block Blitz game-over
  card). Never mid-question, never over a score. The game waits for the ad
  to close, with the music paused, then carries on.
- **Pacing** (`src/pacing.js`): the first ad after the third finished round
  ever, then at most every second round, and never within 2.5 minutes of the
  last one, including across restarts. Set a frequency cap on the ad unit in
  AdMob as a second limit.
- **Length** is AdMob's choice, not the game's. In AdMob, the interstitial ad
  unit's settings decide how long before an ad can be skipped (5 s by default)
  and whether non-skippable video is allowed.
- **Consent**: in the EEA, UK and Switzerland, Google's consent form shows
  before any ad request, and a **Privacy options** link appears in the game's
  language dialog so players can change their choice.
- Ads rated up to **Teen** only.
- Until the real ids are in, every build shows Google's **test ads**
  (`src/ads-config.js`, `admob_app_id` in
  `app/app/src/main/res/values/strings.xml`).

## Commands

```bash
npm ci                 # here; and `npm ci` one folder up (Playwright, for tests and screenshots)
npm run build:web      # copy the game into www/, bundle platform.js, sync into the native project
npm test               # build:web, then pacing/platform tests and the game in Chromium with fake ads
npm run apk            # debug APK: app/app/build/outputs/apk/debug/app-debug.apk
npm run release        # signed .aab for Play, in release/ (see below)
npm run screenshots    # store/en/*.png, 1080x1920
npm run icons          # launcher icons and splash screens from ../art and ../icons
```

Building needs JDK 21 and the Android SDK (platform 36); Android Studio has
both. Point Gradle at the SDK with `ANDROID_HOME` or `app/local.properties`
(`sdk.dir=...`).

## How it fits together

```
../index.html ──scripts/sync-web.mjs──> www/index.html (YouTube SDK removed, platform.js loaded first)
../assets, ../icons, ../lang ─────────> www/
src/platform.js ──esbuild──> www/platform.js   (window.BrainBlastPlatform: AdMob, back button, pause)
www/ ──cap sync──> app/app/src/main/assets/public/
```

- `src/platform-core.js` is the platform layer with its dependencies passed
  in; `src/platform.js` wires it to the real Capacitor plugins, and
  `test/fake-entry.js` to fakes for the tests.
- Progress is saved in the WebView's local storage by the game itself.
- Android's back button closes an open dialog, leaves a round or the results,
  and from the home screen leaves the app.

## First release checklist

1. **Name.** Search Google Play for "Brain Blast" and close variants before
   anything is uploaded; the package id can never change afterwards.
2. **Upload key.** Create it once and back it up, with its passwords, somewhere
   other than this computer:
   ```bash
   keytool -genkeypair -v -keystore brain-blast-upload.jks -alias upload \
     -keyalg RSA -keysize 2048 -validity 10000
   ```
   Put it in `android/` and create `android/keystore.properties`:
   ```
   storeFile=brain-blast-upload.jks
   storePassword=...
   keyAlias=upload
   keyPassword=...
   ```
   Both are git-ignored. Enrol in Play App Signing when creating the app.
3. **AdMob.** Create the app in AdMob and one **interstitial** ad unit. Put
   the app id in `strings.xml` (`admob_app_id`) and the ad unit id in
   `src/ads-config.js`. Set the ad unit's frequency cap. Add
   `app-ads.txt` to the developer website listed on Play once AdMob gives you
   its line.
4. **Build:** `npm run release`. It refuses while test ids or the key are
   missing. Raise `versionCode` in `app/app/build.gradle` for every upload.
5. **Play Console:**
   - Privacy policy URL: `https://xdsliperz1830-eng.github.io/TriviaMania/privacy.html`
     (published from `../privacy.html` once merged).
   - Contains ads: **yes**. Target audience: **13 and over**.
   - Data safety: the app collects the **device advertising ID**, **app
     interactions**, **diagnostics** and **approximate location** (from IP)
     through the Google Mobile Ads SDK, for advertising and analytics; data is
     encrypted in transit; the game itself collects nothing.
   - Content rating questionnaire (no violence, no user content, ads).
   - Store art: `store/feature-graphic-1024x500.png`, `store/en/*.png`, icon
     `../art/icon-512.png`.
6. **Closed test**: new personal developer accounts need 12 testers opted in
   for 14 days in a row before production access.

## Not checked yet

There was no phone or emulator for this build: the APK and bundle compile and
were inspected, and the game was tested in Chromium with a fake ad service.
On a real phone, check: the consent form and a test interstitial appear and
close, the back button, sound after an ad, and the frame rate on a low-end
phone.
