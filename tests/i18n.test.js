/**
 * Languages: English is built in; Spanish, Portuguese and German load from
 * lang/<code>.js. Checks the automatic choice, the picker, that a choice is
 * remembered, that questions keep their identity across languages, a failed
 * download, and that the longer translated text still fits the screens.
 */
const { chromium, GAME_URL, createSuite, playRound } = require("./harness");
const suite = createSuite("i18n");
const ck = (condition, message) => suite.check(condition, message);

const CODES = ["es", "pt", "de"];
const SAMPLE = {
  es: { tagline: "¿Cuánto sabes de verdad?", q0: "¿Cuántos continentes hay en la Tierra?", cat: "Ciencia", correct: "¡Correcto!" },
  pt: { tagline: "Quanto você sabe de verdade?", q0: "Quantos continentes existem na Terra?", cat: "Ciência", correct: "Correto!" },
  de: { tagline: "Wie viel weißt du wirklich?", q0: "Wie viele Kontinente gibt es auf der Erde?", cat: "Wissenschaft", correct: "Richtig!" }
};

async function open(browser, opts = {}, url = GAME_URL) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 390, height: 844 }, hasTouch: true }, opts));
  const page = suite.watch(await ctx.newPage());
  await page.goto(url);
  await page.waitForTimeout(450);
  return { ctx, page };
}

const snapshot = (page) => page.evaluate(() => ({
  code: I18n.code(),
  htmlLang: document.documentElement.lang,
  badge: document.getElementById("langCode").textContent,
  tagline: document.querySelector(".tagline").textContent,
  q0: QUESTIONS[0].q,
  cat: CATEGORIES.science.name,
  play: document.getElementById("playQuizLabel").textContent
}));

