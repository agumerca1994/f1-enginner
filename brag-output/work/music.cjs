// Synthesises the soundtrack: 120 BPM, A minor, 22 s, music and effects on one beat grid.
const fs = require('fs');
const SR = 48000, DUR = 22, N = SR * DUR, BEAT = 0.5;
const L = new Float32Array(N), R = new Float32Array(N);       // dry mix
const RL = new Float32Array(N), RR = new Float32Array(N);     // reverb send
const DUCK = new Float32Array(N).fill(1);                     // sidechain for pad and bass
let seed = 1; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const hz = m => 440 * Math.pow(2, (m - 69) / 12);

function biquad(type, f, q) {
  const w = 2 * Math.PI * f / SR, a = Math.sin(w) / (2 * q), c = Math.cos(w);
  let b0, b1, b2, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
  else { b0 = a; b1 = 0; b2 = -a; }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function filt(type, q = 0.707) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, k = null, lastF = -1;
  return (x, f) => {
    if (Math.abs(f - lastF) > 0.5) { k = biquad(type, Math.min(f, SR * 0.45), q); lastF = f; }
    const y = k.b0 * x + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y; return y;
  };
}
// write a voice: fn(t, i) -> sample, pan -1..1, send to reverb, duck by sidechain
function voice(start, dur, fn, { gain = 1, pan = 0, send = 0, duck = false } = {}) {
  const s0 = Math.round(start * SR), n = Math.round(dur * SR);
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = 0; i < n && s0 + i < N; i++) {
    if (s0 + i < 0) continue;
    let v = fn(i / SR, i); if (duck) v *= DUCK[s0 + i];
    L[s0 + i] += v * gl; R[s0 + i] += v * gr;
    if (send) { RL[s0 + i] += v * gl * send; RR[s0 + i] += v * gr * send; }
  }
}
const saw = p => 2 * (p - Math.floor(p + 0.5));

// --- arrangement ----------------------------------------------------------------
// bars of 4 beats; chords as midi roots + triads
const CH = { Am: [57, 60, 64], F: [53, 57, 60], C: [48, 55, 60, 64], G: [55, 59, 62] };
const BARS = ['Am', 'Am', 'Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'Am', 'F'];
const ROOT = { Am: 45, F: 41, C: 48, G: 43 };
const GROOVE_FROM = 8, BREAK = [34, 35], END = 42;
const grooveOn = b => b >= GROOVE_FROM && b < END && !BREAK.includes(b);

// sidechain envelope from every kick
const kicks = []; for (let b = 0; b < 44; b++) if (grooveOn(b) || b === END) kicks.push(b * BEAT);
for (const k of kicks) { const s0 = Math.round(k * SR); for (let i = 0; i < SR * 0.4 && s0 + i < N; i++) { const t = i / SR; DUCK[s0 + i] = Math.min(DUCK[s0 + i], 1 - 0.55 * Math.exp(-t / 0.09)); } }

// kick
function kick(t0, g = 0.9) {
  let ph = 0;
  voice(t0, 0.6, t => { const f = 45 + 110 * Math.exp(-t / 0.035); ph += f / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.22) + 0.15 * rnd() * Math.exp(-t / 0.004); }, { gain: g });
}
function clap(t0, g = 0.32) {
  const bp = filt('bp', 1.2);
  voice(t0, 0.35, t => { const e = (t < 0.02 ? (Math.floor(t / 0.007) % 2 ? .6 : 1) : 1) * Math.exp(-t / 0.11); return bp(rnd(), 1600) * e * 2.2 + Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.05) * 0.25; }, { gain: g, send: 0.35 });
}
function hat(t0, open, g, pan) {
  const hp = filt('hp', 0.9);
  voice(t0, open ? 0.25 : 0.06, t => hp(rnd(), 7500) * Math.exp(-t / (open ? 0.07 : 0.018)), { gain: g, pan, send: 0.08 });
}
for (let b = 0; b < 44; b++) {
  const t = b * BEAT;
  if (grooveOn(b)) {
    kick(t);
    if (b % 2 === 1) clap(t);
    hat(t + BEAT / 2, true, 0.13, 0.15);
    hat(t + BEAT / 4, false, 0.05, -0.3); hat(t + 3 * BEAT / 4, false, 0.05, -0.3);
  } else if (b < GROOVE_FROM) {
    hat(t + BEAT / 2, false, 0.05 + 0.01 * b, 0.2);      // ticking clock under the hook
    if (b >= 4) hat(t, false, 0.04, -0.2);
  }
}
kick(END * BEAT, 1);

