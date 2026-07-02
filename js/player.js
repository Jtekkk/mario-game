// player.js — the hero's physics + power system.
//
// Two design lessons from SMB3 drive this file:
//
//  1. A RUN/POWER METER THAT GATES A REWARD. Hold run and keep moving to charge
//     a meter; when it's full you can boost/fly for a short time. One commitment,
//     a bigger payoff — exactly the P-meter idea, rebuilt originally.
//
//  2. POWER TIERS AS HEALTH + ABILITY. The hero has tiers:
//        0 SMALL   -> one hit from death
//        1 ARMORED -> a free hit (drops you to SMALL instead of dying)
//        2 MODULE  -> armored PLUS an active ability (jet / drill)
//     Getting hit knocks you DOWN a tier instead of instant death — forgiving,
//     but every tier is worth protecting.
//
// Feel details that make platformers good, all here on purpose:
//   acceleration + friction (not instant velocity), variable jump height,
//   coyote time, and jump buffering.

const PHYS = {
  // Asymmetric gravity: you fall faster than you rise. This is the single
  // biggest "feel" lever — it keeps the jump arc crisp instead of floaty and
  // makes landings feel deliberate. (apex ~3.3 tiles, reach ~6 tiles.)
  gravityUp: 0.48,    // while rising
  gravityFall: 0.72,  // while falling
  maxFall: 8.5,
  walkAccel: 0.42,
  runAccel: 0.62,
  friction: 0.55,
  walkMax: 2.1,
  runMax: 3.6,
  coyoteTime: 6,      // frames after leaving a ledge you can still jump
  // Charged jump: hold jump on the ground to fill PWR (it stays full while
  // held); release to leap. Height AND apex hang time scale with the charge.
  // A quick tap = a normal jump; a full charge = a high, floaty jump.
  meterMax: 100,
  chargeRate: 2.2,    // PWR filled per frame while holding on the ground (~45f to full)
  jumpMin: -7.1,      // launch velocity for a quick tap (a normal jump)
  jumpMax: -9.9,      // launch velocity at full charge (a high jump)
  hangBand: 1.7,      // |vy| below this counts as "at the apex"
  hangGravity: 0.12,  // reduced gravity during hang time (the float at the top)
  hangMax: 42,        // frames of hang time at full charge (scaled by charge)
};

const TIER = { SMALL: 0, ARMORED: 1, MODULE: 2 };

class Player {
  constructor(x, y) {
    this.x = x; this.y = y;
    this.w = 12; this.h = 14;
    this.vx = 0; this.vy = 0;
    this.face = 1;            // 1 right, -1 left
    this.onGround = false;
    this.tier = TIER.SMALL;
    this.module = null;       // 'jet' | 'drill' | null
    this.meter = 0;
    this.charging = false;    // holding jump on the ground to charge a leap
    this.hang = 0;            // frames of apex hang time remaining
    this.coyote = 0;
    this.invuln = 0;          // i-frames after taking a hit
    this.animT = 0;
    this.dead = false;
    this.bolts = 0;
    this.spawnX = x; this.spawnY = y;
  }

  get maxSpeed() { return this._running ? PHYS.runMax : PHYS.walkMax; }

