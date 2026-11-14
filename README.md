# Brain Blast

A fast-paced HTML5 trivia game built for YouTube Playables. Everything — markup,
styles, game logic, question bank and sound engine — lives in a single
self-contained `index.html`, plus the icon images in `assets/icons/`. No backend,
no build step, no accounts, no external requests, so it runs offline once loaded.
The launcher icons and the web app manifest are the only other files, and nothing
at runtime reads them.

**Play:** open `index.html` in any modern browser.

It runs in two places from the same file: as an ordinary web page, and inside
YouTube as a Playable. The YouTube Playables SDK is loaded first and wrapped in a
`Platform` adapter; outside YouTube that request simply fails and the game runs
standalone, saving progress to `localStorage` instead of the cloud.

## Modes

The home screen has two tabs, **Quiz** and **Block Blitz** (marked NEW), and one
Play button that starts whichever is selected. The last tab used is remembered.
The best-score chip in the corner follows the tab: the quiz best for the chosen
length, or the Block Blitz best.

### Daily challenge

Opened from the calendar button in the top bar, beside the music and sound
buttons. A red dot on the button shows until today's challenge is played. The
button opens a card with the day streak, the longest run and today's score, and
its own Play button.

The same ten questions for every player on a given day, one from each category.
There's no server: the local date seeds a small PRNG (`buildDailyRound`) that
picks the questions and shuffles them and their answers, so the challenge turns
over at the player's midnight. Each day gets one scored try. Playing on
consecutive days builds a **day streak**, and a missed day resets it to zero,
though the longest run is kept. The daily round doesn't touch the quiz's
rotation history, and the day is fixed when the round starts, so a round that
crosses midnight counts for the day it began.

### Block Blitz

A puzzle mode. The board is a stack of blocks, each one a category, shown by
its colour and icon. Each game uses five random categories.

- Tap a block to pick its whole connected group, then answer a question from
  that category. A right answer blasts the group for size² × 10 points,
  multiplied by the answer streak (up to ×2), and the blocks above fall.
- A wrong answer or a timeout pushes a new row up from the bottom. A row also
  rises every few answers regardless: every 4 at first, one answer sooner for
  every 8 correct, down to every 2. The label and the board's edge warn one
  answer ahead. The game ends when the stack reaches the top.
- **Bombs:** every fifth answer in a streak earns one, up to three. Arm it
  (button or `B`) and tap a block to blast its whole row, with no question.
- **Lucky Block:** a rising row sometimes carries one. Answering its question
  blasts every block of one category on the board.
- Clearing the board scores a 500-point bonus and refills it.

The board picks 8–11 rows to suit the screen. In landscape, the question panel
sits beside the board instead of over it.

## Quiz

- **Pick your round length** — 5, 10, 20 or 30 questions — from the picker on
  the home screen. The choice is remembered between sessions.
- 15 seconds per question, drawn from a bank of **900 questions** — 90 in each
  of the 10 categories.
- Pick a single category or **Mixed Blast**, which spreads the round evenly over
  the categories: 10 questions means one from each, 20 means two, and a length
  that does not divide evenly gives the remainder to whichever categories come
  up first in the shuffle.
- **Questions rotate.** A round always draws questions you have not been asked
  yet, so playing the same category three times in a row at 10 questions gives
  30 different questions. Only once a category is used up does the cycle restart
  and mix in earlier questions. Progress is stored in `localStorage`, so it survives a
  reload, and category play and Mixed Blast share the same history.
- Category cards show what is left — `90 questions`, then `80 new of 90`, then
  `all 90 seen`.
- Answer choices are reshuffled every round, so the correct answer never sits
  in a predictable position.
- **Best scores are kept per round length**, since a 30-question round scores
  roughly three times a 10-question one. Switching length shows that length's
  own record.
- Scoring: **100 points** per correct answer, up to **+50** for answering
  quickly, and up to **+50** more for a streak (+10 per consecutive correct).
- The countdown ring turns yellow at 5 seconds and red at 3, with a matching
  audio tick. Running out of time reveals the answer and breaks the streak.
- Results show the final score, correct count, accuracy, best streak, a
  performance message and a per-question recap. Best scores are kept in
  `localStorage`.

**Controls:** tap or click a length and a category, then Play; tap or click an
answer; `1`–`4` / `A`–`D` also work, `Enter` or
`Space` advances, `Esc` quits to the home screen (or closes the daily
challenge card). The arrow keys switch the home tabs. In Block Blitz they move between blocks, `Enter` picks a group, `B` arms a
bomb and `Esc` disarms it or quits. Sound can be muted from either
the home or quiz screen, and the preference is remembered.

