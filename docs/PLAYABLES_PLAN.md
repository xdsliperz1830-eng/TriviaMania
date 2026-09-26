# Brain Blitz → YouTube Playable

A review of the game as it stands today, and the plan to get it certified as a
YouTube Playable.

> **Source caveat.** `developers.google.com` is blocked from the environment this
> review ran in, so the requirements below come from search summaries of the
> official certification pages plus reputable secondary sources, not from reading
> the specification directly. Everything marked **[verify]** must be checked
> against the official docs before it is implemented — in particular the exact SDK
> namespaces, where sources disagreed. Measurements of *our own game* were taken
> directly and are reliable.

---

## 1. Where the game stands

Measured against the published Playables limits:

| Limit | Budget | Brain Blitz | Headroom |
|---|---|---|---|
| Initial payload | 30 MiB (15 MiB recommended) | **114 KB** | 0.4% of the hard cap |
| Total bundle | 250 MiB | 114 KB | negligible |
| JS heap | 512 MB | **10 MB** | 2% |
| Interactive within | 5 s | **~19 ms** to DOM ready, 108 ms to first paint | effectively instant |
| Save state | 3 MB serialised | ~2 KB | negligible |

The size and speed budgets are not a concern and are unlikely to become one. The
work ahead is **integration and compliance**, not optimisation for size.

### Already compliant

- **Responsive in every aspect ratio.** Verified at 18 viewports from 320×568 to
  1920×1080, portrait and landscape, with worst-case question and explanation text.
- **No orientation or posture lock.** Nothing in the code touches the Screen
  Orientation API.
- **State survives a resize.** Rotating portrait→landscape mid-question keeps the
  question, index, score and a running timer intact — this is an explicit
  requirement and we already pass it.
- **Touch, mouse and keyboard input.** Answers are tappable and bound to 1–4/A–D,
  Enter/Space advances.
- **No external links, ads, payments or sign-in.** Nothing to strip out.
- **No network at all after load.** Verified with the network offline.
- **Not obfuscated.** The single file is readable and commented, which matters —
  certification explicitly rejects code transformed to hide its logic.

---

## 2. SDK integration — **done**

The game is now integrated. The API was confirmed by reading Phaser's official
Playables template (`phaserjs/template-youtube-playables`, `src/YouTubePlayables.js`),
which is a working reference rather than a summary — that resolved the open
question below.

**The open question is resolved: pause and resume live on `ytgame.system`,
not `ytgame.game`.** Two other details the summaries had not made clear:
`sendScore` takes an **object** (`{ value: score }`), and `loadData()` resolves
with a **raw string** that the caller must `JSON.parse` itself.

Required integrations:

| Requirement | Status |
|---|---|
| SDK loaded before game code | done — first script in `<head>` |
| Loading lifecycle | done — `game.firstFrameReady()` at boot, `game.gameReady()` once the home screen is built |
| Environment detection | done — `IN_PLAYABLES_ENV` keeps the standalone build working |
| Pause / resume | done — `system.onPause` / `system.onResume`, sharing the hidden-tab path |
| Audio state | done — `system.isAudioEnabled()` + `system.onAudioEnabledChange()` |
| Persistence | done — `game.saveData()` / `game.loadData()`, hydrate-once + debounced flush |
| Score reporting | done — `engagement.sendScore({ value })` at round end |
| Error reporting | done — `health.logError()` on save/load failure |

### The adapter, as built

The game must keep working as a plain web page (it is deployed on GitHub Pages and
that is how it gets tested), while also running inside YouTube. So the SDK should
not be called directly from game logic. Introduce one adapter that both builds talk
to:

```js
const Platform = (() => {
  const inYT = typeof ytgame !== "undefined" && ytgame.IN_PLAYABLES_ENV;
  return {
    inYT,
    ready()                { if (inYT) ytgame.game.gameReady(); },
    firstFrame()           { if (inYT) ytgame.game.firstFrameReady(); },
    onPause(fn)            { inYT ? ytgame.game.onPause(fn)  : document.addEventListener(...); },
    onResume(fn)           { inYT ? ytgame.game.onResume(fn) : document.addEventListener(...); },
    audioEnabled()         { return inYT ? ytgame.system.isAudioEnabled() : !storedMute; },
    load()                 { return inYT ? ytgame.game.loadData() : Promise.resolve(localStorage...); },
    save(obj)              { return inYT ? ytgame.game.saveData(JSON.stringify(obj)) : localStorage...; }
  };
})();
```

Everything else calls `Platform.*`, so neither build knows about the other and
the GitHub Pages deploy stays the test harness. Every SDK call is wrapped so a
missing, hostile or hanging SDK cannot take the game down — `loadData` is bounded
at two seconds, and a round still starts if every SDK method throws. Both are
covered by tests.

### Persistence became asynchronous — the one real refactor