  // Rectangle in world space.
  get rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }

  hurt() {
    if (this.invuln > 0) return false;
    this.invuln = 90;
    if (this.tier > TIER.SMALL) {
      this.tier -= 1;
      if (this.tier < TIER.MODULE) this.module = null;
      return false; // survived, dropped a tier
    }
    this.dead = true;
    return true;
  }

  gainModule(kind) {
    this.module = kind;
    this.tier = TIER.MODULE;
  }
  gainArmor() { if (this.tier < TIER.ARMORED) this.tier = TIER.ARMORED; }

  update(level) {
    if (this.dead) return;
    const held = Input.down.bind(Input);
    this._running = held('run');

    // ---- horizontal: accelerate toward input, apply friction otherwise ----
    const accel = this._running ? PHYS.runAccel : PHYS.walkAccel;
    let dir = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    if (dir !== 0) {
      this.vx += dir * accel;
      this.face = dir;
      const m = this.maxSpeed;
      if (this.vx > m) this.vx = m;
      if (this.vx < -m) this.vx = -m;
    } else {
      if (this.vx > 0) this.vx = Math.max(0, this.vx - PHYS.friction);
      else if (this.vx < 0) this.vx = Math.min(0, this.vx + PHYS.friction);
    }

    // ---- coyote timer (small grace to still jump just after a ledge) ----
    if (this.onGround) this.coyote = PHYS.coyoteTime; else if (this.coyote > 0) this.coyote--;

    // ---- charged jump ----
    // HOLD jump on the ground to fill PWR; it charges up and STAYS full while
    // held. RELEASE to leap: both the launch height and the apex hang time
    // scale with how full the charge got. A quick tap gives a normal jump.
    const holding = held('jump');
    if (holding && this.onGround) {
      this.charging = true;
      this.meter = Math.min(PHYS.meterMax,
        this.meter + PHYS.chargeRate * (this.module === 'jet' ? 1.5 : 1));
    }
    if (Input.justReleased('jump') && this.charging && (this.onGround || this.coyote > 0)) {
      const t = this.meter / PHYS.meterMax;                // 0..1 charge fraction
      this.vy = PHYS.jumpMin + (PHYS.jumpMax - PHYS.jumpMin) * t;
      this.hang = Math.round(PHYS.hangMax * t);            // hang time scales too
      this.onGround = false; this.coyote = 0;
      this.charging = false; this.meter = 0;
      Sfx.jump();
    }
    // cancel a charge if the button is up or we lost the ground without leaping
    if (!holding && this.charging) { this.charging = false; this.meter = 0; }
    if (this.charging && !this.onGround && this.coyote <= 0) { this.charging = false; this.meter = 0; }

    // ---- vertical acceleration, with apex hang time ----
    if (this.vy < -PHYS.hangBand) {
      this.vy += PHYS.gravityUp;                            // rising hard
    } else if (this.vy > PHYS.hangBand) {
      this.vy += PHYS.gravityFall;                          // falling
    } else if (this.hang > 0) {
      this.hang--;                                          // near apex: float
      this.vy += PHYS.hangGravity;
    } else {
      this.vy += this.vy < 0 ? PHYS.gravityUp : PHYS.gravityFall;
    }
    if (this.vy > PHYS.maxFall) this.vy = PHYS.maxFall;

    // ---- integrate + resolve against tiles, axis by axis ----
    this._moveAxis(level, this.vx, 0);
    this._moveAxis(level, 0, this.vy);
    // Determine grounded via a dedicated probe rather than the collision-snap
    // timing. Inferring it from the snap makes onGround flicker on flat ground
    // (the player sinks ~1px, snaps, repeats), which starved the power meter.
    this.onGround = this._probeGround(level);
    if (this.onGround && this.vy > 0) this.vy = 0; // pin to the floor, no jitter

    // Level ceiling: flight must never carry you off the top of the screen.
    if (this.y < 0) { this.y = 0; if (this.vy < 0) this.vy = 0; }

    if (this.invuln > 0) this.invuln--;
    this.animT += Math.abs(this.vx) * 0.15 + 0.05;

    // fell out of the world
    if (this.y > level.pxHeight + 40) this.dead = true;
  }

  // Move along one axis and stop at the first solid tile hit.
  _moveAxis(level, dx, dy) {
    this.x += dx; this.y += dy;
    const left = Math.floor(this.x / Level.TILE);
    const right = Math.floor((this.x + this.w - 1) / Level.TILE);
    const top = Math.floor(this.y / Level.TILE);
    const bottom = Math.floor((this.y + this.h - 1) / Level.TILE);

    for (let ty = top; ty <= bottom; ty++) {
      for (let tx = left; tx <= right; tx++) {
        if (!Level.isSolid(level, tx, ty)) continue;
        const info = Level.tileInfo(Level.tileAt(level, tx, ty));
        if (info.hurts) { this.hurt(); }
        const tileL = tx * Level.TILE, tileT = ty * Level.TILE;
        if (dx > 0) { this.x = tileL - this.w; this.vx = 0; }
        else if (dx < 0) { this.x = tileL + Level.TILE; this.vx = 0; }
        else if (dy > 0) { this.y = tileT - this.h; this.vy = 0; }
        else if (dy < 0) { this.y = tileT + Level.TILE; this.vy = 0; }
        return; // one resolution per axis step is enough at these speeds
      }
    }
  }

  // Is there solid ground directly under the feet? Inset horizontally by 1px so
  // brushing a wall doesn't read as standing on it.
  _probeGround(level) {
    if (this.vy < 0) return false; // rising: never grounded
    const footRow = Math.floor((this.y + this.h) / Level.TILE);
    const left = Math.floor((this.x + 1) / Level.TILE);
    const right = Math.floor((this.x + this.w - 2) / Level.TILE);
    for (let tx = left; tx <= right; tx++) {
      if (Level.isSolid(level, tx, footRow)) return true;
    }
    return false;
  }
}

const PlayerNS = { Player, PHYS, TIER };
