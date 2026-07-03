// enemies.js — simple, readable enemy behaviors.
//
// Lesson from SMB3's roster: enemies don't need AI, they need *legible patterns*
// the player can read and plan around. A patroller that turns at ledges/walls,
// and a hopper on a timer, are enough to create real gameplay. Defeat model is
// the classic one: land on top to stomp; touch the side and you take a hit.

class Enemy {
  constructor(x, y, kind) {
    this.kind = kind;
    this.x = x; this.y = y;
    this.w = kind === 'hopper' ? 8 : 10;
    this.h = 8;
    this.vx = kind === 'hopper' ? 0 : -0.7;
    this.vy = 0;
    this.dead = false;
    this.squash = 0;       // frames of squash animation after being stomped
    this.animT = 0;
    this.hopTimer = 30 + ((x * 7) % 40); // deterministic, no RNG needed
  }

  get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  update(level) {
    if (this.dead) { if (this.squash > 0) this.squash--; return; }
    this.animT += 0.2;

    if (this.kind === 'crawler') {
      // Patrol: turn around at a wall or before walking off a ledge.
      const nextX = this.x + this.vx;
      const dir = this.vx > 0 ? 1 : -1;
      const aheadTx = Math.floor((nextX + (dir > 0 ? this.w : 0)) / Level.TILE);
      const footTy = Math.floor((this.y + this.h + 1) / Level.TILE);
      const midTy = Math.floor((this.y + this.h / 2) / Level.TILE);
      const wall = Level.isSolid(level, aheadTx, midTy);
      const ledge = !Level.isSolid(level, aheadTx, footTy);
      if (wall || ledge) this.vx = -this.vx;
      else this.x = nextX;
    } else if (this.kind === 'hopper') {
      this.hopTimer--;
      if (this.hopTimer <= 0 && this.onGround) { this.vy = -5.2; this.hopTimer = 60; }
    }

    // gravity for both
    this.vy = Math.min(PlayerNS.PHYS.maxFall, this.vy + PlayerNS.PHYS.gravityFall);
    this.onGround = false;
    this.y += this.vy;
    const tx0 = Math.floor(this.x / Level.TILE);
    const tx1 = Math.floor((this.x + this.w - 1) / Level.TILE);
    const ty = Math.floor((this.y + this.h - 1) / Level.TILE);
    for (let tx = tx0; tx <= tx1; tx++) {
      if (Level.isSolid(level, tx, ty) && this.vy > 0) {
        this.y = ty * Level.TILE - this.h; this.vy = 0; this.onGround = true; break;
      }
    }
  }

  // Called when the player's rect overlaps this enemy.
  // Returns 'stomp' | 'hit' | null.
  collidePlayer(p) {
    if (this.dead || p.dead) return null;
    // Falling onto the top third counts as a stomp.
    const fallingOnto = p.vy > 0 && (p.y + p.h) - this.y < this.h * 0.7;
    if (fallingOnto) {
      this.dead = true; this.squash = 12;
      p.vy = -5.2; // bounce
      Sfx.stomp();
      return 'stomp';
    }
    // Drill module bulldozes enemies you run into.
    if (p.module === 'drill' && Math.abs(p.vx) > 1.5) {
      this.dead = true; this.squash = 12;
      Sfx.stomp();
      return 'stomp';
    }
    return 'hit';
  }
}

// Boss — a bigger foe with an HP bar. Weak to one power-up (triple damage) but
// beatable by any offensive means (stomp, laser, bees, dash, nuke, moon).
// Movement is deterministic (driven by a frame counter — no RNG).
class Boss {
  constructor(x, y, cfg) {
    this.name = cfg.name; this.weakness = cfg.weakness;
    this.color = cfg.color; this.pattern = cfg.pattern;
    this.w = 30; this.h = 26;
    this.homeX = x; this.homeY = y;
    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;
    this.maxHp = 6; this.hp = 6;
    this.hitCd = 0; this.flash = 0;
    this.dead = false; this.deadTimer = 0;
    this.t = 0; this.state = 'idle'; this.actionCd = 90; this.dir = -1;
  }
  get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  // Apply damage. The boss's weakness power-up deals triple.
  hit(base, source) {
    if (this.dead || this.hitCd > 0) return false;
    const dmg = (source === this.weakness) ? base * 3 : base;
    this.hp -= dmg;
    this.hitCd = 12; this.flash = 8;
    if (this.hp <= 0) { this.hp = 0; this.dead = true; this.deadTimer = 55; this.vy = -3; }
    return true;
  }

  update(player) {
    this.t++;
    if (this.hitCd > 0) this.hitCd--;
    if (this.flash > 0) this.flash--;
    if (this.dead) { this.deadTimer--; this.vy += 0.35; this.y += this.vy; this.x += Math.sin(this.t * 0.5) * 2; return; }

    if (this.pattern === 'hover') {              // floats, then lunges at you
      if (this.state === 'idle') {
        this.x = this.homeX + Math.sin(this.t * 0.05) * 44;
        this.y = this.homeY + Math.sin(this.t * 0.1) * 14;
        if (--this.actionCd <= 0) {
          const dx = player.x - this.x, dy = player.y - this.y, m = Math.hypot(dx, dy) || 1;
          this.vx = dx / m * 3.4; this.vy = dy / m * 3.4; this.state = 'lunge'; this.lungeT = 24;
        }
      } else if (this.state === 'lunge') {
        this.x += this.vx; this.y += this.vy; this.vx *= 0.93; this.vy *= 0.93;
        if (--this.lungeT <= 0) this.state = 'return';
      } else {
        this.x += (this.homeX - this.x) * 0.06; this.y += (this.homeY - this.y) * 0.06;
        if (Math.abs(this.x - this.homeX) < 5 && Math.abs(this.y - this.homeY) < 5) { this.state = 'idle'; this.actionCd = 95; }
      }
    } else if (this.pattern === 'bounce') {      // big hopper across the arena
      this.vy += 0.4; this.y += this.vy;
      if (this.y >= this.homeY) { this.y = this.homeY; this.vy = -6.6; this.vx = (player.x > this.x ? 1 : -1) * 1.8; }
      this.x = Math.max(this.homeX - 72, Math.min(this.homeX + 72, this.x + this.vx));
    } else {                                     // 'charge' — telegraph then rush
      if (this.state === 'idle') {
        this.y = this.homeY + Math.sin(this.t * 0.06) * 6;
        if (--this.actionCd <= 0) { this.dir = player.x > this.x ? 1 : -1; this.state = 'charge'; this.chargeT = 42; }
      } else {
        this.x = Math.max(this.homeX - 84, Math.min(this.homeX + 84, this.x + this.dir * 4.4));
        if (--this.chargeT <= 0) { this.state = 'idle'; this.actionCd = 78; }
      }
    }
  }
}

const Enemies = { Enemy, Boss };
