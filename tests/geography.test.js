const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("geography");
const ck = (condition, message) => suite.check(condition, message);
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage(); await p.setViewportSize({width:390,height:844});
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(GAME_URL); await p.waitForTimeout(300);

  // ---- capital-question density ----
  const geo = await p.evaluate(() => QUESTIONS.filter(q => q.c === 'geo').map(q => q.q));
  const caps = geo.filter(q => /capital/i.test(q));
  ck(geo.length === 30, 'geography still holds 30 questions');
  ck(caps.length === 2, 'only 2 capital questions remain (was 10): ' + caps.length);

  // ---- a full 30-question geography round: at most 2 capitals, wide topic spread ----
  const round = await p.evaluate(() => {
    progress.seen = [];
    return buildRound('geo', 30).map(q => q.text);
  });
  ck(round.length === 30, 'a 30-question geography round builds');
  ck(round.filter(q => /capital/i.test(q)).length === 2, 'a full round contains at most 2 capital questions');

  // ---- no two questions share an answer (a proxy for near-duplicate topics) ----
  const answers = await p.evaluate(() => {
    const seen = {}, clash = [];
    QUESTIONS.filter(q => q.c === 'geo').forEach(q => {
      const correct = q.a[0];
      if (seen[correct]) clash.push(correct + ' — "' + seen[correct] + '" / "' + q.q + '"');
      seen[correct] = q.q;
    });
    return clash;
  });
  ck(answers.length === 0, 'no two geography questions share a correct answer: ' +
     (answers.length ? answers.join(' | ') : 'none'));

  // ---- 10-question rounds should rarely be capital-heavy ----
  const sample = await p.evaluate(() => {
    progress.seen = [];
    const counts = [];
    for (let i = 0; i < 30; i++) {
      progress.seen = [];
      counts.push(buildRound('geo', 10).filter(q => /capital/i.test(q.text)).length);
    }
    return counts;
  });
  const avg = sample.reduce((a,b)=>a+b,0) / sample.length;
  ck(avg <= 1, 'average capitals per 10-question round is at most 1 (got ' + avg.toFixed(2) + ')');
  ck(Math.max(...sample) <= 2, 'never more than 2 capitals in a round (max ' + Math.max(...sample) + ')');

  // ---- the new questions are actually playable end to end ----
  const played = await p.evaluate(async () => {
    progress.seen = [];
    state.category = 'geo'; state.roundSize = 30;
    Game.start();
    const texts = state.round.map(q => q.text);
    const ok = state.round.every(q => q.options.length === 4 &&
                                      q.correctIndex >= 0 && q.correctIndex < 4 &&
                                      q.explanation && q.explanation.length > 10);
    Game.quitToHome();
    return { ok, n: texts.length };
  });
  ck(played.ok && played.n === 30, 'every question in a geography round is well formed');

  // ---- removed questions leave no orphan ids in saved progress ----
  const prune = await p.evaluate(() => {
    progress.seen = ['deadbeef', 'notreal', QUESTIONS[0].id];
    const seen = loadSeen();
    return { size: seen.size, keptReal: seen.has(QUESTIONS[0].id),
             droppedFake: !seen.has('deadbeef') && !seen.has('notreal') };
  });
  ck(prune.droppedFake, 'ids of removed questions are dropped on load');
  ck(prune.keptReal && prune.size === 1, 'ids of questions still in the bank are kept');

  // ---- a saved history from before the swap still works ----
  const legacy = await p.evaluate(() => {
    // pretend the player had seen all ten old capital questions (now gone)
    progress.seen = ['aaa','bbb','ccc','ddd','eee','fff','ggg','hhh','iii','jjj'];
    const r = buildRound('geo', 10);
    return { n: r.length, distinct: new Set(r.map(q=>q.text)).size };
  });
  ck(legacy.n === 10 && legacy.distinct === 10,
     'an old saved history from before the swap still builds a clean round');

  errs.forEach((e) => suite.check(false, e));
  await b.close();
  suite.report();
})();
