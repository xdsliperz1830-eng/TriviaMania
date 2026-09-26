/**
 * YouTube Playables integration.
 *
 * YouTube itself is not reachable from a test runner, so these drive the game
 * against a mock `ytgame` injected before any page script runs. The mock mirrors
 * the surface confirmed against Phaser's official Playables template.
 */
const { chromium, GAME_URL, createSuite, isSdkFetch } = require("./harness");
const suite = createSuite("playables");
const ck = (condition, message) => suite.check(condition, message);

/** Installed before page scripts; records every SDK call the game makes. */
function mockSdk(options) {
  return function (opts) {
    const calls = [];
    window.__sdk = {
      calls,
      saved: [],
      scores: [],
      handlers: {},
      resolveLoad: null
    };
    window.ytgame = {
      SDK_VERSION: "mock-1",
      IN_PLAYABLES_ENV: opts.inEnv,
      game: {
        firstFrameReady() { calls.push("firstFrameReady"); },
        gameReady() { calls.push("gameReady"); },
        loadData() {
          calls.push("loadData");
          if (opts.throwOnEverything) throw new Error("boom");
          if (opts.hangLoad) return new Promise(() => {});   // never settles
          return Promise.resolve(opts.savedBlob || "");
        },
        saveData(str) {
          calls.push("saveData");
          window.__sdk.saved.push(str);
          if (opts.throwOnEverything) throw new Error("boom");
          return Promise.resolve();
        }
      },
      system: {
        onPause(cb) { calls.push("onPause"); window.__sdk.handlers.pause = cb; },
        onResume(cb) { calls.push("onResume"); window.__sdk.handlers.resume = cb; },
        isAudioEnabled() { return opts.audioEnabled !== false; },
        onAudioEnabledChange(cb) { window.__sdk.handlers.audio = cb; return function () {}; },
        getLanguage() { return Promise.resolve("en"); }
      },
      engagement: {
        sendScore(o) { calls.push("sendScore"); window.__sdk.scores.push(o); }
      },
      health: {
        logError() { calls.push("logError"); },
        logWarning() { calls.push("logWarning"); }
      }
    };
    if (opts.throwOnEverything) {
      ["firstFrameReady", "gameReady"].forEach((m) => {
        window.ytgame.game[m] = function () { calls.push(m); throw new Error("boom"); };
      });
      window.ytgame.system.isAudioEnabled = function () { throw new Error("boom"); };
      window.ytgame.system.onPause = function () { throw new Error("boom"); };
      window.ytgame.system.onResume = function () { throw new Error("boom"); };
      window.ytgame.engagement.sendScore = function () { throw new Error("boom"); };
    }
  };
}

async function openWith(browser, opts) {
  const page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  page.on("console", (m) => {
    if (m.type() === "error" && !isSdkFetch(m)) suite.check(false, "console: " + m.text());
  });
  page.on("pageerror", (e) => suite.check(false, "pageerror: " + e.message));
  await page.addInitScript(mockSdk(), opts);
  await page.goto(GAME_URL);
  await page.waitForTimeout(600);
  return page;
}

const calls = (page) => page.evaluate(() => window.__sdk.calls.slice());

