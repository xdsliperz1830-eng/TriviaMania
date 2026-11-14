---
name: mobile-game-dev
description: Rules for building casual mobile games (especially HTML5/Canvas in a WebView via Capacitor, targeting low-end Android) that run smoothly, ship cleanly and don't need rework. Use when starting a new mobile game, adding game features, fixing lag or jank, preparing a Play Store release, or testing a game on a real phone.
---

# Mobile game development playbook

These rules come from building seven casual games for Android with Claude Code (a block puzzle, a mahjong game, a word search, an arrow "tap away" puzzle, a conveyor colour shooter, a goods triple-sort and a word solitaire), all tested on a low-end phone (MediaTek Helio P22, 4 GB RAM, Android 10). Each rule is here because breaking it cost a rewrite, a bug or a lost day. The case studies in this repo have the measurements behind them.

Follow them in order. When a rule doesn't fit the project, say so and why, rather than skipping it silently.

## 1. Day one: decide the permanent things before writing code

- **Check the name in the stores first.** Search Google Play and the App Store for the exact title and close variants. One planned title ("Word Trail") was already used by two apps; finding that after the icon, listing and package id exist means redoing all three. Another ("Arrow Out") was taken four times over, and so were two of the first alternatives: search each alternative too, then let the owner choose among the free ones. The planned title was taken in four games running. Never use a competitor's trademark.
- **Fix the package id / bundle id now.** It can never change after the first upload. Use one namespace per game (`app.<gamename>.game`) so a game can be sold or moved on its own.
- **Create the signing (upload) key now, one per game,** keep it and its passwords out of version control, and tell the user to back both up off the machine. Enrol in Play App Signing.
- **Pick the weakest phone you will support and set a performance budget,** for example: 60 fps idle and at least 55 fps during effects on a Helio P22-class phone. "It runs" is not the bar; "it runs smoothly on the weak phone" is.
- **Build the measurement tools before the features** (section 5). In the first game they arrived in the third rewrite; they were the most valuable code in the project.
- **Keep the toolchain portable.** Point builds at the JDK with `JAVA_HOME` at build time, not a machine-specific path committed in `gradle.properties`.

## 2. Reuse before building

