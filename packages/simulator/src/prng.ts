// Seeded randomness: everything the simulator generates is a pure function of (seed, inputs).

/** 32-bit FNV-1a over a string. */
export function hash(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  const s = parts.join('\u0000');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough for demo data. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
export const hex = (r: () => number, n: number) =>
  Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
