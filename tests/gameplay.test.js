const { chromium, GAME_URL, createSuite , isSdkFetch } = require("./harness");
const suite = createSuite("gameplay");
const ck = (condition, message) => suite.check(condition, message);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !isSdkFetch(m)) errors.push('console: ' + m.text()); });

  await page.goto(GAME_URL);
  await page.waitForTimeout(400);

  // ---- HOME ----
  ck(await page.locator('#home').isVisible(), 'home screen visible');
  ck((await page.locator('.logo').innerText()).replace(/\s/g,'') === 'BRAINBLITZ', 'logo text');
  ck(await page.locator('#catGrid .cat').count() === 11, 'category grid has mixed + 10 categories');
  ck((await page.locator('#bestScore').innerText()) === '0', 'best score starts at 0');

  // category select
  await page.locator('.cat[data-cat="space"]').click();
  ck(await page.locator('.cat[data-cat="space"]').evaluate(e=>e.classList.contains('selected')), 'category select highlights');
  ck((await page.locator('#playCat').innerText()) === 'Space', 'play button reflects category');
  await page.locator('.cat[data-cat="mixed"]').click();

  // mute toggle
  await page.locator('#muteBtn').click();
  ck((await page.locator('#muteBtn').innerText()) === '🔇', 'mute button toggles to muted');
  await page.locator('#muteBtn').click();
  ck((await page.locator('#muteBtn').innerText()) === '🔊', 'mute button toggles back');

  // ---- START GAME ----
  await page.locator('#playBtn').click();
  await page.waitForTimeout(300);
  ck(await page.locator('#quiz').isVisible(), 'quiz screen shown after play');
  ck((await page.locator('#qNum').innerText()) === '1/10', 'question counter 1/10');
  ck(await page.locator('.ans').count() === 4, 'four answer buttons');
  const cats1 = await page.evaluate(() => state.round.map(q => q.category));
  ck(new Set(cats1).size === 10, 'mixed round spans all 10 categories');

  // ---- ANSWER CORRECTLY, FAST ----
  let ci = await page.evaluate(() => state.round[state.index].correctIndex);
  await page.locator(`.ans[data-idx="${ci}"]`).click();
  await page.waitForTimeout(250);
  let sc = await page.evaluate(() => state.score);
  ck(sc > 100 && sc <= 150, 'correct fast answer scores 100 + speed bonus (got ' + sc + ')');
  ck(await page.locator('#feedback').evaluate(e=>e.classList.contains('good')), 'green feedback for correct');
  ck((await page.locator('#fbExp').innerText()).length > 20, 'explanation shown');
  ck(await page.locator(`.ans[data-idx="${ci}"]`).evaluate(e=>e.classList.contains('correct')), 'correct answer highlighted');
  ck((await page.locator('#streakVal').innerText()) === '🔥 1', 'streak = 1');
  ck(await page.locator('#nextBtn').evaluate(e=>e.classList.contains('show')), 'next button appears');

  // ---- DOUBLE-ANSWER GUARD ----
  const before = await page.evaluate(() => state.score);
  const wrongIdx = (ci + 1) % 4;
  await page.locator(`.ans[data-idx="${wrongIdx}"]`).click({ force: true });
  await page.locator(`.ans[data-idx="${ci}"]`).click({ force: true });
  await page.waitForTimeout(150);
  ck(await page.evaluate(() => state.score) === before, 'answering twice does not change score');
  ck(await page.evaluate(() => state.results.length) === 1, 'only one result recorded per question');

  // ---- TIMER STOPS ON ANSWER ----
  const t1 = await page.evaluate(() => state.timeLeft);
  await page.waitForTimeout(900);
  ck(await page.evaluate(() => state.timeLeft) === t1, 'timer frozen after answering');

  // ---- NEXT QUESTION ----
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(250);
  ck((await page.locator('#qNum').innerText()) === '2/10', 'advanced to question 2');
  ck(await page.evaluate(() => state.timeLeft) > 14, 'timer reset for new question');
  ck(!(await page.locator('#nextBtn').evaluate(e=>e.classList.contains('show'))), 'next button hidden again');
  ck(await page.locator('.ans.locked').count() === 0, 'answers unlocked on new question');

  // ---- WRONG ANSWER ----
  ci = await page.evaluate(() => state.round[state.index].correctIndex);
  const bad = (ci + 2) % 4;
  const scoreBefore = await page.evaluate(() => state.score);
  await page.locator(`.ans[data-idx="${bad}"]`).click();
  await page.waitForTimeout(200);
  ck(await page.evaluate(() => state.score) === scoreBefore, 'wrong answer scores nothing');
  ck(await page.locator('#feedback').evaluate(e=>e.classList.contains('bad')), 'red feedback for wrong');
  ck(await page.locator(`.ans[data-idx="${bad}"]`).evaluate(e=>e.classList.contains('wrong')), 'chosen wrong answer marked');
  ck(await page.locator(`.ans[data-idx="${ci}"]`).evaluate(e=>e.classList.contains('correct')), 'correct answer still revealed');
  ck((await page.locator('#streakVal').innerText()) === '🔥 0', 'streak reset after wrong answer');

  // ---- TIMEOUT PATH (fast-forward the clock) ----
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(200);
  await page.evaluate(() => { state.endsAt = performance.now() + 60; });
  await page.waitForTimeout(500);
  ck(await page.evaluate(() => state.locked), 'question locks on timeout');
  ck((await page.locator('#fbTitle').innerText()).includes("Time's up"), 'timeout feedback shown');
  ck((await page.locator('#timerNum').innerText()) === '0', 'timer reads 0');
  ck(await page.locator('.ans.correct').count() === 1, 'correct answer revealed on timeout');
  ck(await page.evaluate(() => state.results.length) === 3, '3 results after 3 questions');

  // ---- KEYBOARD INPUT ----
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(200);
  ci = await page.evaluate(() => state.round[state.index].correctIndex);
  await page.keyboard.press(String(ci + 1));
  await page.waitForTimeout(200);
  ck(await page.evaluate(() => state.locked), 'number key answers the question');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  ck((await page.locator('#qNum').innerText()) === '5/10', 'Enter advances to next question');

  // ---- STREAK BONUS ----
  await page.evaluate(() => { state.streak = 4; });
  ci = await page.evaluate(() => state.round[state.index].correctIndex);
  const s0 = await page.evaluate(() => state.score);
  await page.locator(`.ans[data-idx="${ci}"]`).click();
  await page.waitForTimeout(200);
  const gained = await page.evaluate(() => state.score) - s0;
  ck(gained >= 150, 'streak bonus applied (gained ' + gained + ')');
  ck((await page.locator('#fbExp').innerText()).includes('streak'), 'feedback itemises streak bonus');
  ck(await page.locator('#streakBox').evaluate(e=>e.classList.contains('hot')), 'streak box glows when hot');

  // ---- PLAY OUT THE ROUND ----
  for (let i = 0; i < 20; i++) {
    const done = await page.locator('#results').isVisible();
    if (done) break;
    if (await page.evaluate(() => state.locked)) {
      await page.locator('#nextBtn').click();
    } else {
      const k = await page.evaluate(() => state.round[state.index].correctIndex);
      await page.locator(`.ans[data-idx="${k}"]`).click();
    }
    await page.waitForTimeout(160);
  }

  // ---- RESULTS ----
  ck(await page.locator('#results').isVisible(), 'results screen reached after 10 questions');
  const st = await page.evaluate(() => ({ score: state.score, correct: state.correctCount, best: state.bestStreak, res: state.results.length }));
  ck(st.res === 10, 'exactly 10 results recorded (got ' + st.res + ')');
  ck((await page.locator('#statCorrectV').innerText()) === st.correct + '/10', 'correct count stat matches');
  const acc = await page.locator('#statAccV').innerText();
  ck(acc === Math.round(st.correct / 10 * 100) + '%', 'accuracy stat matches (' + acc + ')');
  ck((await page.locator('#statStreakV').innerText()) === String(st.best), 'best streak stat matches');
  ck((await page.locator('#resScore').innerText()) === String(st.score), 'final score displayed');
  ck(await page.locator('#reviewList .rev-row').count() === 10, 'recap lists 10 rows');
  ck(await page.locator('#resNewBest').evaluate(e=>e.classList.contains('show')), 'new best badge shown on first run');
  ck((await page.locator('#resMsg').innerText()).length > 10, 'performance message shown');

  // ---- BEST SCORE PERSISTS ----
  await page.locator('#homeBtn').click();
  await page.waitForTimeout(200);
  ck(await page.locator('#home').isVisible(), 'home button returns to home');
  ck((await page.locator('#bestScore').innerText()) === String(st.score), 'best score saved to home screen');

  // ---- REPLAY RESETS CLEANLY ----
  await page.locator('#playBtn').click();
  await page.waitForTimeout(250);
  const fresh = await page.evaluate(() => ({ s: state.score, i: state.index, c: state.correctCount, st: state.streak, r: state.results.length, bs: state.bestStreak, locked: state.locked }));
  ck(JSON.stringify(fresh) === JSON.stringify({ s:0, i:0, c:0, st:0, r:0, bs:0, locked:false }), 'restart resets all state: ' + JSON.stringify(fresh));
  ck((await page.locator('#scoreVal').innerText()) === '0', 'score display reset');
  ck((await page.locator('#progFill').evaluate(e => e.style.width)) === '0%', 'progress bar reset');

  // ---- QUIT MID-GAME, THEN PLAY AGAIN FROM RESULTS ----
  await page.locator('#quitBtn').click();
  await page.waitForTimeout(200);
  ck(await page.locator('#home').isVisible(), 'quit button returns home mid-game');
  ck(await page.evaluate(() => state.rafId === null), 'timer cancelled on quit');

  // category-specific round
  await page.locator('.cat[data-cat="animals"]').click();
  await page.locator('#playBtn').click();
  await page.waitForTimeout(250);
  const catsOnly = await page.evaluate(() => state.round.map(q => q.category));
  ck(catsOnly.every(c => c === 'animals') && catsOnly.length === 10, 'category round draws only that category');
  const qtexts = await page.evaluate(() => state.round.map(q => q.text));
  ck(new Set(qtexts).size === 10, 'no repeated questions inside a round');

  // answer shuffling actually happens across rounds
  const posSpread = await page.evaluate(() => {
    const seen = new Set();
    for (let i = 0; i < 40; i++) seen.add(buildRound('animals')[0].correctIndex);
    return seen.size;
  });
  ck(posSpread >= 3, 'correct answer position is randomised (' + posSpread + ' distinct positions)');

  // ---- PROGRESS BAR ----
  ck((await page.locator('#progFill').evaluate(e => e.style.width)) === '0%', 'progress 0% at question 1');
  ci = await page.evaluate(() => state.round[state.index].correctIndex);
  await page.locator(`.ans[data-idx="${ci}"]`).click();
  await page.locator('#nextBtn').click();
  await page.waitForTimeout(200);
  ck((await page.locator('#progFill').evaluate(e => e.style.width)) === '10%', 'progress 10% at question 2');

  // ---- LANDSCAPE / DESKTOP LAYOUT ----
  await page.setViewportSize({ width: 800, height: 420 });
  await page.waitForTimeout(250);
  const cols = await page.locator('#answers').evaluate(e => getComputedStyle(e).gridTemplateColumns.split(' ').length);
  ck(cols === 2, 'landscape uses a two-column answer grid');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ck(!overflow, 'no horizontal overflow in landscape');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(200);
  ck(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'no horizontal overflow on desktop');

  // tap targets
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(250);
  const minH = await page.locator('.ans').first().evaluate(e => e.getBoundingClientRect().height);
  ck(minH >= 44, 'answer buttons are at least 44px tall (' + Math.round(minH) + 'px)');

  errors.forEach((e) => suite.check(false, e));
  await browser.close();
  suite.report();
})();
