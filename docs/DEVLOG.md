# Devlog

Decisions, measurements and what is deliberately not done yet, so the next
session starts from facts instead of memory. Newest first.

## Android version with ads between rounds

`android/` wraps the game in Capacitor 8 (target SDK 36) with
`@capacitor-community/admob` 8.3. The game gained one hook,
`Platform.adBreak(kind)`, called by `leaveFinished()` at every exit from a
finished round (Play again, Home, Escape/back on results, the Block Blitz
game-over buttons and keys); the game waits for it with the music paused.
Platforms without it are unaffected.

- **Pacing**, in `android/src/pacing.js`: first ad after round 3 ever, then
  every second round, at least 150 s apart, persisted across restarts. A
  zero timestamp was first read as "no ad yet" (caught by the tests); the
  pacer now counts ads instead.
- **Ad length** can't be set by the game: AdMob's ad unit settings decide the
  skip delay (5 s default, up to 12 s with high-engagement ads, up to 30 s if
  non-skippable video is allowed).
- **Consent** through Google's UMP form before any ad request; a Privacy
  options link appears in the language dialog where it is required
  (`Platform.privacyOptions`).
- **Test ids** everywhere until the owner's AdMob ids exist;
  `scripts/release.mjs` refuses a release with test ids or without the
  upload key, and was exercised with a throwaway key (8.2 MB signed bundle).
- **Not verified on a device**: no phone or emulator in the build container.
  The APK was inspected (manifest, target SDK, AdMob app id, bundled files)
  and the game was driven in Chromium with a fake ad service.

## Reddit version, server-scored daily, leaderboards

The Reddit app lives in `reddit/` and is built from `index.html` by
`reddit/scripts/sync-client.mjs`, so there is still one game. The game gained
optional platform hooks (`window.BrainBlastPlatform`, documented above the
`Platform` module); with none present nothing changes for the web or YouTube.

- **Daily Challenge on the server.** The server picks the day's ten from a
  secret (HMAC of a per-subreddit random key and the UTC date), hands out each
  question only when it is shown, and scores each answer on its own clock with
  the game's formula. The game shows its own points at once, then takes the
  server's total. 600 ms of the elapsed time is forgiven for the round trip;
  an answer more than 2 s past the 15 s limit is a time-out.
- **Accepted risk.** The question bank, answers included, ships to the
  browser (each player reads questions in their own language from it), so a
  determined cheater can look answers up by id. Server timing limits that to
  "fast lookups"; answers under 1.2 s and averages under 2 s are flagged in
  the moderators' standings, along with accounts under 30 days old.
- **One try a day, strictly.** A round that was started and then reloaded, or
  opened on a second device, ends with what it scored. Resuming mid-round
  would let a player re-roll the clock.
- **Logged-out players** play everything, with the Daily Challenge run on the
  device and unscored; the leaderboard asks them to log in.
- **Board order** packs tie-breaks into the sorted-set score: month = points,
  then days played, then less total answer time; day = points, then time.
- **The Best chip opens the leaderboard** rather than a fifth top-bar button.
  Measuring that showed a pre-existing bug: a five-digit best pushed the mute
  button off phones 390 px wide and under. The chip now yields, and drops its
  label below 400 px.
- **Not verified yet** (needs `devvit playtest` on a real subreddit): whether
  Reddit's content security policy allows the game's `data:` fonts, how the
  scheduler's context names the subreddit, and the review-source settings
  (`additionalSourceRoots`). Inline code was moved into files regardless.

## Laptops and monitors

Reported from a monitor: category names broke inside words ("Knowledg-e",
"Geograph-y", "Technolog-y").

- **Cause.** The language work added `overflow-wrap:anywhere` to category
  names so long German words could not overflow. On desktop the screen is
  620px wide and the grid has four columns of 148px, too narrow for
  "Knowledge" or "Technology", so they broke at any letter.
- **Fix.** Screens are 760px wide on desktop (four columns of 183px). Names
  now use `hyphens:auto` with `overflow-wrap:break-word`, so a word breaks
  only when it cannot fit, and then at a real hyphenation point for the
  page's language.
- **Found while checking.** A laptop browser window is short: a 1366x768
  laptop leaves about 657px. There, the last row of categories was below
  the fold. On desktop windows up to 720px tall, the title now shares the
  top row with the score and buttons, and the round-length pills share a
  row with "Choose a category".
- **Tall monitors.** Screens stop at 900px tall and sit in the middle,
  instead of stretching with an empty band above the Play button.
- **Mouse.** The language flags and Block Blitz blocks gained hover states;
  everything else already had them.
- `tests/regressions.test.js` 3.5 checks all four languages at seven desktop
  sizes for names broken inside words and categories below the fold. It
  fails 36 times on the previous version.
