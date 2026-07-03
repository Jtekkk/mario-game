# CLAUDE.md — working on BOLT

BOLT is an original browser platformer (a 10-level campaign). It is **plain
HTML5 Canvas + vanilla JavaScript, no build step and no dependencies** — open
`index.html` (or serve the folder) and it runs. Everything is original; the
project began as a study of how an 8-bit platformer is engineered (see
`docs/LEARNINGS.md`), rebuilt from scratch.

## Run it
- Open `index.html` directly, or `python3 -m http.server` then visit it.
- Scripts load as classic `<script>` tags in a fixed order (see `index.html`);
  each module attaches one global (`Art`, `Sfx`, `Input`, `Powerups`, `Level`,
  `PlayerNS`, `Enemies`, `Game`). Order matters — `powerups.js` before
  `player.js`, everything before `game.js`.

## Module map
| File | Owns |
|---|---|
| `js/pixel.js` | `Art`: sprites authored as char-grids, baked to offscreen canvases |
| `js/sound.js` | `Sfx`: a tiny WebAudio blip/noise synth (no audio files) |
| `js/music.js` | `Music`: one looping MP3 per level from `assets/music/` (HTMLAudioElement; handles autoplay-block retry on first gesture; `playFor(i)` is idempotent so retries don't restart the song) |
| `js/input.js` | `Input`: keyboard + gamepad + `setAction()` for touch; held / justPressed / justReleased edges |
| `js/powerups.js` | `Powerups`: the 10 abilities' metadata (`POWERUPS`), order, tuning (`PWR`), and `freshPower()` initial state |
| `js/level.js` | `Level`: the 10 `LEVELS`, `THEMES`, `BOSSES`, `parseLevel()` + tile helpers |
| `js/player.js` | `PlayerNS.Player` + `PHYS`: movement, the charged jump, and physics-power hooks (heli/pig/dash/shield) |
| `js/enemies.js` | `Enemies.Enemy` (crawler/hopper) and `Enemies.Boss` |
| `js/game.js` | `Game`: the loop, camera, all rendering, level progression, inventory, ability effects, HUD |
| `js/touch.js` | on-screen controls on touch devices (feeds `Input.setAction`) |

## Core systems
- **Levels are text grids.** Each level is `{ name, powerup, rows }`. In `rows`,
  `#`=ground `B`=brick `Q`=crate `^`=spike `G`=goal `W`=wire deco; markers
  `P`=start `o`=bolt `c`/`h`=enemies `*`=the secret power-up. `parseLevel()`
  turns markers into spawns and leaves solid tiles in the grid. The shared floor
  is row 12; levels are 16 rows tall.
- **Charged jump** (`player.js`): hold jump on the ground to fill `meter` (it
  stays full); release to leap. Launch velocity and apex hang-time both scale
  with charge. A normal jump = a quick tap. Gravity is asymmetric (fall faster
  than rise). There is a level ceiling so flight can't leave the screen.
- **Power-ups** are an inventory on the player (`player.inv`). Movement powers
  (heli/pig/dash/shield) live in `player.js`; entity/kill powers (laser/bees/
  moon/nuke/carpet) are activated in `game.js` `_activate()` and rendered there.
- **Bosses** (`Level.BOSSES`, levels 4/7/10): each has an HP bar, a movement
  pattern, telegraphed shots, and a weakness power-up that deals triple damage
  (but any offensive means works). `game.js` carves a flat arena and locks the
  goal until the boss falls.
- **Health**: 2 HP per level (resets each level). Save/resume uses
  `localStorage` (`bolt_progress`, `bolt_best`).

## Adding content
- **A level**: add a `{ name, powerup, rows }` to `LEVELS` and a matching entry
  to `THEMES` (same index), plus a track in `music.js` `TRACKS` (same index —
  tracks wrap via modulo if there are fewer than levels). Keep pits ≤ 3 wide and **keep enemies/crates/spikes
  ≥ 7 tiles before any pit** (jumping an obstacle just before a pit lands you in
  it — an unfair trap). Put the `*` secret on a high ledge reachable by a
  charged jump. To gate it behind a boss, add to `BOSSES`.
- **A power-up**: add metadata to `POWERUPS` + a key in `input.js` MAP + initial
  state in `freshPower()`, then handle it in `game.js` `_activate()` (and/or
  `player.js` if it changes movement) and draw its effect.

## Verifying changes
There is no test suite; verify by driving the real game in headless Chromium
with Playwright. The reliable pattern: override `Input` in-page to read a bot
object, then script it. Examples used during development live in the session
scratchpad, but the approach is: boot with **no page errors**, then assert
behavior (a secret is reachable, a boss is beatable at 2 HP, the campaign
reaches `COMPLETE`). Always confirm zero JS errors after editing `level.js` —
it's easy to break the array and take down every global.
