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
    this.vy = Math.min(PlayerNS.PHYS.maxFall, this.vy + PlayerNS.PHYS.gravity);
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

const Enemies = { Enemy };
