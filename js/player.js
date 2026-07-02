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
  gravity: 0.42,
  maxFall: 8.5,
  walkAccel: 0.42,
  runAccel: 0.62,
  friction: 0.55,
  walkMax: 2.1,
  runMax: 3.6,
  jumpVel: -7.7,
  jumpCut: 0.45,      // multiply upward vel when jump released (variable height)
  coyoteTime: 6,      // frames after leaving a ledge you can still jump
  jumpBuffer: 6,      // frames a jump press is remembered before landing
  meterMax: 100,
  meterGain: 1.9,     // per frame while running at speed
  meterDrain: 1.2,    // per frame when not
  flyTime: 150,       // frames of boosted flight when meter is full
  flyThrust: -0.55,   // upward accel while boosting
  flyMaxUp: -4.0,
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
    this.flying = 0;          // frames of flight remaining
    this.coyote = 0;
    this.buffer = 0;
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

    // ---- run/power meter: charge while running fast on the ground ----
    if (this._running && Math.abs(this.vx) > PHYS.walkMax && this.onGround) {
      this.meter = Math.min(PHYS.meterMax, this.meter + PHYS.meterGain);
    } else if (this.flying <= 0) {
      this.meter = Math.max(0, this.meter - PHYS.meterDrain);
    }
    const charged = this.meter >= PHYS.meterMax;

    // ---- jump: coyote time + input buffering ----
    if (this.onGround) this.coyote = PHYS.coyoteTime; else if (this.coyote > 0) this.coyote--;
    if (Input.justPressed('jump')) this.buffer = PHYS.jumpBuffer; else if (this.buffer > 0) this.buffer--;

    if (this.buffer > 0 && this.coyote > 0) {
      this.vy = PHYS.jumpVel;
      this.onGround = false;
      this.coyote = 0; this.buffer = 0;
      Sfx.jump();
    }
    // variable jump height: releasing jump early cuts the rise
    if (Input.justReleased('jump') && this.vy < 0) this.vy *= PHYS.jumpCut;

    // ---- flight: when charged, press jump in the air to boost ----
    if (charged && !this.onGround && this.flying <= 0 &&
        (Input.justPressed('jump') || (this.module === 'jet' && held('jump') && this.vy > 0))) {
      this.flying = PHYS.flyTime;
      this.meter = 0;
      Sfx.boost();
    }
    if (this.flying > 0) {
      this.flying--;
      if (held('jump')) {
        this.vy += PHYS.flyThrust;
        if (this.vy < PHYS.flyMaxUp) this.vy = PHYS.flyMaxUp;
      }
    }

    // ---- gravity ----
    this.vy += PHYS.gravity;
    if (this.vy > PHYS.maxFall) this.vy = PHYS.maxFall;

    // ---- integrate + resolve against tiles, axis by axis ----
    this._moveAxis(level, this.vx, 0);
    this._moveAxis(level, 0, this.vy);
    // Determine grounded via a dedicated probe rather than the collision-snap
    // timing. Inferring it from the snap makes onGround flicker on flat ground
    // (the player sinks ~1px, snaps, repeats), which starved the power meter.
    this.onGround = this._probeGround(level);
    if (this.onGround && this.vy > 0) this.vy = 0; // pin to the floor, no jitter

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
