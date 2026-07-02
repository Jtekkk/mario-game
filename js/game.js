// game.js — main loop, camera, rendering, HUD, and game states.
//
// Lesson from the ROM's scanline IRQ: the world scrolls, but the status panel
// does NOT. On the NES that was a mid-frame interrupt splitting the screen.
// Here it's simpler but the same idea: we render the world through a moving
// camera transform, then reset the transform and draw the HUD in screen space
// so it stays pinned no matter where the player is.

const VIEW_W = 320;   // logical viewport (before PIXEL_SCALE)
const VIEW_H = 224;   // 14 tiles tall of play + a HUD band feel
const SCALE = Art.PIXEL_SCALE;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = VIEW_W * SCALE;
canvas.height = VIEW_H * SCALE;
ctx.imageSmoothingEnabled = false;

// Pre-flip hero sprites for facing left.
const HERO_L = { idle: Art.flipSprite(Art.HERO.idle), walk: Art.flipSprite(Art.HERO.walk), jump: Art.flipSprite(Art.HERO.jump) };

const State = { TITLE: 'title', PLAY: 'play', WIN: 'win', DEAD: 'dead' };

const Game = {
  state: State.TITLE,
  level: null,
  player: null,
  enemies: [],
  bolts: [],
  modules: [],
  particles: [],
  cam: { x: 0, y: 0 },
  time: 0,
  frame: 0,
  best: Number(localStorage.getItem('bolt_best') || 0),

  load() {
    this.level = Level.parseLevel(Level.LEVEL_1);
    const s = this.level.spawns;
    this.player = new PlayerNS.Player(s.player.x, s.player.y - 2);
    this.enemies = s.enemies.map(e => new Enemies.Enemy(e.x, e.y, e.kind));
    this.bolts = s.bolts.map(b => ({ x: b.x + 4, y: b.y + 4, got: false, t: 0 }));
    this.modules = s.modules.map(m => ({ x: m.x, y: m.y, kind: m.kind, got: false, t: 0 }));
    this.particles = [];
    this.cam = { x: 0, y: 0 };
    this.time = 300 * 60; // frames
    this.frame = 0;
  },

  start() { this.load(); this.state = State.PLAY; Sfx.resume(); },

  addBurst(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * (1 + i % 3), vy: Math.sin(a) * (1 + i % 3) - 1, life: 24, color });
    }
  },

  update() {
    this.frame++;
    Input.beginFrame();

    if (this.state === State.TITLE) {
      if (Input.justPressed('start') || Input.justPressed('jump')) this.start();
      Input.endFrame();
      return;
    }
    if (this.state === State.WIN || this.state === State.DEAD) {
      if (Input.justPressed('start') || Input.justPressed('jump') || Input.justPressed('reset')) {
        this.state = State.TITLE;
      }
      this._updateParticles();
      Input.endFrame();
      return;
    }

    // ---- PLAY ----
    if (Input.justPressed('reset')) { this.start(); Input.endFrame(); return; }

    const p = this.player;
    p.update(this.level);

    // timer
    if (this.time > 0) this.time--; else p.dead = true;

    // enemies
    for (const e of this.enemies) {
      e.update(this.level);
      if (!e.dead && rectsOverlap(p.rect, e.rect)) {
        const r = e.collidePlayer(p);
        if (r === 'stomp') this.addBurst(e.x + e.w / 2, e.y + e.h / 2, Art.PAL.o, 6);
        else if (r === 'hit') {
          const died = p.hurt();
          if (p.invuln === 90) { // just got hit this frame
            Sfx.hurt();
            this.addBurst(p.x + p.w / 2, p.y + p.h / 2, Art.PAL.e, 8);
          }
          if (died) this._die();
        }
      }
    }

    // bolts
    for (const b of this.bolts) {
      if (b.got) continue;
      b.t++;
      if (rectsOverlap(p.rect, { x: b.x - 4, y: b.y - 4, w: 8, h: 8 })) {
        b.got = true; p.bolts++; Sfx.bolt();
        this.addBurst(b.x, b.y, Art.PAL.o, 5);
      }
    }

    // modules
    for (const m of this.modules) {
      if (m.got) continue;
      m.t++;
      if (rectsOverlap(p.rect, { x: m.x, y: m.y, w: 8, h: 8 })) {
        m.got = true;
        if (m.kind === 'shield') p.gainArmor(); else p.gainModule(m.kind);
        Sfx.module();
        this.addBurst(m.x + 4, m.y + 4, Art.PAL[m.kind === 'jet' ? 'j' : m.kind === 'shield' ? 'g' : 'p'], 10);
      }
    }

    // reached the goal pillar?
    const ptx0 = Math.floor(p.x / Level.TILE), ptx1 = Math.floor((p.x + p.w) / Level.TILE);
    for (let tx = ptx0; tx <= ptx1; tx++) {
      const ty = Math.floor((p.y + p.h / 2) / Level.TILE);
      if (Level.tileAt(this.level, tx, ty) === 'G') { this._win(); }
    }

    if (p.dead && this.state === State.PLAY) this._die();

    this._updateParticles();
    this._updateCamera();
    Input.endFrame();
  },

  _die() {
    if (this.state !== State.PLAY) return;
    this.state = State.DEAD;
    Sfx.die();
    this.addBurst(this.player.x + 6, this.player.y + 7, Art.PAL.e, 14);
  },
  _win() {
    if (this.state !== State.PLAY) return;
    this.state = State.WIN;
    const score = this.player.bolts * 100 + Math.floor(this.time / 60) * 10;
    if (score > this.best) { this.best = score; localStorage.setItem('bolt_best', score); }
    this._winScore = score;
    Sfx.win();
  },

  _updateParticles() {
    for (const pt of this.particles) {
      pt.x += pt.vx; pt.y += pt.vy; pt.vy += 0.18; pt.life--;
    }
    this.particles = this.particles.filter(pt => pt.life > 0);
  },

  _updateCamera() {
    const p = this.player;
    // Camera leads slightly in the direction of travel, clamped to the level.
    const targetX = p.x + p.w / 2 - VIEW_W / 2 + p.face * 30;
    this.cam.x += (targetX - this.cam.x) * 0.12;
    const targetY = p.y + p.h / 2 - VIEW_H / 2 + 20;
    this.cam.y += (targetY - this.cam.y) * 0.1;
    this.cam.x = clamp(this.cam.x, 0, Math.max(0, this.level.pxWidth - VIEW_W));
    this.cam.y = clamp(this.cam.y, 0, Math.max(0, this.level.pxHeight - VIEW_H));
  },

  // ---------- Rendering ----------
  render() {
    ctx.save();
    ctx.scale(SCALE, SCALE);
    this._drawSky();

    if (this.state === State.TITLE) { this._drawTitle(); ctx.restore(); return; }

    // World, drawn through the camera transform.
    ctx.save();
    ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));
    this._drawLevel();
    this._drawBolts();
    this._drawModules();
    this._drawEnemies();
    this._drawPlayer();
    this._drawParticles();
    ctx.restore();

    // HUD in screen space (the non-scrolling panel — the scanline-IRQ lesson).
    this._drawHUD();

    if (this.state === State.WIN) this._drawBanner('SECTOR CLEARED', `SCORE ${this._winScore}   BEST ${this.best}`, Art.PAL.g);
    if (this.state === State.DEAD) this._drawBanner('SYSTEM DOWN', 'PRESS ENTER TO RETRY', Art.PAL.j);

    ctx.restore();
  },

  _drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#0b1030');
    g.addColorStop(0.6, '#18234f');
    g.addColorStop(1, '#28407a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // parallax "circuit" dots
    ctx.fillStyle = 'rgba(120,200,255,0.25)';
    for (let i = 0; i < 40; i++) {
      const x = ((i * 71 - this.cam.x * 0.3) % (VIEW_W + 20) + VIEW_W + 20) % (VIEW_W + 20) - 10;
      const y = (i * 47) % VIEW_H;
      ctx.fillRect(x, y, 2, 2);
    }
  },

  _drawLevel() {
    const L = this.level;
    const x0 = Math.floor(this.cam.x / Level.TILE) - 1;
    const x1 = Math.floor((this.cam.x + VIEW_W) / Level.TILE) + 1;
    const y0 = Math.floor(this.cam.y / Level.TILE) - 1;
    const y1 = Math.floor((this.cam.y + VIEW_H) / Level.TILE) + 1;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const ch = Level.tileAt(L, tx, ty);
        if (ch === '.') continue;
        drawTile(ch, tx * Level.TILE, ty * Level.TILE, this.frame);
      }
    }
  },

  _drawBolts() {
    for (const b of this.bolts) {
      if (b.got) continue;
      const bob = Math.sin((b.t + b.x) * 0.1) * 1.5;
      const spr = Art.BOLT.a;
      ctx.drawImage(spr, Math.round(b.x - 4), Math.round(b.y - 4 + bob));
    }
  },

  _drawModules() {
    for (const m of this.modules) {
      if (m.got) continue;
      const bob = Math.sin(m.t * 0.08) * 2;
      const spr = Art.MODULE[m.kind];
      // glow
      ctx.save();
      ctx.globalAlpha = 0.35 + Math.sin(m.t * 0.15) * 0.15;
      ctx.fillStyle = m.kind === 'jet' ? '#ff7a3c' : m.kind === 'shield' ? '#78e68c' : '#be82ff';
      ctx.fillRect(m.x - 2, m.y - 2 + bob, 12, 12);
      ctx.restore();
      ctx.drawImage(spr, Math.round(m.x), Math.round(m.y + bob));
    }
  },

  _drawEnemies() {
    for (const e of this.enemies) {
      let spr;
      if (e.kind === 'crawler') spr = (Math.floor(e.animT) % 2) ? Art.CRAWLER.b : Art.CRAWLER.a;
      else spr = Art.HOPPER.a;
      ctx.save();
      if (e.dead && e.squash > 0) {
        ctx.translate(e.x, e.y + e.h);
        ctx.scale(1, 0.35);
        ctx.drawImage(spr, 0, -e.h);
      } else if (!e.dead) {
        ctx.drawImage(spr, Math.round(e.x - 1), Math.round(e.y - (spr.logicalH - e.h)));
      }
      ctx.restore();
    }
  },

  _drawPlayer() {
    const p = this.player;
    if (p.dead && this.state === State.DEAD) return;
    if (p.invuln > 0 && Math.floor(p.invuln / 4) % 2) return; // blink during i-frames

    const set = p.face < 0 ? HERO_L : Art.HERO;
    let spr = set.idle;
    if (!p.onGround) spr = set.jump;
    else if (Math.abs(p.vx) > 0.3) spr = (Math.floor(p.animT) % 2) ? set.walk : set.idle;

    // charging cue: a pulsing ring that grows and brightens with the charge
    if (p.charging) {
      const pct = p.meter / PlayerNS.PHYS.meterMax;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const r = 8 + pct * 7 + Math.sin(this.frame * 0.5) * 1.5;
      ctx.save();
      ctx.globalAlpha = 0.35 + pct * 0.4;
      ctx.strokeStyle = pct >= PlayerNS.PHYS.flyThreshold / 100 ? '#8affa0' : '#5adcff';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      // rising sparks
      ctx.fillStyle = '#bff4ff';
      for (let i = 0; i < 3; i++) {
        const a = this.frame * 0.2 + i * 2.1;
        ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
      }
      ctx.restore();
    }
    // jet flame while flying
    if (p.flying > 0) {
      const fl = (this.frame % 6 < 3) ? Art.FLAME.a : Art.FLAME.b;
      ctx.drawImage(fl, Math.round(p.x + 2), Math.round(p.y + p.h - 1));
    }
    // armor tint ring
    if (p.tier >= PlayerNS.TIER.ARMORED) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = p.tier === PlayerNS.TIER.MODULE
        ? (p.module === 'jet' ? '#ff7a3c' : '#be82ff') : '#78e68c';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(p.x - 1), Math.round(p.y - 1), p.w + 2, p.h + 2);
      ctx.restore();
    }
    ctx.drawImage(spr, Math.round(p.x - 0), Math.round(p.y));
  },

  _drawParticles() {
    for (const pt of this.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / 24);
      ctx.fillStyle = `rgb(${pt.color[0]},${pt.color[1]},${pt.color[2]})`;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), 2, 2);
    }
    ctx.globalAlpha = 1;
  },

  // ---- HUD: pinned to the screen, never scrolls ----
  _drawHUD() {
    const p = this.player;
    // top band
    ctx.fillStyle = 'rgba(6,10,26,0.85)';
    ctx.fillRect(0, 0, VIEW_W, 22);
    ctx.fillStyle = '#2a3a6a';
    ctx.fillRect(0, 22, VIEW_W, 1);

    text('BOLTS ' + String(p.bolts).padStart(2, '0'), 6, 6, Art.PAL.o);
    text('TIME ' + String(Math.ceil(this.time / 60)).padStart(3, '0'), 120, 6, Art.PAL.w);
    text('BEST ' + this.best, 220, 6, Art.PAL.e);

    // charge meter: fills while hover-charging, release to fly
    const mx = 6, my = 15, mw = 90, mh = 4;
    const thresh = PlayerNS.PHYS.flyThreshold / PlayerNS.PHYS.meterMax;
    ctx.fillStyle = '#101830';
    ctx.fillRect(mx, my, mw, mh);
    const pct = p.meter / PlayerNS.PHYS.meterMax;
    // marker for the minimum charge needed to fly
    ctx.fillStyle = '#31406e';
    ctx.fillRect(mx + Math.round(mw * thresh), my - 1, 1, mh + 2);
    ctx.fillStyle = pct >= 1 ? (this.frame % 8 < 4 ? '#ffe066' : '#ff9a3c')
                  : pct >= thresh ? '#78e68c' : '#5adcff';
    ctx.fillRect(mx, my, Math.round(mw * pct), mh);
    text('PWR', mx + mw + 4, my - 1, p.charging ? Art.PAL.o : Art.PAL.m);
    if (p.flying > 0) text('FLY!', mx + mw + 26, my - 1, Art.PAL.e);
    else if (p.charging && pct >= thresh && this.frame % 10 < 6) text('RELEASE!', mx + mw + 26, my - 1, Art.PAL.g);
    else if (p.charging) text('HOLD', mx + mw + 26, my - 1, Art.PAL.o);

    // tier indicator
    const tierName = ['SMALL', 'ARMORED', p.module ? p.module.toUpperCase() : 'MODULE'][p.tier];
    text(tierName, 220, 15, p.tier === 0 ? Art.PAL.m : Art.PAL.g);
  },

  _drawTitle() {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // hero big
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(Art.HERO.idle, VIEW_W / 2 - 24, 60, Art.HERO.idle.logicalW * 4, Art.HERO.idle.logicalH * 4);
    ctx.restore();
    textBig('BOLT', VIEW_W / 2 - 40, 20, Art.PAL.e);
    text('A FACTORY RUN', VIEW_W / 2 - 39, 130, Art.PAL.w);
    if (this.frame % 60 < 40) text('PRESS ENTER TO START', VIEW_W / 2 - 60, 160, Art.PAL.o);
    text('ARROWS MOVE   Z JUMP   X RUN', VIEW_W / 2 - 84, 185, Art.PAL.m);
    text('JUMP THEN HOLD PAST THE PEAK TO CHARGE', VIEW_W / 2 - 114, 198, Art.PAL.m);
    text('RELEASE TO FLY', VIEW_W / 2 - 42, 208, Art.PAL.e);
  },

  _drawBanner(title, sub, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, VIEW_H / 2 - 34, VIEW_W, 64);
    textBig(title, VIEW_W / 2 - title.length * 6, VIEW_H / 2 - 22, color);
    text(sub, VIEW_W / 2 - sub.length * 3, VIEW_H / 2 + 8, Art.PAL.w);
  },
};

