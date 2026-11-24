// Builds the Reddit web view from the shared game, so there is one game to
// maintain. Run by `npm run build` (and before the tests).
//
//   ../index.html  ->  public/game.html + game.css + game.js
//                      (YouTube's SDK removed; platform.js loaded first, so
//                      the game finds window.BrainBlastPlatform)
//   ../assets      ->  public/assets
//   ../lang/*.js   ->  public/lang
//   ../art/icon-1024.png -> assets/icon.png (the app's listing icon)
//   question bank  ->  src/server/bank.gen.ts (ids per category and the
//                      scoring rules, for the server-run Daily Challenge)
//
// The style and script move out of the page into files of their own because
// Reddit's web views run under a content security policy; same-origin files
// are always allowed, inline code may not be.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..')
const ROOT = path.resolve(APP, '..')
const PUB = path.join(APP, 'public')

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')

function cut(text, open, close) {
  const a = text.indexOf(open)
  const b = text.indexOf(close, a)
  if (a === -1 || b === -1) throw new Error(`index.html: could not find ${open}…${close}`)
  return { before: text.slice(0, a), inner: text.slice(a + open.length, b), after: text.slice(b + close.length) }
}

function removeLine(text, needle) {
  const lines = text.split('\n')
  const kept = lines.filter((l) => !l.includes(needle))
  if (kept.length === lines.length) throw new Error(`index.html: expected a line with ${needle}`)
  return kept.join('\n')
}

// ---------------------------------------------------------------- page
let page = html
page = removeLine(page, 'youtube.com/game_api')      // the Playables SDK: YouTube only
for (const rel of ['rel="icon"', 'rel="apple-touch-icon"', 'rel="manifest"']) {
  page = page.split('\n').filter((l) => !l.includes(rel)).join('\n')
}

const style = cut(page, '<style>', '</style>')
page = `${style.before}<link rel="stylesheet" href="game.css">${style.after}`

// The game's one inline script is the last <script> in the page.
const at = page.lastIndexOf('<script>')
const end = page.indexOf('</script>', at)
if (at === -1 || end === -1) throw new Error('index.html: no inline game script')
const script = page.slice(at + '<script>'.length, end)
page = `${page.slice(0, at)}<script src="platform.js"></script>\n<script src="game.js"></script>${page.slice(end + '</script>'.length)}`
if (/<script>(?!<\/script>)/.test(page) || /\son[a-z]+="/i.test(page)) throw new Error('game.html: inline script left over')

fs.mkdirSync(PUB, { recursive: true })
fs.writeFileSync(path.join(PUB, 'game.html'), page)
fs.writeFileSync(path.join(PUB, 'game.css'), style.inner)
fs.writeFileSync(path.join(PUB, 'game.js'), script)

// ---------------------------------------------------------------- assets
function copyDir(from, to, keep = () => true) {
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(to, { recursive: true })
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name)
    if (e.isDirectory()) { if (keep(e.name, true)) copyDir(a, b, keep) }
    else if (keep(e.name, false)) fs.copyFileSync(a, b)
  }
}
copyDir(path.join(ROOT, 'assets'), path.join(PUB, 'assets'))
copyDir(path.join(ROOT, 'lang'), path.join(PUB, 'lang'), (name, dir) => !dir && name.endsWith('.js'))
fs.mkdirSync(path.join(APP, 'assets'), { recursive: true })
fs.copyFileSync(path.join(ROOT, 'art', 'icon-1024.png'), path.join(APP, 'assets', 'icon.png'))

// ---------------------------------------------------------------- bank
function literal(name, close) {
  const start = html.indexOf(`const ${name} = `)
  const stop = html.indexOf(close, start)
  if (start === -1 || stop === -1) throw new Error(`index.html: could not find ${name}`)
  return (0, eval)(`(${html.slice(start + `const ${name} = `.length, stop + close.length - 1)})`)
}
function constant(name) {
  const m = html.match(new RegExp(`const ${name} = (\\d+);`))
  if (!m) throw new Error(`index.html: could not find ${name}`)
  return Number(m[1])
}
// The same id the game gives each question (questionId in index.html).
function questionId(text) {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) ^ text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const QUESTIONS = literal('QUESTIONS', '\n];')
const CATEGORIES = literal('CATEGORIES', '\n};')
const bank = {}
const seen = new Set()
for (const c of Object.keys(CATEGORIES)) bank[c] = []
for (const q of QUESTIONS) {
  if (!bank[q.c]) throw new Error(`question in unknown category ${q.c}`)
  if (q.a.length !== 4) throw new Error(`question without four answers: ${q.q}`)
  const id = questionId(q.q)
  if (seen.has(id)) throw new Error(`two questions share the id ${id}`)
  seen.add(id)
  bank[q.c].push(id)
}
const rules = {
  timeLimit: constant('TIME_LIMIT'),
  basePoints: constant('BASE_POINTS'),
  maxSpeedBonus: constant('MAX_SPEED_BONUS'),
  streakStep: constant('STREAK_STEP'),
  maxStreakBonus: constant('MAX_STREAK_BONUS'),
}
fs.writeFileSync(path.join(APP, 'src', 'server', 'bank.gen.ts'),
  `// Generated by scripts/sync-client.mjs from ../index.html. Do not edit.\n` +
  `export const RULES = ${JSON.stringify(rules)} as const\n` +
  `export const BANK: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(bank)}\n`)

const kb = (f) => Math.round(fs.statSync(path.join(PUB, f)).size / 1024)
console.log(`synced: game.html ${kb('game.html')} KB, game.js ${kb('game.js')} KB, game.css ${kb('game.css')} KB; ` +
  `${QUESTIONS.length} questions in ${Object.keys(bank).length} categories`)
