const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("round-length");
const ck = (condition, message) => suite.check(condition, message);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:390,height:844} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(GAME_URL);
  await p.waitForTimeout(300);

  // ---- picker renders, defaults to 10 ----
  ck(await p.locator('.len').count() === 4, 'four length options shown');
  ck((await p.locator('.len.on').innerText()) === '10', 'defaults to 10 questions');
  ck((await p.locator('#playHint').innerText()).startsWith('10 questions'), 'hint reflects default length');

  // ---- choosing a length updates the hint ----
  await p.locator('.len[data-len="20"]').click();
  await p.waitForTimeout(150);
  ck((await p.locator('.len.on').innerText()) === '20', 'selection moves to 20');
  ck(await p.locator('.len[data-len="20"]').getAttribute('aria-pressed') === 'true', 'aria-pressed set');
  ck(await p.locator('.len[data-len="10"]').getAttribute('aria-pressed') === 'false', 'old option unpressed');
  ck((await p.locator('#playHint').innerText()).startsWith('20 questions'), 'hint updates to 20');

  // ---- a 20-question mixed round really has 20 ----
  await p.locator('#playBtn').click();
  await p.waitForTimeout(300);
  let r = await p.evaluate(() => ({ len: state.round.length, size: state.roundSize,
                                    cats: state.round.map(q=>q.category),
                                    texts: state.round.map(q=>q.text) }));
  ck(r.len === 20, 'mixed round holds 20 questions (got ' + r.len + ')');
  ck(new Set(r.texts).size === 20, 'no repeats inside the round');
  ck((await p.locator('#qNum').innerText()) === '1/20', 'counter shows 1/20');
  const per = {}; r.cats.forEach(c => per[c] = (per[c]||0)+1);
  ck(Object.keys(per).length === 10, 'all 10 categories represented');
  ck(Object.values(per).every(n => n === 2), 'exactly 2 per category: ' + JSON.stringify(per));

  // ---- progress bar scales to the new length ----
  const ci = await p.evaluate(() => state.round[state.index].correctIndex);
  await p.locator(`.ans[data-idx="${ci}"]`).click();
  await p.waitForTimeout(200);
  ck((await p.locator('#progFill').evaluate(e=>e.style.width)) === '5%', 'progress is 1/20 = 5%');

  // ---- play a full 5-question round end to end ----
  await p.locator('#quitBtn').click(); await p.waitForTimeout(200);
  await p.locator('.len[data-len="5"]').click();
  await p.locator('#playBtn').click(); await p.waitForTimeout(250);
  r = await p.evaluate(() => ({ len: state.round.length, cats: state.round.map(q=>q.category) }));
  ck(r.len === 5, 'a 5-question round holds 5 (got ' + r.len + ')');
  ck(new Set(r.cats).size === 5, '5-question mixed round spans 5 distinct categories');
  for (let i = 0; i < 12; i++) {
    if (await p.locator('#results').isVisible()) break;
    if (await p.evaluate(() => state.locked)) await p.locator('#nextBtn').click();
    else { const k = await p.evaluate(() => state.round[state.index].correctIndex);
           await p.locator(`.ans[data-idx="${k}"]`).click(); }
    await p.waitForTimeout(150);
  }
  ck(await p.locator('#results').isVisible(), 'results reached after 5 questions');
  ck((await p.locator('#statCorrectV').innerText()).endsWith('/5'), 'results count out of 5');
  ck(await p.locator('#reviewList .rev-row').count() === 5, 'recap lists 5 rows');
  const score5 = await p.evaluate(() => state.score);

  // ---- best score is tracked per length, not shared ----
  await p.locator('#homeBtn').click(); await p.waitForTimeout(250);
  ck((await p.locator('#bestScore').innerText()) === String(score5), 'best for 5 shows the 5-round score');
  await p.locator('.len[data-len="30"]').click(); await p.waitForTimeout(150);
  ck((await p.locator('#bestScore').innerText()) === '0', 'a different length starts with its own best of 0');
  await p.locator('.len[data-len="5"]').click(); await p.waitForTimeout(150);
  ck((await p.locator('#bestScore').innerText()) === String(score5), 'switching back restores that length\'s best');

  // ---- a 30-question category round uses the whole pool, no repeats ----
  await p.locator('.len[data-len="30"]').click();
  await p.locator('.cat[data-cat="animals"]').click();
  ck((await p.locator('#playHint').innerText()).startsWith('30 questions'), 'hint follows category + length');
  await p.locator('#playBtn').click(); await p.waitForTimeout(300);
  r = await p.evaluate(() => ({ len: state.round.length, texts: state.round.map(q=>q.text),
                                cats: state.round.map(q=>q.category) }));
  ck(r.len === 30, 'a 30-question category round holds 30 (got ' + r.len + ')');
  ck(new Set(r.texts).size === 30, 'all 30 are distinct');
  ck(r.cats.every(c => c === 'animals'), 'all 30 come from the chosen category');

  // ---- the chosen length survives a reload ----
  await p.locator('#quitBtn').click(); await p.waitForTimeout(200);
  await p.locator('.len[data-len="20"]').click(); await p.waitForTimeout(150);
  await p.reload(); await p.waitForTimeout(400);
  ck((await p.locator('.len.on').innerText()) === '20', 'length choice is remembered after reload');
  ck((await p.locator('#playHint').innerText()).startsWith('20 questions'), 'hint restored after reload');

  // ---- rotation still applies at other lengths ----
  const rot = await p.evaluate(() => {
    localStorage.removeItem('brainblitz.seen');
    const a = buildRound('sports', 20).map(q=>q.text);
    const b = buildRound('sports', 20).map(q=>q.text);
    return { a, b, overlap: b.filter(q => a.includes(q)).length };
  });
  ck(rot.a.length === 20 && rot.b.length === 20, 'two 20-question sports rounds built');
  ck(rot.overlap === 10, 'after 20 of 30 are used, the next 20 reuses exactly 10 (got ' + rot.overlap + ')');

  // ---- a legacy best score is inherited by the 10-question length ----
  const legacy = await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('brainblitz.best', '1234');
    return { ten: loadBest(10), five: loadBest(5) };
  });
  ck(legacy.ten === 1234, 'old saved best carries over to the 10-question length');
  ck(legacy.five === 0, 'other lengths are unaffected by the legacy value');

  errs.forEach((e) => suite.check(false, e));
  await b.close();
  suite.report();
})();
