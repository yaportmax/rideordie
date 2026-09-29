// Small allocation-free helpers for the FX module.
import * as THREE from 'three';

/** xorshift32 PRNG (deterministic: same events -> same visuals on both peers / in screenshots). */
export class Rng {
  constructor(seed = 1) { this.s = (seed >>> 0) || 1; }
  next() { let x = this.s; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.s = x; return x / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  sym(a) { return (this.next() * 2 - 1) * a; }
  int(n) { return (this.next() * n) | 0; }
  chance(p) { return this.next() < p; }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const _c = new THREE.Color();
/** hex (sRGB) -> linear rgb written into out[0..2]. */
export function hexLinear(hex, out = [0, 0, 0]) { _c.setHex(hex); out[0] = _c.r; out[1] = _c.g; out[2] = _c.b; return out; }

/** Surface kinds (sim `surface`): dust colour (linear), amount multipliers, skid mark look. */
export const SURF = {
  asphalt:  { dust: [0.55, 0.53, 0.50], dustK: 0.0, smokeK: 1.0, skid: 1.0, skidCol: [0.02, 0.02, 0.02], spray: 0.0, hard: true },
  concrete: { dust: [0.62, 0.60, 0.57], dustK: 0.0, smokeK: 1.0, skid: 0.8, skidCol: [0.03, 0.03, 0.03], spray: 0.0, hard: true },
  gravel:   { dust: [0.50, 0.44, 0.35], dustK: 0.75, smokeK: 0.0, skid: 0.22, skidCol: [0.10, 0.09, 0.07], spray: 1.0, hard: false },
  sand:     { dust: [0.78, 0.60, 0.38], dustK: 1.1, smokeK: 0.0, skid: 0.30, skidCol: [0.36, 0.26, 0.15], spray: 0.35, hard: false },
  dirt:     { dust: [0.55, 0.36, 0.22], dustK: 1.0, smokeK: 0.0, skid: 0.32, skidCol: [0.14, 0.08, 0.05], spray: 0.7, hard: false },
  grass:    { dust: [0.42, 0.40, 0.22], dustK: 0.45, smokeK: 0.0, skid: 0.20, skidCol: [0.05, 0.07, 0.03], spray: 0.5, hard: false },
  snow:     { dust: [0.92, 0.95, 1.00], dustK: 1.0, smokeK: 0.0, skid: 0.35, skidCol: [0.35, 0.38, 0.42], spray: 0.0, hard: false },
  oil:      { dust: [0.55, 0.53, 0.50], dustK: 0.0, smokeK: 0.35, skid: 0.0, skidCol: [0.02, 0.02, 0.02], spray: 0.0, hard: true },
  rock:     { dust: [0.50, 0.47, 0.44], dustK: 0.5, smokeK: 0.3, skid: 0.0, skidCol: [0.05, 0.05, 0.05], spray: 0.5, hard: true },
};
export function surfOf(kind) { return SURF[kind] || SURF.asphalt; }
