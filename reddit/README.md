# Brain Blast for Reddit

The Reddit version of Brain Blast, as a [Devvit Web](https://developers.reddit.com/docs)
app. It is the same game as `../index.html`: the build copies it into this
app and plugs in a Reddit layer, so there is one game to maintain.

What Reddit adds:

- **A launch card in the feed** (`public/splash.html`). Play opens the full game.
- **A server-run Daily Challenge.** The server picks the day's ten questions
  (one per category, the same for the whole subreddit, turning over at midnight
  UTC), hands each out only when it is shown, and scores every answer on its
  own clock. One scored try a day.
- **Leaderboards**: today, this month (with an optional prize line), and Block
  Blitz. Opened from the Best chip on the home screen.
- **Saves on the server**, so progress follows a player between devices.
- **A daily post** at 00:05 UTC with the new challenge (a subreddit setting).
- **Moderator tools** in the subreddit menu: a new game post, and the contest
  standings for this month and last, with checks for each top player.
- **"Delete my data"** in the subreddit menu, for any player.

Logged-out visitors can play everything; their Daily Challenge runs on their
device and is not scored, and the leaderboard asks them to log in.

## Commands

```bash
npm ci            # here, and `npm ci` one folder up for Playwright (tests only)
npm run build     # sync the game in, bundle the client and the server
npm test          # build, type check, server tests, then the game in Chromium
npm run playtest  # devvit playtest: run it on a test subreddit (needs `npx devvit login`)
npm run publish-app
```

## How it fits together

```
../index.html ──scripts/sync-client.mjs──> public/game.html + game.css + game.js
                                           public/assets, public/lang
                                           src/server/bank.gen.ts (question ids per category, scoring rules)
src/client/platform.ts ──esbuild──> public/platform.js   (defines window.BrainBlastPlatform)
src/client/splash.ts   ──esbuild──> public/splash.js
src/server/index.ts    ──esbuild──> dist/server/index.js
```

The game looks for `window.BrainBlastPlatform` before falling back to its
YouTube layer. `platform.js` is loaded first, so the game uses it: saves go to
`/api/progress`, the Daily Challenge to `/api/daily/*`, the leaderboard to
`/api/leaderboard`. The hooks are documented in `../index.html` above the
`Platform` module.

The build moves the game's style and script out of the page into their own
files, because Reddit's web views run under a content security policy.

### Server

| Endpoint | What it does |
| --- | --- |
| `GET /api/init` | Who is playing, the server's day and clock, their save |
| `POST /api/progress` | Save progress (logged in, up to 100 KB) |
| `POST /api/daily/start` | Start today's round, or report it was already played |
| `POST /api/daily/next` | The next question, timed from now |
| `POST /api/daily/answer` | Score an answer (index into the question's answers; -1 = time up) |
| `GET /api/leaderboard?board=day\|month\|blitz` | Top ten, this player's rank, the prize line |
| `POST /api/blitz` | A finished Block Blitz game (keeps each player's best) |
| `GET /api/splash` | Players today and this player's score, for the launch card |

`/internal/*` endpoints serve the menu items, forms, scheduled jobs and the
install trigger (see `devvit.json`).

Redis keys: `round:<day>:<user>` (today's round), `lb:day:<day>`,
`lb:month:<yyyy-mm>`, `lb:blitz` (sorted sets), `stats:<yyyy-mm>:<user>`
(points, days, answer time, fast answers), `save:<user>`, `names`,
`results:<yyyy-mm>` (frozen at the month close), `secret` (seeds each day's
questions; never sent to players).

### Scoring and fairness

The server uses the game's formula: 100 points, up to 50 for speed, up to 50
for a streak, with a 15-second limit. 600 ms of each answer's time is forgiven
for the round trip, and an answer more than 2 s late is a time-out.

The monthly board ranks by total Daily Challenge points, then more days played,
then less total answer time. Block Blitz has its own board for fun; its scores
come from the player's device and are not used for anything else.

The question bank ships to the browser (each player reads the questions in
their own language from it), so answers can be looked up by someone determined
to. The server's clock limits that, and the moderators' standings flag what
looks wrong: answers under 1.2 s, an average under 2 s, accounts under 30 days
old. A moderator should check those before announcing a winner.

## Settings (per subreddit)

- **Post a new Daily Challenge every day** (on by default).
- **Monthly prize line**: shown above the This month board and on the launch
  card. Leave it empty for no prize.

## To check on a real subreddit

These can only be confirmed with `npm run playtest`:

- the game's embedded `data:` fonts load under Reddit's content security policy;
- the daily post job finds the subreddit in its context;
- the review package picks up `../index.html` and `../lang` (`additionalSourceRoots`);
- the launch card loads in under a second in the feed.