This is the part that actually changes existing code. Today `store.get/set` are
**synchronous** and called freely from `loadSeen`, `saveSeen`, `loadBest` and the
length picker. The SDK's `loadData`/`saveData` are **promises**, and there is a
documented ordering rule: *`saveData` must not be called until `loadData` has
resolved, or the write is rejected.* **[verify]**

So the storage layer becomes:

1. On boot, `await Platform.load()` **once**, hydrate an in-memory `progress`
   object (`seen` ids, `best` per length, `mute`, `length`).
2. All reads during play hit that in-memory object — no behaviour change, no
   `await` sprinkled through the game logic.
3. Writes mark the object dirty and a **debounced** flush (say 1 s, plus a flush on
   round end) calls `Platform.save()`. This also avoids hammering the cloud API
   after every answer.
4. A save that fails must never break play — same defensive posture as the current
   `try/catch` around `localStorage`.

Done this way, `loadSeen`/`saveSeen`/`loadBest` kept their signatures and the
rotation, best-score and picker code was untouched. Saved progress from before
the change is migrated on first load, so existing players keep their history and
records. A finished round and a pause are both flush points; a five-question
round writes twice, not once per answer.

---

## 3. Defects found in this review — all fixed

### 3.1 Double-tapping Play burns the rotation pool — **high** — *fixed*

Two `Game.start()` calls in quick succession each build a round, and **each build
marks its questions as seen**. Only the last round is played; the earlier ones are
consumed without ever being shown.

Measured on a 10-question round: a double-tap **consumed 20 questions and played
10**, silently burning ten from the rotation pool.

> **Correction to the original review.** That first write-up also claimed a
> double-tapped 30-question category round exhausted "all 30 of 30". That number
> is real but it does not isolate the bug: a 30-question round draws the entire
> 30-question pool anyway, so a single correct round produces the same figure. The
> honest evidence is the 10-question case above. Writing the regression test is
> what surfaced this — the assertion passed against the broken build, which meant
> it was measuring the wrong thing.

A double-tap is an ordinary thing to do on a phone, and it was reachable from the
Play button, the Play Again button and the Enter key.

**Fixed** by a `state.roundActive` re-entry guard in `Game.start()`, released in
`end()` and `quitToHome()`. All three entry points funnel through `start()`, so
one guard covers them. The regression test asserts the invariant directly — three
rapid taps must call `buildRound` exactly once — rather than counting consumed
questions, which only exposes the bug when the round is smaller than the pool.

### 3.2 Esc does nothing on the results screen — **low** — *fixed*

The `keydown` handler returns early unless the quiz screen is active, so Esc only
quits mid-round. Playables requires modals to be closable with Esc **[verify how
strictly this applies to a full-screen results view]**. **Fixed:** Esc now returns home from the results screen, and still quits mid-round.

### 3.3 Background blur costs ~30% of the frame budget — **medium** — *fixed*

The three drifting orbs use `filter: blur(60px)` on elements up to 46 vmax across.
Measured on the home screen (headless, same machine, three runs):

| Configuration | FPS |
|---|---|
| As shipped (blurred orbs) | **43** |
| Orbs hidden entirely | 60 |
| Orbs visible, `filter: none` | **61** |

The cost is the blur, not the orbs — an equally soft look can be had from a
`radial-gradient` with transparent stops, which the compositor handles for free.
Headless FPS is not a phone, so this is a *relative* signal, not a verdict; but a
large-radius blur on a continuously animating element is a known cost on mobile
GPUs, and Playables must run on low-end hardware. 20 elements animate infinitely
on the home screen.

**Fixed** by replacing the blurred circles with radial gradients that fade to
transparent — the same look, painted once and composited for free. Re-measured on
the same machine: **43 fps → 61 fps**, and the background now costs nothing at all
(61 fps with the orbs shown, 61 with them hidden). The regression test guards it
structurally: no large, continuously animating element may carry a blur filter,
the three orbs must still animate, and the frame rate must stay above 50.

---

## 4. Project health

**All of the test coverage is ephemeral.** The repository contains four files —
`index.html`, `README.md`, `.nojekyll` and the deploy workflow. The suites written
alongside the game (**132 assertions** across gameplay, rotation, round length,
geography balance, picker layout and an 18-viewport sweep) live only in a scratch
directory and disappear with the container.

That matters more now than it did: the SDK work above is the first change that
touches persistence, audio and lifecycle *underneath* the game logic. That is
exactly the kind of refactor the existing tests would catch regressions in, and
right now CI runs nothing but a deploy.

**Fixed.** The suites now live in `tests/` behind `npm test`, with a shared
harness, a runner that isolates each suite in its own process, and a `Tests`
workflow running them on every push and pull request. **148 assertions** across
seven suites, including a new `regressions.test.js` covering the three defects
above.

