// touch.js — on-screen controls for phones/tablets. Feeds the same Input
// actions the keyboard does, so the game logic doesn't change at all.

(() => {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const isTouch = coarse || ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (!isTouch) return;                 // desktop: leave the overlay hidden
  document.body.classList.add('touch');

  // Wire one button to hold/release an Input action (works for taps and holds).
  function wire(btn) {
    const act = btn.dataset.act;
    const down = (e) => { e.preventDefault(); Input.setAction(act, true); try { btn.setPointerCapture(e.pointerId); } catch (_) {} };
    const up = (e) => { e.preventDefault(); Input.setAction(act, false); };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  document.querySelectorAll('#touch button[data-act]').forEach(wire);

  // Rebuild the power-up button row whenever the inventory changes.
  const holder = document.getElementById('touchPowers');
  let sig = null;
  function sync() {
    const p = (typeof Game !== 'undefined') && Game.player;
    const inv = p ? p.inv : {};
    const owned = Powerups.POWER_ORDER.filter((n) => inv[n]);
    const s = owned.join(',');
    if (s !== sig) {
      sig = s;
      holder.innerHTML = '';
      for (const n of owned) {
        const m = Powerups.POWERUPS[n];
        const btn = document.createElement('button');
        btn.dataset.act = n;
        btn.textContent = m.key;
        btn.style.borderColor = `rgb(${m.color[0]},${m.color[1]},${m.color[2]})`;
        btn.style.color = `rgb(${m.color[0]},${m.color[1]},${m.color[2]})`;
        holder.appendChild(btn);
        wire(btn);
      }
    }
    requestAnimationFrame(sync);
  }
  requestAnimationFrame(sync);
})();
