/**
 * The pluggable platform: a host that defines window.BrainBlastPlatform (the
 * Reddit version) replaces the YouTube layer, and its optional hooks turn on a
 * server-run Daily Challenge, a leaderboard and Block Blitz score reports.
 *
 * Driven against a mock platform injected before any page script runs. The
 * mock "server" scores 150 per correct answer whatever the clock says, so the
 * test can tell the server's total apart from the game's own count.
 */
const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("platform");
const ck = (condition, message) => suite.check(condition, message);

function mockPlatform() {
  return function (opts) {
    const log = [];
    const srv = { log, served: [], answers: [], total: 0, blitz: [], logins: 0, boards: [] };
    window.__srv = srv;
    const later = (v, ms) => new Promise((res, rej) => setTimeout(() => (v instanceof Error ? rej(v) : res(v)), ms || 30));
    // Today's ten: the first question of each category, answers reversed (so a[0], the right one, shows last).
    const items = () => Object.keys(BY_CATEGORY).map((c) => ({ id: BY_CATEGORY[c][0].id, order: [3, 2, 1, 0] }));
    window.BrainBlastPlatform = {
      inPlayables: false,
      version: "mock-reddit",
      firstFrameReady() { log.push("firstFrameReady"); },
      gameReady() { log.push("gameReady"); },
      isReady() { return true; },
      onPause() {}, onResume() {},
      audioEnabled() { return true; },
      onAudioEnabledChange() {},
      sendScore() { log.push("sendScore"); },
      logError() {},
      language() { return Promise.resolve("en"); },
      load() { log.push("load"); return Promise.resolve(opts.saved || null); },
      save(p) { log.push("save"); return Promise.resolve(true); },
      dailyDate() { return "2031-03-14"; },
      daily: {
        start(key) {
          log.push("start " + key);
          if (opts.startFails) return later(new Error("offline"));
          if (opts.played) return later({ played: { score: 1234, correct: 7 } });
          srv.served.push(0);
          return later({ count: 10, item: items()[0] });
        },
        next(key, i) {
          log.push("next " + i);
          if (opts.nextFailsOnce && !srv.failedOnce) { srv.failedOnce = true; return later(new Error("offline")); }
          srv.served.push(i);
          return later(items()[i]);
        },
        answer(key, i, pick) {
          srv.answers.push(pick);
          if (pick === 0) srv.total += 150;
          return later({ correct: pick === 0, total: srv.total }, 60);
        }
      },
      leaderboard(board) {
        srv.boards.push(board);
        if (opts.boardFails) return later(new Error("offline"));
        return later({
          rows: [
            { rank: 1, name: "<img src=x onerror=window.__xss=1>", score: 1500 },
            { rank: 2, name: "quizfan", score: 1200, me: !!opts.meInRows }
          ],
          me: opts.loggedOut ? null : (opts.meInRows ? { rank: 2, score: 1200 } : { rank: 14, score: 640 }),
          prize: board === "month" ? "Top player this month wins a $20 gift card. Rules in the pinned post." : null,
          loggedIn: !opts.loggedOut
        });
      },
      login() { srv.logins++; },
      blitzScore(score) { srv.blitz.push(score); }
    };
  };
}

async function open(browser, opts, size) {
  const page = await browser.newPage({ viewport: size || { width: 390, height: 844 } });
  suite.watch(page);
  await page.addInitScript(mockPlatform(), opts || {});
  await page.goto(GAME_URL + "?debug");
  await page.waitForTimeout(400);
  return page;
}

/** Answer the current question: right (the option whose a-index is 0) or a given wrong one. */
async function answer(page, right) {
  const k = await page.evaluate((right) => {
    const q = state.round[state.index];
    return right ? q.correctIndex : (q.correctIndex + 1) % 4;
  }, right);
  await page.locator(`.ans[data-idx="${k}"]`).click();
  await page.waitForTimeout(120);
}

