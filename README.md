# Brain Blitz 🧠⚡

A fast-paced HTML5 trivia game built for YouTube Playables. Everything — markup,
styles, game logic, question bank and sound engine — lives in a single
self-contained `index.html`. No backend, no build step, no accounts, no external
requests, so it runs offline once loaded.

**Play:** open `index.html` in any modern browser.

## Gameplay

- 10 questions per round, 15 seconds each, drawn from a bank of **100 questions**
  across 10 categories.
- Pick a single category or **Mixed Blitz**, which pulls one question from each
  category so every round covers all ten.
- Questions and answer choices are reshuffled every round.
- Scoring: **100 points** per correct answer, up to **+50** for answering
  quickly, and up to **+50** more for a streak (+10 per consecutive correct).
- The countdown ring turns yellow at 5 seconds and red at 3, with a matching
  audio tick. Running out of time reveals the answer and breaks the streak.
- Results show the final score, correct count, accuracy, best streak, a
  performance message and a per-question recap. Best score is kept in
  `localStorage`.

**Controls:** tap or click an answer; `1`–`4` / `A`–`D` also work, `Enter` or
`Space` advances, `Esc` quits to the home screen. Sound can be muted from either
the home or quiz screen, and the preference is remembered.

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

New categories go in the `CATEGORIES` map (key, display name and an emoji icon);
the home screen grid and question counts build themselves from it.

## Layout

The game adapts between portrait and landscape. In portrait the question card,
answers and explanation stack; in landscape the question sits beside a 2×2 answer
grid with the explanation across the bottom, so a phone held sideways never has
to scroll. Layout was verified against 18 viewport sizes from 320×568 up to
1920×1080.
