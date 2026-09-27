/**
 * Builds the recorded-sound sprite for Howler.
 *
 *   node tools/build-audio.ts
 *
 * Card sounds: Kenney "Casino Audio" (CC0). Percussion: Sam Gossner's VSCO 2 Community
 * Edition congas, claves and cowbell, and menegass's bongos, all CC0 on Freesound (the
 * HQ previews, kept in art/source/audio/vsco/). Celebration phrases are
 * sequenced here from single hits, in the manner of Uruguayan candombe: the
 * madera (stick) pattern on claves, the chico's offbeat taps and the piano drum's low
 * accents. See docs/ASSETS.md.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const FFMPEG: string = require('ffmpeg-static');
const RATE = 44100;
const SRC = 'art/source/audio';
const CASINO = `${SRC}/casino/Audio`;
const VSCO = `${SRC}/vsco`;

type Pcm = { l: Float32Array; r: Float32Array };

function decode(file: string): Pcm {
  const buf = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(RATE), '-'], { maxBuffer: 1 << 28 });
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = f.length / 2;
  const l = new Float32Array(n), r = new Float32Array(n);
  for (let i = 0; i < n; i++) { l[i] = f[2 * i]; r[i] = f[2 * i + 1]; }
  return { l, r };
}

function trim(p: Pcm, threshold = 0.004, padMs = 6): Pcm {
  const n = p.l.length;
  const loud = (i: number) => Math.max(Math.abs(p.l[i]), Math.abs(p.r[i])) > threshold;
  let a = 0; while (a < n && !loud(a)) a++;
  let b = n - 1; while (b > a && !loud(b)) b--;
  const pad = Math.round((padMs / 1000) * RATE);
  a = Math.max(0, a - pad); b = Math.min(n - 1, b + pad * 4);
  return { l: p.l.slice(a, b + 1), r: p.r.slice(a, b + 1) };
}

function cut(p: Pcm, fromS: number, toS: number): Pcm {
  const a = Math.round(fromS * RATE), b = Math.min(p.l.length, Math.round(toS * RATE));
  return { l: p.l.slice(a, b), r: p.r.slice(a, b) };
}

function rms(p: Pcm): number {
  let s = 0;
  for (let i = 0; i < p.l.length; i++) s += p.l[i] * p.l[i] + p.r[i] * p.r[i];
  return Math.sqrt(s / (2 * Math.max(1, p.l.length)));
}

function peak(p: Pcm): number {
  let m = 0;
  for (let i = 0; i < p.l.length; i++) m = Math.max(m, Math.abs(p.l[i]), Math.abs(p.r[i]));
  return m;
}

/** Scale to a target RMS (dBFS) without letting the peak exceed -1 dBFS. */
function level(p: Pcm, targetDb: number): Pcm {
  const g = Math.min(10 ** (targetDb / 20) / Math.max(1e-6, rms(p)), 0.891 / Math.max(1e-6, peak(p)));
  return { l: p.l.map((v) => v * g), r: p.r.map((v) => v * g) };
}

function fade(p: Pcm, inMs: number, outMs: number): Pcm {
  const l = p.l.slice(), r = p.r.slice(), n = l.length;
  const fi = Math.min(n, Math.round((inMs / 1000) * RATE)), fo = Math.min(n, Math.round((outMs / 1000) * RATE));
  for (let i = 0; i < fi; i++) { const g = i / fi; l[i] *= g; r[i] *= g; }
  for (let i = 0; i < fo; i++) { const g = i / fo; l[n - 1 - i] *= g; r[n - 1 - i] *= g; }
  return { l, r };
}

/** A seamless loop: the tail is crossfaded (equal power) into the head. */