Never start a game or feature from scratch. In order:
1. Code and tools already in this repo or the previous game (copy the whole last project and trim it; don't rebuild its save system, sound, screens or device tools).
2. What the platform and installed libraries already provide (Capacitor plugins, system fonts packages, ImageMagick, Playwright's browser).
3. Only then new code, as little as possible, for the part that is missing or broken. When a reused part misbehaves, replace only that part.

At the start of each new game, list which files and tools it reuses before writing anything. **Reuse the engine, never the look** (see section 3).

Look outside the project too, before drawing, synthesizing or writing content by hand: CC0/MIT assets, sounds, fonts and data (Kenney, OpenGameArt, Fontsource/Google Fonts, dariusk/corpora, official Capacitor plugins). Check each licence in its own file, and record what was used in the DEVLOG and in the game's credits. Real CC0 card sounds replaced synthesized beeps in minutes. In the third game, copying the second one meant the Android setup, saves, sound and device tools worked on the first build, and nearly all new work was the game itself. It worked again in the fourth, fifth and sixth games.

## 3. Design system before screens

- **Give every game its own named design style, chosen before any UI is written** (minimalism, skeuomorphism, claymorphism, pixel art, neo-brutalism, Art Deco, Swiss, Memphis, Bauhaus, paper cut-out…), and write its page from scratch in that style: typeface, palette, shapes, HUD, home layout, textures. After five games copied from each other, the owner's verdict was "way too similar to each other" and "way too ai generated". The tells were one font everywhere, cream rounded cards with soft shadows, the same pause-title-badge header and the same hero-plus-stacked-buttons home. Pick from a wide catalogue of named styles (minimalism, flat, material, dark mode, bento grid, aurora, glassmorphism, neumorphism, claymorphism, neo-brutalism, Gen Z maximalism, Bauhaus, Memphis, collage, Y2K, synthwave, retro-futurism, cyberpunk, pixel art, steampunk, vintage analog, typography-centric, hand-drawn, E-ink, biophilic, Japandi and wabi-sabi…), a different one per game. What reads as AI-made is the generic soft-gradient card template, not any one named style.
- **Soft-shadow styles (claymorphism, neumorphism) are fine on a weak phone if every blur is static**: bake shadows into cached images or static CSS, never animate them.
- **adb input lands about 0.9 s after the command**: on-device tests of timed gestures (press and hold) must wait for the effect, not a fixed delay.
- **A UI element that comes and goes must keep its space** (visibility, not display none), or it resizes the play area and shifts the board under the finger. Scope selectors to one element. Never use overflow-wrap: anywhere on display text (it splits words); size the type down. Font names in inline SVG must match the page's @font-face name.
- **After swapping a game's fonts, search the whole web folder for the old font's name.** A boot step that waited for the removed font survived in three games, so pages showed before their real fonts loaded.
- **Trim sound packs for rapid events.** Most pack sounds are 0.3–1 s long; cut short versions (ffmpeg `-t 0.09` with a fade) for anything that fires several times a second.
- **Player-made levels need the same guarantees as built-in ones**: an editor that cannot produce an illegal level, full validation of shared codes, and a test that builds and solves random player creations.
- **Every game needs a selling point no rival has** (in the word solitaire: a note on why each group fits, deals written for a friend, a shareable daily grid). Propose it to the owner, get it approved before building, and lead the store listing with it.

- **Art direction, colour tokens, an icon set and a small component kit (buttons, cards, modals, rows) come first.** Every screen is then assembled from the kit. The first game shipped about 15 screens built ad hoc and had to rewrite every one.
- **No emoji in the UI, ever.** They are fonts that differ by Android version and phone maker (a calendar emoji showed a date, a coin looked like a bank). Use an inline SVG icon set.
- **Design for the short screen first** (about 360×620 CSS px once a banner ad is there), not a tall desktop viewport.
- **Check the phone's system text size at 1.15× and 1.3×** before calling any screen done. WebView scales CSS text with it (canvas text is not scaled), so lists grow, titles wrap and the game area shrinks. This found layout bugs in both of the last two games that desktop testing never showed.
- **Messages and banners must not resize the play area.** Show helper text as an overlay; a message that pushes the board up makes it jump under the player's finger.
- **When JS shrinks text to fit, set the size in `em`, not px.** Android WebView's text zoom scales px sizes again (15.8px became 20.5px at 1.3×), so the shrink undoes itself. Wait for the fonts you actually use before measuring, and measure again on `document.fonts.ready`.
- **Preview art at the size it will really be seen,** and against what will be behind it, every time the art changes. An icon detail that reads at 1024 px can hide a letter at 48 px; a navy stamp disappears on a navy cover; a white flower vanished on a cream card at launcher size.
- **Keep the in-game title to one short item.** Compound titles ("Level 30 · Sunflower bed") truncated at 1.3× text in two games.
- **In a colour-matching game, never fade a colour to mean "inactive" or "next".** A half-transparent brown token read as beige, which was a real colour in the game. Make inactive items smaller instead.
- **Lay out for the item size first.** Three shelves per row left 30 px items on a 360 px phone; two per row gave 52 px and still fit nine shelves on a short screen.
- **Icons sit inside their box with margins.** When composing store art, size the box so the visible art is the size you want (a donut that fills 65% of its box came out a fifth of the shelf). Give SVGs an intrinsic `width`/`height`, or canvas `drawImage` uses a 300×150 default box.
- **Picture-shaped boards need their outline drawn.** With only empty cells marked, a tree-shaped board looked like random pieces.

## 4. Rendering rules for Canvas in a WebView

On a weak GPU, JavaScript was under 3% of CPU time; the lag was all painting and uploading pixels.
- **Redraw only when something changes.** No permanent `requestAnimationFrame` loop. Use a dirty flag and draw once per change.
- **Layer it:** a static canvas for the board (cache anything that doesn't move, such as the frame, card or letters, in offscreen canvases), and a separate effects canvas that animates only while something moves and is hidden when empty.
- **Moving things are compositor transforms:** a dragged piece is its own small element moved with `translate3d`; screen shake and "pop" effects are CSS transforms. Never animate `width`, `top`, `left` or text content every frame. This holds for continuous motion too: up to five DOM tokens moved by `transform` every frame, plus pooled projectile elements animated with the Web Animations API, ran at 59.8–60 fps on the weak phone with four shooters firing at once.
- **Never read layout inside a frame loop or a pointer-move handler** (`getBoundingClientRect`, `innerWidth`, `offsetWidth`). Read once per layout, or once per gesture, and cache. One confetti loop caused about 70 forced layouts per frame.
- **No full-screen animated canvases, no `shadowBlur` per frame.** Bake shadows and text into sprites once. A full-screen confetti canvas re-rasterised the whole page every frame.
- **A DOM board is fine on a weak phone if it is built once and patched.** Rebuilding every cell's HTML on each move, with SVG `<img>` items, cost 46 fps in a burst of moves: every new SVG image is decoded and rasterised again, and again at each new scale. Update only the cells that changed, and rasterise SVG art to PNG once at start-up (58.7 fps, worst frame 33 ms).
- **Don't create dozens of animated DOM elements at once** (36 animated confetti divs cost 110–180 ms in one frame: one GPU layer each).
- **Watch for size changes the window doesn't announce** (an ad banner loading) with a `ResizeObserver` on the play area. Missing this squashed the board and made drops land in the wrong place for three versions.
- **Cap devicePixelRatio at 2.**
- **Defer saves and bookkeeping off the frame where the player's action lands** (save about 500 ms later, and immediately when the app goes to the background). If the debounce checks `if (!timer)`, reset the timer id to 0 wherever it is cleared; otherwise it never schedules again and progress is saved only on backgrounding (a resume test caught exactly this).
- **Effects can outlive the state they draw.** A 300 ms animation still running after the player quits must not read game state that is now gone. Keep geometry the effects need outside the game-state object, and guard input handlers against a quit mid-gesture.
- **Time the work that runs when a screen opens, not just animations.** Generating a puzzle took 210 ms at worst on desktop, which is a visible freeze on a weak phone; one fix made it 8× faster. Measure generation and layout, not only fps. As a calibration, a Helio P22 ran one generator about 4× slower than a desktop, but measure it on the device rather than assuming.

## 5. Measure on the real phone

- **Desktop Chrome is not evidence.** Attach to the game's WebView on the phone over USB: `adb forward tcp:9223 localabstract:webview_devtools_remote_<pid>`, then Playwright `chromium.connectOverCDP('http://localhost:9223')`. A small script can then evaluate JS in the page, sample `requestAnimationFrame` intervals (fps, % of frames over 20 ms, worst frame) while an action runs, and take screenshots (`adb exec-out screencap -p`). See `tools/device.mjs` next to this skill file.
- **Add a debug hook (`window.__dbg`) that triggers each effect on demand** (a line clear, a win, confetti, a hint) so each can be measured alone. Strip it from release builds with a script that fails loudly if it can't find it.
- **Change one variable per measurement.** One early test board was empty, so every "line clear" was really a "board clear with confetti", and the numbers pointed the wrong way. Set up the state *before* the sampling window starts: starting a level inside it made level generation look like a 399 ms animation stall.
- **Measure the worst frame per kind of event** (plain move, pop, pop that brings in a new layer), not only per burst. It points at the guilty event at once.
- **Find causes with traces, not guesses:** switch features off one at a time on the device, and use the Chrome `Tracing` domain to count forced layouts and paints.
- **Test with the real ad banner loaded** once ads exist. Desktop tests have no banner.
- **`adb screencap` lags about a second.** To see something fast-moving, capture in parallel with the action, and query the DOM before concluding that something doesn't render.

## 6. Architecture

- **Keep the rules pure and tested** (`logic.js`: no DOM, deterministic, seeded random numbers). Every rewrite of rendering and UI in three games left the rules untouched and their tests still passing.
- **For games with a running simulation, write it once and share it** between the game, the solver, the tests and the bot: pure `send()`/`tick()` functions, with `tick()` returning events (shot, left, parked, won) that the renderer animates. Events must carry the objects they describe; an object that left the simulation in the same tick can't be looked up afterwards.
- **An identical stats table before and after a speed-up is a free equivalence test.** Print level statistics in the logic test; if an optimisation changes any number, it changed the game.
- **One source of truth for geometry,** used by the renderer, the hit test, the effects and the test bot. A bot that copied the layout formula broke every time the layout changed.
- **Tests read game state, not saved data.** Deferring saves made a bot that read `localStorage` miscount.
- **Record wins and unlocks the moment they happen,** not after the celebration; a player who quits during the confetti must not lose the level.
- **Separate save slots per mode** (journey vs. daily), so starting one never erases the other.
- **Validate generated content automatically.** For procedural levels: thousands of seeds, each checked for solvability and fairness (every level solvable; every hidden word readable in exactly one place; no offensive words in random filler). For written content: spell-check every word against a dictionary and fail on typos. A spell-check of 2,290 hand-written words caught 8.
- **Prefer generators that are correct by construction, and test them anyway.** Reverse play (add each piece only where removing it is legal at that moment) makes every level solvable; the test still solves 1,000 levels and checks every piece's shape. While tuning, print generated levels as ASCII: fill, sizes and holes show at a glance.
- **Prove the rules' safety properties before designing help.** In the arrow game, "any free arrow is always a safe move" meant hints, the tutorial and the fail message needed no solver at run time, and a player could never get stuck.
- **Hand-written content needs written rules and a test.** In the word game: one category per word across the whole bank, no word that genuinely fits two categories (kiwi is a fruit *and* a bird), categories that overlap by nature never dealt together, everything spell-checked against a dictionary. Codes that players share are outside input: validate everything on decode.
- **An SVG drawn as an image (on a canvas, as an `<img>`, or exported) needs `xmlns` and an intrinsic `width`/`height`.** Inline SVG needs neither, so it works on screen and fails silently on export.
- **Text-to-speech in a WebView app needs a native plugin** (Android's WebView has no `speechSynthesis`). Check the installed voices and tell the player when one is missing.
- **Show progress as a picture that grows** (a pond, a garden, a shopfront) rather than a number, and cap its catch-up animation so a long absence never means a long wait.
- **Make an accessibility mode one tap away** (a HUD button, not only a setting): bigger tiles, high contrast, colour per suit and free match highlighting sell to players other games leave behind.
- **A debug build won't install over a release-signed copy** (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`); uninstalling first clears that phone's save.
- **Trial an outside library against the feature before building on it**: time it on the target, check its coverage on your own inputs, and check its output carries what the feature needs. Record why one was rejected.
- **For logic puzzles, a solver that uses only sound human techniques** grades difficulty, proves a unique answer when it finishes, and yields explainable hints. Ship only puzzles it finishes; test soundness by replaying every step against the answer.
- **Turn solver steps into hints a person can follow**: merge runs of the same idea, summarise long chains, cap the length and test the cap.
- **Precompute in a shipped pack when on-device work at a screen's opening passes about 50 ms.**
- **Store screenshots from `adb screencap` include the status bar and its notification icons**: crop the system bars off.
- **Museum open-access APIs (for example the Met's) are a rich source of public-domain art.** If a server answers scripts with a bot check, use another source rather than working around it.
- **For shortest-solution searches, use A* with a cheap admissible bound**, not breadth-first search; re-solve a sample in the tests to keep par provably optimal.
- **Reject impossible pieces when generating** (check each piece alone on the empty board) instead of discovering unsolvable levels at solve time.
- **Seed offline builds per item** so they can run on every core and still give the same file.
- **Lay out decorative compositions in proportions of their box, keep text in the flow, and never leave vertical text in the flow.**
- **Crop store screenshots by the measured system-bar insets**, not a fixed amount: some apps hide the navigation bar.
- **After copying an engine, list the modules nothing imports and delete them.**
- **Start each game as a fresh project and take only ideas from earlier ones.** Copying a previous game's folder, even just the engine, carries dead code and makes games look alike.
- **Look for state that follows from the rest** (in a bus sort, the street follows from who has left), and keep an explicit event version for the screen, tested to agree.
- **Tie queued animations to the game that queued them**, and act on captured elements, not later lookups. Run the regression several times in a row to catch races.
- **Cancel an element's old animations before placing it again**: WAAPI `fill: 'forwards'` keeps the end frame.
- **Put static gradient backgrounds on their own layer** (`transform: translateZ(0)`) on low-end GPUs: anything moving over them re-rasters them otherwise.
- **When frames are slow but the main thread is quiet, record a Chrome trace over DevTools** and total the time per thread and event: it shows GPU raster that no amount of JS tuning will fix.
- **Generators that are solvable by construction need a proven invariant** (bound the worst case of finishing what is open, not just the current load); ship the construction order and replay it in the tests.
- **Measure difficulty with a reasonable player**, not a random one: a player that never plans measures nothing on harder content.
- **Never let a press-and-hold gesture swallow a slow tap** where the gesture doesn't apply.
- **Take real-world facts from open data (for example Wikidata, CC0), never from memory**: query by name and type, prefer the preferred-rank value, leave out values that change, and show only the data and arithmetic on it.
- **Store calendar days with the device's local date**, not `toISOString()` (UTC gives yesterday in the small hours).
- **Render heavy vector art once at build time** into small PNGs instead of shipping it.
- **Check every claim in the store listing against the code** before writing it.
- **Look for a closed form before adding a physics engine**: if bodies only come to rest in a few ways, make the poses a table that the game, solver and tests share, and animate the motion instead of simulating it.
- **Reject knife-edge levels at generation** (geometry within a margin of changing an outcome), and check a little inside the test's limits so rounding stored numbers can't cross them.
- **Draw small canvases onto a board as `ImageBitmap`s** (`createImageBitmap`), or the GPU may receive them again every frame.
- **Ignore the first frame of any FPS window started over DevTools**: it is long whatever the page does. Use an idle lead-in.
- **Online for a turn-based game: one phone referees.** The host runs the rules and rolls every die; the others only send requests the host checks, and draw what it sends. Supabase Realtime broadcast + presence works with no tables or accounts.
- **Assume a broadcast can be missed**: send whole states, re-send every few seconds, and keep the receiving queue alive past a failing step.
- **Treat every message from another phone as outside input**: rebuild received state field by field, and test with an outsider sending garbage and forgeries.
- **Ask the owner before adding a server**, naming what changes: account and cost, privacy policy, Data safety form, the "offline" claim.
- **Clamp animation elapsed time at zero**: a `requestAnimationFrame` timestamp can precede a `performance.now()` read taken just before.
- **Real places from OpenStreetMap**: one cached Overpass request per area, pauses, no retry loop, "© OpenStreetMap contributors" wherever the map shows; drop an area with poor coverage rather than invent it.
- **Test a growth game's size ladder**: food at once for a new player, something at every size, and the biggest thing reachable.
- **Tie every animation loop to its round**, and check measurements don't drift from round to round (a duplicate loop skews them all).
- **Render flat art at CSS pixels on low-end GPUs** when a full-screen canvas at 2x is the cost.
- **Simulate an idle economy with a decent player before any visuals**, and treat a stuck simulated player as a design bug (full hands with nowhere to put things; auto-pickups you did not want).
- **Draw a paused scene once**, not every frame under the modal.
- **Check a device test's own inputs before blaming the game**: adb ignores a swipe with a fractional duration; a game's autosave can overwrite a test's setup.
- **Plan for content updates after launch.** If puzzles are derived from content lists by shuffling, adding items reshuffles every existing puzzle. Use an order that stays stable when items are appended, and guard saved in-progress state against content that has changed under it.

## 7. Test like a player, on the device, after every change

- **Keep an on-device regression script** and run it after every change: it drives the running app over CDP, uses real touch input where it matters (`adb shell input swipe/tap` at coordinates from the engine's own geometry), and asserts game state.
- **If the phone isn't available, write the device regression anyway, plus a desktop smoke script that drives every flow and reports page errors.** The smoke script caught one crash; the regression caught two more bugs within minutes of the phone being connected.
- **Anything a re-render rebuilds must be re-applied by the render itself.** A tutorial highlight vanished on the phone when a `ResizeObserver` re-render fired after the first layout; desktop timing hid it.
- **Never take screenshots with a share sheet open**: it shows the owner's contacts.
- **Fail the run on any page error,** not only on failed assertions. That check caught a crash manual play would almost never hit.
- **Relaunch the way a person leaves:** press Home, then kill the process. On Android WebView, `localStorage` written less than about 1 second before a hard kill in the foreground can be lost; going to the background flushes it.
- **Write down where every wait in a test comes from** ("700 ms celebration + 1300 ms petals"). A guessed wait of 1.9 s for a card that opens at 2.0 s made a correct game look broken.
- **Check full-screen / edge-to-edge on the real phone.** On Android 10, Capacitor 8's system-bars inset listener reported a 0 px bottom inset, putting buttons under the navigation bar; the fix was one replacement inset listener in `MainActivity`.

## 8. Game design and scope

- **Ship in slices, each checked on the phone for function and frame rate:** game feel first, then progression (journey/levels), then a daily puzzle, then everything else. One version added seven retention systems at once (four of them "come back daily"), which was too much for a new player to parse.
- **Design the reward loop before ads exist** (what hints cost, how they're earned) so rewarded ads plug in later without changing the rules. Close farming loopholes (restarting a level must not re-earn rewards).
- **Offer an alternative to the hard gesture** (tap first and last letter as well as swiping; tap to select as well as drag). Many players, especially older ones, struggle with precise swipes.
- **"The solver wins" proves a level is fair, not that it is a puzzle.** Also measure how often a *random* player wins, and tune difficulty on that number. One game passed every solvability test while a random player won 99% of levels. In sort games, where random moves never build a match, a purely random player wins nothing at all; measure with a *careless* player instead (half greedy moves, half random).
- **Find the structural cause before sweeping knobs.** Sweeping ammo, capacity and shuffle barely moved that 99%. The cause was the content: every colour touched the picture's edge, so any move was useful. Fixing the content (full-square pictures with a background colour) made one knob work.
- **Before writing a "never stuck" rescue, prove exactly when a position is dead.** In the sort game, "no free slots" was not the whole rule: with one or two free slots and no type three times up front, nothing could ever pop. With the exact rule the rescue was a few lines and always possible. Give the greedy solver cycle protection too (a repeated state counts as stuck), so the test always ends.
- **Never let a player get permanently stuck** (a shuffle that always succeeds, a guaranteed-solvable deal).
- **Get real players early.** Difficulty and economy tuned by judgement alone are guesses; a few closed-test players are worth more than more polish.

## 9. Working habits for Claude Code

- **Make code changes with the editor tool or small script files, not long `sed`/heredoc one-liners.** One-liners broke twice in the first game (a quoting error, and a slice that deleted the line starting the render loop).
- **Patch scripts that put code inside JS strings can lose escapes:** `\.` became `.`, and a regex `/./g` replaced every character. Prefer plain string methods (`replaceAll`) in patches, and run the tests right after.
- **On Windows, don't patch files with Python text-mode writes:** they convert line endings to CRLF, which broke a release script's pattern match. Use the editor tool or Node.
- **Watch for empty stray files named after code fragments** (`{let`, `!g)`, `setTimeout(r`). In one setup a hook passed tool input through `cmd.exe`, which treated `>` (from `=>` in code) as a redirect. In a web game's asset folder they ship inside the app. Make the release script refuse to build if the asset folder contains empty files, and delete them when found. In one session 20 appeared, and the release guard stopped one shipping. Sweep the whole project before each release, and prefer the editor tool over `node -e` one-liners, whose `=>` triggers it.
- **Release scripts should fail loudly** when something they expect is missing (the debug hook to strip, the signing config). Two such checks caught real problems.
- **Verify every number before writing it into docs** (counts, sizes, timings); re-run the command rather than recalling it.
- **Keep a DEVLOG per game:** decisions, measurements, bugs found and how, process problems with the guard added for each, commands, and what is deliberately not done yet. Read the previous game's DEVLOG before starting the next one.
