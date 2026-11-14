// Attach to the game's WebView on the USB phone over CDP (needs `npm i -D playwright-core`, adb,
// USB debugging on, and a debuggable build: Capacitor debug builds are).
//   APP_ID=com.example.game node tools/device.mjs <command>
//   node tools/device.mjs eval "<js>"          run JS in the page, print the result
//   node tools/device.mjs errors               reload and print console errors
//   node tools/device.mjs fps "<js>" [ms]      run JS, then sample rAF frame times for ms (default 3000)
//   node tools/device.mjs shot out.png         screenshot via adb
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright-core';

// adb from the Android SDK on Windows, else whatever `adb` is on the PATH
const ADB = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android/Sdk/platform-tools/adb.exe') : 'adb';
const PKG = process.env.APP_ID;
if (!PKG) throw new Error('set APP_ID to your app id, e.g. APP_ID=com.example.game');
const adb = (...a) => execFileSync(ADB, a, { encoding: 'buffer', maxBuffer: 64 << 20 });
const [, , cmd, arg, arg2] = process.argv;

if (cmd === 'shot') { fs.writeFileSync(arg, adb('exec-out', 'screencap', '-p')); process.exit(0); }

const pid = adb('shell', 'pidof', PKG).toString().trim();
if (!pid) throw new Error('game not running on the phone');
adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP('http://localhost:9223');
const page = browser.contexts()[0].pages().find(p => p.url().includes('localhost')) || browser.contexts()[0].pages()[0];

if (cmd === 'eval') console.log(JSON.stringify(await page.evaluate(arg), null, 1));
if (cmd === 'errors') {
  const errs = [];
  page.on('console', m => (m.type() === 'error' || m.type() === 'warning') && errs.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
  await page.reload(); await page.waitForTimeout(3000);
  console.log(errs.join('\n') || 'no errors');
}
if (cmd === 'fps') {
  // Sample real frame intervals in the page while the action plays out.
  const r = await page.evaluate(async ([js, ms]) => {
    const t = [];
    let stop = false;
    const loop = now => { t.push(now); if (!stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    await new Promise(r => setTimeout(r, 100));
    const t0 = performance.now();
    await (0, eval)(js);
    const run = performance.now() - t0;
    await new Promise(r => setTimeout(r, ms));
    stop = true;
    const d = t.slice(1).map((v, i) => v - t[i]);
    const avg = d.reduce((a, b) => a + b, 0) / d.length;
    return { syncMs: +run.toFixed(1), fps: +(1000 / avg).toFixed(1), late: +(100 * d.filter(x => x > 20).length / d.length).toFixed(1) + '%', worst: +Math.max(...d).toFixed(1), frames: d.length };
  }, [arg || '0', +(arg2 || 3000)]);
  console.log(JSON.stringify(r));
}
await browser.close();