// ---------- small render helpers ----------
function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Draw a level tile procedurally by type (no tile image assets needed).
function drawTile(ch, x, y, frame) {
  const T = Level.TILE;
  switch (ch) {
    case '#': // ground: metal plate with rivets
      ctx.fillStyle = '#3a4668'; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#4c5a84'; ctx.fillRect(x, y, T, 3);
      ctx.fillStyle = '#2a3350'; ctx.fillRect(x, y + T - 2, T, 2);
      ctx.fillStyle = '#6478a8'; ctx.fillRect(x + 2, y + 5, 2, 2); ctx.fillRect(x + T - 4, y + 5, 2, 2);
      break;
    case 'B': // brick
      ctx.fillStyle = '#7a5038'; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#5a3826'; ctx.fillRect(x, y + 7, T, 1); ctx.fillRect(x + 7, y, 1, 7); ctx.fillRect(x + 3, y + 8, 1, 8);
      ctx.fillStyle = '#96684a'; ctx.fillRect(x + 1, y + 1, T - 2, 2);
      break;
    case 'Q': // crate
      ctx.fillStyle = '#b7832f'; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = '#8a6220'; ctx.fillRect(x + 1, y + 1, T - 2, T - 2);
      ctx.strokeStyle = '#e0b45a'; ctx.lineWidth = 1;
      ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3);
      ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + T - 2, y + T - 2);
      ctx.moveTo(x + T - 2, y + 2); ctx.lineTo(x + 2, y + T - 2); ctx.stroke();
      break;
    case '^': // spike
      ctx.fillStyle = '#20263a'; ctx.fillRect(x, y + T - 4, T, 4);
      ctx.fillStyle = '#c6d0e0';
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 8, y + T); ctx.lineTo(x + i * 8 + 4, y + 3); ctx.lineTo(x + i * 8 + 8, y + T);
        ctx.closePath(); ctx.fill();
      }
      break;
    case 'G': { // goal pillar with a glow
      const glow = 0.4 + Math.sin(frame * 0.1 + y) * 0.25;
      ctx.fillStyle = `rgba(90,220,255,${glow})`; ctx.fillRect(x + 2, y, T - 4, T);
      ctx.fillStyle = '#d0f4ff'; ctx.fillRect(x + 6, y, 4, T);
      break; }
    case 'W': { // background circuit node (non-solid decoration)
      const pulse = 0.3 + Math.sin(frame * 0.08 + x) * 0.2;
      ctx.strokeStyle = `rgba(90,180,255,${pulse * 0.6})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + 8, y + 8); ctx.lineTo(x + 8, y + T); ctx.stroke();
      ctx.fillStyle = `rgba(120,210,255,${pulse})`;
      ctx.fillRect(x + 6, y + 6, 4, 4);
      break; }
    default:
      break; // unknown chars draw nothing (no ugly fallback blocks)
  }
}

// ---------- bitmap text (original 4x6 font) ----------
// A compact font so the HUD needs no font asset — echoes the ROM's tile font.
const FONT = buildFont();
function text(str, x, y, color) { drawText(str, x, y, color, 1); }
function textBig(str, x, y, color) { drawText(str, x, y, color, 2); }
function drawText(str, x, y, color, scale) {
  str = String(str).toUpperCase();
  ctx.save();
  ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
  for (let i = 0; i < str.length; i++) {
    const g = FONT[str[i]];
    if (!g) continue;
    for (let r = 0; r < 6; r++) {
      for (let c = 0; c < 4; c++) {
        if (g[r] & (1 << (3 - c))) ctx.fillRect(x + (i * 4 + c) * scale, y + r * scale, scale, scale);
      }
    }
  }
  ctx.restore();
}
// tiny 4x6 glyphs encoded as 6 nibble-rows
function buildFont() {
  const F = {
    'A':[0x6,0x9,0xF,0x9,0x9,0x9],'B':[0xE,0x9,0xE,0x9,0x9,0xE],'C':[0x7,0x8,0x8,0x8,0x8,0x7],
    'D':[0xE,0x9,0x9,0x9,0x9,0xE],'E':[0xF,0x8,0xE,0x8,0x8,0xF],'F':[0xF,0x8,0xE,0x8,0x8,0x8],
    'G':[0x7,0x8,0xB,0x9,0x9,0x7],'H':[0x9,0x9,0xF,0x9,0x9,0x9],'I':[0x7,0x2,0x2,0x2,0x2,0x7],
    'J':[0x1,0x1,0x1,0x1,0x9,0x6],'K':[0x9,0xA,0xC,0xC,0xA,0x9],'L':[0x8,0x8,0x8,0x8,0x8,0xF],
    'M':[0x9,0xF,0xF,0x9,0x9,0x9],'N':[0x9,0xD,0xF,0xB,0x9,0x9],'O':[0x6,0x9,0x9,0x9,0x9,0x6],
    'P':[0xE,0x9,0xE,0x8,0x8,0x8],'Q':[0x6,0x9,0x9,0x9,0xA,0x5],'R':[0xE,0x9,0xE,0xC,0xA,0x9],
    'S':[0x7,0x8,0x6,0x1,0x1,0xE],'T':[0xF,0x2,0x2,0x2,0x2,0x2],'U':[0x9,0x9,0x9,0x9,0x9,0x6],
    'V':[0x9,0x9,0x9,0x9,0x6,0x6],'W':[0x9,0x9,0x9,0xF,0xF,0x9],'X':[0x9,0x9,0x6,0x6,0x9,0x9],
    'Y':[0x9,0x9,0x6,0x2,0x2,0x2],'Z':[0xF,0x1,0x2,0x4,0x8,0xF],
    '0':[0x6,0x9,0xB,0xD,0x9,0x6],'1':[0x2,0x6,0x2,0x2,0x2,0x7],'2':[0x6,0x9,0x1,0x2,0x4,0xF],
    '3':[0xE,0x1,0x6,0x1,0x1,0xE],'4':[0x9,0x9,0xF,0x1,0x1,0x1],'5':[0xF,0x8,0xE,0x1,0x1,0xE],
    '6':[0x6,0x8,0xE,0x9,0x9,0x6],'7':[0xF,0x1,0x2,0x4,0x4,0x4],'8':[0x6,0x9,0x6,0x9,0x9,0x6],
    '9':[0x6,0x9,0x9,0x7,0x1,0x6],
    ' ':[0,0,0,0,0,0],'!':[0x2,0x2,0x2,0x2,0x0,0x2],'.':[0,0,0,0,0,0x2],'-':[0,0,0xF,0,0,0],
    ':':[0,0x2,0,0,0x2,0],'/':[0x1,0x1,0x2,0x4,0x8,0x8],
  };
  return F;
}

// ---------- main loop ----------
let acc = 0, last = 0;
const STEP = 1000 / 60;
function loop(ts) {
  if (!last) last = ts;
  acc += ts - last; last = ts;
  let guard = 0;
  while (acc >= STEP && guard++ < 5) { Game.update(); acc -= STEP; }
  Game.render();
  requestAnimationFrame(loop);
}

// mute toggle on M
window.addEventListener('keydown', e => { if (e.code === 'KeyM') Sfx.toggleMute(); });
// resume audio on first interaction (browser policy)
window.addEventListener('pointerdown', () => Sfx.resume(), { once: true });

requestAnimationFrame(loop);
