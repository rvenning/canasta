/**
 * Seeded randomness. Every stream is derived from what it is for and where
 * (match seed, hand number, redeal count, purpose) rather than drawn from one
 * running stream, so a saved match needs no RNG state and a replay is exact.
 */
export type Rng = () => number;

/** 32-bit FNV-1a style mix of a list of numbers/strings into a seed. */
export function hashSeed(...parts: (number | string)[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = typeof p === 'number' ? String(p >>> 0) + ':' : p + '|';
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** mulberry32 */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFor = (...parts: (number | string)[]): Rng => makeRng(hashSeed(...parts));

export function shuffle<T>(arr: T[], rng: Rng): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

export function randomSeed(): number {
  const a = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else a[0] = Math.floor(Math.random() * 2 ** 32);
  return a[0] >>> 0;
}
