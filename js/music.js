// music.js — level music. One looping track per level (10 tracks, 10 levels).
//
// Uses a plain HTMLAudioElement (streams from disk, works from file://) rather
// than WebAudio — Sfx keeps WebAudio for synth blips; this just plays songs.
// Browsers block audio until the first user gesture, so play() failures are
// remembered and retried on the next keydown/pointerdown automatically. The
// usual flow ("press Enter to start") is itself a gesture, so music starts
// with level 1 without any extra prompt.

const Music = (() => {
  // Track list, index-aligned with Level.LEVELS. Display names are uppercase
  // A-Z/0-9 so the bitmap HUD font can render them.
  const TRACKS = [
    { file: 'assets/music/01-the-last-of-the-dwarves.mp3',         name: 'THE LAST OF THE DWARVES' },
    { file: 'assets/music/02-the-1950s-boy-band-samba-soul.mp3',   name: 'THE 1950S BOY BAND SAMBA SOUL' },
    { file: 'assets/music/03-the-8bit-witch.mp3',                  name: 'THE 8BIT WITCH' },
    { file: 'assets/music/04-the-8bit-parade-6.mp3',               name: 'THE 8BIT PARADE 6' },
    { file: 'assets/music/05-the-8bit-parade-7.mp3',               name: 'THE 8BIT PARADE 7' },
    { file: 'assets/music/06-glitch-dragon-cartridge.mp3',         name: 'GLITCH DRAGON CARTRIDGE' },
    { file: 'assets/music/07-retro-racer.mp3',                     name: 'RETRO RACER' },
    { file: 'assets/music/08-the-devils-chiptune.mp3',             name: 'THE DEVILS CHIPTUNE' },
    { file: 'assets/music/09-untitled.mp3',                        name: 'UNTITLED' },
    { file: 'assets/music/10-rule-tha-world.mp3',                  name: 'RULE THA WORLD' },
  ];

  const VOLUME = 0.45;
  let el = null;        // the single <audio> element (only current track loads)
  let cur = -1;         // index of the current track
  let enabled = true;   // music toggle (independent from Sfx mute)
  let blocked = false;  // last play() was refused pending a user gesture

  function _tryPlay() {
    if (!el || !enabled) return;
    const p = el.play();
    if (p && p.catch) p.then(() => { blocked = false; })
                       .catch(() => { blocked = true; }); // retry on next gesture
  }

  // Fully tear down an audio element (removeAttribute+load is the spec-safe
  // way — src='' can make browsers treat the page URL as the media source).
  function _teardown(a) {
    a.pause();
    a.removeAttribute('src');
    a.load();
  }

  // Play the track for a level index (wraps if there are ever more levels than
  // tracks). Returns true when this actually switched to a different track.
  function playFor(levelIndex) {
    const n = TRACKS.length;
    const i = ((levelIndex % n) + n) % n;
    if (i === cur && el) { _tryPlay(); return false; }
    if (el) _teardown(el);
    cur = i;
    el = new Audio(TRACKS[i].file);
    el.loop = true;
    el.volume = VOLUME;
    _tryPlay();
    return true;
  }

  function stop() {
    if (el) { _teardown(el); el = null; }
    cur = -1;
  }

  function setEnabled(on) {
    enabled = !!on;
    if (!el) return;
    if (enabled) _tryPlay(); else el.pause();
  }

  // First user gesture unlocks audio; keep listening — a later blocked play()
  // (e.g. tab restored) gets retried on the next gesture too.
  function _unlock() { if (blocked) _tryPlay(); }
  window.addEventListener('keydown', _unlock);
  window.addEventListener('pointerdown', _unlock);

  return {
    playFor, stop, setEnabled,
    isEnabled: () => enabled,
    currentName: () => (cur >= 0 ? TRACKS[cur].name : ''),
    trackCount: () => TRACKS.length,
    // exposed for tests/debugging
    _el: () => el, _cur: () => cur,
  };
})();
