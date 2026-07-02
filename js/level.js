// level.js — tile-based world.
//
// Lesson from the ROM: a level is not an image, it's a grid of small indices
// into a tile alphabet. That makes levels cheap to author (they're just text
// here), cheap to store, and trivial to collide against (integer math, no
// per-pixel checks). Backgrounds are drawn procedurally per tile-type.

const TILE = 16; // logical pixels per tile

// Tile alphabet. Each char in a level map row is one tile.
// Solidity + how to draw are derived from the type below.
const TILES = {
  '.': { solid: false, type: 'air' },
  '#': { solid: true,  type: 'ground' },   // dirt/metal floor
  '=': { solid: true,  type: 'platform' }, // one-way? kept solid for simplicity
  'B': { solid: true,  type: 'brick' },     // breakable-looking block
  'Q': { solid: true,  type: 'crate' },     // crate
  '^': { solid: true,  type: 'spike', hurts: true },
  'G': { solid: true,  type: 'goal' },       // exit pillar (handled specially)
  'W': { solid: false, type: 'wire' },       // background decoration
};

// ---- The level (original layout) --------------------------------------------
// Legend: player start 'P', bolt 'o', enemies 'c' crawler / 'h' hopper,
// modules 'J' jet / 'S' shield / 'D' drill. These are entity markers: they are
// read out, then the cell becomes air.
const LEVEL_1 = [
  '........................................................................................................................',
  '........................................................................................................................',
  '........................................................................................................................',
  '..............................WW....................................................................W...................',
  '..........................................................W.............................................................',
  '........................................................................................................................',
  '.........................................................o.o.o..........................................................',
  '.......................................................o.......o...........oo......................................o....',
  '..........................................................................BBBB....................................G.....',
  '.........................................................................BBBBB....................................G.....',
  '......o.o.o.....................................o..o..o..o..o..o........B.BBBB............o...o.........o.o.o.....G.....',
  '..P...........S.........c...........c.............................J....B..BBBB............c.........h...........######..',
  '##########################################...#############################BBBB###....###################################',
  '##########################################...####################################....###################################',
  '##########################################...####################################....###################################',
  '##########################################...####################################....###################################',
];

// Parse a text level into: a solid grid + a list of spawn markers.
function parseLevel(rows) {
  const h = rows.length;
  const w = Math.max(...rows.map(r => r.length));
  const grid = [];
  const spawns = { player: null, bolts: [], enemies: [], modules: [] };
  for (let y = 0; y < h; y++) {
    const line = rows[y].padEnd(w, '.');
    const gr = [];
    for (let x = 0; x < w; x++) {
      const ch = line[x];
      switch (ch) {
        case 'P': spawns.player = { x: x * TILE, y: y * TILE }; gr.push('.'); break;
        case 'o': spawns.bolts.push({ x: x * TILE, y: y * TILE }); gr.push('.'); break;
        case 'c': spawns.enemies.push({ x: x * TILE, y: y * TILE, kind: 'crawler' }); gr.push('.'); break;
        case 'h': spawns.enemies.push({ x: x * TILE, y: y * TILE, kind: 'hopper' }); gr.push('.'); break;
        case 'J': spawns.modules.push({ x: x * TILE, y: y * TILE, kind: 'jet' }); gr.push('.'); break;
        case 'S': spawns.modules.push({ x: x * TILE, y: y * TILE, kind: 'shield' }); gr.push('.'); break;
        case 'D': spawns.modules.push({ x: x * TILE, y: y * TILE, kind: 'drill' }); gr.push('.'); break;
        default: gr.push(ch in TILES ? ch : '.');
      }
    }
    grid.push(gr);
  }
  return { grid, w, h, spawns, pxWidth: w * TILE, pxHeight: h * TILE };
}

// Collision helpers — all integer tile lookups.
function tileAt(level, tx, ty) {
  if (ty < 0 || ty >= level.h || tx < 0 || tx >= level.w) return '.';
  return level.grid[ty][tx];
}
function isSolid(level, tx, ty) {
  const t = TILES[tileAt(level, tx, ty)];
  return t ? t.solid : false;
}
function tileInfo(ch) { return TILES[ch] || TILES['.']; }

const Level = { TILE, TILES, LEVEL_1, parseLevel, tileAt, isSolid, tileInfo };
