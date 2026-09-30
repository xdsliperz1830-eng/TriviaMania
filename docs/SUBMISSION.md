# Submission pack

Everything needed to submit Brain Blitz as a YouTube Playable, minus the parts
that require portal access.

> **Unverified specs.** `developers.google.com` is blocked from the environment
> this was prepared in, so exact character limits and image dimensions could not
> be read from the certification pages. Copy below is written to several lengths
> so something fits whichever limit applies, and the art is generated at common
> sizes with a script that can produce any other. Anything needing confirmation
> is marked **[verify]**.

---

## 1. Build the upload

```bash
npm install
npx playwright install chromium
npm run build          # -> dist/brain-blitz-playable.zip
```

The whole game is one self-contained file, so the bundle is `index.html` at the
archive root: **40 KB zipped, 124 KB unpacked**. The build fails rather than
producing a bundle if a size cap is exceeded, and it finishes by launching the
built file and playing a round, so what you upload is what was tested.

| Limit | Budget | Bundle |
|---|---|---|
| Initial payload | 30 MiB (15 MiB recommended) | 0.13% of the cap |
| Total bundle | 250 MiB | negligible |
| Per file | 30 MiB (512 KiB recommended) | 124 KB |

---

## 2. Store metadata

**Title** — `Brain Blitz` (11 characters)

**Short description**, in ascending length so one fits the limit **[verify]**:

| Chars | Copy |
|---|---|
| 29 | `Ten questions. Fifteen seconds each.` |
| 48 | `Fast-fire trivia across ten categories. How much do you really know?` |
| 78 | `Fast-fire trivia across ten categories — answer quickly, build a streak, and find out how much you really know.` |

**Long description**

> How much do you really know?
>
> Brain Blitz is fast-fire trivia across ten categories — general knowledge,
> science, history, geography, movies, sports, animals, technology, food and
> space. You get fifteen seconds a question, and the quicker you answer the more
> you score, so hesitating is expensive.
>
> Pick a category or take the Mixed Blitz, which draws from all ten at once, and
> choose how long you want to play: 5, 10, 20 or 30 questions. Every round pulls
> questions you have not seen yet, so playing again gives you new ones rather
> than the same set in a different order.
>
> Build a streak for bonus points, learn something from the explanation after
> every answer, and chase your best score for each round length.
>
> 300 questions. No sign-in, no waiting, no ads.

**Category / genre:** Trivia, Puzzle, Casual **[verify — use the portal's own list]**

**Audience:** General audience, 13+. See the content notes in §4.

---

## 3. Art

Generated from the game's own palette and typography by `npm run art`, which
refuses to write a file if the artwork fails to render properly.

| File | Size | Use |
|---|---|---|
| `art/keyart-1280x720.png` | 1280×720 | 16:9 store art |
| `art/keyart-1920x1080.png` | 1920×1080 | larger 16:9 |
| `art/icon-512.png` | 512×512 | square icon |
| `art/icon-1024.png` | 1024×1024 | larger square icon |

Any other size: `node tools/make-art.js 1600x900`. **[verify the required
dimensions and file formats in the portal and regenerate.]**

---

## 4. Certification self-check

What could be checked without portal access, and the evidence for each.

| Requirement | Status | Evidence |
|---|---|---|
| SDK loaded before game code | ✅ | first `<script>` in `<head>` |
| `firstFrameReady` then `gameReady` | ✅ | ordering asserted in `tests/playables.test.js` |
| Cloud save via `saveData`/`loadData` | ✅ | hydrate-once + debounced flush; `saveData` never precedes `loadData` |
| Pause/resume honoured | ✅ | countdown freezes and resumes; asserted |
| Audio follows `isAudioEnabled` | ✅ | YouTube's state gates the in-game mute |
| Responsive, all aspect ratios | ✅ | 18 viewports, 320×568 → 1920×1080 |
| No orientation or posture lock | ✅ | nothing touches the Screen Orientation API |
| State preserved on resize | ✅ | question, score and running timer survive rotation |
| Touch, mouse and keyboard | ✅ | taps, `1`–`4`/`A`–`D`, Enter, Esc |
| Esc closes the results screen | ✅ | regression test |
| Interactive within 5 s | ✅ | 567 ms at 6× CPU throttling |
| JS heap under 512 MB | ✅ | 10 MB during a 30-question round; no leak over 40 rounds |
| No external links, ads or payments | ✅ | none in the source |
| No sign-in required | ✅ | no accounts anywhere |
| Not obfuscated | ✅ | single readable, commented file |
| General audience (13+) | ✅ | see content notes below |
| Works if the SDK never loads | ✅ | standalone path tested three ways |
| Survives an SDK that throws or hangs | ✅ | asserted |
| Behaviour against YouTube's real runtime | ⚠️ | **unverifiable here** — mock only; test in the portal |
| Metadata specs | ⚠️ | **[verify]** — pages unreachable |

### Content notes

300 questions, reviewed for a 13+ general audience:

- No profanity, sexual content, gambling or self-harm references.
- Alcohol references were removed, though nothing suggests they are
  disqualifying — a general-audience title with questions to spare does not need
  the reviewer to make a judgement call.
- History includes the World Wars, the Holocaust diary of Anne Frank and the
  American Civil War, handled factually and neutrally, as school curricula do.
  Flagging in case a reviewer reads them differently.
- Facts that decay were avoided deliberately: no current record holders, heads
  of state or "most X ever" questions whose answer can be overtaken. Where a
  superlative is used it is a settled physical fact (largest planet, deepest
  ocean point).

---

## 5. What still needs you

1. **Apply to the Playables developer programme.** Access is by approval, not
   self-serve, so this gates everything and has an unknown lead time.
2. **Read the certification pages** and settle every **[verify]** above.
3. **Run the bundle in the portal's test harness.** This is the first contact
   with YouTube's real runtime rather than a mock, and is the true verification
   of the SDK integration.
4. **Commit a lockfile.** The npm registry was unreachable here, so no
   `package-lock.json` exists. Run `npm install` locally, commit it, and switch
   the CI workflow from `npm install` to `npm ci`.
