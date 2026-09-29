// Deterministic road path generator. Both peers build the identical road from the same seed.
//  - samples every DS meters: position, heading, curvature, bank, elevation
//  - road features (ramps, boost pads, bridges, tunnels, roadblocks, guard rails...) chosen per block
// No DOM / WebGL: usable in Node tests and Web Workers.
import { BIOMES, biomeAt, BIOME_START, ROAD_WIDTH, HALF_ROAD } from '../data/biomes.js';
import { rng, clamp, lerp, smoothstep, fbm1, hash2, wrapAngle } from '../core/util.js';

export const DS = 3;        // sample spacing (m)
export const BLOCK = 96;    // generation block length (m)
export { ROAD_WIDTH, HALF_ROAD };

const MAJOR = new Set(['bridge', 'tunnel', 'overpass', 'gate']);

export class Road {
  constructor(seed = 1) {
    this.seed = seed | 0;
    this.cap = 8192;
    this.n = 0;
    this.x = new Float64Array(this.cap); this.y = new Float64Array(this.cap); this.z = new Float64Array(this.cap);
    this.th = new Float64Array(this.cap); this.k = new Float64Array(this.cap); this.bank = new Float64Array(this.cap);
    this.features = [];
    this._featEnd = 0; // s up to which features have been decided
    this._lastMajorEnd = -1e9;
    this.st = { x: 0, z: 0, th: 0, y: this._elevTarget(0), slope: 0, kPrev: 0, block: 0 };
    this._push(0, this.st.x, this.st.y, this.st.z, 0, 0, 0);
    this.sEnd = 0;
  }

  _grow() {
    const cap = this.cap * 2;
    for (const key of ['x', 'y', 'z', 'th', 'k', 'bank']) { const a = new Float64Array(cap); a.set(this[key]); this[key] = a; }
    this.cap = cap;
  }
  _push(i, x, y, z, th, k, bank) {
    if (i >= this.cap) this._grow();
    this.x[i] = x; this.y[i] = y; this.z[i] = z; this.th[i] = th; this.k[i] = k; this.bank[i] = bank;
    this.n = Math.max(this.n, i + 1);
  }

  /** Blended numeric road parameters at s. */
  params(s) {
    const b = biomeAt(s), A = BIOMES[b.a].road, B = BIOMES[b.b].road;
    const o = {};
    for (const key of Object.keys(A)) o[key] = lerp(A[key], B[key], b.w);
    return o;
  }

  _elevTarget(s) {
    const P = this.params(s);
    const n = fbm1(s / P.elevScale, 3, this.seed + 17) * 2 - 1;
    return P.elevBase + P.elevAmp * n;
  }

  extendTo(s) { while (this.sEnd < s) this._genBlock(); }

  _genBlock() {
    const st = this.st, b = st.block++;
    const s0 = this.sEnd;
    const r = rng((Math.imul(this.seed, 73856093) ^ Math.imul(b + 1, 19349663)) >>> 0);
    const P = this.params(s0 + BLOCK / 2);
    // ---- curvature target for this block
    let kT;
    if (b < 4) kT = 0; // gentle start
    else if (r.chance(P.straight)) kT = 0;
    else { const dir = r.chance(0.5) ? 1 : -1; kT = dir * P.kmax * (0.25 + 0.75 * Math.pow(r(), 0.8)); }
    // steer back toward the main axis when the heading has drifted
    const thLimit = 0.8;
    const predicted = st.th + 0.5 * (st.kPrev + kT) * BLOCK;
    if (Math.abs(predicted) > thLimit && Math.sign(kT) === Math.sign(predicted)) kT = -kT;
    if (Math.abs(st.th) > thLimit * 1.2) kT = -Math.sign(st.th) * P.kmax * 0.6;
    const n = Math.round(BLOCK / DS);
    for (let i = 0; i < n; i++) {
      const u = (i + 1) / n;
      const k = lerp(st.kPrev, kT, smoothstep(0, 1, u));
      const s = s0 + (i + 1) * DS;
      const thMid = st.th + k * DS * 0.5;
      st.x += Math.sin(thMid) * DS; st.z += Math.cos(thMid) * DS; st.th += k * DS;
      // elevation follows a target curve with a slope limit and smoothing
      const Pl = this.params(s);
      const want = clamp((this._elevTarget(s) - st.y) / 220, -Pl.slopeMax, Pl.slopeMax);
      st.slope += (want - st.slope) * (1 - Math.exp(-DS / 70));
      st.y += st.slope * DS;
      const bankT = clamp(k * Pl.bank * 0.25, -0.13, 0.13);
      const idx = this.n;
      const prevBank = this.bank[idx - 1];
      this._push(idx, st.x, st.y, st.z, st.th, k, prevBank + (bankT - prevBank) * 0.25);
    }
    st.kPrev = kT;
    this.sEnd = s0 + n * DS;
    this._genFeatures(s0, this.sEnd, r, P);
  }

