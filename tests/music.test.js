/**
 * Background music: it starts on the first gesture, follows the round (drums
 * in, drums out), honours its own toggle and the global mute, remembers the
 * player's choice, and stops booking notes while the tab is hidden.
 *
 * Nothing here can listen, so "silent" is checked at the source: while music
 * should be quiet, it must create no oscillators or noise sources at all.
 */
const { chromium, GAME_URL, createSuite } = require("./harness");
const suite = createSuite("music");
const ck = (condition, message) => suite.check(condition, message);

/** Count audio sources created on the page from now on. */
const countSources = (page) => page.evaluate(() => {
  window.__made = 0;
  if (window.__counting) return;
  window.__counting = true;
  const C = window.AudioContext || window.webkitAudioContext;
  for (const fn of ["createOscillator", "createBufferSource"]) {
    const orig = C.prototype[fn];
    C.prototype[fn] = function () { window.__made++; return orig.apply(this, arguments); };
  }
});
const sourcesAfter = async (page, ms) => {
  await page.evaluate(() => { window.__made = 0; });
  await page.waitForTimeout(ms);
  return page.evaluate(() => window.__made);
};

(async () => {
  const browser = await chromium.launch();
  const page = suite.watch(await browser.newPage());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(GAME_URL);
  await page.waitForTimeout(300);
  await countSources(page);

  ck(await page.evaluate(() => !Music.isPlaying()), "no music before the player has interacted");
  ck((await page.locator("#musicBtn").getAttribute("data-music")) === "on",
     "the music button starts in the on state");

  // The first gesture starts it, on the home screen without drums.
  await page.locator(".len[data-len='5']").click();
  await page.waitForTimeout(200);
  ck(await page.evaluate(() => Music.isPlaying()), "the first tap starts the music");
  ck(await page.evaluate(() => Music.getMode()) === "home", "the home screen plays the light mix");
  ck(await sourcesAfter(page, 600) > 0, "the music is actually booking notes");

  // A round brings the drums in; quitting takes them out.
  await page.locator("#playBtn").click();
  await page.waitForTimeout(200);
  ck(await page.evaluate(() => Music.getMode()) === "quiz", "a round switches to the drum mix");
  await page.locator("#quitBtn").click();
  await page.waitForTimeout(200);
  ck(await page.evaluate(() => Music.getMode()) === "home", "quitting returns to the light mix");

  // The global mute silences it at the source.
  await page.evaluate(() => Sound.setMuted(true));
  ck(await sourcesAfter(page, 600) === 0, "muted: the music books no notes");
  await page.evaluate(() => Sound.setMuted(false));
  ck(await sourcesAfter(page, 600) > 0, "unmuted: the music resumes");

  // Its own toggle: off, remembered, and silent.
  await page.locator("#musicBtn").click();
  await page.waitForTimeout(150);
  ck((await page.locator("#musicBtn").getAttribute("data-music")) === "off" &&
     (await page.locator("#musicBtn").getAttribute("aria-pressed")) === "false",
     "the music button shows off after a tap");
  ck(await page.evaluate(() => !Music.isEnabled()), "the tap turns the music off");
  ck(await sourcesAfter(page, 600) === 0, "music off: no notes are booked");
  ck(await page.evaluate(() => Sound.isAudible()), "turning the music off leaves the sound effects on");
  await page.waitForTimeout(1000);   // past the save debounce
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("brainblitz.save")));
  ck(saved && saved.music === false, "the choice is saved with the rest of the progress");

  await page.reload();
  await page.waitForTimeout(400);
  ck((await page.locator("#musicBtn").getAttribute("data-music")) === "off" &&
     await page.evaluate(() => !Music.isEnabled()),
     "after a reload the music stays off");

  // Back on, then a hidden tab stops the scheduler and a visible one restarts it.
  await page.locator("#musicBtn").click();
  await page.waitForTimeout(200);
  ck(await page.evaluate(() => Music.isEnabled() && Music.isPlaying()), "tapping again turns it back on");
  const hide = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await hide(true);
  ck(await page.evaluate(() => !Music.isPlaying()), "a hidden tab pauses the music");
  await hide(false);
  ck(await page.evaluate(() => Music.isPlaying()), "returning to the tab resumes it");

  await browser.close();
  suite.report();
})();
