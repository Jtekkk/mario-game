// sound.js — a minimal synth, in the spirit of the NES APU.
//
// The ROM drove 5 fixed channels (2 pulse, triangle, noise, DPCM) from a compact
// data-driven engine. We can't touch an APU from a browser, but we echo the idea:
// short, synthesized blips with no audio assets at all — pure oscillators.

const Sfx = (() => {
  let ac = null;
  let muted = false;
  function ctx() {
    if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; } }
    return ac;
  }
  // A single "pulse"-ish blip: type, start freq, end freq, duration, volume.
  function blip(type, f0, f1, dur, vol = 0.2) {
    const a = ctx(); if (!a || muted) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur);
  }
  function noise(dur, vol = 0.15) {
    const a = ctx(); if (!a || muted) return;
    const t = a.currentTime;
    const n = a.createBufferSource();
    const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    n.buffer = buf;
    const g = a.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(g).connect(a.destination);
    n.start(t); n.stop(t + dur);
  }
  return {
    resume() { const a = ctx(); if (a && a.state === 'suspended') a.resume(); },
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },
    jump() { blip('square', 440, 720, 0.12, 0.16); },
    boost() { blip('sawtooth', 260, 880, 0.35, 0.18); },
    stomp() { blip('square', 320, 90, 0.12, 0.2); noise(0.08, 0.1); },
    bolt() { blip('square', 880, 1320, 0.08, 0.14); },
    module() { blip('square', 523, 784, 0.09, 0.18); blip('square', 784, 1046, 0.12, 0.16); },
    hurt() { blip('sawtooth', 300, 120, 0.3, 0.2); noise(0.12, 0.12); },
    win() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip('square', f, f, 0.14, 0.18), i * 120)); },
    die() { [400, 340, 280, 180].forEach((f, i) => setTimeout(() => blip('sawtooth', f, f * 0.7, 0.18, 0.18), i * 130)); },
  };
})();
