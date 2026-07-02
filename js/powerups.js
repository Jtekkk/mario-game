// powerups.js — the 10 secret abilities: metadata + tuning + fresh state.
//
// Each level hides one of these. You keep what you find (an inventory), and each
// is fired by its own key. Metadata here; the actual effects live in game.js
// (entity/kill effects) and player.js (movement effects) where they have the
// data they need. All original.

const POWERUPS = {
  laser:  { key: 'F', label: 'LASER EYES',    color: [255, 77, 94],  blurb: 'Fire a beam that kills the nearest enemy ahead' },
  heli:   { key: 'H', label: 'HELI HAT',      color: [90, 220, 255], blurb: 'Hold to spin the rotor and hover' },
  bees:   { key: 'K', label: 'KILLER BEES',   color: [255, 210, 63], blurb: 'Release a homing swarm (3 uses)' },
  juke:   { key: 'J', label: 'JUKE',          color: [185, 128, 255],blurb: 'Dodge — brief invulnerability + sidestep' },
  shield: { key: 'L', label: 'LIGHT SHIELD',  color: [138, 255, 160],blurb: 'Raise a shield that blocks hits for a bit' },
  pig:    { key: 'P', label: 'RIDE PIG',      color: [255, 158, 199],blurb: 'Toggle a pig mount — faster, and it flattens foes' },
  dash:   { key: 'B', label: 'TURBO DASH',    color: [255, 150, 60], blurb: 'Dash forward through enemies, briefly invincible' },
  moon:   { key: 'O', label: 'MOON DESTRUCT', color: [223, 232, 255],blurb: 'Blow up the moon — debris rains on every enemy on screen' },
  nuke:   { key: 'N', label: 'MINI NUKE',     color: [255, 224, 102],blurb: 'Wipe out every enemy in the level' },
  carpet: { key: 'C', label: 'MAGIC CARPET',  color: [255, 122, 192],blurb: 'Skip the next 2 levels' },
};

// Level order (also the order abilities are introduced).
const POWER_ORDER = ['laser','heli','bees','juke','shield','pig','dash','moon','nuke','carpet'];

// Tuning for effects.
const PWR = {
  laserCd: 20, laserRange: 170,
  heliFuelMax: 100, heliLift: -0.62, heliFallCap: 1.2, heliDrain: 1.0, heliRefill: 2.2,
  beesUses: 3, beesCount: 6, beesLife: 110, beesSpeed: 2.7,
  jukeCd: 55, jukeIframes: 36, jukeStep: 4.2,
  shieldUses: 2, shieldTime: 210,
  pigSpeed: 4.7,
  dashCd: 42, dashFrames: 16, dashSpeed: 7.2,
  moonUses: 1, moonDelay: 55,
  nukeUses: 1,
  carpetUses: 1,
};

// Initial per-power state the moment you collect it.
function freshPower(name) {
  switch (name) {
    case 'laser':  return { cd: 0 };
    case 'heli':   return {};
    case 'bees':   return { ammo: PWR.beesUses };
    case 'juke':   return { cd: 0 };
    case 'shield': return { ammo: PWR.shieldUses };
    case 'pig':    return {};
    case 'dash':   return { cd: 0 };
    case 'moon':   return { ammo: PWR.moonUses };
    case 'nuke':   return { ammo: PWR.nukeUses };
    case 'carpet': return { ammo: PWR.carpetUses };
    default:       return {};
  }
}

const Powerups = { POWERUPS, POWER_ORDER, PWR, freshPower };
