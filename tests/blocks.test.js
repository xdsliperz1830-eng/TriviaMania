/**
 * Block Blitz (draft mode): tapping picks a whole same-category group, a
 * right answer blasts exactly that group and scores size² × 10, a wrong one
 * raises a row, a full column ends the game, and quitting returns home.
 */
const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("blocks");
const ck = (condition, message) => suite.check(condition, message);

(async () => {
  const browser = await chromium.launch();
  const page = suite.watch(await browser.newPage());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(GAME_URL);
  await page.waitForTimeout(300);
  const dbg = () => page.evaluate(() => Blocks.debug());
  const count = () => page.evaluate(() => document.querySelectorAll("#bkBoard .bk-block:not(.pop)").length);

  ck(await page.locator("#catGrid .cat").count() === 11, "the mode card leaves the category grid as it was");
  await page.locator("#blocksBtn").click();
  await page.waitForTimeout(400);
  let d = await dbg();
  ck(await page.evaluate(() => document.querySelector("#blocks").classList.contains("active")), "the mode card opens Block Blitz");
  ck(d.cats.length === 5 && new Set(d.cats).size === 5, `five distinct categories are in play (${d.cats})`);
  ck(await count() === 35, "the board starts with five full rows of seven");
  ck(d.rows >= 8 && d.rows <= 11, `the board height is within 8-11 rows (${d.rows})`);

  // Pick a group and check it is exactly the connected same-category region.
  await page.locator("#bkBoard .bk-block").first().click();
  await page.waitForTimeout(400);
  d = await dbg();
  const expected = await page.evaluate(() => {
    const g = Blocks.debug().grid, cat = g[0][0], seen = new Set(), st = [[0, 0]];
    while (st.length) {
      const [c, r] = st.pop(), k = c + "," + r;
      if (c < 0 || r < 0 || c >= g.length || r >= g[0].length || seen.has(k) || g[c][r] !== cat) continue;
      seen.add(k); st.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
    }
    return seen.size;
  });
  ck(d.open && d.picked === expected, `tapping picks the whole connected group (${d.picked} of ${expected})`);
  ck(await page.locator("#bkSheet").evaluate((e) => e.classList.contains("open")), "a question opens for the group");
  const badge = await page.locator("#bkBadge").innerText();
  const pickedCat = d.grid[0][0];
  ck(badge.trim() === await page.evaluate((c) => CATEGORIES[c].name, pickedCat),
     "the question comes from the picked blocks' category");

  // Right answer: exactly the group disappears and scores size² × 10.
  const n = d.picked;
  await page.keyboard.press(String(d.correctIndex + 1));
  await page.waitForTimeout(1900);
  d = await dbg();
  ck(await count() === 35 - n, `a right answer blasts exactly the group (${35 - n} left)`);
  ck(d.score === n * n * 10, `the blast scores size² × 10 (${d.score})`);
  ck(d.streak === 1, "the streak counts the right answer");
  const heights = d.grid.map((col) => col.findIndex((x) => x === null));
  ck(d.grid.every((col) => { const i = col.indexOf(null); return i === -1 || col.slice(i).every((x) => x === null); }),
     `blocks fall to fill the gaps (column heights ${heights})`);

  // Wrong answer: a new row rises.
  const before = await count();
  await page.locator("#bkBoard .bk-block").nth(1).click();
  await page.waitForTimeout(400);
  d = await dbg();
  await page.locator(`#bkAnswers .ans[data-idx="${(d.correctIndex + 1) % 4}"]`).click();
  await page.waitForTimeout(2400);
  d = await dbg();
  ck(await count() === before + 7, `a wrong answer raises a row (${before} -> ${await count()})`);
  ck(d.streak === 0, "a wrong answer breaks the streak");

  // Keep answering wrong: the stack reaches the top and the game ends.
  for (let i = 0; i < 12 && !(await dbg()).over; i++) {
    await page.locator("#bkBoard .bk-block:not(.pop)").first().click();
    await page.waitForTimeout(350);
    d = await dbg();
    if (!d.open) { await page.waitForTimeout(400); continue; }
    await page.locator(`#bkAnswers .ans[data-idx="${(d.correctIndex + 1) % 4}"]`).click();
    await page.waitForTimeout(2300);
  }
  ck((await dbg()).over, "a full column ends the game");
  ck(await page.locator("#bkOver").evaluate((e) => e.classList.contains("show")), "the game-over card shows");
  await page.waitForTimeout(1000);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("brainblitz.save") || "{}"));
  ck(saved.best && saved.best.blocks === n * n * 10, "the best Block Blitz score is saved with the progress");

  await page.locator("#bkAgain").click();
  await page.waitForTimeout(400);
  ck(!(await dbg()).over && await count() === 35, "Play Again starts a fresh board");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ck(await page.evaluate(() => document.querySelector("#home").classList.contains("active")), "Escape returns home");
  ck(await page.evaluate(() => Music.getMode()) === "home", "the music drops back to the light mix at home");

  // Regressions: a delayed step from a game that has ended must not touch the next one.
  await page.locator("#blocksBtn").click();
  await page.waitForTimeout(400);
  await page.locator("#bkBoard .bk-block").first().click();
  await page.waitForTimeout(300);
  d = await dbg();
  await page.keyboard.press(String(d.correctIndex + 1));   // the blast is now pending...
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");                       // ...and the player quits
  await page.waitForTimeout(1500);
  ck(true, "quitting while a blast is pending throws nothing (page errors fail the suite)");

  await page.locator("#blocksBtn").click();
  await page.waitForTimeout(400);
  await page.locator("#bkBoard .bk-block").first().click();
  await page.waitForTimeout(300);
  d = await dbg();
  await page.locator(`#bkAnswers .ans[data-idx="${(d.correctIndex + 1) % 4}"]`).click();   // a penalty row is pending...
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  await page.locator("#blocksBtn").click();                  // ...and a new game starts at once
  await page.waitForTimeout(2500);
  ck(await count() === 35, `the old game's penalty row does not land on the new board (${await count()} blocks)`);

  await browser.close();
  suite.report();
})();
