// input.js — keyboard + gamepad, exposing a tiny "held / just-pressed" API.
//
// Good game feel starts at the input layer: we track not just what's held, but
// what was *pressed this frame* (for jump buffering) so higher layers stay clean.

const Input = (() => {
  const held = {};
  const pressed = {};   // set true on the frame a key goes down, cleared each tick
  const released = {};

  // Map physical keys to abstract actions.
  const MAP = {
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    Space: 'jump', KeyK: 'jump', KeyZ: 'jump',
    ShiftLeft: 'run', ShiftRight: 'run', KeyJ: 'run', KeyX: 'run',
    KeyE: 'action', Enter: 'start', KeyP: 'pause',
    KeyR: 'reset',
  };

  window.addEventListener('keydown', (e) => {
    const a = MAP[e.code];
    if (!a) return;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
    if (!held[a]) pressed[a] = true;
    held[a] = true;
  });
  window.addEventListener('keyup', (e) => {
    const a = MAP[e.code];
    if (!a) return;
    held[a] = false;
    released[a] = true;
  });

  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (!gp) return;
    const set = (a, v) => { if (v && !held[a]) pressed[a] = true; if (!v && held[a]) released[a] = true; held[a] = v; };
    const ax = gp.axes[0] || 0;
    set('left', gp.buttons[14]?.pressed || ax < -0.4);
    set('right', gp.buttons[15]?.pressed || ax > 0.4);
    set('up', gp.buttons[12]?.pressed || (gp.axes[1] || 0) < -0.4);
    set('down', gp.buttons[13]?.pressed || (gp.axes[1] || 0) > 0.4);
    set('jump', gp.buttons[0]?.pressed);
    set('run', gp.buttons[2]?.pressed || gp.buttons[5]?.pressed || gp.buttons[7]?.pressed);
    set('start', gp.buttons[9]?.pressed);
  }

  return {
    down: (a) => !!held[a],
    justPressed: (a) => !!pressed[a],
    justReleased: (a) => !!released[a],
    // Called once at the very end of each frame.
    endFrame() {
      for (const k in pressed) pressed[k] = false;
      for (const k in released) released[k] = false;
    },
    beginFrame() { pollGamepad(); },
  };
})();
