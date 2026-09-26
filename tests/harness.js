/**
 * Shared test harness.
 *
 * Each suite is a standalone Node script so that a crash in one cannot take the
 * others down with it; tests/run.js spawns them and aggregates the exit codes.
 */
const path = require("path");
const { chromium } = require("playwright");

const GAME_URL = "file://" + path.resolve(__dirname, "..", "index.html");

const PHONE = { width: 390, height: 844 };

/**
 * Collects pass/fail results and reports them, exiting non-zero on any failure
 * or uncaught page error.
 */
/**
 * The Playables SDK is only reachable from inside YouTube. Everywhere else the
 * request fails by design and the game runs standalone, so that console entry
 * is expected rather than a defect.
 */
function isSdkFetch(consoleMessage) {
  const from = (consoleMessage.location() && consoleMessage.location().url) || "";
  return from.indexOf("youtube.com/game_api") !== -1 ||
         consoleMessage.text().indexOf("game_api") !== -1;
}

function createSuite(name) {
  const passed = [];
  const failed = [];
  const pageErrors = [];

  return {
    name,
    /** Record an assertion. */
    check(condition, message) {
      (condition ? passed : failed).push(message);
      return !!condition;
    },
    /** Attach to a page so uncaught errors fail the suite. */
    watch(page) {
      page.on("pageerror", (e) => pageErrors.push("pageerror: " + e.message));
      page.on("console", (m) => {
        if (m.type() !== "error") return;
        // The Playables SDK is only reachable from inside YouTube. Everywhere
        // else the request fails by design and the game runs standalone, so
        // that one console entry is expected rather than a defect.
        if (isSdkFetch(m)) return;
        pageErrors.push("console: " + m.text());
      });
      return page;
    },
    /** Print the report and exit with the right code. */
    report() {
      passed.forEach((m) => console.log("  pass  " + m));
      failed.forEach((m) => console.log("  FAIL  " + m));
      pageErrors.forEach((m) => console.log("  ERROR " + m));
      const ok = failed.length === 0 && pageErrors.length === 0;
      console.log(
        `\n${name}: ${passed.length} passed, ${failed.length} failed` +
          (pageErrors.length ? `, ${pageErrors.length} page errors` : "")
      );
      process.exit(ok ? 0 : 1);
    }
  };
}

/** Launch a browser and open the game on a phone-sized viewport. */
async function openGame(options = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: options.viewport || PHONE,
    hasTouch: options.hasTouch !== false
  });
  const page = await context.newPage();
  await page.goto(GAME_URL);
  await page.waitForTimeout(options.settle || 350);
  return { browser, context, page };
}

/** Play the current round to the results screen by always answering correctly. */
async function playRound(page, maxSteps = 40) {
  for (let i = 0; i < maxSteps; i++) {
    if (await page.locator("#results").isVisible()) return true;
    if (await page.evaluate(() => state.locked)) {
      await page.locator("#nextBtn").click();
    } else {
      const correct = await page.evaluate(() => state.round[state.index].correctIndex);
      await page.locator(`.ans[data-idx="${correct}"]`).click();
    }
    await page.waitForTimeout(140);
  }
  return page.locator("#results").isVisible();
}

/**
 * Clear saved progress. Progress is held in memory and mirrored to storage, so
 * clearing the key alone is not enough — the live object has to go back to its
 * defaults too.
 */
async function resetProgress(page) {
  await page.evaluate(() => {
    try { localStorage.clear(); } catch (e) {}
    progress.seen = [];
    progress.best = {};
    progress.muted = false;
    progress.length = 10;
  });
}

/** The ids the game currently considers served. */
function seenIds(page) {
  return page.evaluate(() => progress.seen.slice());
}

module.exports = {
  chromium, GAME_URL, PHONE, createSuite, openGame, playRound, resetProgress, seenIds, isSdkFetch
};
