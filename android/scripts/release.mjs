// Builds the signed Android App Bundle (.aab) to upload to Google Play.
//
//   npm run release                    real ads; refuses while any ad id is Google's test id
//   npm run release -- --test-ads      a signed bundle that still shows test ads (internal testing only)
//
// Needs android/keystore.properties (never committed):
//   storeFile=brain-blast-upload.jks
//   storePassword=...
//   keyAlias=upload
//   keyPassword=...
// and the Android SDK (ANDROID_HOME, or sdk.dir in app/local.properties).
// Fails loudly on anything missing rather than building something that can't ship.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INTERSTITIAL_ID, TEST_APP_ID, TEST_INTERSTITIAL } from '../src/ads-config.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..')
const NATIVE = path.join(APP, 'app')
const testAds = process.argv.includes('--test-ads')
const problems = []

// ---------------------------------------------------------------- ad ids
const strings = fs.readFileSync(path.join(NATIVE, 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8')
const appId = (strings.match(/name="admob_app_id"[^>]*>([^<]+)</) || [])[1]
if (!appId) problems.push('strings.xml has no admob_app_id')
if (!testAds) {
  if (appId === TEST_APP_ID) problems.push('admob_app_id in app/app/src/main/res/values/strings.xml is still Google\'s test app id')
  if (INTERSTITIAL_ID === TEST_INTERSTITIAL) problems.push('INTERSTITIAL_ID in src/ads-config.js is still Google\'s test ad unit')
  if (appId && !/^ca-app-pub-\d{16}~\d{10}$/.test(appId)) problems.push(`admob_app_id does not look like an AdMob app id: ${appId}`)
  if (!/^ca-app-pub-\d{16}\/\d{10}$/.test(INTERSTITIAL_ID)) problems.push(`INTERSTITIAL_ID does not look like an ad unit id: ${INTERSTITIAL_ID}`)
}

// ---------------------------------------------------------------- signing
const propsFile = path.join(APP, 'keystore.properties')
if (!fs.existsSync(propsFile)) {
  problems.push('android/keystore.properties is missing (see the top of scripts/release.mjs and android/README.md)')
} else {
  const props = Object.fromEntries(fs.readFileSync(propsFile, 'utf8').split('\n')
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
  for (const k of ['storeFile', 'storePassword', 'keyAlias', 'keyPassword']) if (!props[k]) problems.push(`keystore.properties has no ${k}`)
  if (props.storeFile && !fs.existsSync(path.resolve(APP, props.storeFile))) problems.push(`the keystore ${props.storeFile} is not in android/`)
}

// ---------------------------------------------------------------- version
const gradle = fs.readFileSync(path.join(NATIVE, 'app', 'build.gradle'), 'utf8')
const versionCode = Number((gradle.match(/versionCode (\d+)/) || [])[1])
const versionName = (gradle.match(/versionName "([^"]+)"/) || [])[1]
if (!versionCode || !versionName) problems.push('could not read versionCode/versionName from app/app/build.gradle')

if (problems.length) {
  console.error('Not building a release:\n' + problems.map((p) => `  - ${p}`).join('\n'))
  process.exit(1)
}

// ---------------------------------------------------------------- build
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: 'inherit' })
run('npm', ['run', 'build:web'], APP)
const page = fs.readFileSync(path.join(APP, 'www', 'index.html'), 'utf8')
if (!page.includes('<script src="platform.js"></script>')) throw new Error('www/index.html does not load platform.js')
if (page.includes('youtube.com/game_api')) throw new Error('www/index.html still loads the YouTube SDK')
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['bundleRelease', '--no-daemon', '-q'], NATIVE)

const built = path.join(NATIVE, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab')
if (!fs.existsSync(built)) throw new Error('gradle finished but there is no app-release.aab')
execFileSync('jarsigner', ['-verify', built], { stdio: 'pipe' })   // throws if the bundle is unsigned
const outDir = path.join(APP, 'release')
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, `brain-blast-${versionName}-${versionCode}${testAds ? '-test-ads' : ''}.aab`)
fs.copyFileSync(built, out)
console.log(`\nSigned bundle: ${path.relative(process.cwd(), out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`)
console.log(`versionCode ${versionCode}: every upload to Play needs a higher one (app/app/build.gradle).`)
if (testAds) console.log('This bundle shows TEST ads: use it for internal testing only, never production.')
