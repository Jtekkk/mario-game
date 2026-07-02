# BOLT · A Factory Run

A small, original 2D platformer built in vanilla JavaScript + HTML5 Canvas.
You play **Bolt**, a factory robot who sprints, stomps, and charges up big
hang-time jumps across a **10-level campaign** — and every level hides a
**secret power-up** on a high ledge, from laser eyes to a mini nuke.

It was built as a learning exercise: we examined a real NES cartridge to
understand how an 8-bit platformer was engineered, then rebuilt those
*techniques and design principles* from scratch. All code, art, levels, and
audio here are original. See [`docs/LEARNINGS.md`](docs/LEARNINGS.md) for the
teardown and how each lesson maps to the code.

## Play it

No build step, no dependencies. Either:

- **Open `index.html`** directly in a browser, or
- Serve the folder: `python3 -m http.server` then visit `http://localhost:8000`.

### Controls
| Action | Keys |
|---|---|
| Move | ← / → (or A / D) |
| Jump | Z / Space |
| Charged jump | **Hold** jump to fill **PWR** (it stays full), **release** for a high jump with hang time |
| Run | X / Shift |
| Restart level | R |
| Start / advance | Enter |

### Secret power-ups (one per level, fired by its own key)
Each level hides a `*` capsule up high — reach it with a charged jump, then keep
it in your inventory and use it any time:

| Key | Power-up | Effect |
|---|---|---|
| **F** | Laser Eyes | Beam kills the nearest enemy ahead (repeatable) |
| **H** | Heli Hat | Hold to spin the rotor and hover (limited fuel) |
| **K** | Killer Bees | Homing swarm — 3 uses |
| **J** | Juke | Dodge: brief invulnerability + sidestep |
| **L** | Light Shield | A bubble that blocks hits for a bit — 2 uses |
| **P** | Ride Pig | Toggle a faster mount that flattens enemies |
| **B** | Turbo Dash | Dash through enemies, briefly invincible |
| **O** | Moon Destruct | Blow up the moon; debris wipes on-screen enemies |
| **N** | Mini Nuke | Kill every enemy in the level |
| **C** | Magic Carpet | Skip the next 2 levels |

## What's inside (and which lesson it applies)

| File | Role | Lesson |
|---|---|---|
| `js/pixel.js` | Original sprites as character grids, baked to canvases | Tiny reusable tiles |
| `js/level.js` | Tile alphabet + a 10-level campaign as grids of indices | Levels as data |
| `js/player.js` | Physics state machine: accel/friction, charged jump + hang time, and the power-up hooks (heli/pig/dash/shield) | Game feel + abilities |
| `js/powerups.js` | The 10 secret abilities: metadata, keys, tuning, fresh state | — |
| `js/enemies.js` | Legible patrol/hop patterns; stomp-to-defeat | Readable enemy patterns |
| `js/game.js` | Level progression, inventory, ability effects, camera, and the pinned HUD | Scanline-IRQ split screen |
| `js/sound.js` | Oscillator SFX synth (no audio files) | Compact APU-style sound |

## Design pillars
- **Charge and release for a high jump.** Hold jump to fill PWR (it stays full);
  release for a high, floaty jump. The more you charge, the higher you leap —
  which is exactly how you reach each level's secret power-up.
- **Find it, keep it, use it.** Every level hides one ability up high. Collect it
  and it stays in your inventory, fired by its own key — the arsenal grows.
- **10 levels, escalating.** Each level introduces its own secret and gets a
  little longer and busier; reach the goal to advance.

## Roadmap ideas
- A world-map hub between levels (the meta-progression lesson)
- Per-level themed tilesets / backgrounds
- A boss stage that forces you to use a specific power-up
- Simple level editor that reads/writes the text-grid format in `js/level.js`

## Credits
Design, code, and art: original. Built with plain web tech. Learnings documented
in `docs/LEARNINGS.md`.
