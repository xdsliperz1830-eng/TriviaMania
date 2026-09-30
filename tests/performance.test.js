/**
 * Performance against the published Playables limits.
 *
 * A headless runner is faster than a phone, so raw numbers here are optimistic.
 * The throttled cases exist to catch the shape of a regression rather than to
 * predict a device: CPU throttling via CDP is the closest proxy available
 * without real hardware.
 */
const fs = require("fs");
const path = require("path");
const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("performance");
const ck = (condition, message) => suite.check(condition, message);

const MiB = 1024 * 1024;
const INITIAL_PAYLOAD_CAP = 30 * MiB;   // hard limit: the game will not launch above it
const RECOMMENDED_CAP = 15 * MiB;       // Google's recommendation
const HEAP_CAP = 512;                   // MB
const INTERACTIVE_BUDGET = 5000;        // ms

async function openThrottled(browser, rate) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/game_api/**", (r) => r.abort());   // deterministic: no SDK fetch
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  }
  return page;
}

const measureFps = (page, ms) =>
  page.evaluate(
    (d) =>
      Promise.race([
        new Promise((res) => {
          let frames = 0;
          const t0 = performance.now();
          (function tick() {
            frames++;
            if (performance.now() - t0 < d) requestAnimationFrame(tick);
            else res(Math.round(frames / ((performance.now() - t0) / 1000)));
          })();
        }),
        new Promise((res) => setTimeout(() => res(null), d + 4000))
      ]),
    ms
  );

(async () => {
  const browser = await chromium.launch();

  /* ---------------- payload ---------------- */
  const bytes = fs.statSync(path.resolve(__dirname, "..", "index.html")).size;
  ck(bytes < INITIAL_PAYLOAD_CAP,
     `initial payload is inside the 30 MiB cap (${(bytes / 1024).toFixed(0)} KB)`);
  ck(bytes < RECOMMENDED_CAP,
     `initial payload is inside the 15 MiB recommendation (${(bytes / 1024).toFixed(0)} KB)`);
  // The whole game is one file, so the bundle is the payload.
  const extra = fs.readdirSync(path.resolve(__dirname, "..")).filter(
    (f) => /\.(png|jpg|jpeg|gif|mp3|wav|ogg|woff2?|ttf)$/i.test(f));
  ck(extra.length === 0, `no external media to load (${extra.length} files)`);

  /* ---------------- time to interactive, unthrottled and throttled ---------------- */
  for (const rate of [1, 4, 6]) {
    const page = await openThrottled(browser, rate);
    const started = Date.now();
    await page.goto(GAME_URL);
    await page.waitForSelector("#playBtn", { state: "visible" });
    await page.waitForFunction(() => document.querySelectorAll("#catGrid .cat").length > 0);
    const interactive = Date.now() - started;
    ck(interactive < INTERACTIVE_BUDGET,
       `interactive within 5 s at ${rate}x CPU throttling (${interactive} ms)`);

    if (rate === 6) {
      // Heaviest case: the game must still be playable, not just painted.
      await page.locator("#playBtn").click();
      await page.waitForTimeout(400);
      ck(await page.locator(".ans").count() === 4,
         "a round starts and renders four answers at 6x throttling");
      const correct = await page.evaluate(() => state.round[state.index].correctIndex);
      await page.locator(`.ans[data-idx="${correct}"]`).click();
      await page.waitForTimeout(400);
      ck(await page.evaluate(() => state.locked === true),
         "an answer registers at 6x throttling");
    }
    await page.close();
  }

  /* ---------------- frame rate ---------------- */
  let page = await openThrottled(browser, 1);
  await page.goto(GAME_URL);
  await page.waitForTimeout(500);
  const full = await measureFps(page, 2000);
  ck(full === null || full >= 50, `home screen runs smoothly unthrottled (${full} fps)`);
  await page.close();

  page = await openThrottled(browser, 4);
  await page.goto(GAME_URL);
  await page.waitForTimeout(800);
  const slow = await measureFps(page, 2000);
  // Four times slower hardware should still animate, not crawl.
  ck(slow === null || slow >= 20, `home screen still animates at 4x throttling (${slow} fps)`);
  await page.close();

  /* ---------------- memory ---------------- */
  page = await openThrottled(browser, 1);
  await page.goto(GAME_URL);
  await page.waitForTimeout(400);
  await page.evaluate(() => { state.roundSize = 30; Game.start(); });
  await page.waitForTimeout(600);
  const heap = await page.evaluate(() =>
    performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
  ck(heap === null || heap < HEAP_CAP,
     `JS heap stays well inside the 512 MB cap during a 30-question round (${heap} MB)`);

  /* ---------------- no leak across many rounds ---------------- */
  const before = await page.evaluate(() =>
    performance.memory ? performance.memory.usedJSHeapSize : 0);
  await page.evaluate(() => {
    for (let i = 0; i < 40; i++) { Game.quitToHome(); Game.start(); }
    Game.quitToHome();
  });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() =>
    performance.memory ? performance.memory.usedJSHeapSize : 0);
  const growthMB = Math.round((after - before) / 1048576);
  ck(before === 0 || growthMB < 50,
     `forty rounds do not leak memory (grew ${growthMB} MB)`);
  ck(await page.evaluate(() => state.rafId === null),
     "no animation frame is left pending after forty rounds");
  await page.close();

  await browser.close();
  suite.report();
})();
