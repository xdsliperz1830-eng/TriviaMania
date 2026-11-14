/**
 * Times each visual effect on its own, under CPU throttling.
 *
 *   node tools/measure-fx.js            # 4x and 6x throttling
 *   node tools/measure-fx.js 6          # one rate
 *
 * For every effect: the state is set up first, there is an idle lead-in, and
 * only then does the sampling window open and the effect fire. Inside the
 * window it records requestAnimationFrame intervals (fps, share of frames over
 * 20 ms, worst frame) and, from the DevTools Performance domain, how many
 * layouts and style recalculations the effect caused.
 *
 * Desktop Chromium is not a phone: CPU throttling slows script, style and
 * layout, but not the GPU. Treat these numbers as the shape of a regression
 * (an effect that forces layouts, writes text every frame or spawns many
 * layers), and confirm on a real low-end phone when one is available.
 */
const path = require("path");
const { chromium } = require("playwright");

const URL = "file://" + path.resolve(__dirname, "..", "index.html") + "?debug";
const WINDOW = 1500;   // ms sampled after each trigger
const LEAD_IN = 400;   // idle ms before the window opens

/** Each scenario: setup (outside the window), then the effect (inside it). */
const SCENARIOS = [
  { name: "home idle",          setup: async () => {},                                   fire: "" },
  { name: "quiz idle (timer)",  setup: async (p) => { await p.evaluate(() => __dbg.startQuiz()); }, fire: "" },
  { name: "correct answer",     setup: async (p) => { await p.evaluate(() => __dbg.startQuiz()); }, fire: "__dbg.correct()" },
  { name: "correct + combo 5",  setup: async (p) => { await p.evaluate(() => { __dbg.startQuiz(); __dbg.streak(4); }); }, fire: "__dbg.correct()" },
  { name: "wrong answer",       setup: async (p) => { await p.evaluate(() => __dbg.startQuiz()); }, fire: "__dbg.wrong()" },
  { name: "next question",      setup: async (p) => { await p.evaluate(() => { __dbg.startQuiz(); __dbg.correct(); }); }, fire: "__dbg.next()" },
  { name: "results reveal",     setup: async (p) => { await p.evaluate(() => { __dbg.startQuiz(); __dbg.correct(); }); }, fire: "__dbg.results()" },
  { name: "blocks: pick group", setup: async (p) => { await p.evaluate(() => __dbg.startBlocks()); }, fire: "__dbg.pickBlocks()" },
  { name: "blocks: blast",      setup: async (p) => { await p.evaluate(() => { __dbg.startBlocks(); __dbg.pickBlocks(); }); }, fire: "__dbg.blastBlocks()" }
];

async function measure(browser, rate, sc) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.route("**/game_api/**", (r) => r.abort());
  const cdp = await page.context().newCDPSession(page);
  await page.goto(URL);
  await page.waitForFunction(() => window.__dbg && document.querySelectorAll("#catGrid .cat").length > 0);
  await page.waitForTimeout(500);   // the game warms its effect elements 300 ms after start-up
  await sc.setup(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.waitForTimeout(LEAD_IN);
  await cdp.send("Performance.enable");
  const before = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const frames = await page.evaluate(([fire, ms]) => new Promise((resolve) => {
    const t = [];
    let stop = false;
    const loop = (now) => { t.push(now); if (!stop) requestAnimationFrame(loop); };
    requestAnimationFrame((now) => {
      t.push(now);
      if (fire) (0, eval)(fire);
      requestAnimationFrame(loop);
    });
    setTimeout(() => { stop = true; resolve(t); }, ms);
  }), [sc.fire, WINDOW]);
  const after = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  await page.close();
  const d = frames.slice(1).map((v, i) => v - frames[i]).filter((x) => x >= 0);
  const avg = d.reduce((a, b) => a + b, 0) / d.length;
  return {
    fps: +(1000 / avg).toFixed(1),
    late: +(100 * d.filter((x) => x > 20).length / d.length).toFixed(1),
    worst: +Math.max(...d).toFixed(1),
    layouts: after.LayoutCount - before.LayoutCount,
    styles: after.RecalcStyleCount - before.RecalcStyleCount,
    layoutMs: +((after.LayoutDuration - before.LayoutDuration) * 1000).toFixed(1)
  };
}

(async () => {
  const rates = process.argv[2] ? [Number(process.argv[2])] : [4, 6];
  const browser = await chromium.launch();
  // FX=name filters to the effects whose name contains it; REPEAT=n runs each n times.
  const only = process.env.FX, repeat = Number(process.env.REPEAT) || 1;
  for (const rate of rates) {
    console.log(`\n${rate}x CPU throttling, ${WINDOW} ms window`);
    console.log("effect".padEnd(22) + "fps".padStart(6) + "  >20ms".padStart(8) + "  worst".padStart(8) + "  layouts".padStart(10) + "  styles".padStart(9) + "  layout ms".padStart(11));
    for (const sc of SCENARIOS.filter((x) => !only || x.name.includes(only))) for (let k = 0; k < repeat; k++) {
      const r = await measure(browser, rate, sc);
      console.log(sc.name.padEnd(22) + String(r.fps).padStart(6) + (r.late + "%").padStart(8) + String(r.worst).padStart(8) +
        String(r.layouts).padStart(10) + String(r.styles).padStart(9) + String(r.layoutMs).padStart(11));
    }
  }
  await browser.close();
})();