**Music:** an upbeat looping tune plays from the first tap: bass, chord stabs
and a melody on the home screen, with a drum kit joining in during a round. It
is synthesised live with Web Audio from note lists in the `Music` module, so
there are no audio files and nothing to license. The 8-bar loop is about 16
seconds, and the melody alternates with an arpeggio on alternate passes so it
does not wear thin. It sits about 8 dB under the sound effects. The note
button on the home screen turns the music off on its own, and that choice is
remembered. The speaker button (and YouTube's own audio setting) silences
everything. The music pauses while the tab is hidden or YouTube pauses the
game. On iPhone, the ring/silent switch also silences web audio.

## Tests

```bash
npm ci
npx playwright install chromium
npm test                 # all suites
npm test -- rotation     # one suite by name prefix
```

Thirteen suites in `tests/` drive the real page in a headless browser: gameplay,
question rotation, round length, geography balance, picker layout, an
18-viewport layout sweep, regressions for previously fixed defects, the launcher
icons and manifest, the background music, Block Blitz, the daily challenge (on a
fixed clock), the YouTube Playables integration (against a mock `ytgame`,
since YouTube is not reachable from a test runner), and performance against the
published Playables limits under CPU throttling. They run in CI on every push
and pull request.

## Building for submission

```bash
npm run build      # -> dist/brain-blast-playable.zip (545 KB)
npm run art        # -> art/ store key art and listing tiles
npm run icons      # -> icons/ launcher icons and favicons
npm run questions  # -> dist/brain-blast-questions.csv, the whole bank for review
```

The build checks the bundle against every Playables size cap, then launches the
built file and plays a round before declaring it ready. See
[`docs/SUBMISSION.md`](docs/SUBMISSION.md) for the metadata, art inventory and
certification self-check, and [`docs/PLAYABLES_PLAN.md`](docs/PLAYABLES_PLAN.md)
for how the game got here.

## Look and feel

The "Toybox" theme is built to match the icon pack. Every card and button has
the icons' dark navy outline (`#040335`), a solid drop underneath and a light
bevel, and the palette (gold, orange, red, green, blue) is sampled from the
icons themselves. The theme is the last block in the `<style>`, after the base
layout rules, and its colour tokens are on `:root` at the top of that block.

The top of the background is a flat `#2F48C7`, the same value as the
`theme-color` meta tag and the manifest's `theme_color`, so the phone's status
bar (and any app chrome around the page) blends in with no seam. Change all
three together.

Text is set in **Lilita One** (headings, scores, buttons) and **Nunito**
(questions and body), both under the SIL Open Font License; the licence texts
are in `assets/fonts/`. The fonts are embedded in `index.html` as data URIs
rather than linked, because browsers refuse font files over `file://`, and
inline keeps the game a single file with no extra requests.

## In-game icons

The category, HUD, feedback and results icons are from gvesster's Free Icon
Pack, used under its licence. [`assets/icons/CREDITS.md`](assets/icons/CREDITS.md)
lists each file, its source icon and where it is used. Only the icons the game
uses are committed, never the whole pack, because the licence forbids
redistributing it.

## The app icon

Added to a phone's home screen, the game installs as a standalone app. The mark
is a brain with a lightning bolt through it, authored as vector geometry in
[`tools/logo.js`](tools/logo.js) and rasterised by `npm run icons` into
`icons/` — a 180 px `apple-touch-icon` for iOS, 192 and 512 px icons plus a
maskable 512 for the Android manifest, and 16/32 px favicons that drop the brain
and keep only the bolt, which is all that survives at that size.

It is deliberately not the store art in `art/`: that is a listing tile with a
wordmark on it, and at roughly 48 px the words are unreadable and its emoji
renders differently on every platform.

`tests/icons.test.js` reads the pixels back out of each PNG, so an icon that
silently fails to render — or a mark that drifts outside the circle Android may
crop a maskable icon to — fails the build rather than shipping.

## Adding questions

The question bank is a plain array near the top of the `<script>` block. Append
an entry — the **first answer is always the correct one**, and the options are
shuffled at runtime, so authoring order never leaks into the game:

```js
{ c: "science",                                   // category key from CATEGORIES
  q: "Which gas do plants absorb from the air?",  // the question
  a: ["Carbon dioxide", "Oxygen", "Nitrogen", "Hydrogen"],   // correct answer first
  e: "Plants take in carbon dioxide during photosynthesis." } // shown after answering
```

New categories go in the `CATEGORIES` map (key, display name and the file name
of an icon in `assets/icons/`, without `.png`; add it to `ICON_NAMES` too);
the home screen grid and question counts build themselves from it.

Rotation needs no bookkeeping: each question is identified by a short hash of
its text, so adding, removing or reordering questions never disturbs a player's
saved history. Ids belonging to questions that have been edited out are dropped
the next time progress is loaded.

When adding questions, watch the spread of *topics* within a category, not just
the count — a category where a third of the questions ask the same kind of thing
(capital cities, say) feels repetitive long before the pool runs out.

## Layout

The game adapts between portrait and landscape. In portrait the question card,
answers and explanation stack; in landscape the question sits beside a 2×2 answer
grid with the explanation across the bottom, so a phone held sideways never has
to scroll. Layout was verified against 18 viewport sizes from 320×568 up to
1920×1080.