  // ---------------------------------------------------------------------------------------- features
  _genFeatures(s0, s1, r, P) {
    const bio = biomeAt((s0 + s1) / 2);
    const id = bio.w > 0.5 ? bio.b : bio.a;
    const B = BIOMES[id];
    const add = (f) => { this.features.push(f); if (MAJOR.has(f.type)) this._lastMajorEnd = f.s1; };
    const canMajor = s0 > 600 && s0 - this._lastMajorEnd > 500;
    const at = () => s0 + r.range(8, BLOCK - 8);
    // ramps / boost pads / roadblocks in most biomes
    if (s0 > 300) {
      const rampP = { desert: 0.05, canyon: 0.04, coast: 0.02, mountain: 0.02, city: 0.04, dam: 0.0 }[id] ?? 0;
      if (r.chance(rampP)) { const s = at(); add({ type: 'ramp', s0: s, s1: s + 14, lane: r.pick([-1, 0, 1]), big: r.chance(0.4) }); }
      if (r.chance(0.04)) { const s = at(); add({ type: 'boost', s0: s, s1: s + 6, lane: r.pick([-1.5, -0.5, 0.5, 1.5]) }); }
      const blockP = { desert: 0.012, canyon: 0.02, coast: 0.02, mountain: 0.025, city: 0.05, dam: 0.0 }[id] ?? 0;
      if (r.chance(blockP)) { const s = at(); add({ type: 'roadblock', s0: s, s1: s + 12, gap: r.pick([-2, -1, 0, 1, 2]), seed: (r() * 1e9) | 0 }); }
    }
    if (canMajor) {
      const bridgeP = { desert: 0.006, canyon: 0.02, coast: 0.02, mountain: 0.015, city: 0.008, dam: 0.0 }[id] ?? 0;
      const tunnelP = { desert: 0, canyon: 0.008, coast: 0.006, mountain: 0.03, city: 0.006, dam: 0.0 }[id] ?? 0;
      const overP = { desert: 0.01, canyon: 0, coast: 0, mountain: 0, city: 0.04, dam: 0 }[id] ?? 0;
      const roll = r();
      if (roll < bridgeP) { const len = r.pick([60, 80, 120, 160]); const s = at(); add({ type: 'bridge', s0: s, s1: s + len, depth: r.range(14, 40) }); }
      else if (roll < bridgeP + tunnelP) { const len = r.pick([180, 240, 320, 420]); const s = at(); add({ type: 'tunnel', s0: s, s1: s + len, rock: r.chance(0.7) }); }
      else if (roll < bridgeP + tunnelP + overP) { const s = at(); add({ type: 'overpass', s0: s - 10, s1: s + 10 }); }
    }
    // guard rails on cliffy biomes
    const kind = B.terrain.kind;
    if ((kind === 'coast' || kind === 'mountain' || kind === 'lake') && r.chance(0.22)) {
      const s = s0 + r.range(0, 30), len = r.pick([150, 250, 400, 600]);
      add({ type: 'guard', s0: s, s1: s + len, side: kind === 'coast' || kind === 'lake' ? (B.terrain.seaSide > 0 ? 'L' : 'R') : 'both' });
    }
    this._featEnd = s1;
  }

  /** Features overlapping [a,b]. */
  featuresIn(a, b, type) {
    this.extendTo(b + BLOCK);
    const out = [];
    for (const f of this.features) if (f.s1 >= a && f.s0 <= b && (!type || f.type === type)) out.push(f);
    return out;
  }
  featureAt(s, type) {
    for (const f of this.features) if (s >= f.s0 && s <= f.s1 && (!type || f.type === type)) return f;
    return null;
  }

  // ---------------------------------------------------------------------------------------- sampling
  /** Fills out {x,y,z,th,fx,fz,nx,nz,k,bank} for path distance s. */
  sample(s, out = {}) {
    if (s < 0) s = 0;
    this.extendTo(s + DS * 2);
    const f = s / DS, i = Math.min(this.n - 2, Math.floor(f)), t = f - i;
    out.s = s;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    out.th = this.th[i] + (this.th[i + 1] - this.th[i]) * t;
    out.k = this.k[i] + (this.k[i + 1] - this.k[i]) * t;
    out.bank = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
    out.fx = Math.sin(out.th); out.fz = Math.cos(out.th);
    out.nx = Math.cos(out.th); out.nz = -Math.sin(out.th); // left normal
    return out;
  }

  /** Height of the road surface at lateral offset d (left positive) for a sample. */
  surfaceY(sm, d) {
    const ad = Math.abs(d);
    let y = sm.y - d * Math.tan(sm.bank);
    if (ad > HALF_ROAD) y -= Math.min(ad - HALF_ROAD, 2.5) * 0.06; // shoulders fall away a little
    return y;
  }

  /** Closest path parameter to world (x,z), searching near hint s. Returns {s, d (left +), dist}. */
  nearest(x, z, hint = 0, window = 90, out = {}) {
    this.extendTo(hint + window + BLOCK);
    let i0 = Math.max(0, Math.floor((hint - window) / DS)), i1 = Math.min(this.n - 2, Math.ceil((hint + window) / DS));
    let best = 1e18, bs = hint, bd = 0;
    for (let i = i0; i <= i1; i++) {
      const ax = this.x[i], az = this.z[i], bx = this.x[i + 1], bz = this.z[i + 1];
      const dx = bx - ax, dz = bz - az;
      const L2 = dx * dx + dz * dz;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = ax + dx * t, pz = az + dz * t;
      const dd = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (dd < best) {
        best = dd; bs = (i + t) * DS;
        const th = this.th[i] + (this.th[i + 1] - this.th[i]) * t;
        bd = (x - px) * Math.cos(th) + (z - pz) * -Math.sin(th);
      }
    }
    out.s = bs; out.d = bd; out.dist = Math.sqrt(best);
    return out;
  }

  /** World position at path distance s and lateral offset d (left +). */
  pointAt(s, d, out = {}) {
    const sm = this.sample(s, this._tmp || (this._tmp = {}));
    out.x = sm.x + sm.nx * d; out.z = sm.z + sm.nz * d; out.y = this.surfaceY(sm, d);
    out.th = sm.th; out.fx = sm.fx; out.fz = sm.fz; out.nx = sm.nx; out.nz = sm.nz;
    return out;
  }
}
