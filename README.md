# BOLT · A Factory Run

A small, original 2D platformer built in vanilla JavaScript + HTML5 Canvas.
You play **Bolt**, a factory robot who sprints, stomps, collects hardware
**modules**, and — once the **PWR** meter is charged — takes off and *flies*.

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
| Jump | Z / Space (hold for higher; release early to hop) |
| Run | X / Shift |
| Fly | Charge **PWR** by running, then press Jump in mid-air |
| Restart | R |
| Mute | M |
| Start | Enter |

Gamepad is supported too (d-pad/stick, A = jump, X/bumpers = run).

## What's inside (and which lesson it applies)

| File | Role | Lesson |
|---|---|---|
| `js/pixel.js` | Original sprites as character grids, baked to canvases | Tiny reusable tiles |
| `js/level.js` | Tile alphabet + level as a grid of indices, integer collision | Levels as data |
| `js/player.js` | Physics state machine: accel/friction, variable jump, coyote time, jump buffer, the PWR meter + power tiers | Run-meter reward; tiers as health |
| `js/enemies.js` | Legible patrol/hop patterns; stomp-to-defeat | Readable enemy patterns |
| `js/game.js` | Camera, rendering, particles, states, and the pinned HUD | Scanline-IRQ split screen |
| `js/sound.js` | Oscillator SFX synth (no audio files) | Compact APU-style sound |

## Design pillars
- **Run to charge, commit to fly.** Holding run on solid ground fills PWR; full
  meter unlocks a short flight window when you jump in the air.
- **Power tiers.** Small → Armored (a free hit) → Module (armored + an ability
  like the jet or drill). Getting hit drops you one tier instead of killing you.
- **Teach → stretch → test.** A clean speed runway teaches the meter; the brick
  "fly wall" rewards using it; the finale tests everything.

## Roadmap ideas
- More levels + a small world-map hub (the meta-progression lesson)
- The **drill** module as a distinct level path (bulldoze through blocks)
- Moving platforms, checkpoints, and a boss that tests one mechanic
- Simple level editor that reads/writes the text-grid format in `js/level.js`

## Credits
Design, code, and art: original. Built with plain web tech. Learnings documented
in `docs/LEARNINGS.md`.
