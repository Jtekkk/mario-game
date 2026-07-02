// pixel.js — original pixel-art system.
//
// Lesson from the SMB3 ROM: don't ship big images. Ship a small alphabet of
// tiny tiles and reuse them everywhere. NES tiles were 8x8 px with 4 colors.
// We keep that spirit: every sprite below is authored as a grid of characters,
// each character mapping to a palette color. All art here is original.
//
// A sprite is defined as { pal, rows } where `rows` is an array of equal-length
// strings. Characters:  '.' = transparent, others index into `pal`.

const PIXEL_SCALE = 3; // logical px -> screen px (set once, used by the camera)

// Bake a character-grid sprite into an offscreen canvas so we blit it fast.
function bakeSprite(def) {
  const h = def.rows.length;
  const w = def.rows[0].length;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = def.rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      const i = (y * w + x) * 4;
      if (ch === '.' || ch === ' ' || !(ch in def.pal)) {
        img.data[i + 3] = 0; // transparent
        continue;
      }
      const c = def.pal[ch];
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
      img.data[i + 3] = 3 in c ? c[3] : 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  cv.logicalW = w;
  cv.logicalH = h;
  return cv;
}

// Return a horizontally-mirrored copy (so we author art facing one way only).
function flipSprite(cv) {
  const out = document.createElement('canvas');
  out.width = cv.width;
  out.height = cv.height;
  const ctx = out.getContext('2d');
  ctx.translate(cv.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(cv, 0, 0);
  out.logicalW = cv.logicalW;
  out.logicalH = cv.logicalH;
  return out;
}

// ---- Original palette --------------------------------------------------------
const PAL = {
  // robot body
  s: [70, 78, 94],     // steel shadow
  m: [126, 138, 158],  // steel mid
  h: [196, 206, 222],  // steel highlight
  e: [90, 220, 255],   // eye / energy cyan
  o: [255, 176, 64],   // accent orange
  d: [34, 38, 48],      // outline / dark
  w: [240, 244, 250],   // white
  // module colors
  j: [255, 120, 60],    // jet flame
  g: [120, 230, 140],   // shield green
  p: [190, 130, 255],   // drill purple
};

// ---- Hero: "Bolt", a small factory robot (original) -------------------------
// Idle frame. 12x14, authored facing right.
const HERO = {
  idle: bakeSprite({ pal: PAL, rows: [
    '....dddd....',
    '...dhhhhd...',
    '..dhmmmmhd..',
    '..dheeeehd..',
    '..dhe..ehd..',
    '..dhmmmmhd..',
    '.ddhmssmhdd.',
    'dhhdmmmmdhhd',
    'dhhdmoomdhhd',
    '.ddhmmmmhdd.',
    '..dhm..mhd..',
    '..dhd..dhd..',
    '..ddd..ddd..',
    '..dd....dd..',
  ]}),
  walk: bakeSprite({ pal: PAL, rows: [
    '....dddd....',
    '...dhhhhd...',
    '..dhmmmmhd..',
    '..dheeeehd..',
    '..dhe..ehd..',
    '..dhmmmmhd..',
    '.ddhmssmhdd.',
    'dhhdmmmmdhhd',
    'dhhdmoomdhhd',
    '.ddhmmmmhdd.',
    '..dhm..mhd..',
    '.dhd....dhd.',
    '.ddd....dd..',
    'ddd......dd.',
  ]}),
  jump: bakeSprite({ pal: PAL, rows: [
    '....dddd....',
    '...dhhhhd...',
    '..dhmmmmhd..',
    '..dheeeehd..',
    '..dhe..ehd..',
    '.ddhmmmmhdd.',
    'dhhdmssmdhhd',
    'dhhdmmmmdhhd',
    '.ddhmoomhdd.',
    '..dhmmmmhd..',
    '..dhm..mhd..',
    '.dhd....dhd.',
    'ddd......ddd',
    '.d........d.',
  ]}),
};

// A tiny flame that draws under the hero while boosting.
const FLAME = {
  a: bakeSprite({ pal: PAL, rows: [
    '.jj..jj.',
    'joj..joj',
    '.joj joj',
    '..joooj.',
    '...oo...',
  ]}),
  b: bakeSprite({ pal: PAL, rows: [
    '..j..j..',
    '.joj joj',
    '..jojoj.',
    '...ooo..',
    '....o...',
  ]}),
};

// ---- Enemies (original) -----------------------------------------------------
// "Crawler" — a walking maintenance bug.
const CRAWLER = {
  a: bakeSprite({ pal: PAL, rows: [
    '..dddddd..',
    '.dhsssshd.',
    'dhsoooshd.',
    'dsowwoosd.',
    'dsowwoosd.',
    'dhsoooshd.',
    '.dhsssshd.',
    '.d.dd.dd.d',
  ]}),
  b: bakeSprite({ pal: PAL, rows: [
    '..dddddd..',
    '.dhsssshd.',
    'dhsoooshd.',
    'dsowwoosd.',
    'dsowwoosd.',
    'dhsoooshd.',
    '.dhsssshd.',
    'd.dd.dd.d.',
  ]}),
};

// "Hopper" — a spring drone that bounces.
const HOPPER = {
  a: bakeSprite({ pal: PAL, rows: [
    '..dddd..',
    '.deeeed.',
    'dep..ped',
    'deppppdd',
    'dheeeehd',
    '.d.dd.d.',
    '..d..d..',
    '.dd..dd.',
  ]}),
};

// ---- Pickups (original) -----------------------------------------------------
const BOLT = { // the collectible "coin" — a hex bolt
  a: bakeSprite({ pal: PAL, rows: [
    '..oooo..',
    '.o.ww.o.',
    'oowwwwoo',
    'owwoowwo',
    'owwoowwo',
    'oowwwwoo',
    '.o.ww.o.',
    '..oooo..',
  ]}),
};

// Modules: powerups, colored by ability.
function moduleSprite(color) {
  return bakeSprite({ pal: PAL, rows: [
    '.dddddd.',
    'd'+color+color+color+color+color+color+'d',
    'd'+color+'wwww'+color+'d',
    'd'+color+'w'+color+color+'w'+color+'d',
    'd'+color+'w'+color+color+'w'+color+'d',
    'd'+color+'wwww'+color+'d',
    'd'+color+color+color+color+color+color+'d',
    '.dddddd.',
  ]});
}
const MODULE = {
  jet: moduleSprite('j'),
  shield: moduleSprite('g'),
  drill: moduleSprite('p'),
};

// Expose as a namespace.
const Art = { PIXEL_SCALE, PAL, HERO, FLAME, CRAWLER, HOPPER, BOLT, MODULE, flipSprite, bakeSprite };
