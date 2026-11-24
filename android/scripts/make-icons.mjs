// Launcher icons and splash screens for the Android app, made from the game's
// own art with ImageMagick (`convert`). The results live in the native project
// (app/app/src/main/res) and are committed; run again only when the art changes.
//
//   ../icons/icon-maskable-512.png -> adaptive icon foreground (it already has
//                                     the safe zone launchers crop to)
//   ../art/icon-1024.png           -> legacy square and round icons
//   ../icons/icon-512.png          -> centred on the game's blue for the splash
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const RES = path.resolve(HERE, '..', 'app', 'app', 'src', 'main', 'res')
const BLUE = '#2F48C7'        // the game's theme colour
const ICON_BG = '#435FDC'     // the maskable icon's edge colour

const im = (...args) => execFileSync('convert', args, { stdio: 'inherit' })

const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [d, k] of Object.entries(densities)) {
  const dir = path.join(RES, `mipmap-${d}`)
  fs.mkdirSync(dir, { recursive: true })
  const legacy = Math.round(48 * k), fg = Math.round(108 * k)
  im(path.join(ROOT, 'art', 'icon-1024.png'), '-resize', `${legacy}x${legacy}`, path.join(dir, 'ic_launcher.png'))
  // Round: the same art in a circle.
  im(path.join(ROOT, 'art', 'icon-1024.png'), '-resize', `${legacy}x${legacy}`,
    '(', '+clone', '-alpha', 'transparent', '-fill', 'white', '-draw', `circle ${legacy / 2 - 0.5},${legacy / 2 - 0.5} ${legacy / 2 - 0.5},0`, ')',
    '-compose', 'DstIn', '-composite', path.join(dir, 'ic_launcher_round.png'))
  im(path.join(ROOT, 'icons', 'icon-maskable-512.png'), '-resize', `${fg}x${fg}`, path.join(dir, 'ic_launcher_foreground.png'))
}

// The generated project's vector foreground (the Capacitor logo) would win over the PNGs on newer phones.
fs.rmSync(path.join(RES, 'drawable-v24', 'ic_launcher_foreground.xml'), { force: true })
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${ICON_BG}</color>\n</resources>\n`)

// Splash screens: every size the project ships, the icon at a third of the short side.
for (const dir of fs.readdirSync(RES).filter((n) => n.startsWith('drawable'))) {
  const file = path.join(RES, dir, 'splash.png')
  if (!fs.existsSync(file)) continue
  const [w, h] = execFileSync('identify', ['-format', '%w %h', file]).toString().split(' ').map(Number)
  const s = Math.round(Math.min(w, h) / 3)
  im('-size', `${w}x${h}`, `xc:${BLUE}`, '(', path.join(ROOT, 'icons', 'icon-512.png'), '-resize', `${s}x${s}`, ')',
    '-gravity', 'center', '-composite', '-strip', file)
}
console.log('icons and splash screens written to', path.relative(process.cwd(), RES))
