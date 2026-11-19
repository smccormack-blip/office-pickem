// Football sound effects, synthesized in the browser (no audio files needed),
// plus the Legal Mumbo Jumbo recording borrowed from Shopping Man.
const MUTE_KEY = 'pickem-muted';
let ctx = null;
const legal = new Audio('legal-mumbo-jumbo.mp3');

export function isMuted() { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; } }
export function setMuted(m) { try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ } }

function ac() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// Browsers only allow sound after the first tap; unlock on any tap.
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => ac(), { once: true, capture: true }));

function noiseBuffer(c, secs) {
  const b = c.createBuffer(1, Math.floor(c.sampleRate * secs), c.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = last * 3.5; } // brownish noise
  return b;
}
function out(c, vol) { const g = c.createGain(); g.gain.value = vol; g.connect(c.destination); return g; }

// Crowd: layered filtered noise that swells; `mood` 'cheer' | 'groan'
function crowd(mood = 'cheer', secs = 2.6, vol = 0.55) {
  const c = ac(); if (!c || isMuted()) return;
  const t = c.currentTime, master = out(c, vol);
  for (let layer = 0; layer < 3; layer++) {
    const src = c.createBufferSource(); src.buffer = noiseBuffer(c, secs + 0.3);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    const f0 = [450, 900, 1600][layer];
    if (mood === 'cheer') { bp.frequency.setValueAtTime(f0, t); bp.frequency.linearRampToValueAtTime(f0 * 1.25, t + secs * 0.4); }
    else { bp.frequency.setValueAtTime(f0 * 0.9, t); bp.frequency.exponentialRampToValueAtTime(f0 * 0.45, t + secs); }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(mood === 'cheer' ? 0.9 : 0.6, t + (mood === 'cheer' ? 0.35 : 0.25));
    g.gain.setValueAtTime(mood === 'cheer' ? 0.9 : 0.6, t + secs * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    src.connect(bp).connect(g).connect(master); src.start(t); src.stop(t + secs + 0.2);
  }
  if (mood === 'groan') {  // a low "awww" vowel under the noise
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(120, t + secs);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 4;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + secs);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + secs);
  }
}

// Referee's pea whistle: two short trilled blasts.
export function whistle() {
  const c = ac(); if (!c || isMuted()) return;
  const master = out(c, 0.22);
  [[0, 0.22], [0.32, 0.55]].forEach(([s, len]) => {
    const t = c.currentTime + s;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 2900;
    const lfo = c.createOscillator(); lfo.frequency.value = 32;          // the "pea" trill
    const lfoG = c.createGain(); lfoG.gain.value = 160; lfo.connect(lfoG).connect(o.frequency);
    const am = c.createGain(); am.gain.setValueAtTime(0.0001, t); am.gain.exponentialRampToValueAtTime(1, t + 0.02);
    am.gain.setValueAtTime(1, t + len - 0.04); am.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(am).connect(master); o.start(t); lfo.start(t); o.stop(t + len); lfo.stop(t + len);
  });
}

// Brass fanfare: "da-da-da-DAAA".
export function fanfare() {
  const c = ac(); if (!c || isMuted()) return;
  const master = out(c, 0.18);
  const notes = [[392, 0, 0.14], [392, 0.16, 0.14], [392, 0.32, 0.14], [523.25, 0.48, 0.9], [659.25, 0.48, 0.9], [783.99, 0.48, 0.9]];
  for (const [f, s, len] of notes) {
    const t = c.currentTime + s;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.linearRampToValueAtTime(2600, t + 0.08);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.03);
    g.gain.setValueAtTime(0.7, t + len * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp).connect(g).connect(master); o.start(t); o.stop(t + len + 0.05);
  }
  setTimeout(() => crowd('cheer', 2.4, 0.4), 700);
}

export const cheer = () => crowd('cheer');
export const groan = () => crowd('groan', 1.8, 0.5);

// Plays even when muted: you pressed the button, you get the mumbo jumbo.
export function legalMumboJumbo() {
  try { legal.currentTime = 0; legal.play().catch(() => {}); } catch { /* ignore */ }
}