(async () => {
  const browser = await chromium.launch();

  /* ---------------- loading lifecycle ---------------- */
  let page = await openWith(browser, { inEnv: true });
  let c = await calls(page);
  ck(c.indexOf("firstFrameReady") !== -1, "firstFrameReady is called");
  ck(c.indexOf("gameReady") !== -1, "gameReady is called");
  ck(c.indexOf("firstFrameReady") < c.indexOf("gameReady"),
     "firstFrameReady comes before gameReady");
  ck(c.indexOf("loadData") !== -1, "loadData is called at boot");
  ck(c.indexOf("loadData") < c.indexOf("gameReady"),
     "saved progress is loaded before the game reports itself ready");
  ck(c.indexOf("saveData") === -1, "saveData is not called before loadData resolves");
  ck(c.indexOf("onPause") !== -1 && c.indexOf("onResume") !== -1,
     "pause and resume handlers are registered");
  ck(await page.locator("#home").isVisible(), "the home screen is showing");
  await page.close();

  /* ---------------- cloud progress hydrates the game ---------------- */
  page = await openWith(browser, {
    inEnv: true,
    savedBlob: JSON.stringify({ seen: [], best: { 10: 4321, 20: 777 }, muted: true, length: 20 })
  });
  ck((await page.locator(".len.on").innerText()) === "20",
     "the saved round length is restored");
  // Bests are per round length, so the restored length decides which is shown.
  ck((await page.locator("#bestScore").innerText()) === "777",
     "best score comes from the cloud save, for the restored length");
  await page.locator('.len[data-len="10"]').click();
  await page.waitForTimeout(150);
  ck((await page.locator("#bestScore").innerText()) === "4321",
     "switching length shows that length's cloud-saved best");
  ck((await page.locator("#muteBtn").innerText()) === "🔇",
     "the saved mute preference is restored");
  await page.close();

  /* ---------------- a finished round saves and reports ---------------- */
  page = await openWith(browser, { inEnv: true });
  await page.evaluate(() => { state.roundSize = 5; Game.start(); });
  await page.waitForTimeout(250);
  for (let i = 0; i < 12; i++) {
    if (await page.locator("#results").isVisible()) break;
    if (await page.evaluate(() => state.locked)) await page.locator("#nextBtn").click();
    else {
      const k = await page.evaluate(() => state.round[state.index].correctIndex);
      await page.locator(`.ans[data-idx="${k}"]`).click();
    }
    await page.waitForTimeout(140);
  }
  ck(await page.locator("#results").isVisible(), "a five-question round reaches the results screen");
  const after = await page.evaluate(() => ({
    calls: window.__sdk.calls.slice(),
    scores: window.__sdk.scores.slice(),
    saved: window.__sdk.saved.slice(),
    score: state.score
  }));
  ck(after.calls.indexOf("saveData") !== -1, "progress is saved to the cloud after a round");
  ck(after.scores.length === 1 && after.scores[0].value === after.score,
     `the score is reported as { value } (${JSON.stringify(after.scores[0])})`);
  const payload = JSON.parse(after.saved[after.saved.length - 1]);
  ck(Array.isArray(payload.seen) && payload.seen.length === 5,
     `the saved payload carries the five served question ids (${payload.seen.length})`);
  ck(payload.best && payload.best["5"] === after.score, "the saved payload carries the new best score");
  ck(after.saved[after.saved.length - 1].length < 3 * 1024 * 1024,
     `the payload is far inside the 3 MB save limit (${after.saved[after.saved.length - 1].length} bytes)`);

  /* ---------------- writes are debounced, not per answer ---------------- */
  const writeCount = after.calls.filter((x) => x === "saveData").length;
  ck(writeCount <= 3, `a five-question round does not write once per answer (${writeCount} writes)`);
  await page.close();

  /* ---------------- pause and resume drive the countdown ---------------- */
  page = await openWith(browser, { inEnv: true });
  await page.evaluate(() => Game.start());
  await page.waitForTimeout(300);
  const t0 = await page.evaluate(() => state.timeLeft);
  await page.evaluate(() => window.__sdk.handlers.pause());
  await page.waitForTimeout(700);
  const t1 = await page.evaluate(() => state.timeLeft);
  ck(Math.abs(t0 - t1) < 0.1, `the countdown freezes on pause (${t0.toFixed(1)} -> ${t1.toFixed(1)})`);
  ck(await page.evaluate(() => state.rafId === null), "no animation frame is pending while paused");
  await page.evaluate(() => window.__sdk.handlers.resume());
  await page.waitForTimeout(500);
  const t2 = await page.evaluate(() => state.timeLeft);
  ck(t2 < t1, `the countdown resumes (${t1.toFixed(1)} -> ${t2.toFixed(1)})`);
  await page.close();

  /* ---------------- YouTube owns the audio ---------------- */
  page = await openWith(browser, { inEnv: true, audioEnabled: false });
  ck(await page.evaluate(() => Sound.isAudible() === false),
     "the game is silent when YouTube reports audio disabled");
  ck((await page.locator("#muteBtn").innerText()) === "🔇",
     "the mute button shows muted while YouTube has audio off");
  await page.evaluate(() => window.__sdk.handlers.audio(true));
  await page.waitForTimeout(150);
  ck(await page.evaluate(() => Sound.isAudible() === true),
     "audio returns when YouTube re-enables it");
  // the player's own mute still applies on top
  await page.evaluate(() => Sound.setMuted(true));
  ck(await page.evaluate(() => Sound.isAudible() === false),
     "the player's own mute still silences the game when YouTube allows audio");
  await page.close();

  /* ---------------- a hostile SDK cannot break the game ---------------- */
  page = await openWith(browser, { inEnv: true, throwOnEverything: true });
  ck(await page.locator("#home").isVisible(), "the home screen loads when every SDK call throws");
  await page.locator("#playBtn").click();
  await page.waitForTimeout(300);
  ck(await page.locator("#quiz").isVisible(), "a round still starts when every SDK call throws");
  await page.close();

  /* ---------------- a hanging loadData cannot block the game ---------------- */
  page = await openWith(browser, { inEnv: true, hangLoad: true });
  await page.waitForTimeout(2600);            // the adapter bounds loadData at 2s
  ck(await page.locator("#home").isVisible(), "the game becomes interactive even if loadData never resolves");
  ck((await calls(page)).indexOf("gameReady") !== -1, "gameReady is still reported after a hung loadData");
  await page.close();

  /* ---------------- outside YouTube nothing is called ---------------- */
  page = await openWith(browser, { inEnv: false });
  c = await calls(page);
  ck(c.length === 0, `no SDK calls are made when IN_PLAYABLES_ENV is false (${JSON.stringify(c)})`);
  ck(await page.locator("#home").isVisible(), "the standalone build still runs");
  await page.evaluate(() => { state.roundSize = 5; Game.start(); });
  await page.waitForTimeout(250);
  ck(await page.locator("#quiz").isVisible(), "the standalone build still plays");
  ck(await page.evaluate(() => Sound.isAudible() === true), "audio is allowed outside YouTube");
  await page.close();

  /* ---------------- no SDK at all: the deployed web build ---------------- */
  page = await browser.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  page.on("pageerror", (e) => suite.check(false, "pageerror: " + e.message));
  await page.goto(GAME_URL);           // the SDK script cannot load here
  await page.waitForTimeout(600);
  ck(await page.evaluate(() => typeof window.ytgame === "undefined"),
     "the SDK really is absent in this environment");
  ck(await page.locator("#home").isVisible(), "the game runs with no SDK object at all");
  ck(await page.evaluate(() => Platform.inPlayables === false), "the adapter reports standalone");
  ck(await page.evaluate(() => Platform.version === "standalone"), "the adapter reports no SDK version");
  await page.close();

  await browser.close();
  suite.report();
})();
