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

const State = { TITLE: 'title', PLAY: 'play', CLEAR: 'clear', DEAD: 'dead', COMPLETE: 'complete' };

const Game = {
  state: State.TITLE,
  level: null,
  levelIndex: 0,
  player: null,
  enemies: [],
  bolts: [],
  secret: null,          // the hidden power-up of this level
  inv: {},               // persistent inventory across levels
  beams: [], bees: [], debris: [],   // active effects
  nukeFlash: 0, moonSeq: 0,
  banner: null, bannerT: 0,
  particles: [],
  cam: { x: 0, y: 0 },
  time: 0,
  frame: 0,
  transition: 0,
  best: Number(localStorage.getItem('bolt_best') || 0),
  progress: Number(localStorage.getItem('bolt_progress') || 0),  // highest level unlocked

  // Load the current level. Inventory + bolt total persist across levels.
  load() {
    this.level = Level.parseLevel(Level.LEVELS[this.levelIndex]);
    this.theme = Level.THEMES[this.levelIndex] || Level.THEMES[0];
    const s = this.level.spawns;
    this.player = new PlayerNS.Player(s.player.x, s.player.y - 2);
    this.player.inv = this.inv;                 // share the persistent inventory
    this.player.bolts = this._totalBolts || 0;
    this.enemies = s.enemies.map(e => new Enemies.Enemy(e.x, e.y, e.kind));
    this.bolts = s.bolts.map(b => ({ x: b.x + 4, y: b.y + 4, got: false, t: 0 }));
    this.secret = s.secret ? { x: s.secret.x, y: s.secret.y, powerup: s.secret.powerup, got: false, t: 0 } : null;
    this.beams = []; this.bees = []; this.debris = []; this.bossShots = [];
    this.nukeFlash = 0; this.moonSeq = 0;
    // boss?
    const bcfg = Level.BOSSES[this.levelIndex];
    if (bcfg) {
      const gx = this._goalX();
      // carve a flat, pit-free arena floor before the goal so the fight is fair
      for (let x = Math.max(0, gx - 18); x <= gx - 1; x++)
        for (let y = 12; y < this.level.h; y++) this.level.grid[y][x] = '#';
      this.enemies = this.enemies.filter(e => e.x < (gx - 18) * Level.TILE);
      const bx = (gx - 9) * Level.TILE;
      const floorY = 12 * Level.TILE;
      // bounce/charge fight at ground level (so stomp/dash connect); only the
      // hover boss floats (and it's weak to the angled laser).
      const by = bcfg.pattern === 'hover' ? floorY - 44 : floorY - 26;
      this.boss = new Enemies.Boss(bx, by, bcfg);
    } else this.boss = null;
    this.bossDefeated = false;
    this.particles = [];
    this.cam = { x: 0, y: 0 };
    this.time = 300 * 60; // frames
    this.frame = 0;
    // level music: one looping track per level; announce it when it changes
    // (a retry of the same level keeps the track playing seamlessly)
    if (Music.playFor(this.levelIndex)) {
      this._flashBanner('NOW PLAYING  ' + Music.currentName(), Art.PAL.e, 140);
    }
  },

  _goalX() {
    const L = this.level;
    for (let x = L.w - 1; x >= 0; x--)
      for (let y = 0; y < L.h; y++)
        if (L.grid[y][x] === 'G') return x;
    return L.w - 4;
  },

  // Start the campaign at a given level (0 = new game). When resuming, grant
  // the secrets you'd already have collected from earlier levels.
  start(fromLevel = 0) {
    this.levelIndex = fromLevel;
    this.inv = {};
    for (let i = 0; i < fromLevel; i++) {
      const pu = Level.LEVELS[i].powerup;
      this.inv[pu] = Powerups.freshPower(pu);
    }
    this._totalBolts = 0;
    this.load();
    this.state = State.PLAY;
    Sfx.resume();
  },

  // Advance to a given level index (used by goal + magic carpet).
  gotoLevel(idx) {
    this._totalBolts = this.player.bolts;
    if (idx > this.progress && idx <= Level.LEVELS.length) {
      this.progress = Math.min(idx, Level.LEVELS.length);
      try { localStorage.setItem('bolt_progress', this.progress); } catch (e) {}
    }
    if (idx >= Level.LEVELS.length) { this.state = State.COMPLETE; Sfx.win(); return; }
    this.levelIndex = idx;
    this.load();
    this.state = State.PLAY;
  },

  addBurst(x, y, color, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.particles.push({ x, y, vx: Math.cos(a) * (1 + i % 3), vy: Math.sin(a) * (1 + i % 3) - 1, life: 24, color });
    }
  },

  update() {
    this.frame++;
    Input.beginFrame();
    if (this.bannerT > 0) this.bannerT--;

    if (this.state === State.TITLE) {
      const canContinue = this.progress > 0 && this.progress < Level.LEVELS.length;
      if (Input.justPressed('start') || Input.justPressed('jump')) this.start(canContinue ? this.progress : 0);
      else if (Input.justPressed('reset')) this.start(0);   // R = new game
      Input.endFrame(); return;
    }
    if (this.state === State.CLEAR) {
      this.transition--;
      this._updateParticles();
      if (this.transition <= 0 || Input.justPressed('start') || Input.justPressed('jump'))
        this.gotoLevel(this.levelIndex + 1);
      Input.endFrame(); return;
    }
    if (this.state === State.DEAD) {
      if (Input.justPressed('start') || Input.justPressed('jump') || Input.justPressed('reset')) {
        this.load(); this.state = State.PLAY;   // retry this level, keep inventory
      }
      this._updateParticles(); Input.endFrame(); return;
    }
    if (this.state === State.COMPLETE) {
      if (Input.justPressed('start') || Input.justPressed('jump')) { this.state = State.TITLE; Music.stop(); }
      this._updateParticles(); Input.endFrame(); return;
    }

    // ---- PLAY ----
    if (Input.justPressed('reset')) { this.load(); this.state = State.PLAY; Input.endFrame(); return; }

    const p = this.player;
    p.update(this.level);
    this._powers();          // activate abilities from key presses
    this._updateEffects();   // beams, bees, debris, timers

    // timer
    if (this.time > 0) this.time--; else p.dead = true;

    // enemies
    for (const e of this.enemies) {
      e.update(this.level);
      if (e.dead || !rectsOverlap(p.rect, e.rect)) continue;
      if (p.dashing > 0 || p.riding) {           // dash / pig plows through
        e.dead = true; e.squash = 12;
        this.addBurst(e.x + e.w / 2, e.y + e.h / 2, Art.PAL.o, 6);
        Sfx.stomp();
        continue;
      }
      const r = e.collidePlayer(p);
      if (r === 'stomp') this.addBurst(e.x + e.w / 2, e.y + e.h / 2, Art.PAL.o, 6);
      else if (r === 'hit') {
        const died = p.hurt();
        if (p.invuln === 90) { // a real hit landed this frame
          Sfx.hurt();
          this.addBurst(p.x + p.w / 2, p.y + p.h / 2, Art.PAL.e, 8);
        }
        if (died) this._die();
      }
    }

    this._updateBoss();

    // bolts
    for (const b of this.bolts) {
      if (b.got) continue;
      b.t++;
      if (rectsOverlap(p.rect, { x: b.x - 4, y: b.y - 4, w: 8, h: 8 })) {
        b.got = true; p.bolts++; Sfx.bolt();
        this.addBurst(b.x, b.y, Art.PAL.o, 5);
      }
    }

    // the hidden power-up of this level
    if (this.secret && !this.secret.got) {
      this.secret.t++;
      if (rectsOverlap(p.rect, { x: this.secret.x - 2, y: this.secret.y - 2, w: 12, h: 12 })) {
        this.secret.got = true;
        const name = this.secret.powerup;
        p.inv[name] = Powerups.freshPower(name);
        const meta = Powerups.POWERUPS[name];
        this._flashBanner('GOT ' + meta.label + '   PRESS [' + meta.key + ']', meta.color, 150);
        Sfx.module();
        this.addBurst(this.secret.x + 4, this.secret.y + 4, meta.color, 16);
      }
    }

    // reached the goal pillar? (on boss levels it's locked until the boss falls)
    const ptx0 = Math.floor(p.x / Level.TILE), ptx1 = Math.floor((p.x + p.w) / Level.TILE);
    for (let tx = ptx0; tx <= ptx1; tx++) {
      const ty = Math.floor((p.y + p.h / 2) / Level.TILE);
      if (Level.tileAt(this.level, tx, ty) === 'G') {
        if (this.boss && !this.boss.dead) {
          if (this.frame % 40 < 2) this._flashBanner('DEFEAT THE BOSS FIRST', [255, 120, 80], 60);
        } else { this._clearLevel(); }
      }
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
  _clearLevel() {
    if (this.state !== State.PLAY) return;
    this._totalBolts = this.player.bolts;
    const score = this.player.bolts * 100 + Math.floor(this.time / 60) * 10;
    if (score > this.best) { this.best = score; localStorage.setItem('bolt_best', score); }
    if (this.levelIndex >= Level.LEVELS.length - 1) { this.state = State.COMPLETE; Sfx.win(); return; }
    this.state = State.CLEAR;
    this.transition = 110;
    Sfx.win();
  },

  _flashBanner(text, color, frames) { this.banner = { text, color }; this.bannerT = frames; },

  _updateBoss() {
    const p = this.player;
    // boss shots keep flying (and hurting) even if the boss just fell
    for (const sh of this.bossShots) {
      sh.x += sh.vx; sh.y += sh.vy; sh.life--;
      if (rectsOverlap({ x: sh.x - 3, y: sh.y - 3, w: 6, h: 6 }, p.rect)) {
        sh.life = 0;
        const died = p.hurt();
        if (p.invuln === 90) { Sfx.hurt(); this.addBurst(p.x + p.w / 2, p.y + p.h / 2, Art.PAL.e, 8); }
        if (died) this._die();
      }
    }
    this.bossShots = this.bossShots.filter(s => s.life > 0);

    const b = this.boss;
    if (!b) return;
    b.update(p);

    if (b.dead) {
      if (!this.bossDefeated) { this.bossDefeated = true; this._flashBanner(b.name + ' DEFEATED  REACH THE EXIT', b.color, 150); }
      if (b.deadTimer > 0 && this.frame % 3 === 0) this.addBurst(b.x + b.w / 2 + (b.t % 20 - 10), b.y + b.h / 2, b.color, 5);
      return;
    }

    // fire a telegraphed, dodgeable shot aimed at the player
    b.fireCd--;
    if (b.fireCd <= 0) {
      const sx = b.x + b.w / 2, sy = b.y + b.h / 2;
      const dx = (p.x + p.w / 2) - sx, dy = (p.y + p.h / 2) - sy, m = Math.hypot(dx, dy) || 1;
      this.bossShots.push({ x: sx, y: sy, vx: dx / m * 2.0, vy: dy / m * 2.0, life: 170, color: b.color });
      b.fireCd = 110;
      Sfx.boost();
    }

    // contact: stomp/plow damages the boss; a side hit hurts the player
    if (rectsOverlap(p.rect, b.rect)) {
      const fallingOn = p.vy > 0 && (p.y + p.h) - b.y < b.h * 0.6;
      if (p.dashing > 0 || p.riding) {
        if (b.hit(1, p.dashing > 0 ? 'dash' : 'pig')) { this.addBurst(b.x + b.w / 2, b.y, b.color, 5); Sfx.stomp(); }
      } else if (fallingOn) {
        if (b.hit(1, 'stomp')) { this.addBurst(b.x + b.w / 2, b.y, b.color, 5); Sfx.stomp(); }
        p.vy = -5.6;
      } else {
        const died = p.hurt();
        if (p.invuln === 90) { Sfx.hurt(); this.addBurst(p.x + p.w / 2, p.y + p.h / 2, Art.PAL.e, 8); }
        if (died) this._die();
      }
    }
    // laser beams
    for (const beam of this.beams) {
      if (beam.y > b.y && beam.y < b.y + b.h &&
          Math.min(beam.x, beam.x2) < b.x + b.w && Math.max(beam.x, beam.x2) > b.x) {
        if (b.hit(1, 'laser')) this.addBurst(b.x + b.w / 2, beam.y, b.color, 5);
      }
    }
    // bees
    for (const bee of this.bees) {
      if (rectsOverlap({ x: bee.x - 3, y: bee.y - 3, w: 6, h: 6 }, b.rect)) {
        if (b.hit(1, 'bees')) { bee.life = 0; this.addBurst(bee.x, bee.y, b.color, 4); }
      }
    }
  },

  // ---------- power-up activation ----------
  _powers() {
    const p = this.player;
    p.heliOn = !!p.inv.heli && Input.down('heli');   // heli is a hold
    for (const name of Powerups.POWER_ORDER) {
      if (!p.inv[name]) continue;
      if (Input.justPressed(name)) this._activate(name, p.inv[name]);
    }
  },

  _activate(name, st) {
    const p = this.player;
    switch (name) {
      case 'laser': {
        if (st.cd > 0) break;
        st.cd = Powerups.PWR.laserCd;
        const y = p.y + 4;
        let best = null, bestd = Powerups.PWR.laserRange;
        for (const e of this.enemies) {
          if (e.dead) continue;
          const dx = (e.x + e.w / 2) - (p.x + p.w / 2);
          if (Math.sign(dx) !== p.face) continue;
          if (Math.abs((e.y + e.h / 2) - y) > 22) continue;
          if (Math.abs(dx) < bestd) { bestd = Math.abs(dx); best = e; }
        }
        let endX = best ? best.x + best.w / 2 : p.x + p.face * Powerups.PWR.laserRange;
        let endY = y;
        // the boss: hit it if it's in front within range, at ANY height (angled beam)
        if (this.boss && !this.boss.dead) {
          const bdx = (this.boss.x + this.boss.w / 2) - (p.x + p.w / 2);
          if (Math.sign(bdx) === p.face && Math.abs(bdx) < Powerups.PWR.laserRange) {
            this.boss.hit(1, 'laser');
            endX = this.boss.x + this.boss.w / 2; endY = this.boss.y + this.boss.h / 2;
          }
        }
        this.beams.push({ x: p.x + p.w / 2, y, x2: endX, y2: endY, life: 8 });
        if (best) { best.dead = true; best.squash = 12; this.addBurst(best.x + best.w / 2, best.y, Art.PAL2.e || [90,220,255], 8); }
        Sfx.stomp();
        break;
      }
      case 'bees': {
        if (st.ammo <= 0) break;
        st.ammo--;
        for (let i = 0; i < Powerups.PWR.beesCount; i++) {
          const a = (i / Powerups.PWR.beesCount) * Math.PI * 2;
          this.bees.push({ x: p.x + 6, y: p.y + 6, vx: Math.cos(a) * 2, vy: Math.sin(a) * 2, life: Powerups.PWR.beesLife });
        }
        Sfx.boost();
        break;
      }
      case 'juke': {
        if (st.cd > 0) break;
        st.cd = Powerups.PWR.jukeCd;
        p.invuln = Math.max(p.invuln, Powerups.PWR.jukeIframes);
        p.vx = p.face * Powerups.PWR.jukeStep;   // quick sidestep in facing dir
        this.addBurst(p.x + 6, p.y + 7, Powerups.POWERUPS.juke.color, 8);
        Sfx.jump();
        break;
      }
      case 'shield': {
        if (st.ammo <= 0 || p.shieldTimer > 0) break;
        st.ammo--;
        p.shieldTimer = Powerups.PWR.shieldTime;
        Sfx.module();
        break;
      }
      case 'pig': {
        p.riding = !p.riding;
        this.addBurst(p.x + 6, p.y + 10, Powerups.POWERUPS.pig.color, 8);
        Sfx.module();
        break;
      }
      case 'dash': {
        if (st.cd > 0) break;
        st.cd = Powerups.PWR.dashCd;
        p.dashing = Powerups.PWR.dashFrames;
        p.invuln = Math.max(p.invuln, Powerups.PWR.dashFrames + 4);
        Sfx.boost();
        break;
      }
      case 'moon': {
        if (st.ammo <= 0 || this.moonSeq > 0) break;
        st.ammo--;
        this.moonSeq = Powerups.PWR.moonDelay;   // charge, then rain debris
        Sfx.boost();
        break;
      }
      case 'nuke': {
        if (st.ammo <= 0) break;
        st.ammo--;
        this.nukeFlash = 22;
        for (const e of this.enemies) { if (!e.dead) { e.dead = true; e.squash = 12; } }
        if (this.boss && !this.boss.dead) this.boss.hit(4, 'nuke');
        Sfx.die();
        break;
      }
      case 'carpet': {
        if (st.ammo <= 0) break;
        st.ammo--;
        this._flashBanner('MAGIC CARPET  SKIP 2 LEVELS', Powerups.POWERUPS.carpet.color, 90);
        this.gotoLevel(this.levelIndex + 3);     // skip the next two
        break;
      }
    }
  },

  _updateEffects() {
    // cool down each owned ability
    for (const name of Powerups.POWER_ORDER) {
      const st = this.player.inv[name];
      if (st && st.cd > 0) st.cd--;
    }
    // laser beams
    for (const b of this.beams) b.life--;
    this.beams = this.beams.filter(b => b.life > 0);
    // bees: home to the nearest target (enemy OR boss), kill enemies on contact
    for (const bee of this.bees) {
      let tgt = null, td = 1e9;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = (e.x - bee.x) ** 2 + (e.y - bee.y) ** 2;
        if (d < td) { td = d; tgt = e; }
      }
      if (this.boss && !this.boss.dead) {
        const d = (this.boss.x + this.boss.w / 2 - bee.x) ** 2 + (this.boss.y + this.boss.h / 2 - bee.y) ** 2;
        if (d < td) { td = d; tgt = this.boss; }
      }
      if (tgt) {
        const dx = (tgt.x + tgt.w / 2) - bee.x, dy = (tgt.y + tgt.h / 2) - bee.y;
        const m = Math.hypot(dx, dy) || 1;
        bee.vx += (dx / m) * 0.5; bee.vy += (dy / m) * 0.5;
        const s = Math.hypot(bee.vx, bee.vy), mx = Powerups.PWR.beesSpeed;
        if (s > mx) { bee.vx = bee.vx / s * mx; bee.vy = bee.vy / s * mx; }
        // enemy contact kills; boss damage is applied in _updateBoss
        if (td < 64 && tgt !== this.boss) { tgt.dead = true; tgt.squash = 12; bee.life = 0; this.addBurst(tgt.x + tgt.w / 2, tgt.y, Powerups.POWERUPS.bees.color, 5); }
      }
      bee.x += bee.vx; bee.y += bee.vy; bee.life--;
    }
    this.bees = this.bees.filter(b => b.life > 0);
    // moon destruct sequence
    if (this.moonSeq > 0) {
      this.moonSeq--;
      if (this.moonSeq === 0) {
        // spawn debris across the top of the screen; kill all ON-SCREEN enemies
        for (let i = 0; i < 26; i++) {
          this.debris.push({ x: this.cam.x + Math.random() * VIEW_W, y: this.cam.y - 10 - Math.random() * 40,
                             vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, life: 90 });
        }
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (e.x > this.cam.x - 8 && e.x < this.cam.x + VIEW_W + 8) { e.dead = true; e.squash = 12; }
        }
        if (this.boss && !this.boss.dead && this.boss.x > this.cam.x - 8 && this.boss.x < this.cam.x + VIEW_W + 8)
          this.boss.hit(3, 'moon');
        this.nukeFlash = 14;
      }
    }
    for (const d of this.debris) { d.x += d.vx; d.y += d.vy; d.vy += 0.12; d.life--; }
    this.debris = this.debris.filter(d => d.life > 0);
    if (this.nukeFlash > 0) this.nukeFlash--;
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
    this._drawSecret();
    this._drawEnemies();
    this._drawBoss();
    this._drawBossShots();
    this._drawBees();
    this._drawDebris();
    this._drawPlayer();
    this._drawBeams();
    this._drawParticles();
    ctx.restore();

    // full-screen effects
    this._drawMoon();
    if (this.nukeFlash > 0) {
      ctx.globalAlpha = this.nukeFlash / 22 * 0.85; ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H); ctx.globalAlpha = 1;
    }

    // HUD in screen space (the non-scrolling panel — the scanline-IRQ lesson).
    this._drawHUD();
    if (this.boss && !this.boss.dead) this._drawBossHUD();

    if (this.state === State.CLEAR) this._drawBanner('SECTOR CLEARED', 'GET READY...', Art.PAL.g);
    if (this.state === State.DEAD) this._drawBanner('SYSTEM DOWN', 'PRESS ENTER TO RETRY', Art.PAL.j);
    if (this.state === State.COMPLETE) this._drawBanner('CAMPAIGN COMPLETE!', `BEST ${this.best}   ENTER = TITLE`, Art.PAL.e);
    if (this.bannerT > 0 && this.banner) this._drawTopBanner();

    ctx.restore();
  },

  _drawSecret() {
    const s = this.secret;
    if (!s || s.got) return;
    const meta = Powerups.POWERUPS[s.powerup];
    const bob = Math.sin(s.t * 0.09) * 2;
    const c = meta.color;
    // pulsing aura so the secret reads as special
    ctx.save();
    ctx.globalAlpha = 0.3 + Math.sin(s.t * 0.15) * 0.18;
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(s.x - 3, s.y - 3 + bob, 14, 14);
    ctx.restore();
    ctx.drawImage(Art.CAPSULE, Math.round(s.x), Math.round(s.y + bob));
  },

  _drawBeams() {
    for (const b of this.beams) {
      const y2 = b.y2 != null ? b.y2 : b.y;
      ctx.save();
      ctx.globalAlpha = b.life / 8;
      ctx.strokeStyle = '#ff4d5e'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x2, y2); ctx.stroke();
      ctx.strokeStyle = '#ffd0d0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x2, y2); ctx.stroke();
      ctx.restore();
    }
  },

  _drawBees() {
    for (const bee of this.bees) ctx.drawImage(Art.BEE, Math.round(bee.x - 3), Math.round(bee.y - 2));
  },

  _drawDebris() {
    for (const d of this.debris) {
      ctx.fillStyle = d.life % 4 < 2 ? '#c9d4ef' : '#8a94b4';
      ctx.fillRect(Math.round(d.x), Math.round(d.y), 3, 3);
    }
  },

  _drawMoon() {
    if (this.moonSeq <= 0) return;
    const t = 1 - this.moonSeq / Powerups.PWR.moonDelay;   // 0..1 over the sequence
    const cx = VIEW_W - 46, cy = 40, r = 20;
    ctx.save();
    ctx.fillStyle = '#dfe8ff';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b9c4e0';
    ctx.beginPath(); ctx.arc(cx - 6, cy - 4, 4, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 5, cy + 6, 3, 0, Math.PI * 2); ctx.fill();
    // cracks grow as it's about to blow
    ctx.strokeStyle = `rgba(255,${Math.round(120 - t * 120)},80,${t})`;
    ctx.lineWidth = 1 + t * 2;
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r * t, cy - 4);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx + 4, cy + r * t);
    ctx.stroke();
    ctx.restore();
  },

  _drawTopBanner() {
    const bnr = this.banner, c = bnr.color;
    const w = bnr.text.length * 6 + 16;
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.bannerT / 20);
    ctx.fillStyle = 'rgba(6,10,26,0.9)';
    ctx.fillRect(VIEW_W / 2 - w / 2, 30, w, 16);
    ctx.strokeStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.lineWidth = 1;
    ctx.strokeRect(VIEW_W / 2 - w / 2, 30, w, 16);
    ctx.restore();
    text(bnr.text, VIEW_W / 2 - bnr.text.length * 3, 34, c);
  },

  _drawBossHUD() {
    const b = this.boss, meta = Powerups.POWERUPS[b.weakness];
    const w = 168, x = VIEW_W / 2 - w / 2, y = 36;
    ctx.fillStyle = 'rgba(6,10,26,0.8)';
    ctx.fillRect(x - 3, y - 3, w + 6, 17);
    text(b.name, x, y, b.color);
    text('WEAK ' + meta.key, x + w - 24, y, meta.color);
    ctx.fillStyle = '#101830'; ctx.fillRect(x, y + 8, w, 4);
    ctx.fillStyle = `rgb(${b.color[0]},${b.color[1]},${b.color[2]})`;
    ctx.fillRect(x, y + 8, Math.round(w * b.hp / b.maxHp), 4);
  },

  _drawSky() {
    const th = this.theme || Level.THEMES[0];
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, th.sky[0]); g.addColorStop(0.6, th.sky[1]); g.addColorStop(1, th.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    // parallax dots (twinkling stars on space themes)
    ctx.fillStyle = th.dot;
    for (let i = 0; i < 42; i++) {
      const par = th.stars ? 0.12 : 0.3;
      const x = ((i * 71 - this.cam.x * par) % (VIEW_W + 20) + VIEW_W + 20) % (VIEW_W + 20) - 10;
      const y = (i * 47) % VIEW_H;
      if (th.stars && i % 5 === 0 && this.frame % 40 < 20) continue; // twinkle
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

  _drawBoss() {
    const b = this.boss;
    if (!b || (b.dead && b.deadTimer <= 0)) return;
    const c = b.color;
    const flash = b.flash > 0 && this.frame % 2 === 0;
    ctx.save();
    if (b.dead) ctx.globalAlpha = Math.max(0, b.deadTimer / 55);
    // blocky armored body
    ctx.fillStyle = flash ? '#ffffff' : `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(b.x, b.y + 3, b.w, b.h - 6);
    ctx.fillRect(b.x + 3, b.y, b.w - 6, b.h);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(b.x + 4, b.y + b.h - 6, b.w - 8, 3);       // under-plating
    ctx.fillRect(b.x + 4, b.y + 3, b.w - 8, 2);
    ctx.strokeStyle = '#10121c'; ctx.lineWidth = 1;
    ctx.strokeRect(b.x + 3, b.y, b.w - 6, b.h);
    // single eye that looks toward the player
    const ex = b.x + b.w / 2, ey = b.y + b.h / 2 - 1;
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? '#000' : `rgb(${Math.max(0, c[0] - 70)},${Math.max(0, c[1] - 70)},${Math.max(0, c[2] - 70)})`;
    ctx.beginPath(); ctx.arc(ex + (this.player.x > b.x ? 2 : -2), ey, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (b.dead) return;
    // telegraph: the eye charges up just before it fires
    if (b.fireCd < 20) {
      ctx.save();
      ctx.globalAlpha = (20 - b.fireCd) / 20 * (this.frame % 4 < 2 ? 0.8 : 0.4);
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.beginPath(); ctx.arc(ex, ey, 3 + (20 - b.fireCd) * 0.3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // floating HP bar
    ctx.fillStyle = '#101830'; ctx.fillRect(b.x, b.y - 7, b.w, 3);
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    ctx.fillRect(b.x, b.y - 7, Math.round(b.w * b.hp / b.maxHp), 3);
  },

  _drawBossShots() {
    for (const sh of this.bossShots) {
      const c = sh.color;
      ctx.save();
      ctx.globalAlpha = Math.min(1, sh.life / 20);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},0.4)`;
      ctx.beginPath(); ctx.arc(sh.x, sh.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(Math.round(sh.x - 2), Math.round(sh.y - 2), 4, 4);
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.round(sh.x - 1), Math.round(sh.y - 1), 2, 2);
      ctx.restore();
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

    // pig mount, drawn under the hero
    if (p.riding) {
      const pig = p.face < 0 ? (HERO_L._pig || (HERO_L._pig = Art.flipSprite(Art.PIG))) : Art.PIG;
      ctx.drawImage(pig, Math.round(p.x - 1), Math.round(p.y + p.h - 4));
    }
    // helicopter rotor spinning above the head
    if (p.heliOn && p.heliFuel > 0) {
      const spin = (this.frame % 4 < 2) ? 7 : 3;
      ctx.strokeStyle = '#cfeaff'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x + 6 - spin, p.y - 2); ctx.lineTo(p.x + 6 + spin, p.y - 2); ctx.stroke();
      ctx.fillStyle = '#5adcff'; ctx.fillRect(p.x + 5, p.y - 3, 2, 2);
    }
    // dash streak
    if (p.dashing > 0) {
      ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = '#ffb040';
      for (let i = 1; i <= 3; i++) ctx.fillRect(Math.round(p.x - p.face * i * 4), Math.round(p.y + 3), 3, 8);
      ctx.restore();
    }

    // charging cue: a pulsing ring that grows and brightens with the charge
    if (p.charging) {
      const pct = p.meter / PlayerNS.PHYS.meterMax;
      const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
      const r = 8 + pct * 7 + Math.sin(this.frame * 0.5) * 1.5;
      ctx.save();
      ctx.globalAlpha = 0.35 + pct * 0.4;
      ctx.strokeStyle = pct >= 1 ? '#ffe066' : pct >= 0.5 ? '#8affa0' : '#5adcff';
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
    // thruster flame during the floaty apex (hang time) of a charged jump
    if (p.hang > 0) {
      const fl = (this.frame % 6 < 3) ? Art.FLAME.a : Art.FLAME.b;
      ctx.drawImage(fl, Math.round(p.x + 2), Math.round(p.y + p.h - 1));
    }
    ctx.drawImage(spr, Math.round(p.x - 0), Math.round(p.y));

    // light shield bubble
    if (p.shieldTimer > 0) {
      ctx.save();
      const flick = p.shieldTimer < 40 && this.frame % 6 < 3 ? 0.25 : 0.6;
      ctx.globalAlpha = flick;
      ctx.strokeStyle = '#8affa0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x + p.w / 2, p.y + p.h / 2, 12 + Math.sin(this.frame * 0.3), 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
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
    // top band (taller now, to fit an inventory row)
    ctx.fillStyle = 'rgba(6,10,26,0.85)';
    ctx.fillRect(0, 0, VIEW_W, 30);
    ctx.fillStyle = '#2a3a6a';
    ctx.fillRect(0, 30, VIEW_W, 1);

    const meta = Level.LEVELS[this.levelIndex];
    text('L' + (this.levelIndex + 1) + '/' + Level.LEVELS.length + ' ' + meta.name, 6, 4, Art.PAL.e);
    text('BOLTS ' + String(p.bolts).padStart(2, '0'), 6, 13, Art.PAL.o);
    text('TIME ' + String(Math.ceil(this.time / 60)).padStart(3, '0'), 84, 13, Art.PAL.w);
    // health pips
    text('HP', 140, 13, Art.PAL.m);
    for (let i = 0; i < p.maxHp; i++) {
      ctx.fillStyle = i < p.hp ? (p.invuln > 0 && this.frame % 6 < 3 ? '#ffd0d0' : '#ff5a6e') : '#3a2431';
      ctx.fillRect(153 + i * 8, 11, 6, 6);
    }

    // jump-charge meter
    const mx = 6, my = 22, mw = 72, mh = 4;
    ctx.fillStyle = '#101830';
    ctx.fillRect(mx, my, mw, mh);
    const pct = p.meter / PlayerNS.PHYS.meterMax;
    ctx.fillStyle = pct >= 1 ? (this.frame % 8 < 4 ? '#ffe066' : '#ff9a3c')
                  : pct >= 0.5 ? '#78e68c' : '#5adcff';
    ctx.fillRect(mx, my, Math.round(mw * pct), mh);
    if (p.charging && pct >= 1 && this.frame % 10 < 6) text('MAX!', mx + mw + 4, my - 1, Art.PAL.o);
    else if (p.charging) text('HOLD', mx + mw + 4, my - 1, Art.PAL.e);
    else if (p.hang > 0) text('HANG', mx + mw + 4, my - 1, Art.PAL.e);
    else text('PWR', mx + mw + 4, my - 1, Art.PAL.m);

    this._drawInventory();
  },

  // Owned abilities: colored key-tiles, dimmed when on cooldown / out of ammo.
  _drawInventory() {
    const p = this.player;
    let x = 150;
    for (const name of Powerups.POWER_ORDER) {
      const st = p.inv[name]; if (!st) continue;
      const m = Powerups.POWERUPS[name], c = m.color;
      let ready = true, badge = '';
      if ('ammo' in st) { ready = st.ammo > 0; badge = '' + st.ammo; }
      else if ('cd' in st) { ready = st.cd <= 0; }
      if (name === 'heli') ready = p.heliFuel > 5;
      if (name === 'pig' && p.riding) badge = '*';
      ctx.globalAlpha = ready ? 1 : 0.3;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(x, 18, 9, 9);
      ctx.globalAlpha = 1;
      text(m.key, x + 3, 20, [16, 18, 28]);
      if (badge) text(badge, x + 10, 21, c);
      x += badge ? 16 : 13;
      if (x > VIEW_W - 12) break;
    }
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
    text('A FACTORY RUN   10 LEVELS', VIEW_W / 2 - 75, 122, Art.PAL.w);
    const canContinue = this.progress > 0 && this.progress < Level.LEVELS.length;
    if (this.frame % 60 < 40) {
      if (canContinue) text('ENTER: CONTINUE L' + (this.progress + 1) + '     R: NEW GAME', VIEW_W / 2 - 111, 144, Art.PAL.o);
      else if (this.progress >= Level.LEVELS.length) text('CAMPAIGN COMPLETE   ENTER: PLAY AGAIN', VIEW_W / 2 - 111, 144, Art.PAL.g);
      else text('PRESS ENTER TO START', VIEW_W / 2 - 60, 144, Art.PAL.o);
    }
    text('ARROWS MOVE   Z JUMP   X RUN', VIEW_W / 2 - 84, 168, Art.PAL.m);
    text('HOLD JUMP TO CHARGE, RELEASE FOR A HIGH JUMP', VIEW_W / 2 - 132, 181, Art.PAL.m);
    text('EACH LEVEL HIDES A SECRET POWER-UP', VIEW_W / 2 - 102, 196, Art.PAL.o);
    text('FIRE IT WITH ITS KEY  F H K J L P B O N C', VIEW_W / 2 - 123, 206, Art.PAL.e);
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
    case '#': { // ground plate with rivets — tinted by the level theme
      const g = (Game.theme || Level.THEMES[0]).ground;
      ctx.fillStyle = g[0]; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = g[1]; ctx.fillRect(x, y, T, 3);
      ctx.fillStyle = g[2]; ctx.fillRect(x, y + T - 2, T, 2);
      ctx.fillStyle = g[3]; ctx.fillRect(x + 2, y + 5, 2, 2); ctx.fillRect(x + T - 4, y + 5, 2, 2);
      break;
    }
    case 'B': { // brick — themed
      const bk = (Game.theme || Level.THEMES[0]).brick;
      ctx.fillStyle = bk[0]; ctx.fillRect(x, y, T, T);
      ctx.fillStyle = bk[1]; ctx.fillRect(x, y + 7, T, 1); ctx.fillRect(x + 7, y, 1, 7); ctx.fillRect(x + 3, y + 8, 1, 8);
      ctx.fillStyle = bk[2]; ctx.fillRect(x + 1, y + 1, T - 2, 2);
      break;
    }
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

// M cycles the audio: everything on -> music off -> everything off -> ...
let audioMode = 0; // 0 = music + sfx, 1 = sfx only, 2 = silent
window.addEventListener('keydown', e => {
  if (e.code !== 'KeyM') return;
  audioMode = (audioMode + 1) % 3;
  Music.setEnabled(audioMode === 0);
  if (Sfx.isMuted() !== (audioMode === 2)) Sfx.toggleMute();
  const label = ['MUSIC + SFX ON', 'MUSIC OFF', 'ALL SOUND OFF'][audioMode];
  Game._flashBanner(label, Art.PAL.o, 90);
});
// resume audio on first interaction (browser policy)
window.addEventListener('pointerdown', () => Sfx.resume(), { once: true });

requestAnimationFrame(loop);
