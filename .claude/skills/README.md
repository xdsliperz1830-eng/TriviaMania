# Claude Code skills for this project

Project skills load automatically in every Claude Code session opened on this
repository. Each one was read in full before it was added. Skills are
instructions Claude follows, so treat an update like a code change: read the
new version before copying it in.

| Skill | Source | Version reviewed | Licence |
|---|---|---|---|
| `game-dev` | [Sudhanshu5669/Html5-Gamedev-Skill](https://github.com/Sudhanshu5669/Html5-Gamedev-Skill) | `f547b80` | MIT |
| `mobile-game-dev` | [Ahmad1765/claude-mobile-game-playbook](https://github.com/Ahmad1765/claude-mobile-game-playbook) | `dbc3a0f` | MIT |

- **game-dev**: a discovery interview, then a build loop that does one system
  at a time and checks each in a real browser before moving on. It writes
  `GAME_SPEC.md` and `SYSTEMS.md` when it is used.
- **mobile-game-dev**: rules learned from shipping casual HTML5 games on
  low-end Android phones, covering frame budgets, layout that doesn't jump,
  no emoji in the UI, and testing on the device. `tools/device.mjs` drives a
  game on a USB-connected Android phone over `adb`. It is only needed for
  on-device testing. The skill's one reference to it was changed from "in
  this repo" to "next to this skill file". Nothing else was edited.

## Considered and not installed

- **Claude Code Game Studios** (Donchitos): legitimate, but it is a whole
  project template rather than a skill. It brings its own `CLAUDE.md`, a
  `settings.json` with hooks and a status line, 49 agents (many of them for
  Godot, Unity and Unreal) and 78 skills. Adding it to this finished HTML5
  game was left for a separate decision.
- **A "threejs-game-skills" repository** from the account
  `Oliyflemishspeaking560`: **malware**. Its README tells readers to download
  a `.zip` that contains `Launcher.bat`, `lua51.dll`, `minify.exe` and an
  obfuscated payload, a known password-stealer loader pattern, and the
  skill files around it are copied camouflage. Do not install it. This game
  is 2D, so a Three.js skill isn't needed anyway.
- **"web-game (Skills Hub)"**: no repository could be matched to the name.
  Its stated scope (Phaser, PixiJS and Three.js scaffolding, itch.io
  deploys) doesn't fit this plain HTML game.
