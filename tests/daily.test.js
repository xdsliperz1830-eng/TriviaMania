/**
 * Daily challenge (opened from the calendar button in the top bar) and the
 * home mode tabs. The clock is fixed so "today" is known: the same date gives
 * everyone the same ten questions, one scored try a day, consecutive days
 * build a streak, and a missed day resets it.
 */
const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("daily");
const ck = (condition, message) => suite.check(condition, message);

const DAY1 = new Date("2026-11-11T10:00:00Z");
const DAY2 = new Date("2026-11-12T10:00:00Z");
const DAY4 = new Date("2026-11-14T10:00:00Z");

async function playDaily(page) {
  await page.locator("#dailyBtn").click();
  await page.locator("#dailyPlay").click();
  await page.waitForTimeout(250);
  for (let i = 0; i < 10; i++) {
    const ci = await page.evaluate(() => state.round[state.index].correctIndex);
    await page.keyboard.press(String(ci + 1));
    await page.waitForTimeout(120);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(300);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ timezoneId: "UTC", viewport: { width: 390, height: 844 } });

  /* ---------------- the same questions for everyone ---------------- */
  const roundOn = async (date) => {
    const p = await browser.newPage({ timezoneId: "UTC" });
    await p.clock.setFixedTime(date);
    await p.goto(GAME_URL);
    await p.waitForTimeout(200);
    const r = await p.evaluate(() => buildDailyRound(dateKey()).map((q) => q.text + "|" + q.options.map((o) => o.text).join("/")));
    const cats = await p.evaluate(() => buildDailyRound(dateKey()).map((q) => q.category));
    await p.close();
    return { r, cats };
  };
  const a = await roundOn(DAY1), b = await roundOn(DAY1), c = await roundOn(DAY2);
  ck(JSON.stringify(a.r) === JSON.stringify(b.r), "two players on the same day get identical questions and answer order");
  ck(JSON.stringify(a.r) !== JSON.stringify(c.r), "the next day brings a different set");
  ck(a.r.length === 10 && new Set(a.cats).size === 10, "ten questions, one from each category");

  /* ---------------- tabs, the calendar button and a first daily ---------------- */
  const page = suite.watch(await ctx.newPage());
  await page.clock.setFixedTime(DAY1);
  await page.goto(GAME_URL);
  await page.waitForTimeout(300);
  ck(await page.locator(".mode-tab").count() === 2, "the home screen has two tabs, Quiz and Block Blitz");
  ck(await page.locator("#tabQuiz").getAttribute("aria-selected") === "true", "the Quiz tab is selected by default");
  ck(await page.locator("#panelBlocks").isHidden(), "only the Quiz panel shows at first");
  ck((await page.locator("#tabBlocks .new-tag").innerText()) === "NEW", "the Block Blitz tab carries a NEW tag");
  ck(await page.locator("#dailyDot").isVisible(), "the calendar button shows a dot while today's daily is unplayed");

  await page.locator("#dailyBtn").click();
  ck(await page.locator("#dailyModal").isVisible(), "the calendar button opens the daily challenge");
  ck((await page.locator("#dailyPlay").innerText()).includes("TODAY'S 10"), "the dialog's Play button names the daily challenge");
  await page.keyboard.press("Escape");
  ck(await page.locator("#dailyModal").isHidden(), "Escape closes the dialog");
  await page.locator("#dailyBtn").click();
  await page.mouse.click(5, 420);   // the dimmed backdrop, outside the card
  ck(await page.locator("#dailyModal").isHidden(), "a tap outside the card closes the dialog");

  await playDaily(page);
  const st = await page.evaluate(() => ({ daily: state.daily, score: state.score, seen: progress.seen.length }));
  ck(st.daily && await page.locator("#results").isVisible(), "the daily round plays through to the results");
  ck(st.seen === 0, "the daily round leaves the quiz's rotation history alone");
  ck((await page.locator("#resDaily").innerText()).includes("1-day streak"), "the results show a 1-day streak");
  ck((await page.locator("#againBtn").innerText()) === "Play a Quiz", "after a daily, the replay button offers a quiz");

  await page.locator("#homeBtn").click();
  await page.waitForTimeout(250);
  ck(await page.locator("#dailyDot").isHidden(), "the dot clears once today's daily is played");
  ck(!(await page.locator("#playBtn").isDisabled()), "the main Play button still starts a quiz");
  await page.locator("#dailyBtn").click();
  ck(await page.locator("#dailyPlay").isDisabled() && (await page.locator("#dailyPlay").innerText()).includes("DONE FOR TODAY"),
     "one scored try a day: the daily's Play is disabled once it is done");
  ck((await page.locator("#dailyToday").innerText()) === String(st.score), "today's score shows on the Daily panel");
  await page.evaluate(() => Game.start(true));
  ck(await page.evaluate(() => !state.roundActive), "starting the daily again by any route is refused");

  await page.locator("#dailyClose").click();

  /* ---------------- the tab is remembered ---------------- */
  await page.locator("#tabBlocks").click();
  await page.waitForTimeout(1000);
  await page.reload();
  await page.waitForTimeout(300);
  ck(await page.locator("#tabBlocks").getAttribute("aria-selected") === "true", "the last tab is remembered after a reload");

  /* ---------------- consecutive days ---------------- */
  await page.clock.setFixedTime(DAY2);
  await page.reload();
  await page.waitForTimeout(300);
  ck(await page.locator("#dailyDot").isVisible(), "the next day the dot is back");
  await page.locator("#dailyBtn").click();
  ck(!(await page.locator("#dailyPlay").isDisabled()), "the next day the daily is open again");
  ck((await page.locator("#dailyStatus").innerText()).includes("1-day streak"), "it nudges the player to keep the streak");
  await page.locator("#dailyClose").click();
  await playDaily(page);
  ck((await page.locator("#resDaily").innerText()).includes("2-day streak"), "a second day in a row makes a 2-day streak");

  /* ---------------- a missed day ---------------- */
  await page.waitForTimeout(1000);
  await page.clock.setFixedTime(DAY4);
  await page.reload();
  await page.waitForTimeout(300);
  await page.locator("#dailyBtn").click();
  ck((await page.locator("#dailyStreak").innerText()) === "0", "a missed day breaks the streak");
  ck((await page.locator("#dailyLongest").innerText()) === "2", "the longest streak is kept");
  await page.locator("#dailyClose").click();
  await playDaily(page);
  ck((await page.locator("#resDaily").innerText()).includes("1-day streak"), "playing again starts a new streak at 1");

  ck(await page.evaluate(() => dayBefore("2026-03-01") === "2026-02-28" && dayBefore("2026-01-01") === "2025-12-31"),
     "day arithmetic crosses month and year ends");

  /* ---------------- tabs from the keyboard ---------------- */
  await page.locator("#homeBtn").click();
  await page.waitForTimeout(200);
  await page.locator("#tabQuiz").click();
  await page.locator("#tabQuiz").focus();
  await page.keyboard.press("ArrowRight");
  ck(await page.locator("#tabBlocks").getAttribute("aria-selected") === "true", "arrow keys move between tabs");
  ck((await page.locator("#playBtn").innerText()).includes("BLOCK BLITZ"), "the Play button follows the tab");

  await ctx.close();
  await browser.close();
  suite.report();
})();
