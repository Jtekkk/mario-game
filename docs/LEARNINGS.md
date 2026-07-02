# What we learned from an NES cartridge (and how BOLT applies it)

This project started by examining a real NES ROM to learn how an 8-bit platformer
was built, then rebuilding those *techniques and design principles* from scratch
as an original browser game. No code, art, level data, or audio was copied from
the ROM — only the engineering lessons below, all of which are general knowledge
about how the hardware works and how good platformers are designed.

## The cartridge we analyzed

| Property | Value |
|---|---|
| Format | iNES 1.0 |
| PRG ROM (code) | 256 KB (16 × 16 KB) |
| CHR ROM (graphics) | 128 KB (16 × 8 KB) |
| Mapper | 4 (MMC3) |
| Mirroring | Horizontal |
| Distinct 8 KB PRG banks | 32 / 32 (no duplicate/padding banks) |
| Distinct 1 KB CHR banks | 127 / 128 |
| Total 8×8 tiles | 8,192 (472 blank) |

Everything below was *measured* from the binary, not recalled.

## Lesson 1 — Bank switching beats the address-space limit
The 6502 CPU can only see 64 KB at once, yet the game holds 256 KB of code. The
MMC3 mapper pages 8 KB windows in and out on demand. We counted **74 writes to
`$8000`** (bank-select) and **71 to `$8001`** (bank-data) across the PRG — the
game is constantly swapping banks to reach content that isn't currently mapped.
A fixed 8 KB bank at `$E000–$FFFF` stays resident and holds the core handlers.

**In BOLT:** we don't page memory, but we keep the same discipline — a small tile
*alphabet* and level data that's just indices, so "content" is cheap and the core
loop stays tiny. (`js/level.js`)

## Lesson 2 — The scanline IRQ makes a split screen
The most important rendering trick in the ROM: MMC3 counts rendered scanlines and
fires an interrupt partway down the frame. We found the full setup — writes to
`$C000/$C001` (IRQ latch/reload) and `$E000/$E001` (IRQ disable/enable). The game
uses it to split the display: the play area scrolls freely while the bottom status
panel stays fixed and swaps to a different graphics bank.

**In BOLT:** same *idea*, simpler mechanism — the world is drawn through a moving
camera transform, then the transform is reset and the HUD is drawn in screen space
so it never scrolls. (`js/game.js` → `render()` / `_drawHUD()`)

## Lesson 3 — Everything is tiny tiles
All graphics are 8×8-pixel, 2-bit (4-color) tiles, 16 bytes each. We decoded all
8,192 of them. One CHR bank is clearly a **font** (digits, letters, HUD icons);
others are level tilesets that only resolve once grouped into 16×16 *metatiles*
with a palette. There are **32 separate 4 KB tilesets**, paged per-level by MMC3.

**In BOLT:** all art is authored as tiny character-grid sprites baked to canvases,
and even the HUD font is a hand-made 4×6 bitmap — no image assets at all.
(`js/pixel.js`, `buildFont()` in `js/game.js`)

## Lesson 4 — Where the engine spends effort
Static counts of hardware-register writes reveal the engine's priorities:

| Register | Writes | Meaning |
|---|---|---|
| `$2006` PPUADDR | 109 | heavy nametable updates (drawing level strips while scrolling) |
| `$2000` PPUCTRL | 51 | per-frame render config |
| `$2001` PPUMASK | 35 | show/hide layers |
| `$2005` SCROLL | 34 | smooth scrolling |
| `$4014` OAM DMA | 6 | bulk sprite upload each frame |
| `$4000–$4013` APU | 43 | a compact 5-channel sound engine |

**In BOLT:** scrolling + a per-frame sprite pass mirror this shape, and the sound
is a tiny oscillator synth in the spirit of the APU. (`js/sound.js`)

## Lesson 5 — The design pillars (what makes it fun)
These are genre design principles, not anything specific to the ROM:

1. **A run/power meter that gates a reward.** Commit to running → charge a meter →
   unlock flight for a short window. One input that means more when you commit.
2. **Power tiers as health + ability.** Small → armored (a free hit) → module
   (armored + an active ability). A hit knocks you *down a tier* instead of an
   instant death — forgiving, but every tier is worth protecting.
3. **Teach → stretch → test.** Give a clean space to learn a mechanic (the speed
   runway), then a place that stretches it (the fly wall), then a test.
4. **Levels as tile grids** so content is cheap to author and edit.

**In BOLT:** the P-meter, tiers, and the "runway → fly wall" pacing are the whole
first level. (`js/player.js`, `js/level.js`)

## How this was verified
The game was driven end-to-end in headless Chromium: booting with no JS errors,
charging the meter to 100, triggering flight from a mid-air jump, stomping enemies,
collecting modules, and reaching the goal → win. A ground-probe bug (the power
meter barely charged because `onGround` flickered on flat floors) was found and
fixed this way.
