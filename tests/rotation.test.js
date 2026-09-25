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
    return { total: QUESTIONS.length, unique: set.size };
  });
  ck(ids.total === 300, 'bank holds 300 questions');
  ck(ids.unique === 300, 'every question id is unique (no hash collisions): ' + ids.unique);

  // ---- three consecutive category rounds are fully distinct ----
  const rounds = await p.evaluate(() => {
    localStorage.removeItem('brainblitz.seen');
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
  ck(new Set([...first, ...second, ...third]).size === 30, 'three rounds cover the whole 30-question category');

  // ---- all questions stay in-category ----
  const cats = await p.evaluate(() => buildRound('space').map(q => q.category));
  ck(cats.every(c => c === 'space'), 'category rounds only draw from that category');

  // ---- 4th round recycles, and does so without repeating within the round ----
  const r4 = await p.evaluate(() => buildRound('animals').map(q => q.text));
  ck(new Set(r4).size === 10, 'round 4 (after exhaustion) still has 10 distinct questions');
  ck(r4.every(q => first.has(q) || second.has(q) || third.has(q)), 'round 4 recycles earlier questions');

  // ---- round 5 does not simply repeat round 4 ----
  const r5 = await p.evaluate(() => buildRound('animals').map(q => q.text));
  const overlap45 = r5.filter(q => r4.includes(q));
  ck(overlap45.length === 0, 'round 5 avoids everything from round 4 (overlap ' + overlap45.length + ')');

  // ---- progress survives a page reload ----
  const beforeReload = await p.evaluate(() => {
    localStorage.removeItem('brainblitz.seen');
    return buildRound('tech').map(q => q.text);
  });
  await p.reload(); await p.waitForTimeout(300);
  const afterReload = await p.evaluate(() => buildRound('tech').map(q => q.text));
  const overlapReload = afterReload.filter(q => beforeReload.includes(q));
  ck(overlapReload.length === 0, 'seen history survives a reload (overlap ' + overlapReload.length + ')');

  // ---- mixed mode still spans all ten categories and prefers fresh ----
  const mixed = await p.evaluate(() => {
    localStorage.removeItem('brainblitz.seen');
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
    localStorage.removeItem('brainblitz.seen');
    const cat = buildRound('food').map(q => q.text);
    const mix = buildRound('mixed').filter(q => q.category === 'food').map(q => q.text);
    return { cat, mix };
  });
  ck(shared.mix.every(q => !shared.cat.includes(q)),
     'a mixed round avoids food questions just seen in a food round');

  // ---- 30 rounds straight: never a repeat inside a round, full coverage per cycle ----
  const longRun = await p.evaluate(() => {
    localStorage.removeItem('brainblitz.seen');
    const seenPerRound = [], cycle1 = new Set(), cycle2 = new Set();
    for (let i = 0; i < 6; i++) {
      const r = buildRound('history').map(q => q.text);
      seenPerRound.push(new Set(r).size);
      (i < 3 ? cycle1 : cycle2).forEach && (i < 3 ? r.forEach(q=>cycle1.add(q)) : r.forEach(q=>cycle2.add(q)));
    }
    return { allTen: seenPerRound.every(n => n === 10), cycle1: cycle1.size, cycle2: cycle2.size };
  });
  ck(longRun.allTen, 'every one of 6 consecutive rounds has 10 distinct questions');
  ck(longRun.cycle1 === 30, 'first cycle of 3 rounds covers all 30 history questions');
  ck(longRun.cycle2 === 30, 'second cycle also covers all 30 (' + longRun.cycle2 + ')');

  // ---- the home screen reports fresh counts ----
  await p.evaluate(() => { localStorage.removeItem('brainblitz.seen'); });
  await p.reload(); await p.waitForTimeout(300);
  const fresh0 = await p.locator('.cat[data-cat="animals"] .ct').innerText();
  ck(fresh0 === '30 questions', 'category card starts at "30 questions" (' + fresh0 + ')');
  await p.evaluate(() => buildRound('animals'));
  await p.evaluate(() => UI.refreshHome());
  const fresh1 = await p.locator('.cat[data-cat="animals"] .ct').innerText();
  ck(fresh1 === '20 new of 30', 'card updates to "20 new of 30" after a round (' + fresh1 + ')');
  await p.evaluate(() => { buildRound('animals'); buildRound('animals'); UI.refreshHome(); });
  const fresh2 = await p.locator('.cat[data-cat="animals"] .ct').innerText();
  ck(fresh2 === 'all 30 seen', 'card reports all seen once exhausted (' + fresh2 + ')');

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