function encode(p: Pcm, base: string, opts: { opusKbps: number; mp3Kbps: number }) {
  const n = p.l.length, inter = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { inter[2 * i] = p.l[i]; inter[2 * i + 1] = p.r[i]; }
  const raw = `${base}.f32`;
  writeFileSync(raw, Buffer.from(inter.buffer));
  const input = ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(RATE), '-ac', '2', '-i', raw];
  execFileSync(FFMPEG, [...input, '-c:a', 'libopus', '-b:a', `${opts.opusKbps}k`, `${base}.webm`]);
  execFileSync(FFMPEG, [...input, '-c:a', 'libmp3lame', '-b:a', `${opts.mp3Kbps}k`, `${base}.mp3`]);
  rmSync(raw);
}

// ---------------------------------------------------------------- percussion hits

const mp3 = (id: number) => `${VSCO}/fs-${id}.mp3`;
const hit = (id: number, db: number) => fade(level(trim(decode(mp3(id)), 0.003), db), 1, 30);
const HITS = {
  conga: [373406, 373408, 373410].map((i) => hit(i, -20)),
  congaSoft: [373407, 373409].map((i) => hit(i, -26)),
  tap: [373412, 373413].map((i) => hit(i, -24)),
  clave: [373400, 373402, 373404].map((i) => hit(i, -24)),
  bell: [373416, 373418].map((i) => hit(i, -27)),
  bongo: [99751, 99752, 99753].map((i) => hit(i, -22)),
};

/** Mix hits at given times (seconds) with gain and pan into one clip. */
function sequence(events: { at: number; pcm: Pcm; gain?: number; pan?: number }[], tail = 0.6): Pcm {
  const end = Math.max(...events.map((e) => e.at + e.pcm.l.length / RATE)) + tail;
  const n = Math.round(end * RATE);
  const l = new Float32Array(n), r = new Float32Array(n);
  for (const e of events) {
    const at = Math.round(e.at * RATE), g = e.gain ?? 1, pan = e.pan ?? 0;
    const gl = g * Math.cos(((pan + 1) * Math.PI) / 4) * Math.SQRT2, gr = g * Math.sin(((pan + 1) * Math.PI) / 4) * Math.SQRT2;
    for (let i = 0; i < e.pcm.l.length && at + i < n; i++) { l[at + i] += e.pcm.l[i] * gl; r[at + i] += e.pcm.r[i] * gr; }
  }
  // Soft limiter so layered hits never clip.
  let pk = 0;
  for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(l[i]), Math.abs(r[i]));
  const g = pk > 0.89 ? 0.89 / pk : 1;
  return { l: l.map((v) => v * g), r: r.map((v) => v * g) };
}

const BPM = 112, S16 = 60 / BPM / 4;
const pickHit = (a: Pcm[], i: number) => a[i % a.length];

// ---------------------------------------------------------------- the sprite

interface Clip { name: string; pcm: Pcm }
const clips: Clip[] = [];
const add = (name: string, pcm: Pcm) => clips.push({ name, pcm });
const card = (f: string, db: number) => fade(level(trim(decode(`${CASINO}/${f}.ogg`)), db), 2, 25);

[1, 2, 3, 4].forEach((i) => add(`place${i}`, card(`card-place-${i}`, -20)));
[1, 2, 3, 5].forEach((i, k) => add(`slide${k + 1}`, card(`card-slide-${i}`, -24)));
[1, 2, 3, 4].forEach((i) => add(`shove${i}`, card(`card-shove-${i}`, -21)));
add('select', card('card-fan-1', -27));
add('shuffle', fade(level(cut(trim(decode(`${CASINO}/card-shuffle.ogg`)), 0, 2.2), -24), 2, 220));

