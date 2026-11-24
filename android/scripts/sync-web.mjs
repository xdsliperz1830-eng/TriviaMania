// Copies the shared game into www/, the folder Capacitor packs into the app.
//
//   ../index.html -> www/index.html  (YouTube's SDK removed; platform.js
//                                     loaded first, so the game finds
//                                     window.BrainBlastPlatform)
//   ../assets, ../lang/*.js, ../icons -> www/
//
// Run by `npm run build:web`; esbuild then writes www/platform.js.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..')
const ROOT = path.resolve(APP, '..')
const WWW = path.join(APP, 'www')

let page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')

const sdk = '<script src="https://www.youtube.com/game_api/v1"></script>'
if (!page.includes(sdk)) throw new Error('index.html: the YouTube SDK line has changed; update scripts/sync-web.mjs')
page = page.replace(sdk, '')
page = page.split('\n').filter((l) => !l.includes('rel="manifest"')).join('\n')

// The game's one inline script is the last <script> in the page.
const at = page.lastIndexOf('<script>')
if (at === -1) throw new Error('index.html: no inline game script')
page = `${page.slice(0, at)}<script src="platform.js"></script>\n${page.slice(at)}`

function copyDir(from, to, keep = () => true) {
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) { if (keep(e.name, true)) copyDir(a, b, keep) }
    else if (keep(e.name, false)) fs.copyFileSync(a, b)
  }
}

fs.rmSync(WWW, { recursive: true, force: true })
fs.mkdirSync(WWW, { recursive: true })
fs.writeFileSync(path.join(WWW, 'index.html'), page)
copyDir(path.join(ROOT, 'assets'), path.join(WWW, 'assets'))
copyDir(path.join(ROOT, 'icons'), path.join(WWW, 'icons'))
copyDir(path.join(ROOT, 'lang'), path.join(WWW, 'lang'), (name, dir) => !dir && name.endsWith('.js'))

// Nothing empty may ship: stray zero-byte files have slipped into asset folders before.
const empty = []
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name)
  if (e.isDirectory()) walk(p)
  else if (fs.statSync(p).size === 0) empty.push(path.relative(WWW, p))
})
walk(WWW)
if (empty.length) throw new Error(`empty files in www/: ${empty.join(', ')}`)

console.log(`synced www/: index.html ${Math.round(Buffer.byteLength(page) / 1024)} KB, assets, icons, lang`)