One loose end: no `package-lock.json` is committed, because the npm registry was
unreachable from the environment this was set up in. The Playwright version is
pinned exactly instead, and CI uses `npm install` rather than `npm ci`. Run
`npm install` locally, commit the lockfile, and switch the workflow to `npm ci`
when convenient.

Other notes:

- No dead code or unused CSS found.
- The file is ~2,000 lines: ~600 of question data, ~850 of logic, ~410 of CSS.
  Splitting data out is *permitted* for Playables (bundles may contain many files)
  but is not required and buys little at this size. Worth doing only if the bank
  grows substantially.

---

## 5. Plan

Ordered so that each phase is shippable on its own and nothing depends on YouTube
approval until the game is actually ready.

### ~~Phase 0 — fix the live defects~~ — **done**
1. ~~Re-entry guard on `Game.start()`.~~ *(3.1)*
2. ~~Esc returns home from results.~~ *(3.2)*
3. ~~Regression tests for both.~~ Each was verified to fail against the unfixed
   build before being accepted.

### ~~Phase 1 — make the repo sustainable~~ — **done**
4. ~~Move the assertions into `tests/`, add `package.json` + `npm test`.~~
5. ~~CI workflow running the suites on push and PR.~~

### ~~Phase 3 — SDK integration~~ — **done**
8. ~~Verify the SDK surface against a working reference.~~ Resolved from Phaser's
   official template; pause/resume are on `system`.
9. ~~SDK script tag and `Platform` adapter.~~
10. ~~Loading lifecycle.~~
11. ~~Pause/resume through the adapter.~~
12. ~~Audio: YouTube's state gates the game's own mute.~~
13. ~~Async persistence with hydrate-once and debounced flush.~~
14. ~~`sendScore` and `logError`.~~

Covered by a new `playables.test.js` — 38 assertions driven against a mock
`ytgame`, since YouTube is not reachable from a test runner.

### ~~Phase 2 — performance for low-end devices~~ — **done**
6. ~~Replace blurred orbs with gradients; re-measure.~~ *(3.3)* 43 → 61 fps.
7. A frame-rate floor and a structural no-blur check now guard it. Verifying
   under real CPU throttling on a physical low-end device remains worthwhile
   before submission.

### Phase 3 — SDK integration (the real work)
8. **Verify the SDK surface against the official docs** — resolve the
   `ytgame.game` vs `ytgame.system` question and confirm every signature.
9. Add the SDK script tag and the `Platform` adapter; keep the standalone build
   working and green.
10. Loading lifecycle: `firstFrameReady` at first paint, `gameReady` when the home
    screen is interactive.
11. Pause/resume through the adapter — the countdown must freeze and resume
    exactly as the existing `visibilitychange` path already does (that behaviour is
    already correct and tested; it just needs a second trigger).
12. Audio: make YouTube's audio state the source of truth when embedded, and
    reconcile it with our own mute button so the two cannot disagree.
13. Persistence: the async storage layer described in §2, with the in-memory
    hydrate + debounced flush, preserving the current rotation and best-score
    behaviour exactly.
14. Optional but cheap: `sendScore` on round end, `logError` wired to the existing
    error paths.

### Phase 4 — submission readiness
15. Content pass over the 300 questions for a 13+ general audience and for facts
    that could age badly.
16. Metadata: title, description, thumbnails to the published character/pixel specs
    **[verify]**.
17. Test in the developer portal's own harness, then submit. Expect roughly
    **2–7 business days** from testing to release. **[verify]**

**Status:** Phases 0–3 are complete and deployed. Phase 4 (content pass,
metadata, portal testing and submission) is what remains, and most of it needs
developer-portal access rather than code.

**Still worth verifying against the official docs**, which were unreachable from
the environment this was built in: the exact metadata specs, and whether any
certification rule covers behaviour the mock cannot model (the mock mirrors the
Phaser template's usage, not YouTube's own runtime).

**Not in scope until YouTube says so:** access to the developer portal is via an
interest form and approval, which is a business step, not a code one. Phases 0–2
are worth doing regardless of whether the Playables application succeeds.

---

## Sources

- [Design requirements — Playables, Google for Developers](https://developers.google.com/youtube/gaming/playables/certification/requirements_design)
- [Integration requirements — Playables](https://developers.google.com/youtube/gaming/playables/certification/requirements_integration)
- [Certification requirements — Playables](https://developers.google.com/youtube/gaming/playables/certification/requirements)
- [YouTube Playables SDK reference](https://developers.google.com/youtube/gaming/playables/reference/sdk)
- [SDK getting started](https://developers.google.com/youtube/gaming/playables/reference/getting_started)
- [Phaser template demonstrating the SDK](https://github.com/phaserjs/template-youtube-playables)
- [Game size limit guide](https://playables.in/youtube-playables-game-size-limit-developer-guide/)
- [Common certification errors](https://mediacube.io/en/blog/youtube-playables-errors)