// Short cues.
add('turn', sequence([{ at: 0, pcm: HITS.clave[0], gain: 0.7 }, { at: S16 * 2, pcm: HITS.clave[1], gain: 0.5 }], 0.2));
add('stop', sequence([{ at: 0, pcm: HITS.clave[2] }, { at: S16, pcm: HITS.clave[0], gain: 0.8 }], 0.2));
add('freeze', sequence([{ at: 0, pcm: HITS.conga[2], gain: 0.9 }, { at: S16 * 3, pcm: HITS.congaSoft[0], gain: 0.7 }], 0.4));
add('redThree', sequence([{ at: 0, pcm: HITS.bell[0], gain: 0.8 }, { at: S16 * 2, pcm: HITS.bell[1], gain: 0.6 }], 0.3));

// A canasta: one bar of madera and chico, landing on the piano drum.
const bar = (from: number, accent = 1) => {
  const ev: { at: number; pcm: Pcm; gain?: number; pan?: number }[] = [];
  [0, 3, 6, 10, 12].forEach((s, i) => ev.push({ at: from + s * S16, pcm: pickHit(HITS.clave, i), gain: 0.55 * accent, pan: -0.3 }));
  for (let beat = 0; beat < 4; beat++) {
    ev.push({ at: from + (beat * 4 + 1) * S16, pcm: pickHit(HITS.tap, beat), gain: 0.5 * accent, pan: 0.35 });
    ev.push({ at: from + (beat * 4 + 2) * S16, pcm: pickHit(HITS.conga, beat), gain: 0.75 * accent, pan: 0.35 });
  }
  ev.push({ at: from, pcm: HITS.bongo[2], gain: 0.8 * accent, pan: 0 });
  ev.push({ at: from + 10 * S16, pcm: HITS.bongo[1], gain: 0.7 * accent, pan: 0 });
  return ev;
};
add('canasta', sequence([...bar(0), { at: 16 * S16, pcm: HITS.bongo[2], gain: 1 }, { at: 16 * S16, pcm: HITS.conga[0], gain: 0.9 }], 0.7));
// Going out: two bars, the second with a repique run and the bell.
const run = Array.from({ length: 8 }, (_, i) => ({ at: 16 * S16 + (8 + i) * S16, pcm: pickHit(HITS.conga, i), gain: 0.45 + i * 0.06, pan: 0.2 }));
add('out', sequence([...bar(0, 0.85), ...bar(16 * S16), ...run, { at: 32 * S16, pcm: HITS.bongo[2], gain: 1 }, { at: 32 * S16, pcm: HITS.bell[0], gain: 0.9 }], 0.9));
// Winning the match: three bars building, then a flam and the bell.
add('win', sequence([...bar(0, 0.7), ...bar(16 * S16, 0.85), ...bar(32 * S16), ...run.map((e) => ({ ...e, at: e.at + 32 * S16 })),
  { at: 48 * S16, pcm: HITS.bongo[2], gain: 1 }, { at: 48 * S16 + 0.03, pcm: HITS.conga[0], gain: 0.9 }, { at: 48 * S16, pcm: HITS.bell[0], gain: 1 }, { at: 50 * S16, pcm: HITS.bell[1], gain: 0.8 }], 1.2));

const GAP = Math.round(0.12 * RATE);
const total = clips.reduce((t, c) => t + c.pcm.l.length + GAP, 0);
const sprite: Pcm = { l: new Float32Array(total), r: new Float32Array(total) };
const map: Record<string, [number, number]> = {};
let at = 0;
for (const c of clips) {
  sprite.l.set(c.pcm.l, at); sprite.r.set(c.pcm.r, at);
  map[c.name] = [Math.round((at / RATE) * 1000), Math.round((c.pcm.l.length / RATE) * 1000)];
  at += c.pcm.l.length + GAP;
}

const OUT = 'public/audio';
mkdirSync(OUT, { recursive: true });
encode(sprite, join(OUT, 'sprite'), { opusKbps: 64, mp3Kbps: 96 });

writeFileSync('src/presentation/soundSprite.json', JSON.stringify({ sprite: map }, null, 1) + '\n');
console.log(`sprite: ${clips.length} clips, ${(at / RATE).toFixed(1)} s`);
