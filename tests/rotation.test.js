const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("rotation");
const ck = (condition, message) => suite.check(condition, message);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport:{width:390,height:844} });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(GAME_URL);
  await p.waitForTimeout(300);

  // ---- no id collisions across the whole bank ----
  const ids = await p.evaluate(() => {
    const set = new Set(QUESTIONS.map(q => q.id));
    const perCat = {};
    QUESTIONS.forEach(q => perCat[q.c] = (perCat[q.c] || 0) + 1);
    return { total: QUESTIONS.length, unique: set.size, sizes: Object.values(perCat) };
  });
  // Derived from the bank rather than hardcoded, so growing it is not a failure.
  ck(ids.total >= 300, 'bank holds at least 300 questions (' + ids.total + ')');
  ck(ids.unique === ids.total, 'every question id is unique (no hash collisions): ' + ids.unique);
  ck(new Set(ids.sizes).size === 1, 'every category holds the same number (' + ids.sizes[0] + ')');
  const PER_CAT = ids.sizes[0];
  const ROUNDS_TO_EXHAUST = PER_CAT / 10;

  // ---- three consecutive category rounds are fully distinct ----
  const rounds = await p.evaluate(() => {
    progress.seen = [];
    return [buildRound('animals'), buildRound('animals'), buildRound('animals')]
      .map(r => r.map(q => q.text));
  });
  rounds.forEach((r, i) => ck(new Set(r).size === 10, `round ${i+1} has 10 distinct questions`));
  const first = new Set(rounds[0]), second = new Set(rounds[1]), third = new Set(rounds[2]);
  const overlap12 = rounds[1].filter(q => first.has(q));
  const overlap13 = rounds[2].filter(q => first.has(q));
  const overlap23 = rounds[2].filter(q => second.has(q));
  ck(overlap12.length === 0, 'round 2 repeats nothing from round 1 (overlap ' + overlap12.length + ')');
  ck(overlap13.length === 0, 'round 3 repeats nothing from round 1 (overlap ' + overlap13.length + ')');
  ck(overlap23.length === 0, 'round 3 repeats nothing from round 2 (overlap ' + overlap23.length + ')');
  ck(new Set([...first, ...second, ...third]).size === 30, 'three rounds give 30 distinct questions');

  // ---- all questions stay in-category ----
  const cats = await p.evaluate(() => buildRound('space').map(q => q.category));
  ck(cats.every(c => c === 'space'), 'category rounds only draw from that category');

  // ---- 4th round recycles, and does so without repeating within the round ----
  // Play the category dry, then check the cycle restarts correctly.
  const exhaust = await p.evaluate((n) => {
    progress.seen = [];
    const seenTexts = [];
    for (let i = 0; i < n; i++) seenTexts.push(buildRound('animals').map(q => q.text));
    const all = new Set(seenTexts.flat());
    const next = buildRound('animals').map(q => q.text);
    const after = buildRound('animals').map(q => q.text);
    return { cycle: all.size, rounds: n, next, after,
             recycled: next.every(t => all.has(t)),
             overlap: after.filter(t => next.includes(t)).length };
  }, ROUNDS_TO_EXHAUST);
  ck(exhaust.cycle === PER_CAT,
     `${exhaust.rounds} rounds cover the whole ${PER_CAT}-question category (${exhaust.cycle})`);
  ck(new Set(exhaust.next).size === 10, 'the round after exhaustion still has 10 distinct questions');
  ck(exhaust.recycled, 'the round after exhaustion recycles earlier questions');
  ck(exhaust.overlap === 0,
     'the round after that avoids everything just recycled (overlap ' + exhaust.overlap + ')');

  // ---- progress survives a page reload ----
  const beforeReload = await p.evaluate(() => {
    progress.seen = [];
    return buildRound('tech').map(q => q.text);
  });
  await p.reload(); await p.waitForTimeout(300);
  const afterReload = await p.evaluate(() => buildRound('tech').map(q => q.text));
  const overlapReload = afterReload.filter(q => beforeReload.includes(q));
  ck(overlapReload.length === 0, 'seen history survives a reload (overlap ' + overlapReload.length + ')');

  // ---- mixed mode still spans all ten categories and prefers fresh ----
  const mixed = await p.evaluate(() => {
    progress.seen = [];
    const a = buildRound('mixed'), b = buildRound('mixed');
    return { catsA: a.map(q=>q.category), catsB: b.map(q=>q.category),
             textA: a.map(q=>q.text), textB: b.map(q=>q.text) };
  });
  ck(new Set(mixed.catsA).size === 10, 'mixed round spans all 10 categories');
  ck(new Set(mixed.catsB).size === 10, 'second mixed round also spans all 10');
  const mixOverlap = mixed.textB.filter(q => mixed.textA.includes(q));
  ck(mixOverlap.length === 0, 'second mixed round is entirely fresh (overlap ' + mixOverlap.length + ')');

  // ---- category play and mixed play share one history ----
  const shared = await p.evaluate(() => {
    progress.seen = [];
    const cat = buildRound('food').map(q => q.text);
    const mix = buildRound('mixed').filter(q => q.category === 'food').map(q => q.text);
    return { cat, mix };
  });
  ck(shared.mix.every(q => !shared.cat.includes(q)),
     'a mixed round avoids food questions just seen in a food round');

  // ---- 30 rounds straight: never a repeat inside a round, full coverage per cycle ----
  const longRun = await p.evaluate((n) => {
    progress.seen = [];
    const sizes = [], cycle1 = new Set(), cycle2 = new Set();
    for (let i = 0; i < n * 2; i++) {
      const r = buildRound('history').map(q => q.text);
      sizes.push(new Set(r).size);
      r.forEach(q => (i < n ? cycle1 : cycle2).add(q));
    }
    return { allTen: sizes.every(s => s === 10), cycle1: cycle1.size, cycle2: cycle2.size };
  }, ROUNDS_TO_EXHAUST);
  ck(longRun.allTen, `every one of ${ROUNDS_TO_EXHAUST * 2} consecutive rounds has 10 distinct questions`);
  ck(longRun.cycle1 === PER_CAT, `first full cycle covers all ${PER_CAT} history questions`);
  ck(longRun.cycle2 === PER_CAT, `second full cycle also covers all ${PER_CAT} (${longRun.cycle2})`);

  // ---- the home screen reports fresh counts ----
  await p.evaluate(() => { progress.seen = []; });
  await p.reload(); await p.waitForTimeout(300);
  const fresh0 = await p.locator('.cat[data-cat="animals"] .ct').innerText();
  ck(fresh0 === PER_CAT + ' questions', `category card starts at "${PER_CAT} questions" (${fresh0})`);
  await p.evaluate(() => buildRound('animals'));
  await p.evaluate(() => UI.refreshHome());
  const fresh1 = await p.locator('.cat[data-cat="animals"] .ct').innerText();
  ck(fresh1 === (PER_CAT - 10) + ' new of ' + PER_CAT,
     `card counts down after a round (${fresh1})`);
  await p.evaluate((n) => { for (let i = 1; i < n; i++) buildRound('animals'); UI.refreshHome(); }, ROUNDS_TO_EXHAUST);
  const fresh2 = await p.locator('.cat[data-cat="animals"] .ct').innerText();
  ck(fresh2 === 'all ' + PER_CAT + ' seen', `card reports all seen once exhausted (${fresh2})`);

  // ---- storage failure must not break the game ----
  const survives = await p.evaluate(() => {
    const orig = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
    Storage.prototype.setItem = () => { throw new Error('quota'); };
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    let ok = false;
    try { ok = buildRound('science').length === 10; } catch (e) { ok = false; }
    Object.defineProperty(Storage.prototype, 'setItem', orig);
    return ok;
  });
  ck(survives, 'a round still builds when localStorage throws');

  errs.forEach((e) => suite.check(false, e));
  await b.close();
  suite.report();
})();