- A walk through every screen (home, both tabs, both dialogs, quiz,
  feedback, results, Block Blitz, its question) at 13 desktop sizes in
  English and German found nothing else.

## Block Blitz: 10-second answers, auto-pick, idle motion

### What changed

- Questions in Block Blitz give 10 seconds (the quiz keeps 15). The bar
  warns at 5 and 3 seconds and ticks from 5, as before.
- **Auto-pick.** After 5 seconds of waiting the game picks a group as if it
  were tapped. At 2 seconds the group starts to wiggle with a gold ring and
  the hint becomes a countdown. The focused block's group is preferred; a
  Lucky Block is skipped unless it is all that is left. Arrow keys and arming
  a bomb restart the wait; it never runs while a question is open, during a
  blast or rise, after game over, or while the game is paused.
  A 100 ms poll decides "waiting" from the game's own flags, rather than
  each code path that ends a turn having to remember to start a timer.
- **Idle motion.** Icons bob and a glint sweeps each block, phased by the
  block's diagonal so both travel up the board. Only the icon and a
  pseudo-element animate, with transform and opacity.

### What it costs, and what was changed because of it

Measured with `tools/measure-fx.js` and CDP metrics at 4x CPU throttling:

- **Positive animation delays restyled the board.** Each block's glint
  starting at its own moment cost a style recalculation per start (11 in
  6 s, 57 ms). Negative delays put every block mid-cycle from the start: 0.