(async () => {
  const browser = await chromium.launch();

  /* ---------------- the standalone game has no leaderboard ---------------- */
  let page = await browser.newPage();
  suite.watch(page);
  await page.goto(GAME_URL);
  await page.waitForTimeout(300);
  ck(!(await page.locator("#bestChip").evaluate((e) => e.classList.contains("lb") || e.hasAttribute("role"))),
     "without a platform leaderboard the Best chip is not a button");
  await page.close();

  /* ---------------- a host platform replaces the YouTube layer ---------------- */
  page = await open(browser);
  const boot = await page.evaluate(() => ({ log: window.__srv.log.slice(), version: Platform.version }));
  ck(boot.version === "mock-reddit", "window.BrainBlastPlatform is used as Platform");
  ck(boot.log.includes("load") && boot.log.includes("gameReady"), "the game loads progress and signals ready through it");
  ck((await page.locator("#bestChip").getAttribute("role")) === "button", "with a platform leaderboard the Best chip becomes its button");

  /* ---------------- server-run Daily Challenge ---------------- */
  await page.locator("#dailyBtn").click();
  ck((await page.locator("#dailyDate").innerText()).includes("14"), "the dialog shows the platform's day (the 14th)");
  await page.locator("#dailyPlay").click();
  ck(await page.locator("#dailyModal").isVisible(), "the dialog stays open while the first question loads");
  await page.waitForTimeout(200);
  ck(await page.locator("#quiz").isVisible(), "the round starts once the server hands out the first question");
  const first = await page.evaluate(() => ({ text: state.round[0].text, len: state.round.length, server: state.server,
    loaded: state.round.filter(Boolean).length, key: state.dailyKey, want: BY_CATEGORY[Object.keys(BY_CATEGORY)[0]][0].q }));
  ck(first.server && first.key === "2031-03-14", "the round is a server round for the platform's day");
  ck(first.text === first.want, "the first question is the one the server picked, shown from the local bank");
  ck(first.len === 10 && first.loaded === 1, "only the first question is known up front (1 of 10)");
  const lastOpt = await page.locator('.ans[data-idx="3"]').innerText();
  const rightText = await page.evaluate(() => BY_CATEGORY[Object.keys(BY_CATEGORY)[0]][0].a[0]);
  ck(lastOpt.includes(rightText), "answers appear in the server's order (the right one last here)");

  // Right, wrong, then let one run out, then right to the end.
  await answer(page, true);
  await page.waitForTimeout(150);
  ck((await page.evaluate(() => state.score)) === 150, "the score is corrected to the server's total after a reply (150)");
  await page.locator("#nextBtn").click();
  await page.waitForTimeout(200);
  ck((await page.evaluate(() => state.index)) === 1, "Next fetches and shows the second question");
  await answer(page, false);
  await page.locator("#nextBtn").click();
  await page.waitForTimeout(200);
  await page.evaluate(() => Game.timeUp());
  await page.waitForTimeout(150);
  for (let i = 3; i < 10; i++) {
    await page.locator("#nextBtn").click();
    await page.waitForTimeout(200);
    await answer(page, true);
  }
  await page.waitForTimeout(150);
  await page.locator("#nextBtn").click();
  await page.waitForTimeout(1300);
  ck(await page.locator("#results").isVisible(), "the tenth Next goes to the results");
  const done = await page.evaluate(() => ({ srv: { answers: window.__srv.answers.slice(), served: window.__srv.served.slice(), total: window.__srv.total },
    score: state.score, daily: progress.daily, sent: window.__srv.log.filter((x) => x === "sendScore").length }));
  ck(JSON.stringify(done.srv.served) === "[0,1,2,3,4,5,6,7,8,9]", "each question was fetched once, in order");
  ck(done.srv.answers.length === 10 && done.srv.answers[1] !== 0 && done.srv.answers[1] >= 1 && done.srv.answers[2] === -1,
     `every answer went to the server as an index into the bank's answers, -1 for time up (${done.srv.answers})`);
  ck(done.score === done.srv.total && done.score === 8 * 150, `the final score is the server's total (${done.score})`);
  ck(done.daily && done.daily.date === "2031-03-14" && done.daily.score === done.score && done.daily.correct === 8,
     "the day is recorded as played with the server's score");
  await page.locator("#homeBtn").click();
  await page.waitForTimeout(300);
  await page.locator("#dailyBtn").click();
  ck(await page.locator("#dailyPlay").isDisabled(), "a played day can't be started again");
  await page.locator("#dailyClose").click();

  /* ---------------- leaderboard dialog ---------------- */
  await page.locator("#bestChip").click();
  await page.waitForTimeout(200);
  ck(await page.locator("#lbModal").isVisible(), "the leaderboard button opens the dialog");
  ck((await page.locator(".lb-row").count()) === 2, "today's rows are listed");
  ck((await page.evaluate(() => window.__xss)) === undefined && (await page.locator(".lb-row .lb-name").first().innerText()).includes("<img"),
     "player names are shown as text, never as markup");
  ck((await page.locator("#lbMe").innerText()).includes("14"), "a player below the list sees their own rank");
  ck(!(await page.locator("#lbPrize").isVisible()), "the prize line is only on the monthly board");
  await page.locator('.lb-tab[data-board="month"]').click();
  await page.waitForTimeout(200);
  ck(await page.locator("#lbPrize").isVisible() && (await page.locator("#lbPrize").innerText()).includes("$20"),
     "the monthly board shows the platform's prize line");
  ck((await page.locator('.lb-tab[data-board="month"]').getAttribute("aria-pressed")) === "true", "the chosen board's tab is marked");
  await page.locator('.lb-tab[data-board="blitz"]').click();
  await page.waitForTimeout(200);
  ck((await page.evaluate(() => window.__srv.boards.slice())).join() === "day,month,blitz", "each tab asks for its own board");
  await page.keyboard.press("Escape");
  ck(!(await page.locator("#lbModal").isVisible()), "Escape closes the leaderboard");
  ck((await page.evaluate(() => document.activeElement.id)) === "bestChip", "focus goes back to the Best chip");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  ck(await page.locator("#lbModal").isVisible() && !(await page.locator("#quiz").isVisible()),
     "Enter on the focused chip opens the leaderboard (not a round)");
  await page.keyboard.press("Escape");

  /* ---------------- Block Blitz reports its final score ---------------- */
  await page.evaluate(() => { Blocks.start(); Blocks.testSetup({ autoPick: 0 }); });
  await page.waitForTimeout(400);
  for (let i = 0; i < 14 && !(await page.evaluate(() => Blocks.debug().over)); i++) {
    await page.locator("#bkBoard .bk-block:not(.pop)").first().click();
    await page.waitForTimeout(350);
    const d = await page.evaluate(() => Blocks.debug());
    if (!d.open) { await page.waitForTimeout(400); continue; }
    await page.locator(`#bkAnswers .ans[data-idx="${(d.correctIndex + 1) % 4}"]`).click();
    await page.waitForTimeout(2300);
  }
  const blitz = await page.evaluate(() => ({ over: Blocks.debug().over, score: Blocks.debug().score, sent: window.__srv.blitz.slice() }));
  ck(blitz.over && blitz.sent.length === 1 && blitz.sent[0] === blitz.score,
     `a finished Block Blitz game reports its score once (${JSON.stringify(blitz)})`);
  await page.close();

  /* ---------------- already played on another device ---------------- */
  page = await open(browser, { played: true });
  await page.locator("#dailyBtn").click();
  await page.locator("#dailyPlay").click();
  await page.waitForTimeout(200);
  ck(!(await page.locator("#quiz").isVisible()), "a day already played elsewhere does not start a round");
  ck((await page.locator("#dailyStatus").innerText()).includes("7/10") && (await page.locator("#dailyToday").innerText()) === "1234",
     "the dialog shows the score from the other device");
  await page.close();

  /* ---------------- offline at the start ---------------- */
  page = await open(browser, { startFails: true });
  await page.locator("#dailyBtn").click();
  await page.locator("#dailyPlay").click();
  await page.waitForTimeout(200);
  ck(!(await page.locator("#quiz").isVisible()) && (await page.locator("#dailyStatus").innerText()).includes("server"),
     "a failed start explains the connection problem and stays on the dialog");
  ck(!(await page.locator("#dailyPlay").isDisabled()), "and the Play button can be tapped again");
  await page.close();

  /* ---------------- offline between questions ---------------- */
  page = await open(browser, { nextFailsOnce: true });
  await page.evaluate(() => Game.start(true));
  await page.waitForTimeout(250);
  await answer(page, true);
  await page.locator("#nextBtn").click();
  await page.waitForTimeout(200);
  ck((await page.evaluate(() => state.index)) === 0 && (await page.locator("#fbExp").innerText()).includes("server"),
     "a failed fetch stays on the answered question and says why");
  await page.locator("#nextBtn").click();
  await page.waitForTimeout(200);
  ck((await page.evaluate(() => state.index)) === 1, "tapping Next again retries and moves on");
  // Quitting part-way keeps the day as played, as the server counts it.
  await page.locator("#quitBtn").click();
  await page.waitForTimeout(200);
  ck((await page.evaluate(() => progress.daily && progress.daily.date)) === "2031-03-14", "quitting a server daily keeps the day as played");
  await page.close();

  /* ---------------- logged out, and board failures ---------------- */
  page = await open(browser, { loggedOut: true });
  await page.locator("#bestChip").click();
  await page.waitForTimeout(200);
  ck(await page.locator("#lbLogin").isVisible() && (await page.locator("#lbStatus").innerText()).includes("Log in"),
     "a logged-out player is asked to log in");
  await page.locator("#lbLogin").click();
  ck((await page.evaluate(() => window.__srv.logins)) === 1, "the log-in button asks the platform");
  await page.close();

  page = await open(browser, { boardFails: true });
  await page.locator("#bestChip").click();
  await page.waitForTimeout(200);
  ck((await page.locator("#lbStatus").innerText()).includes("Couldn't"), "a failed board load says so");
  await page.close();

  /* ---------------- the top bar fits narrow phones ---------------- */
  // With and without a host platform: a five-digit best once pushed the last button off phones.
  for (const host of [true, false]) for (const lang of ["en", "de"]) for (const w of [320, 360, 390]) {
    page = await browser.newPage({ viewport: { width: w, height: 640 } });
    suite.watch(page);
    // A five-digit best, the widest the chip gets in practice.
    const saved = { best: { 10: 12450 }, length: 10 };
    if (host) await page.addInitScript(mockPlatform(), { saved });
    else await page.addInitScript((saved) => localStorage.setItem("brainblitz.save", JSON.stringify(saved)), saved);
    await page.goto(GAME_URL + "?lang=" + lang);
    await page.waitForTimeout(500);
    const fit = await page.evaluate(() => {
      const row = document.querySelector(".home-top").getBoundingClientRect();
      const btns = Array.from(document.querySelectorAll(".home-top .icon-btn, .best-chip")).map((b) => b.getBoundingClientRect());
      const overlap = btns.some((a, i) => btns.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
      return { inside: btns.every((r) => r.left >= row.left - 1 && r.right <= row.right + 1), overlap,
               scroll: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    ck(fit.inside && !fit.overlap && !fit.scroll,
       `${host ? "host" : "web"} ${lang} ${w}px: the top bar fits a five-digit best (${JSON.stringify(fit)})`);
    await page.close();
  }

  await browser.close();
  suite.report();
})().catch((e) => { console.error(e); process.exit(1); });
