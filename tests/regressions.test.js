/**
 * Regression tests for defects found in the pre-Playables review.
 * Each test names the defect it guards so a future failure explains itself.
 */
const { chromium, GAME_URL, createSuite, openGame, playRound } = require("./harness");
const suite = createSuite("regressions");
const ck = (condition, message) => suite.check(condition, message);

const seenCount = (page) =>
  page.evaluate(() => (localStorage.getItem("brainblitz.seen") || "").split(",").filter(Boolean).length);

(async () => {
  const { browser, page } = await openGame();
  suite.watch(page);

  /* ---------------------------------------------------------------------
     Defect 3.1 — building a round marks its questions as seen, so a second
     Play tap used to burn a whole extra set the player never saw. One
     double-tap on a 30-question category exhausted all 30.
     --------------------------------------------------------------------- */
  await page.evaluate(() => localStorage.removeItem("brainblitz.seen"));
  await page.reload();
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    document.querySelector("#playBtn").click();
    document.querySelector("#playBtn").click();
    document.querySelector("#playBtn").click();
  });
  await page.waitForTimeout(250);
  ck((await seenCount(page)) === 10, "3.1 triple-tapping Play consumes one round, not three");
  ck((await page.evaluate(() => state.round.length)) === 10, "3.1 the round that starts is still 10 questions");

  // Counting consumed questions only exposes the bug when the round is smaller
  // than the pool; a 30-question round legitimately uses all 30. So assert the
  // underlying invariant directly: one tap must build exactly one round.
  await page.evaluate(() => Game.quitToHome());
  const builds = await page.evaluate(() => {
    const realBuild = window.buildRound;
    let calls = 0;
    window.buildRound = function (...args) { calls++; return realBuild.apply(this, args); };
    localStorage.removeItem("brainblitz.seen");
    state.category = "animals";
    state.roundSize = 30;
    Game.start();
    Game.start();
    Game.start();
    const result = { calls, seen: (localStorage.getItem("brainblitz.seen") || "").split(",").filter(Boolean).length };
    window.buildRound = realBuild;
    return result;
  });
  ck(builds.calls === 1, `3.1 three rapid Play taps build exactly one round (built ${builds.calls})`);
  ck(builds.seen === 30, `3.1 a 30-question round consumes its 30 questions once (${builds.seen})`);

  // the guard must not block legitimate restarts
  await page.evaluate(() => Game.quitToHome());
  await page.waitForTimeout(150);
  const afterQuit = await page.evaluate(() => {
    state.roundSize = 10;
    Game.start();
    return { active: document.querySelector("#quiz").classList.contains("active"), n: state.round.length };
  });
  ck(afterQuit.active && afterQuit.n === 10, "3.1 quitting then pressing Play still starts a round");

  await page.evaluate(() => { state.round = state.round.slice(0, 1); state.index = 0; Game.end(); });
  await page.waitForTimeout(250);
  await page.locator("#againBtn").click();
  await page.waitForTimeout(250);
  ck(await page.locator("#quiz").isVisible(), "3.1 Play Again from the results screen still starts a round");

  // and the Enter key, which is the third way into Game.start()
  await page.evaluate(() => Game.quitToHome());
  await page.evaluate(() => { localStorage.removeItem("brainblitz.seen"); state.roundSize = 10; });
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  ck((await seenCount(page)) === 10, "3.1 pressing Enter twice on the home screen consumes one round");

  /* ---------------------------------------------------------------------
     Defect 3.2 — Esc only worked while the quiz screen was active, so the
     results screen could not be dismissed from the keyboard.
     --------------------------------------------------------------------- */
  await page.evaluate(() => { state.round = state.round.slice(0, 1); state.index = 0; Game.end(); });
  await page.waitForTimeout(250);
  ck(await page.locator("#results").isVisible(), "3.2 results screen is showing");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  ck(await page.locator("#home").isVisible(), "3.2 Esc closes the results screen");

  // Esc mid-quiz must still work as before
  await page.evaluate(() => Game.start());
  await page.waitForTimeout(250);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  ck(await page.locator("#home").isVisible(), "3.2 Esc still quits mid-round");

  /* ---------------------------------------------------------------------
     Defect 3.3 — the background orbs used filter:blur(60px) on very large,
     continuously animating elements, costing about a third of the frame
     budget. Guard structurally so it cannot be reintroduced.
     --------------------------------------------------------------------- */
  const paint = await page.evaluate(() => {
    const blurred = [];
    let animatedOrbs = 0;
    document.querySelectorAll("*").forEach((el) => {
      const s = getComputedStyle(el);
      const animating = s.animationName !== "none" && s.animationIterationCount === "infinite";
      const rect = el.getBoundingClientRect();
      const big = rect.width * rect.height > 40000;
      if (animating && big && /blur\(/.test(s.filter)) blurred.push(el.className + " " + s.filter);
      if (el.classList.contains("orb") && animating) animatedOrbs++;
    });
    const orb = document.querySelector("#bg .o1");
    return {
      blurred,
      animatedOrbs,
      orbVisible: orb ? getComputedStyle(orb).backgroundImage.indexOf("gradient") !== -1 : false
    };
  });
  ck(paint.blurred.length === 0,
     "3.3 no large animating element uses a blur filter" +
     (paint.blurred.length ? ": " + paint.blurred.join(", ") : ""));
  ck(paint.animatedOrbs === 3, `3.3 all three background orbs are still animating (${paint.animatedOrbs})`);
  ck(paint.orbVisible, "3.3 the background wash is drawn with a gradient");

  // and a live frame-rate check, generous enough not to flake in CI
  const fps = await page.evaluate(
    () =>
      new Promise((res) => {
        let frames = 0;
        const t0 = performance.now();
        (function tick() {
          frames++;
          if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
          else res(Math.round(frames / ((performance.now() - t0) / 1000)));
        })();
      })
  );
  ck(fps >= 50, `3.3 home screen holds a healthy frame rate (${fps} fps, was 43 before the fix)`);

  await browser.close();
  suite.report();
})();