- **Running animations cost nothing on their own, but a lot alongside any
  per-frame loop.** With a requestAnimationFrame loop running (the question
  timer, a blast's effects), Chrome restyled every animated block each frame:
  180 recalculations and 400–530 ms of style work in 3 s. So the motion runs
  only while the board is waiting (`.live`), and starts 0.9 s into a wait,
  after a blast's falling blocks have settled.
- **Switching the motion on or off** restyles the board once: 15–20 ms at
  4x (about 5 ms unthrottled), occasionally more. It happens on a pick, in
  the same frame as the dimming the pick already causes.
- Idle board at 4x: 59–60 fps, one frame over 20 ms in 1.5 s (the switch on).

### Also fixed

- `UI.warmFx()` crashed with reduced motion on: `banner()` and `flash()`
  return before creating their elements, and it then read `_anim` from
  undefined. It now does nothing under reduced motion. Found by the new
  reduced-motion check in `tests/blocks.test.js`.

## Languages: Spanish, Portuguese, German

### Decisions

- **One file per language, loaded on demand.** Putting three more question
  banks in `index.html` would add about 460 KB to every player's first load.
  A language file is a script tag (`lang/<code>.js` calling `BB_LANG`), which
  works from `file://`, GitHub Pages and a Playable bundle alike.
- **Translations are matched by position, not by key.** The language file's
  questions are in the same order as `QUESTIONS`. Question ids still come
  from the English text and are computed before any language is applied, so
  "seen" history, best scores and the daily challenge are language-independent.
- **Switching language rewrites the bank in place** (`q`, `a`, `e` and the
  category names), so the quiz, the daily and Block Blitz needed no changes
  to how they read questions. English originals are kept to switch back.
- **Language order:** `?lang=` in the address, then the saved choice, then
  `ytgame.system.getLanguage()` in a Playable or `navigator.language`.
- **Portuguese is Brazilian** and Spanish is neutral Latin American (film
  titles and words like "computadora"), as the larger audiences.
- **Questions about the English language** (plurals, collective nouns such as
  "a murder of crows") are asked as questions about English, with the English
  answers kept. A few were re-angled where that read badly: the baby swan
  question asks its colour, "fortnight" became "two weeks".

### Layout changes the longer text forced

- Quiz top bar: less padding and letter-spacing on the labels, smaller still
  under 360 px, so "Pregunta" and "Punkte" fit. Portuguese uses "Combo" for
  the streak label because "Sequência" does not fit.
- Category cards: a name with a 12+ letter word ("Allgemeinwissen",
  "Wissenschaft") gets smaller type and may break rather than clip.
- The Play label is built from a template (`PLAY {cat}`, `{cat} SPIELEN`)
  because the word order differs.

`tests/i18n.test.js` checks the fit at 320x568, 390x844 and 667x375 in all
four languages, using the question with the longest answers.

### Not done yet, on purpose

- No native-speaker review. The checks catch structure, not tone or a
  regional word choice.
- The store listing text and key art are English only.
- `<title>` and the manifest name stay "Brain Blast" in every language.

## Game feel and animation costs

Reviewed against the `mobile-game-dev` playbook (`.claude/skills/`).

### How effects are measured

`tools/measure-fx.js` opens the game with `?debug`, sets each effect's state
up first, idles 400 ms, and only then fires the effect inside a 1.5 s
window. It reports requestAnimationFrame fps, the share of frames over 20 ms,
the worst frame, and the layouts and style recalculations the effect caused
(DevTools `Performance.getMetrics`). The `?debug` hook (`window.__dbg`) only
exists with that query string, so players never have it.

```bash
node tools/measure-fx.js            # 4x and 6x CPU throttling
FX=correct REPEAT=5 node tools/measure-fx.js 6
```

This is desktop Chromium with the CPU throttled, not a phone. It slows
script, style and layout, but not the GPU, so it shows the shape of a cost
rather than proving smoothness on a weak phone. Runs at 6x vary by a few fps,
so repeat a measurement before trusting a small difference.

### Before and after, 4x CPU throttling

| Effect | Layouts before → after | Layout ms before → after | Worst frame before → after |
|---|---|---|---|
| Quiz idle, timer running | 91 → 6 | 83.6 → 5.3 | 16.8 → 16.8 |
| Correct answer | 37 → 22 | 50.0 → 22.0 | 50 → 33 |
| Wrong answer | 32 → 20 | 40.6 → 20.2 | 50 → 16.8 |
| Next question | 94 → 8 | 83.1 → 10.1 | 33 → 16.8 |
| Results reveal | 7 → 10 | 19.1 → 16.2 | 50 → 50 |
| Block Blitz: pick a group | 3 → 4 | 5.9 → 4.5 | 33 → 16.8 |
| Block Blitz: blast | 19 → 5 | 27.6 → 7.0 | 50 → 16.8 |

At 6x the results reveal's worst frame went from 100 ms to 33–50 ms, and
picking a Block Blitz group went from 54.6 fps (6.2% slow frames) to 58–60.
The answer frame itself still peaks around 50–80 ms at 6x (about 10 ms
unthrottled), the same as before. It now does more work but no longer forces
extra layouts for the effects.

### What caused the costs, and the fix for each

- **The timer wrote its number and classes every frame**, a layout per frame
  for the whole question. Now it writes the number when the second changes
  and the classes at the 5 s and 3 s marks. The ring still updates each
  frame, which is a paint, not a layout.
- **The progress bar animated `width`.** It now slides with `transform`
  inside its track. Tests read `data-progress` instead of `style.width`.
- **The score counted up by rewriting its text every frame.** It is now
  written once and bumped with a transform.
- **Each correct answer created and removed 16 confetti divs.** Twelve are
  now made once and reused, animated with the Web Animations API, and a
  running burst is cancelled before the next one.
- **Effects read a button's position after its classes had changed**,
  forcing a layout each time. The position is now read once, before any
  writes, and passed to the float and the confetti.
- **Ending a round rebuilt the hidden home grid** while the results screen
  opened. Going home already rebuilds it, so that call is gone.
- **The decorative background kept drifting during play.** It is now its own
  layer and pauses while a quiz or Block Blitz round is on.
- **Block Blitz animated `filter` on the picked group, dimmed every other
  block with `filter`, and animated a `box-shadow` for the danger state.**
  There is now one dimming overlay with the picked group above it, and the
  pulse and danger glow animate `opacity` on overlays.
- **The new edge flashes started as full-screen blurred box-shadows**, which
  cost up to a 117 ms frame on first use. They are radial gradients now, and
  the reused effect elements are created 300 ms after start-up instead of on
  the first combo.

### Game feel added

Everything moves only `transform` and `opacity`, floats over the screen
without resizing the play area, reuses its element, and stands down when the
device asks for reduced motion.

- Each question card slides in.
- Streaks of 3, 5, 7, 10 and every 5 after get a banner ("On fire!",
  "Blazing!", "Unstoppable!", "Legendary!") with a gold edge flash.
- Answers in 3 seconds or less get a FAST! tag on the floating points.
- The score and streak boxes bump when they change.
- The screen edges glow red in the last three seconds. A wrong answer or a
  timeout flashes red, and a timeout also shakes the card.
- The results screen reveals in order: the tier icon pops, the score lands,
  then the stats and the first ten recap rows cascade in.
- In Block Blitz, groups of 8 or more get a "Huge blast!" or "Mega blast!"
  banner and a short board shake. A rising row nudges the board, and the
  game-over card springs in.
- Short vibrations on phones that support them (Android, not iOS), silent
  whenever the game is muted.

### Rules from the playbook that don't apply here

- Store name checks, a package id and signing keys: the game ships as a
  YouTube Playable and a web page, not a Play Store app.
- Measuring on a real low-end phone: none was attached. The device helper is
  in `.claude/skills/mobile-game-dev/tools/device.mjs` for when one is.

### Not done yet, on purpose

- The gameplay changes proposed after this round wait for the owner's
  approval. The playbook asks that each new system ship as its own slice,
  checked for function and frame rate.
- Checking the phone's system text size at 1.15x and 1.3x. Android WebView
  scales CSS text with it, and YouTube's app may too, so test it on a
  device when one is available.