// pad: detuned saws, slow attack, ducked
for (let bar = 0; bar < BARS.length; bar++) {
  const t0 = bar * 4 * BEAT, last = bar === BARS.length - 1;
  const chord = last ? CH.Am : CH[BARS[bar]];
  const dur = last ? 4 * BEAT + 1.2 : bar === 0 ? 8 * BEAT + 0.15 : 4 * BEAT + 0.15;
  const lv = bar < 2 ? 0.06 : 0.075;
  if (bar === 10 || bar === 1) continue;
  for (const m of chord) for (const d of [-0.09, 0, 0.11]) {
    const f = hz(m + d * 0.1) * (1 + d * 0.004); const lp = filt('lp'); let ph = Math.random();
    const pan = d * 6;
    voice(t0, dur, t => { ph += f / SR; const a = Math.min(1, t / (bar < 2 ? 1.2 : 0.25)) * Math.min(1, (dur - t) / 0.2); return lp(saw(ph), bar < 2 ? 500 + 500 * Math.min(1, (t0 + t) / 4) : 1400) * a; }, { gain: lv, pan, send: 0.5, duck: bar >= 2 });
  }
}
// final bars: F for two beats, then a held A minor
[['F', 40, 2 * BEAT], ['Am', 42, 2 * BEAT]].forEach(([c, b, d]) => {
  for (const m of CH[c]) for (const det of [-1, 1]) {
    const f = hz(m) * (1 + det * 0.003), lp = filt('lp'); let ph = 0;
    const len = c === 'Am' ? d + 1.0 : d + 0.1;
    voice(b * BEAT, len, t => { ph += f / SR; return lp(saw(ph), 1600) * Math.min(1, t / 0.02) * Math.min(1, (len - t) / 0.6); }, { gain: 0.075, pan: det * 0.4, send: 0.6, duck: c === 'F' });
  }
});

// bass: eighths on the root, filter pluck, ducked
for (let b = GROOVE_FROM; b < END; b++) {
  if (BREAK.includes(b)) continue;
  const bar = Math.floor(b / 4), root = b >= 40 ? ROOT.F : ROOT[BARS[bar]];
  for (const h of [0, 0.5]) {
    const f = hz(root - 12 + (h && b % 4 === 3 ? 12 : 0)), lp = filt('lp', 1.4); let ph = 0;
    voice(b * BEAT + h * BEAT, 0.24, t => { ph += f / SR; return lp(saw(ph) + 0.6 * Math.sin(2 * Math.PI * ph), 180 + 1100 * Math.exp(-t / 0.05)) * Math.min(1, t / 0.003) * Math.min(1, (0.24 - t) / 0.03); }, { gain: 0.36, duck: true });
  }
}
kick; // sub under the final chord
{ let ph = 0; voice(END * BEAT, 1.0, t => { ph += 55 / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.45); }, { gain: 0.35 }); }

// pluck arpeggio from the first highlight on
for (let b = 14; b < END; b++) {
  if (BREAK.includes(b)) continue;
  const bar = Math.floor(b / 4), chord = b >= 40 ? CH.F : CH[BARS[bar]];
  for (let s = 0; s < 2; s++) {
    const idx = (b * 2 + s) % 4, m = chord[idx % chord.length] + 12 + (idx === 3 ? 12 : 0);
    const f = hz(m), lp = filt('lp', 2); let ph = 0;
    voice(b * BEAT + s * BEAT / 2, 0.3, t => { ph += f / SR; return lp(saw(ph) * 0.6 + (ph % 1 < 0.5 ? 0.4 : -0.4), 700 + 3500 * Math.exp(-t / 0.04)) * Math.exp(-t / 0.09); }, { gain: 0.07, pan: s ? 0.35 : -0.35, send: 0.45 });
  }
}

