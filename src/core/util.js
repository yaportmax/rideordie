// Small math / RNG / noise helpers shared by sim + view. No DOM, no WebGL: safe in Node.

export const TAU = Math.PI * 2;
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inv = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export const smootherstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * t * (t * (t * 6 - 15) + 10); };
/** Frame-rate independent exponential smoothing: damp(current, target, lambda, dt). */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const sign = (v) => (v < 0 ? -1 : 1);
export const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
export const angleDiff = (a, b) => wrapAngle(a - b);
export const mix = lerp;

/** Deterministic PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
  f.chance = (p) => f() < p;
  f.gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += f(); return (u - 3) / 0.7071; };
  return f;
}

/** Integer hash -> [0,1). Stable across machines (integer math only). */
export function hash2(ix, iy, seed = 0) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** 2D value noise in [0,1]. */
export function vnoise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
}

/** 1D value noise in [0,1]. */
export function vnoise1(x, seed = 0) {
  const ix = Math.floor(x), f = fade(x - ix);
  return lerp(hash2(ix, 7, seed), hash2(ix + 1, 7, seed), f);
}

/** fBm in roughly [0,1]. */
export function fbm2(x, y, oct = 4, seed = 0, lac = 2.0, gain = 0.5) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise2(x * f, y * f, seed + i * 101);
    norm += amp; amp *= gain; f *= lac;
  }
  return sum / norm;
}

export function fbm1(x, oct = 3, seed = 0) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise1(x * f, seed + i * 57); norm += amp; amp *= 0.5; f *= 2; }
  return sum / norm;
}

/** Ridged fBm in [0,1] (sharp crests) for mountains / canyon strata. */
export function ridged2(x, y, oct = 4, seed = 0) {
  let amp = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(vnoise2(x * f, y * f, seed + i * 31) * 2 - 1);
    sum += amp * n * n; norm += amp; amp *= 0.5; f *= 2.1;
  }
  return sum / norm;
}

export class Ring {
  /** Fixed-size ring buffer of numbers (telemetry / smoothing). */
  constructor(n) { this.a = new Float32Array(n); this.i = 0; this.n = n; this.filled = 0; }
  push(v) { this.a[this.i] = v; this.i = (this.i + 1) % this.n; if (this.filled < this.n) this.filled++; }
  mean() { let s = 0; for (let i = 0; i < this.filled; i++) s += this.a[i]; return this.filled ? s / this.filled : 0; }
  max() { let m = -Infinity; for (let i = 0; i < this.filled; i++) m = Math.max(m, this.a[i]); return m; }
}

/** Object pool. */
export class Pool {
  constructor(make, reset = () => {}) { this.make = make; this.reset = reset; this.free = []; }
  get() { const o = this.free.pop() || this.make(); return o; }
  put(o) { this.reset(o); this.free.push(o); }
}

export const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const kmh = (ms) => ms * 3.6;