(async () => {
  /* ---------------- the committed language files match their sources ---------------- */
  const check = require("child_process").spawnSync(process.execPath,
    [require("path").join(__dirname, "..", "tools", "make-lang.js"), "--check"], { encoding: "utf8" });
  ck(check.status === 0, "lang/*.js is valid and current with lang/src/ (" + check.stdout.trim().split("\n").join("; ") + ")");

  const browser = await chromium.launch();

  /* ---------------- the automatic choice ---------------- */
  {
    const { ctx, page } = await open(browser, { locale: "en-US" });
    const s = await snapshot(page);
    ck(s.code === "en" && s.htmlLang === "en" && s.badge === "EN", "an English device starts in English");
    ck(s.tagline === "How much do you really know?" && s.q0 === "How many continents are there on Earth?", "English text and questions are untouched");
    ck(await page.evaluate(() => !document.querySelector('script[src^="lang/"]')), "English downloads no language file");
    await ctx.close();
  }
  for (const [locale, code] of [["es-MX", "es"], ["pt-BR", "pt"], ["de-DE", "de"]]) {
    const { ctx, page } = await open(browser, { locale });
    const s = await snapshot(page);
    ck(s.code === code && s.badge === code.toUpperCase(), `a ${locale} device starts in ${code}`);
    ck(s.tagline === SAMPLE[code].tagline, `${code}: the home screen is translated`);
    ck(s.q0 === SAMPLE[code].q0 && s.cat === SAMPLE[code].cat, `${code}: questions and category names are translated`);
    ck(s.htmlLang.slice(0, 2) === code, `${code}: the page language is set for screen readers`);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { locale: "fr-FR" });
    ck((await snapshot(page)).code === "en", "an unsupported language falls back to English");
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { locale: "en-US" }, GAME_URL + "?lang=de");
    ck((await snapshot(page)).code === "de", "?lang=de in the address overrides the device language");
    await ctx.close();
  }

  /* ---------------- every text has a translation ---------------- */
  {
    const { ctx, page } = await open(browser, { locale: "en-US" });
    for (const code of CODES) {
      const r = await page.evaluate(async (c) => {
        await setLanguage(c);
        const empty = Array.from(document.querySelectorAll("[data-i18n]")).filter((el) => !el.textContent.trim()).length;
        const same = Object.keys(STR_EN).filter((k) => t(k) === STR_EN[k]);
        const ids = QUESTIONS.map((q) => q.id).join(",");
        const bad = QUESTIONS.filter((q) => !q.q || q.a.length !== 4 || q.a.some((a) => !a) || !q.e).length;
        return { empty, same, ids, bad };
      }, code);
      ck(r.empty === 0, `${code}: no marked element is left empty`);
      // A few texts are the same in every language by design (brand words, "+{n} pts").
      ck(r.same.length <= 8, `${code}: almost every interface text differs from English (same: ${r.same.join(", ") || "none"})`);
      ck(r.bad === 0, `${code}: all 900 questions have a question, four answers and an explanation`);
      suite["ids_" + code] = r.ids;
    }
    const enIds = await page.evaluate(async () => { await setLanguage("en"); return QUESTIONS.map((q) => q.id).join(","); });
    ck(CODES.every((c) => suite["ids_" + c] === enIds), "question ids are the same in every language, so history and the daily carry over");
    ck((await snapshot(page)).q0 === "How many continents are there on Earth?", "switching back restores the English questions");
    await ctx.close();
  }

  /* ---------------- the daily is the same questions in every language ---------------- */
  {
    const { ctx, page } = await open(browser, { locale: "en-US", timezoneId: "UTC" });
    const pick = () => page.evaluate(() => {
      const texts = buildDailyRound(dateKey()).map((r) => r.text);
      return texts.map((tx) => QUESTIONS.findIndex((q) => q.q === tx)).join(",");
    });
    const en = await pick();
    await page.evaluate(() => setLanguage("es"));
    const es = await pick();
    ck(en === es && en.split(",").length === 10 && en.indexOf("-1") === -1, "today's daily picks the same ten questions in English and Spanish");
    await ctx.close();
  }

  /* ---------------- the picker, and remembering the choice ---------------- */
  {
    const { ctx, page } = await open(browser, { locale: "en-US" });
    await page.locator("#langBtn").click();
    ck(await page.locator("#langModal").isVisible(), "the language button opens the picker");
    ck(await page.locator(".lang-opt").count() === 4, "the picker offers four languages");
    ck(await page.locator('.lang-opt[aria-pressed="true"]').textContent() === "English", "the current language is marked");
    await page.locator('.lang-opt[data-lang="es"]').click();
    await page.waitForTimeout(500);
    let s = await snapshot(page);
    ck(s.code === "es" && s.tagline === SAMPLE.es.tagline, "choosing Español switches the game to Spanish");
    ck(!(await page.locator("#langModal").isVisible()), "the picker closes after a choice");
    ck(s.play.indexOf("JUGAR") === 0, "the Play button is translated");
    ck(await page.locator("#catGrid .cat .nm").first().textContent() === "Mezcla total", "the category grid is rebuilt in Spanish");
    await page.waitForTimeout(1000);   // let the debounced save land
    await page.reload();
    await page.waitForTimeout(450);
    s = await snapshot(page);
    ck(s.code === "es", "the choice is remembered after a reload, over the device language");

    await page.locator("#langBtn").click();
    await page.keyboard.press("Escape");
    ck(!(await page.locator("#langModal").isVisible()), "Escape closes the picker");
    ck(await page.locator("#home").evaluate((el) => el.classList.contains("active")), "Escape in the picker does not start a round");
    await ctx.close();
  }

  /* ---------------- a round in German ---------------- */
  {
    const { ctx, page } = await open(browser, { locale: "de-DE" });
    await page.locator("#playBtn").click();
    await page.waitForTimeout(300);
    const first = await page.evaluate(() => ({ text: state.round[0].text, inBank: QUESTIONS.some((q) => q.q === state.round[0].text) }));
    ck(first.inBank && (await page.locator("#qText").textContent()) === first.text, "a German round shows German questions");
    const ci = await page.evaluate(() => state.round[state.index].correctIndex);
    await page.locator(`.ans[data-idx="${ci}"]`).click();
    await page.waitForTimeout(200);
    ck((await page.locator("#fbTitle").textContent()).trim() === SAMPLE.de.correct, "feedback is in German");
    ck((await page.locator("#nextBtn").textContent()).indexOf("NÄCHSTE FRAGE") === 0, "the Next button is in German");
    await page.locator("#nextBtn").click();
    await page.waitForTimeout(200);
    const wrong = await page.evaluate(() => (state.round[state.index].correctIndex + 1) % 4);
    await page.locator(`.ans[data-idx="${wrong}"]`).click();
    await page.waitForTimeout(200);
    ck((await page.locator("#fbExp").textContent()).indexOf("Richtig ist: ") === 0, "a wrong answer names the right one in German");
    await page.locator("#nextBtn").click();
    await playRound(page);
    ck((await page.locator("#againBtn").textContent()) === "Nochmal spielen", "the results screen is in German");
    ck((await page.locator("#statAcc .l").textContent()) === "Trefferquote", "the result labels are in German");
    await ctx.close();
  }

  /* ---------------- Block Blitz in Portuguese ---------------- */
  {
    const { ctx, page } = await open(browser, { locale: "pt-BR" });
    await page.locator("#tabBlocks").click();
    ck((await page.locator("#playBtn .pl-blocks").textContent()) === "JOGAR BLOCK BLITZ", "pt: the Block Blitz Play button is translated");
    await page.locator("#playBtn").click();
    await page.waitForTimeout(400);
    ck((await page.locator("#bkHint").textContent()).indexOf("Toque em um grupo") === 0, "pt: the Block Blitz hint is translated");
    await page.locator(".bk-block").first().click();
    await page.waitForTimeout(450);
    const sheet = await page.evaluate(() => ({
      open: document.getElementById("bkSheet").classList.contains("open"),
      q: document.getElementById("bkQ").textContent,
      known: QUESTIONS.some((q) => q.q === document.getElementById("bkQ").textContent),
      worth: document.getElementById("bkWorth").textContent
    }));
    ck(sheet.open && sheet.known, "pt: a block group asks a Portuguese question");
    ck(/Estoure \d+/.test(sheet.worth), "pt: the group's worth line is translated");
    await ctx.close();
  }

  /* ---------------- a language file that can't be loaded ---------------- */
  {
    const ctx = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();   // not watched: the blocked request logs an expected console error
    await page.route("**/lang/*.js", (route) => route.abort());
    await page.goto(GAME_URL);
    await page.waitForTimeout(400);
    await page.locator("#langBtn").click();
    await page.locator('.lang-opt[data-lang="de"]').click();
    await page.waitForTimeout(600);
    const s = await snapshot(page);
    ck(s.code === "en" && s.q0 === "How many continents are there on Earth?", "a failed download leaves the game in English");
    ck((await page.locator("#langStatus").textContent()).indexOf("could not be loaded") !== -1, "and says so in the picker");
    ck(await page.locator("#langModal").isVisible(), "the picker stays open so the player can try again");
    ck(await page.evaluate(() => progress.lang === ""), "a failed choice is not saved");
    await ctx.close();

    const ctx2 = await browser.newContext({ locale: "de-DE", viewport: { width: 390, height: 844 } });
    const page2 = await ctx2.newPage();
    await page2.route("**/lang/*.js", (route) => route.abort());
    await page2.goto(GAME_URL);
    await page2.waitForTimeout(600);
    ck(await page2.locator("#catGrid .cat").count() === 11 && (await snapshot(page2)).code === "en",
      "a German device with no language file still starts, in English");
    await ctx2.close();
  }

  /* ---------------- the longer text still fits ---------------- */
  for (const code of ["en"].concat(CODES)) {
    for (const [w, h] of [[320, 568], [390, 844], [667, 375]]) {
      const { ctx, page } = await open(browser, { locale: "en-US", viewport: { width: w, height: h } }, GAME_URL + "?lang=" + code);
      const home = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        const chip = box(document.getElementById("bestChip"));
        const btns = box(document.querySelector(".top-btns"));
        const play = document.getElementById("playBtn");
        const tabs = Array.from(document.querySelectorAll(".mode-tab"));
        const vw = document.documentElement.clientWidth;
        return {
          hScroll: document.documentElement.scrollWidth > vw + 1,
          topOverlap: overlap(chip, btns),
          topInside: chip.left >= 0 && btns.right <= vw + 0.5,
          playFits: play.scrollWidth <= play.clientWidth + 1 && box(play).right <= vw + 0.5,
          tabsFit: tabs.every((tb) => tb.scrollWidth <= tb.clientWidth + 1),
          lenInside: box(document.getElementById("lenPills")).right <= vw + 0.5,
          catNames: Array.from(document.querySelectorAll("#catGrid .cat")).every((c) => {
            const nm = c.querySelector(".nm").getBoundingClientRect(), cr = c.getBoundingClientRect();
            return nm.right <= cr.right - 2 && c.scrollWidth <= c.clientWidth + 1;
          })
        };
      });
      const tag = `${code} ${w}x${h}`;
      ck(!home.hScroll, `${tag}: the home screen has no sideways scroll`);
      ck(!home.topOverlap && home.topInside, `${tag}: the best-score chip and the four top buttons don't collide`);
      ck(home.playFits, `${tag}: the Play button's text fits`);
      ck(home.tabsFit && home.lenInside, `${tag}: the mode tabs and length pills fit`);
      ck(home.catNames, `${tag}: every category name fits its card`);

      // The longest category name on the Play button.
      const longCat = await page.evaluate(() => {
        const key = Object.keys(CATEGORIES).sort((a, b) => CATEGORIES[b].name.length - CATEGORIES[a].name.length)[0];
        UI.selectCategory(key);
        const play = document.getElementById("playBtn");
        return play.scrollWidth <= play.clientWidth + 1 && play.getBoundingClientRect().height < 90;
      });
      ck(longCat, `${tag}: the Play button fits the longest category name`);

      // The question with the longest answers, answered, with feedback showing.
      await page.locator("#playBtn").click();
      await page.waitForTimeout(250);
      const quiz = await page.evaluate(async () => {
        const worst = QUESTIONS.slice().sort((a, b) => (b.q.length + b.a.join("").length * 2 + b.e.length) - (a.q.length + a.a.join("").length * 2 + a.e.length))[0];
        const options = worst.a.map((text, i) => ({ text, correct: i === 0 }));
        state.round[state.index] = { category: worst.c, text: worst.q, explanation: worst.e, options, correctIndex: 0 };
        UI.renderQuestion();
        const vw = document.documentElement.clientWidth;
        const hud = Array.from(document.querySelectorAll("#quiz .hud-stat")).every((el) => el.scrollWidth <= el.clientWidth + 1);
        const ans = Array.from(document.querySelectorAll("#answers .ans")).every((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= -0.5 && r.right <= vw + 0.5 && el.scrollWidth <= el.clientWidth + 1;
        });
        Game.answer(0);
        await new Promise((r) => setTimeout(r, 500));
        const next = document.getElementById("nextBtn").getBoundingClientRect();
        return {
          hud, ans,
          hScroll: document.documentElement.scrollWidth > vw + 1,
          nextOnScreen: next.bottom <= window.innerHeight + 1 && next.top >= 0 && next.right <= vw + 0.5,
          nextFits: document.getElementById("nextBtn").scrollWidth <= document.getElementById("nextBtn").clientWidth + 1
        };
      });
      ck(quiz.hud, `${tag}: the quiz HUD labels fit their boxes`);
      ck(quiz.ans && !quiz.hScroll, `${tag}: the longest answers stay inside the screen`);
      ck(quiz.nextOnScreen && quiz.nextFits, `${tag}: the Next button is on screen and its text fits`);
      await ctx.close();
    }
  }

  await browser.close();
  suite.report();
})().catch((e) => { console.error(e); process.exit(1); });
