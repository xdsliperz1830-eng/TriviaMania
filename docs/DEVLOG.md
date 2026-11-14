# Devlog

Decisions, measurements and what is deliberately not done yet, so the next
session starts from facts instead of memory. Newest first.

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
