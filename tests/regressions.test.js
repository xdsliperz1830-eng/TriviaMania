/**
 * Regression tests for defects found in the pre-Playables review.
 * Each test names the defect it guards so a future failure explains itself.
 */
const { chromium, GAME_URL, createSuite, openGame, playRound, resetProgress } = require("./harness");
const suite = createSuite("regressions");
const ck = (condition, message) => suite.check(condition, message);

const seenCount = (page) => page.evaluate(() => progress.seen.length);

(async () => {
  const { browser, page } = await openGame();
  suite.watch(page);

  /* ---------------------------------------------------------------------
     Defect 3.1 — building a round marks its questions as seen, so a second
     Play tap used to burn a whole extra set the player never saw. One
     double-tap on a 30-question category exhausted all 30.
     --------------------------------------------------------------------- */
  await resetProgress(page);
  await page.reload();
  await page.waitForTimeout(400);
  await resetProgress(page);
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
    progress.seen = [];
    state.category = "animals";
    state.roundSize = 30;
    Game.start();
    Game.start();
    Game.start();
    const result = { calls, seen: progress.seen.length };
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
  await page.evaluate(() => { progress.seen = []; state.roundSize = 10; });
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

  // A live frame-rate check, generous enough not to flake. requestAnimationFrame
  // can be throttled or suspended on a headless runner, so the probe races a
  // timer: if frames never arrive we report that rather than hanging the job.
  const fps = await page.evaluate(
    () =>
      Promise.race([
        new Promise((res) => {
          let frames = 0;
          const t0 = performance.now();
          (function tick() {
            frames++;
            if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
            else res(Math.round(frames / ((performance.now() - t0) / 1000)));
          })();
        }),
        new Promise((res) => setTimeout(() => res(null), 6000))
      ])
  );
  if (fps === null) {
    // The structural no-blur assertion above is the real guard; this is a bonus
    // signal, so an environment that cannot animate should not fail the build.
    ck(true, "3.3 frame rate not measurable in this environment (rAF did not run) — skipped");
  } else {
    ck(fps >= 50, `3.3 home screen holds a healthy frame rate (${fps} fps, was 43 before the fix)`);
  }

  /* ---------------------------------------------------------------------
     Defect 3.4 — the answer list is a scroll area, so it clipped the wrong
     answer's shake and the correct answer's pop at the sides, cutting off
     the button outline. Follow the button frame by frame through each.
     --------------------------------------------------------------------- */
  for (const [w, h] of [[390, 844], [360, 640]]) {
    const clipPage = suite.watch(await browser.newPage());
    await clipPage.setViewportSize({ width: w, height: h });
    await clipPage.goto(GAME_URL);
    await clipPage.waitForTimeout(300);
    await clipPage.locator("#playBtn").click();
    for (const kind of ["wrong", "correct"]) {
      await clipPage.waitForTimeout(500);
      const past = await clipPage.evaluate((kind) => new Promise((resolve) => {
        const area = document.querySelector("#qArea");
        const box = area.getBoundingClientRect();
        const ci = state.round[state.index].correctIndex;
        const idx = kind === "wrong" ? (ci + 1) % 4 : ci;
        const btn = document.querySelector('#answers .ans[data-idx="' + idx + '"]');
        let worst = 0;
        const t0 = performance.now();
        Game.answer(idx);
        (function tick() {
          const r = btn.getBoundingClientRect();
          worst = Math.max(worst, box.left - r.left, r.right - (box.left + area.clientWidth));
          if (performance.now() - t0 < 700) requestAnimationFrame(tick);
          else resolve(Math.round(worst * 10) / 10);
        })();
      }), kind);
      ck(past <= 0, `3.4 at ${w}x${h} the ${kind} answer's animation stays inside the answer area (${past}px past the edge)`);
      await clipPage.evaluate(() => Game.next());
    }
    await clipPage.close();
  }

  /* ---------------------------------------------------------------------
     Defect 3.5 — on laptops and monitors the category names broke inside
     words ("Knowledg-e", "Technolog-y"): the four desktop columns were
     148px wide and the names were allowed to break anywhere. And on a
     laptop browser window (about 1366x657 once the toolbars are drawn)
     the last row of categories sat below the fold.
     --------------------------------------------------------------------- */
  for (const lang of ["en", "es", "pt", "de"]) {
    for (const [w, h] of [[932, 1306], [1024, 768], [1280, 600], [1366, 657], [1366, 768], [1920, 1080], [2560, 1440]]) {
      const dp = suite.watch(await browser.newPage({ viewport: { width: w, height: h } }));
      await dp.goto(GAME_URL + "?lang=" + lang);
      await dp.waitForTimeout(400);
      const r = await dp.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px";
        document.body.appendChild(probe);
        const split = [];
        document.querySelectorAll("#catGrid .cat .nm").forEach((n) => {
          probe.style.font = getComputedStyle(n).font;
          probe.style.letterSpacing = getComputedStyle(n).letterSpacing;
          n.textContent.split(/\s+/).forEach((word) => {
            probe.textContent = word;
            if (probe.getBoundingClientRect().width > n.getBoundingClientRect().width + 1) split.push(word);
          });
        });
        probe.remove();
        const sc = document.querySelector(".cat-scroll").getBoundingClientRect();
        const below = Array.from(document.querySelectorAll("#catGrid .cat")).filter((c) => c.getBoundingClientRect().bottom > sc.bottom + 1).length;
        const play = document.getElementById("playBtn").getBoundingClientRect();
        return { split, below, playOn: play.bottom <= innerHeight + 1 };
      });
      ck(r.split.length === 0, `3.5 ${lang} ${w}x${h}: no category name breaks inside a word (${r.split.join(", ") || "none"})`);
      ck(r.below === 0 && r.playOn, `3.5 ${lang} ${w}x${h}: every category and the Play button are on screen without scrolling (${r.below} below)`);
      await dp.close();
    }
  }

  /* ---------------------------------------------------------------------
     "Coming soon" teasers: two locked "???" cards fill the empty cells at
     the end of the category grid, and only there. They must not add a row
     on a phone, take focus, or start anything when clicked.
     --------------------------------------------------------------------- */
  for (const [lang, w, h, want] of [["en", 1366, 657, 2], ["de", 1920, 1080, 2], ["es", 667, 375, 2], ["en", 390, 844, 0], ["pt", 320, 568, 0], ["en", 844, 390, 0]]) {
    const tp = suite.watch(await browser.newPage({ viewport: { width: w, height: h } }));
    await tp.goto(GAME_URL + "?lang=" + lang);
    await tp.waitForTimeout(400);
    const r = await tp.evaluate(() => {
      const shown = Array.from(document.querySelectorAll("#catGrid .cat-soon")).filter((e) => !e.hidden);
      const last = Array.from(document.querySelectorAll("#catGrid .cat")).pop().getBoundingClientRect();
      return {
        n: shown.length,
        sameRow: shown.every((e) => Math.abs(e.getBoundingClientRect().top - last.top) < 2),
        fits: shown.every((e) => e.querySelector(".ct").getBoundingClientRect().right <= e.getBoundingClientRect().right - 3),
        quiet: shown.every((e) => e.getAttribute("aria-hidden") === "true" && e.tabIndex < 0 && e.querySelector(".nm").textContent === "???")
      };
    });
    ck(r.n === want && r.sameRow, `teasers ${lang} ${w}x${h}: ${want} "???" cards fill the last row (${r.n} shown)`);
    ck(r.fits && r.quiet, `teasers ${lang} ${w}x${h}: the "coming soon" label fits, and the cards are hidden from keyboard and screen readers`);
    if (want) {
      await tp.locator("#catGrid .cat-soon").first().click();
      ck(await tp.evaluate(() => document.getElementById("home").classList.contains("active") && state.category === "mixed"),
        `teasers ${lang} ${w}x${h}: clicking one does nothing`);
    }
    await tp.close();
  }

  await browser.close();
  suite.report();
})();