// --- effects, in key and on the grid ----------------------------------------------
function chirp(t0, g = 0.05) {           // radio squelch: a hiss and two short tones (E6, A5)
  const bp = filt('bp', 2);
  voice(t0, 0.05, t => bp(rnd(), 2500) * Math.exp(-t / 0.015) * 3, { gain: g * 0.6, send: 0.1 });
  voice(t0 + 0.03, 0.06, t => Math.sin(2 * Math.PI * hz(88) * t) * Math.min(1, t / 0.004) * Math.min(1, (0.06 - t) / 0.01), { gain: g, send: 0.3 });
  voice(t0 + 0.1, 0.09, t => Math.sin(2 * Math.PI * hz(81) * t) * Math.min(1, t / 0.004) * Math.min(1, (0.09 - t) / 0.02), { gain: g, send: 0.3 });
}
chirp(0.25, 0.06);   // the hook's radio call
chirp(8.25, 0.045);  // the answer lands in the cockpit
// radio static under the hook's waveform
{ const bp = filt('bp', 0.8); voice(0.3, 3.4, t => bp(rnd(), 2200) * (0.5 + 0.5 * Math.abs(Math.sin(t * 9) * Math.sin(t * 3.1))) * Math.min(1, t / 0.1) * Math.min(1, (3.4 - t) / 0.4), { gain: 0.03, send: 0.05 }); }

function riser(t0, dur, g) {
  const bp = filt('bp', 3);
  voice(t0, dur, t => { const x = t / dur; return bp(rnd(), 300 * Math.pow(20, x)) * x * x; }, { gain: g, send: 0.4 });
}
function whoosh(tCut, g = 0.08) {        // swells into a cut and stops on it
  const bp = filt('bp', 1.5), d = 0.35;
  voice(tCut - d, d + 0.08, t => { const x = Math.min(1, t / d); return bp(rnd(), 800 + 3000 * x) * x * x * (t > d ? Math.exp(-(t - d) / 0.02) : 1); }, { gain: g, pan: 0.2, send: 0.3 });
}
function impact(t0, g) {
  const lp = filt('lp'); let ph = 0;
  voice(t0, 1.6, t => { ph += (40 + 30 * Math.exp(-t / 0.05)) / SR; return Math.sin(2 * Math.PI * ph) * Math.exp(-t / 0.5) + lp(rnd(), 2500) * Math.exp(-t / 0.25) * 0.5; }, { gain: g, send: 0.6 });
}
riser(2.4, 1.6, 0.16);    // into the reveal
impact(4.0, 0.34);
[7, 11, 15].forEach(c => whoosh(c));
riser(17.0, 1.0, 0.14);   // the break before the outro
impact(18.0, 0.3);
impact(21.0, 0.22);

// --- reverb (Schroeder) and master --------------------------------------------------
function reverb(inp, combs, aps) {
  const out = new Float32Array(N);
  for (const [d, fb] of combs) { const buf = new Float32Array(d); let p = 0, lp = 0;
    for (let i = 0; i < N; i++) { const y = buf[p]; lp = y * 0.7 + lp * 0.3; buf[p] = inp[i] + lp * fb; p = (p + 1) % d; out[i] += y * 0.25; } }
  for (const d of aps) { const buf = new Float32Array(d); let p = 0;
    for (let i = 0; i < N; i++) { const b = buf[p], x = out[i]; const y = -x + b; buf[p] = x + b * 0.5; p = (p + 1) % d; out[i] = y; } }
  return out;
}
const wl = reverb(RL, [[1557, .84], [1617, .84], [1491, .84], [1422, .84]], [225, 556, 441]);
const wr = reverb(RR, [[1580, .84], [1640, .84], [1514, .84], [1445, .84]], [248, 579, 464]);
let peak = 0; const mix = new Float32Array(N * 2);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / (SR * 0.6));
  const l = Math.tanh((L[i] + wl[i] * 0.35) * 1.1) * fade, r = Math.tanh((R[i] + wr[i] * 0.35) * 1.1) * fade;
  mix[2 * i] = l; mix[2 * i + 1] = r; peak = Math.max(peak, Math.abs(l), Math.abs(r));
}
const g = 0.89 / peak, buf = Buffer.alloc(44 + N * 4);
buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVEfmt ', 8); buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N * 2; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, mix[i] * g)) * 32767), 44 + i * 2);
fs.writeFileSync(process.argv[2] || 'music.wav', buf);
console.log('peak', peak.toFixed(3));
