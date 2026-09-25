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

## 2. The blocker: no SDK integration

The game currently has **zero** Playables SDK integration (`window.ytgame` is
undefined; the only script tag is our own inline one). Certification requires it,
so this is the whole of the real work.

Required integrations **[verify all names]**:

| Requirement | Today | Needed |
|---|---|---|
| Load SDK before game code | — | `<script src="https://www.youtube.com/game_api/v1"></script>` first in `<head>` |
| Loading lifecycle | — | `ytgame.game.firstFrameReady()` then `ytgame.game.gameReady()` |
| Environment detection | — | `ytgame.IN_PLAYABLES_ENV` to keep the standalone build working |
| Pause / resume | `visibilitychange` only | `onPause` / `onResume` callbacks |
| Audio state | own mute button | `ytgame.system.isAudioEnabled()` + `onAudioEnabledChange()` |
| Persistence | `localStorage` only | `ytgame.game.saveData()` / `loadData()` |
| Score reporting | — | `ytgame.engagement.sendScore()` (optional, worth having) |
| Error reporting | — | `ytgame.health.logError()` (optional) |

**Sources disagree on two namespaces** — one places pause/resume on `ytgame.game`,
another on `ytgame.system`. Resolve against the official SDK reference before
writing the adapter. **[verify]**

### Architectural decision: a platform adapter

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

Everything in `STATE` and `GAME` then calls `Platform.*` and neither build knows
about the other. This keeps the GitHub Pages deploy as the test harness.

### Persistence becomes asynchronous — the one real refactor

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

Doing it this way means `loadSeen`/`saveSeen`/`loadBest` keep their signatures and
the rotation, best-score and picker code is untouched.

---

## 3. Defects found in this review

### 3.1 Double-tapping Play burns the rotation pool — **high**

Two `Game.start()` calls in quick succession each build a round, and **each build
marks its questions as seen**. Only the second round is played; the first ten
questions are consumed without ever being shown.

Measured:

- Double-tap Play on a 10-question round → **20 questions consumed, 10 playable**.
- Double-tap Play on a 30-question category round → **all 30 of 30 marked seen**,
  so the entire category is exhausted and the very next round is all repeats.

This silently defeats the question-rotation feature. A double-tap is an ordinary
thing to do on a phone, and it is reachable from the Play button, the Play Again
button and the Enter key.

**Fix:** guard `Game.start()` against re-entry (ignore a start while a round is
already being built / already active), so a second tap is a no-op.

### 3.2 Esc does nothing on the results screen — **low**

The `keydown` handler returns early unless the quiz screen is active, so Esc only
quits mid-round. Playables requires modals to be closable with Esc **[verify how
strictly this applies to a full-screen results view]**. Cheap to make Esc return
home from results.

### 3.3 Background blur costs ~30% of the frame budget — **medium**

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

**Fix:** replace the blurred orbs with pre-blurred radial gradients, keep the
`prefers-reduced-motion` path, then re-measure under CPU throttling.

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

**Fix:** move the suites into `tests/`, add a `package.json` with a Playwright
dev-dependency and an `npm test` script, and run it in CI on push and pull request.

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

### Phase 0 — fix the live defects (small)
1. Re-entry guard on `Game.start()`. *(3.1)*
2. Esc returns home from results. *(3.2)*
3. Regression tests for both.

### Phase 1 — make the repo sustainable (small)
4. Move the 132 assertions into `tests/`, add `package.json` + `npm test`.
5. CI workflow running the suites on push and PR, alongside the existing deploy.

*Rationale: do this before the SDK refactor, not after — it is the safety net for it.*

### Phase 2 — performance for low-end devices (small)
6. Replace blurred orbs with gradients; re-measure. *(3.3)*
7. Add a throttled-CPU performance check to the suite so this cannot regress.

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
