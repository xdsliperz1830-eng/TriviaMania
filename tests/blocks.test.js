/**
 * Block Blitz (draft mode): tapping picks a whole same-category group, a
 * right answer blasts exactly that group and scores size² × 10, a wrong one
 * raises a row, a full column ends the game, and quitting returns home.
 */
const { chromium, GAME_URL, createSuite } = require("./harness");

/** Open Block Blitz the way a player does: the Blocks tab, then Play. */
async function startBlocks(page) {
  await page.locator("#tabBlocks").click();
  await page.locator("#playBtn").click();
}
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

  ck(await page.locator("#catGrid .cat").count() === 11, "the Blocks tab leaves the category grid as it was");
  await startBlocks(page);
  await page.waitForTimeout(400);
  let d = await dbg();
  ck(await page.evaluate(() => document.querySelector("#blocks").classList.contains("active")), "the Blocks tab and Play open Block Blitz");
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
  await startBlocks(page);
  await page.waitForTimeout(400);
  await page.locator("#bkBoard .bk-block").first().click();
  await page.waitForTimeout(300);
  d = await dbg();
  await page.keyboard.press(String(d.correctIndex + 1));   // the blast is now pending...
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");                       // ...and the player quits
  await page.waitForTimeout(1500);
  ck(true, "quitting while a blast is pending throws nothing (page errors fail the suite)");

  await startBlocks(page);
  await page.waitForTimeout(400);
  await page.locator("#bkBoard .bk-block").first().click();
  await page.waitForTimeout(300);
  d = await dbg();
  await page.locator(`#bkAnswers .ans[data-idx="${(d.correctIndex + 1) % 4}"]`).click();   // a penalty row is pending...
  await page.waitForTimeout(100);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  await startBlocks(page);                  // ...and a new game starts at once
  await page.waitForTimeout(2500);
  ck(await count() === 35, `the old game's penalty row does not land on the new board (${await count()} blocks)`);

  /* ---------------- power-ups ---------------- */
  await page.keyboard.press("Escape");   // leave the game the regression check started
  await page.waitForTimeout(300);
  await startBlocks(page);
  await page.waitForTimeout(400);
  ck(await page.locator("#bkBomb").isDisabled(), "the bomb button starts disabled with no bombs");

  // Bomb: arm it, tap a bottom-row block, and exactly that row goes.
  await page.evaluate(() => Blocks.testSetup({ bombs: 1 }));
  await page.locator("#bkBomb").click();
  ck((await dbg()).arming, "tapping the bomb button arms it");
  const before2 = await count();
  const rowSize = (await dbg()).grid.filter((col) => col[0]).length;
  await page.locator("#bkBoard .bk-block").first().click();   // a bottom-row block
  await page.waitForTimeout(1000);
  d = await dbg();
  ck(await count() === before2 - rowSize, `the bomb blasts the whole row (${before2} -> ${await count()})`);
  ck(d.score === rowSize * 20 && d.bombs === 0 && !d.arming, `the bomb scores 20 a block and is spent (${d.score})`);
  ck(!d.open, "a bomb asks no question");

  // Lucky Block: every block of one category on the board, plus the lucky one.
  await page.evaluate(() => Blocks.testSetup({ luckyAt: [3, 0] }));
  const lucky = page.locator("#bkBoard .bk-block.lucky");
  ck(await lucky.count() === 1, "a Lucky Block can sit on the board");
  await lucky.click();
  await page.waitForTimeout(400);
  d = await dbg();
  const ofCat = d.grid.flat().filter((x) => x === d.pickedCat).length;
  ck(d.lucky && d.picked === ofCat + 1, `the Lucky Block picks every ${d.pickedCat} block (${d.picked} = ${ofCat} + 1)`);
  const luckyCat = d.pickedCat;
  await page.keyboard.press(String(d.correctIndex + 1));
  await page.waitForTimeout(1900);
  d = await dbg();
  ck(!d.grid.flat().includes(luckyCat),
     `a right answer blasts every ${luckyCat} block on the board`);
  ck(!d.grid.flat().includes("lucky"), "the Lucky Block goes with them");
  await page.evaluate(() => Blocks.testSetup({ sinceRise: Blocks.debug().riseEvery - 1 }));
  ck((await page.locator("#bkRiseLab").innerText()).toLowerCase().includes("row coming next"),
     "the player is warned one answer before a row rises");
  ck(await page.locator("#bkBoard").evaluate((e) => e.classList.contains("rise-soon")), "the board edge glows before a rise");

  /* ---------------- keyboard ---------------- */
  await page.evaluate(() => Blocks.testSetup({ sinceRise: 0 }));
  await page.keyboard.press("ArrowUp");
  ck(await page.evaluate(() => document.activeElement.classList.contains("bk-block")), "arrow keys move focus onto the blocks");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  ck((await dbg()).open, "Enter on a focused block picks its group and opens a question");
  d = await dbg();
  await page.keyboard.press(String(d.correctIndex + 1));
  await page.waitForTimeout(1900);
  await page.keyboard.press("ArrowLeft");
  ck(await page.evaluate(() => document.activeElement.classList.contains("bk-block")),
     "after a turn, the arrow keys pick up again on the board");

  /* ---------------- landscape ---------------- */
  const land = suite.watch(await browser.newPage());
  await land.setViewportSize({ width: 844, height: 390 });
  await land.goto(GAME_URL);
  await land.waitForTimeout(300);
  await startBlocks(land);
  await land.waitForTimeout(400);
  await land.locator("#bkBoard .bk-block").first().click();
  await land.waitForTimeout(500);
  const lay = await land.evaluate(() => {
    const b = document.querySelector("#bkBoard").getBoundingClientRect();
    const sh = document.querySelector("#bkSheet .bk-sheet-card").getBoundingClientRect();
    return { overlap: !(b.right <= sh.left || sh.right <= b.left || b.bottom <= sh.top || sh.bottom <= b.top),
             onScreen: sh.bottom <= innerHeight + 1 && sh.right <= innerWidth + 1 && b.bottom <= innerHeight + 1 };
  });
  ck(!lay.overlap && lay.onScreen, `in landscape the question sits beside the board (${JSON.stringify(lay)})`);

  await browser.close();
  suite.report();
})();
