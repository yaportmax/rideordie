// Natural rock formations, generated at runtime and shaded with the TERRAIN material (same triplanar rock / cliff layers,
// strata tint and macro variation as the canyon walls, so they sit in the landscape instead of looking like props):
//   hoodoo  - tall sandstone column, soft layers eroded back between hard ledges, a dark caprock that overhangs, a balanced boulder
//   spire   - thin leaning needle
//   fin     - a wall-like slab with a jagged crest
//   butte   - wide stepped block with cliffs and a talus skirt
//   stack   - coastal sea stack: undercut at the waterline, grassy top (coast), optionally pierced (sea arch)
//   arch    - natural arch spanning the road (swept noisy cross-section; >= 15 m over the road strip)
// Placement is a pure, cached function of (seed, slot); each chunk merges the formations anchored in it into ONE mesh.
import * as THREE from 'three';
import { biomeAt } from '../../data/biomes.js';
import { fbm2, hash2, smoothstep, clamp } from '../../core/util.js';
import { CHUNK_LEN, groundAt, rngOf } from './util.js';
import { seaLevel, EDGE } from '../terrain_gen.js';

const L = { sand: 0, dirt_red: 1, gravel: 2, dry_grass: 3, rock_red: 4, rock_grey: 5, snow: 6, forest_floor: 7, grass_green: 8, cliff: 10 };
const _G = {};

// ------------------------------------------------------------------------------------------------ geometry builder
class RockMesh {
  constructor(ax, ay, az) { this.ax = ax; this.ay = ay; this.az = az; this.P = []; this.S = []; this.I = []; this.C = { pos: [], idx: [] }; }
  get n() { return this.P.length / 3; }
  /** Lathe grid: rings[j] = array of N world points {x,y,z} + per-ring material weights fn(j, i, ny) -> Float32Array(12). */
  grid(rings, closeTop, splat, collide) {
    const N = rings[0].length, M = rings.length, base = this.n;
    for (let j = 0; j < M; j++) for (let i = 0; i < N; i++) { const p = rings[j][i]; this.P.push(p.x - this.ax, p.y - this.ay, p.z - this.az); }
    for (let j = 0; j < M - 1; j++) for (let i = 0; i < N; i++) {
      const i2 = (i + 1) % N, a = base + j * N + i, b = base + j * N + i2, c = base + (j + 1) * N + i2, d = base + (j + 1) * N + i;
      this.I.push(a, b, c, a, c, d);
    }
    let top = -1;
    if (closeTop) {
      let cx = 0, cy = -1e9, cz = 0; for (const p of rings[M - 1]) { cx += p.x; cz += p.z; cy = Math.max(cy, p.y); }
      cx /= N; cz /= N; top = this.n; this.P.push(cx - this.ax, cy + closeTop - this.ay, cz - this.az);
      for (let i = 0; i < N; i++) this.I.push(base + (M - 1) * N + i, base + (M - 1) * N + (i + 1) % N, top);
    }
    this._splat(base, this.n, splat);
    if (collide) {
      // coarse hull: every 3rd ring, every 3rd column
      const cb = this.C.pos.length / 3, rs = [], step = Math.max(1, Math.floor(N / 8));
      for (let j = 0; j < M; j += 3) rs.push(j); if (rs[rs.length - 1] !== M - 1) rs.push(M - 1);
      const cols = []; for (let i = 0; i < N; i += step) cols.push(i);
      for (const j of rs) for (const i of cols) { const p = rings[j][i]; this.C.pos.push(p.x, p.y, p.z); }
      const nc = cols.length;
      for (let a = 0; a < rs.length - 1; a++) for (let k = 0; k < nc; k++) {
        const k2 = (k + 1) % nc, p0 = cb + a * nc + k, p1 = cb + a * nc + k2, p2 = cb + (a + 1) * nc + k2, p3 = cb + (a + 1) * nc + k;
        this.C.idx.push(p0, p1, p2, p0, p2, p3);
      }
    }
  }
  _splat(from, to, fn) {
    // normals are computed on build(); splat is decided after (needs normals) -> store the fn per range
    (this.ranges || (this.ranges = [])).push([from, to, fn]);
  }
  build(mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setIndex(this.I);
    g.computeVertexNormals();
    const nor = g.attributes.normal, n = this.n, sp = [new Float32Array(n * 4), new Float32Array(n * 4), new Float32Array(n * 4)], w = new Float32Array(12);
    for (const [a, b, fn] of this.ranges) for (let v = a; v < b; v++) {
      w.fill(0); fn(w, this.P[v * 3] + this.ax, this.P[v * 3 + 1] + this.ay, this.P[v * 3 + 2] + this.az, nor.getY(v));
      let s = 0; for (let k = 0; k < 12; k++) s += w[k]; s = s || 1;
      for (let k = 0; k < 12; k++) sp[(k / 4) | 0][v * 4 + (k % 4)] = w[k] / s;
    }
    g.setAttribute('aSplat0', new THREE.BufferAttribute(sp[0], 4)); g.setAttribute('aSplat1', new THREE.BufferAttribute(sp[1], 4)); g.setAttribute('aSplat2', new THREE.BufferAttribute(sp[2], 4));
    const aux = new Float32Array(n * 4); for (let v = 0; v < n; v++) { aux[v * 4 + 2] = this.desert || 0; aux[v * 4 + 3] = this.seaY ?? -1e4; }
    g.setAttribute('aAux', new THREE.BufferAttribute(aux, 4));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.position.set(this.ax, this.ay, this.az); m.castShadow = true; m.receiveShadow = true;
    m.userData.ownGeo = true; m.matrixAutoUpdate = false; m.updateMatrix(); m.name = 'rocks';
    return m;
  }
}

// ------------------------------------------------------------------------------------------------ material weights
const redRock = (seed) => (w, x, y, z, ny) => {
  const steep = smoothstep(0.35, 0.75, 1 - ny), n = fbm2(x / 23, z / 23 + y / 40, 2, seed);
  w[L.rock_red] = 0.55 * steep + 0.3; w[L.cliff] = steep * (0.5 + 0.4 * n);
  w[L.dirt_red] = (1 - steep) * 0.8; w[L.sand] = (1 - steep) * 0.4 * n;
};
const capRock = (seed) => (w, x, y, z, ny) => { const steep = smoothstep(0.3, 0.7, 1 - ny); w[L.rock_grey] = 0.5 + 0.2 * fbm2(x / 9, y / 9, 2, seed); w[L.rock_red] = 0.35; w[L.cliff] = steep * 0.4; w[L.dirt_red] = (1 - steep) * 0.4; };
const greyRock = (seed, grassTop) => (w, x, y, z, ny) => {
  const steep = smoothstep(0.3, 0.72, 1 - ny), n = fbm2(x / 17, y / 21 + z / 17, 2, seed);
  w[L.rock_grey] = 0.5 + 0.3 * steep; w[L.cliff] = steep * (0.4 + 0.4 * n);
  if (grassTop) { w[L.grass_green] = (1 - steep) * 1.4; w[L.dry_grass] = (1 - steep) * 0.4 * n; } else w[L.gravel] = (1 - steep) * 0.6;
};

// ------------------------------------------------------------------------------------------------ shapes
const TAU = Math.PI * 2;
/** Column formation (hoodoo / spire / stack / butte). o: {x, y (ground), z, R, H, kind, seed, lean[x,z], cap, capFlare, ...} */
function column(rm, o) {
  const { x, z, R, H, seed } = o, y0 = o.y - 4, N = o.N || 26, M = o.M || 44;
  const lx = o.lean ? o.lean[0] : 0, lz = o.lean ? o.lean[1] : 0;
  const strata = o.strata || 3.4, rings = [];
  const capAt = o.cap ? H - o.cap : 1e9;
  for (let j = 0; j <= M; j++) {
    const t = j / M, y = y0 + (H + 4) * t, h = y - o.y;
    let prof;
    if (o.kind === 'hoodoo') prof = 0.62 + 0.55 * Math.pow(1 - smoothstep(0, H * 0.35, h), 2) - 0.16 * smoothstep(H * 0.3, H * 0.8, h);
    else if (o.kind === 'spire') prof = 1.0 - 0.8 * smoothstep(0, H, h) + 0.4 * Math.pow(1 - smoothstep(0, H * 0.25, h), 2);
    else if (o.kind === 'stack') prof = 0.95 - 0.12 * smoothstep(0, H, h) - 0.22 * (1 - smoothstep(0.5, 4.5, h)) * smoothstep(-1.5, 0.5, h) + 0.25 * (1 - smoothstep(-3, 0, h));
    else prof = 1.0 - 0.1 * smoothstep(0, H, h) + 0.5 * Math.pow(1 - smoothstep(0, H * 0.28, h), 2);   // butte: talus skirt
    // strata: soft layers erode back, hard ledges stick out
    const sp = h / strata, fr = sp - Math.floor(sp), hard = hash2(Math.floor(sp), 3, seed) > 0.55;
    let ledge = hard ? 0.06 * smoothstep(0.0, 0.2, fr) * (1 - smoothstep(0.75, 1.0, fr)) : -0.07 * Math.sin(fr * Math.PI);
    if (o.kind === 'butte') ledge *= 1.8;
    if (o.kind === 'stack') ledge *= 0.3;
    if (o.mesa) ledge *= Math.min(1, 16 / R);                       // ledges of a few metres, whatever the size
    let cap = 0;
    if (h > capAt) { const k = (h - capAt) / o.cap; cap = o.capFlare * Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) - (k > 0.7 ? (k - 0.7) * 1.8 : 0); ledge = 0; }
    const top = o.kind === 'hoodoo' || o.kind === 'spire' ? 0 : smoothstep(H - 3, H, h) * 0.12;
    const cx = x + lx * Math.max(0, h), cz = z + lz * Math.max(0, h), ring = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const st = o.kind === 'stack';
      const n1 = fbm2(ca * (st ? 0.9 : 1.3) + seed * 0.01, h / (st ? 16 : 9) + sa * (st ? 0.9 : 1.3), 3, seed), n2 = fbm2(ca * 3 + 7, h / 3.2 + sa * 3, 2, seed + 5);
      let r = R * (prof + ledge + cap - top) * (st ? 0.55 + 0.9 * n1 + 0.1 * (n2 - 0.5) : 0.78 + 0.42 * n1 + (o.mesa ? 0.04 : 0.12) * (n2 - 0.5));
      if (o.flat) r *= o.flat + (1 - o.flat) * ca * ca;             // fins: squashed across one axis
      r = Math.max(0.3, r);
      let px = ca * r, pz = sa * r;
      if (o.rot) { const c = Math.cos(o.rot), s2 = Math.sin(o.rot); const qx = px * c - pz * s2; pz = px * s2 + pz * c; px = qx; }
      ring.push({ x: cx + px, y: y + (n2 - 0.5) * 0.6 * (j > 0 && j < M ? 1 : 0), z: cz + pz });
    }
    rings.push(ring);
  }
  const capY = o.y + capAt, body = o.splat, capS = o.capSplat || body;
  rm.grid(rings, o.dome ?? 1.5, (w, px, py, pz, ny) => (py > capY ? capS : body)(w, px, py, pz, ny), o.collide);
  if (o.boulder) {
    const last = rings[rings.length - 1];
    let cx = 0, cy = -1e9, cz = 0; for (const p of last) { cx += p.x; cz += p.z; cy = Math.max(cy, p.y); } cx /= last.length; cz /= last.length;
    const br = R * 0.42, Nb = 12, Mb = 8, bRings = [];
    for (let j = 0; j <= Mb; j++) {
      const t = j / Mb, yy = cy + (o.dome ?? 1.5) * 0.6 + br * 1.7 * t, rr = br * Math.sin(Math.max(0.12, t) * Math.PI) * (j === Mb ? 0.1 : 1);
      const ring = []; for (let i = 0; i < Nb; i++) { const a = (i / Nb) * TAU; const k = 0.85 + 0.3 * fbm2(Math.cos(a) * 2, t * 2, 2, seed + 9); ring.push({ x: cx + Math.cos(a) * rr * k, y: yy, z: cz + Math.sin(a) * rr * k }); }
      bRings.push(ring);
    }
    rm.grid(bRings, 0.2, capS, false);
  }
}

/** Natural arch over the road at road coords s (the arch spans the road laterally). */
function arch(rm, road, seed, s, o) {
  const sm = road.sample(s, {});
  const span = o.span, H = o.H, T = o.T;                 // feet at d = +-span, path crown height H over the road, thickness T (along s)
  const NP = 40, NS = 18, rings = [];
  const yRoad = sm.y;
  for (let k = 0; k <= NP; k++) {
    const t = k / NP, ang = Math.PI * t;                  // 0 = left foot (+d) .. PI = right foot (-d)
    const d = Math.cos(ang) * span, hPath = Math.sin(ang) * H;
    // tangent of the path in the (d, y) plane and its normal
    const td = -Math.sin(ang) * span, ty = Math.cos(ang) * H, tl = Math.hypot(td, ty); const nd = -ty / tl, nyy = td / tl;
    const foot = Math.pow(1 - Math.sin(ang), 3);           // feet flare
    const halfR = o.R * (1 + 0.9 * foot) * (0.85 + 0.3 * fbm2(t * 6, 1.5, 2, seed));   // radial half size
    const halfT = T * (1 + 0.5 * foot) * (0.85 + 0.3 * fbm2(t * 5, 4.5, 2, seed + 3));
    const ring = [];
    for (let i = 0; i < NS; i++) {
      const a = (i / NS) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const nz = fbm2(ca * 1.5 + t * 7, sa * 1.5 + t * 3, 3, seed + 11);
      const rr = 0.78 + 0.44 * nz;
      const dd = d + nd * ca * halfR * rr, yy = hPath + nyy * ca * halfR * rr, ss = sa * halfT * rr;
      const p = road.pointAt(s + ss, dd, {});
      ring.push({ x: p.x, y: yRoad + yy - (foot > 0.9 ? 6 : 0), z: p.z });
    }
    rings.push(ring);
  }
  // clearance: nothing below 15 m over |d| < 10.5
  let low = 1e9; for (const r of rings) for (const p of r) { const q = road.nearest(p.x, p.z, s, 40, _nn); if (Math.abs(q.d) < 10.5) low = Math.min(low, p.y - yRoad); }
  if (low < 15) for (const r of rings) for (const p of r) p.y += 15 - low;
  // close the ends: ring 0 and ring NP sunk into the ground
  rm.grid(rings, 0, o.splat, false);
  // collision: legs only (|d| > 11), coarse
  for (const leg of [0, 1]) {
    const part = leg ? rings.slice(NP - 12) : rings.slice(0, 13);
    const sub = []; for (let j = 0; j < part.length; j += 3) sub.push(part[j].filter((_, i) => i % 3 === 0));
    const cb = rm.C.pos.length / 3, nc = sub[0].length;
    for (const r of sub) for (const p of r) rm.C.pos.push(p.x, p.y, p.z);
    for (let a = 0; a < sub.length - 1; a++) for (let k = 0; k < nc; k++) { const k2 = (k + 1) % nc; rm.C.idx.push(cb + a * nc + k, cb + a * nc + k2, cb + (a + 1) * nc + k2, cb + a * nc + k, cb + (a + 1) * nc + k2, cb + (a + 1) * nc + k); }
  }
  return { x: sm.x, z: sm.z, r: span + 10 };
}
const _nn = {};

// ------------------------------------------------------------------------------------------------ planning
const PLAN = {
  canyon: { pitch: 330, chance: 0.85 },
  desert: { pitch: 700, chance: 0.6 },
  coast: { pitch: 260, chance: 0.75 },
};
function bid(s) { const b = biomeAt(s); return b.w > 0.5 ? b.b : b.a; }

/**
 * Find a seat for a formation of radius R on one side, scanning the gap to the road (dA..dB m beyond 13 m from the centre line): a patch of ground that is fairly flat
 * over the footprint and either on the canyon FLOOR (<= 7 m above the road) or on top of the RIM (>= 18 m above, so it
 * stands out against the sky). mode: 'floor' | 'rim' | 'any'. Returns d or null.
 */
function seat(ctx, s, side, R, dA, dB, mode) {
  const { road, seed } = ctx, ry = road.sample(s, {}).y;
  for (let a = dA; a <= dB; a += 5) {
    const d = side * (13 + a + R);                  // a = gap between the road strip (+3.5 m) and the rock
    let mn = 1e9, mx = -1e9;
    for (const [ds, dd] of [[0, 0], [R, 0], [-R, 0], [0, R * 0.9], [0, -R * 0.9]]) { const y = groundAt(road, seed, s + ds, d + dd, _G).y; mn = Math.min(mn, y); mx = Math.max(mx, y); }
    if (mx - mn > Math.max(3, R * 0.7)) continue;
    const h = mn - ry;
    if ((mode === 'floor' || mode === 'any') && h < 7) return d;
    if ((mode === 'rim' || mode === 'any') && h > 18) return d;
  }
  return null;
}

/** Formations of slot k of a biome table: [{kind, s, d, R, H, ...}] (pure). */
function planSlot(ctx, id, k) {
  const key = `rk:${id}:${k}`, cache = ctx.rockCache || (ctx.rockCache = new Map());
  if (cache.has(key)) return cache.get(key);
  const T = PLAN[id], { road, seed } = ctx, out = [];
  cache.set(key, out);
  const sc = k * T.pitch + (hash2(k, 401, seed) - 0.5) * T.pitch * 0.6;
  if (bid(sc) !== id) return out;
  const r = rngOf(seed, k, 4000 + id.length);
  if (r() > T.chance) return out;
  road.extendTo(sc + 800);
  const clear = (s, d, rad) => !road.featuresIn(s - rad - 30, s + rad + 30).some((f) => (f.type === 'bridge' || f.type === 'tunnel' || f.type === 'overpass') && Math.abs(d) - rad < 40);
  if (id === 'canyon' || id === 'desert') {
    const u = r();
    const side = r() < 0.5 ? 1 : -1;
    const mode = id === 'desert' ? 'any' : r() < 0.62 ? 'floor' : 'rim';
    const dA = id === 'desert' ? 40 + r() * 120 : mode === 'floor' ? 5 + r() * 6 : 20;
    if (u < 0.5) {                                          // hoodoo cluster
      const n = 1 + Math.floor(r() * 3), s0 = sc + (r() - 0.5) * 30;
      for (let i = 0; i < n; i++) {
        const H = (mode === 'floor' ? 14 : 20) + r() * 20, R = 2.8 + r() * 2.8, s = s0 + i * (8 + r() * 10);
        const d = seat(ctx, s, side, R, dA + i * 4, dA + 220, mode);
        if (d !== null) out.push({ kind: 'hoodoo', s, d, R, H, cap: 3 + r() * 2, capFlare: 0.3 + r() * 0.25, boulder: r() < 0.35, lean: [(r() - 0.5) * 0.03, (r() - 0.5) * 0.03] });
      }
    } else if (u < 0.74) {                                  // spires (a pair flanking the road now and then)
      const both = id === 'canyon' && mode === 'floor' && r() < 0.5;
      for (const sd of both ? [1, -1] : [side]) {
        const H = 22 + r() * 26, R = 2.5 + r() * 1.8, s = sc + (r() - 0.5) * 16;
        const d = seat(ctx, s, sd, R, both ? 4 : dA, dA + 200, mode);
        if (d !== null) out.push({ kind: 'spire', s, d, R, H, lean: [(r() - 0.5) * 0.08, (r() - 0.5) * 0.08], dome: 0.6 });
      }
    } else if (u < 0.88) {                                  // fin
      const H = 18 + r() * 18, R = 8 + r() * 6, d = seat(ctx, sc, side, R * 0.4, dA, dA + 220, mode);
      if (d !== null) out.push({ kind: 'spire', s: sc, d: d + side * R * 0.3, R, H, flat: 0.25, rot: r() * 3, dome: 0.8, N: 32 });
    } else {                                                // butte (rim / desert only)
      const H = 25 + r() * 25, R = 20 + r() * 16, d = seat(ctx, sc, side, R, 60, 360, id === 'desert' ? 'any' : 'rim');
      if (d !== null) out.push({ kind: 'butte', s: sc, d, R, H, cap: 5, capFlare: 0.06, dome: 0.4, strata: 5.2, N: 34, M: 40 });
    }
  } else if (id === 'coast') {
    const sea = seaLevel(road, 'coast');
    const n = r() < 0.4 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const d = 70 + r() * 360, s = sc + (r() - 0.5) * 120;
      if (groundAt(road, seed, s, d, _G).y > sea - 5) continue;
      if (ctx.wreckNear && ctx.wreckNear(s, d)) continue;
      const H = 18 + r() * 26, R = 7 + r() * 9;
      out.push({ kind: 'stack', s, d, R, H, y: sea, strata: 2.6, dome: 0.8, grass: r() < 0.7, pierced: r() < 0.18 && R > 10 });
    }
  }
  for (const f of out) if (!clear(f.s, f.d, f.R)) f.skip = true;
  return out;
}

// far mesas / buttes on the horizon (replace the old low-poly GLB mesas): 90-220 m wide, 55-140 m tall, banded cliffs, talus skirt
const MESA = { desert: { pitch: 620, chance: 0.62, v: [330, 760], R: [45, 90], H: [55, 100] }, canyon: { pitch: 520, chance: 0.7, v: [400, 780], R: [55, 105], H: [80, 140] } };
function planMesa(ctx, id, k) {
  const key = `ms:${id}:${k}`, cache = ctx.rockCache || (ctx.rockCache = new Map());
  if (cache.has(key)) return cache.get(key);
  const T = MESA[id], { road, seed } = ctx, out = [];
  cache.set(key, out);
  const sc = k * T.pitch + (hash2(k, 431, seed) - 0.5) * T.pitch * 0.6;
  if (bid(sc) !== id) return out;
  const r = rngOf(seed, k, 4300 + id.length);
  if (r() > T.chance) return out;
  road.extendTo(sc + 1200);
  const side = r() < 0.5 ? 1 : -1, v = T.v[0] + r() * (T.v[1] - T.v[0]), R = T.R[0] + r() * (T.R[1] - T.R[0]), H = T.H[0] + r() * (T.H[1] - T.H[0]);
  const s = sc + (r() - 0.5) * 80;
  if (road.featuresIn(s - R - 60, s + R + 60).some((f) => (f.type === 'tunnel' || f.type === 'bridge'))) return out;
  out.push({ kind: 'butte', mesa: true, s, d: side * (v + R), R, H, cap: 6 + r() * 4, capFlare: 0.05, dome: 0.3, strata: 4.2 + r() * 2.5, N: 64, M: Math.min(72, Math.ceil(H / 2.1)), flat: r() < 0.5 ? 0.55 + r() * 0.3 : 0, rot: r() * 3.14 });
  return out;
}

/** All planned formations with anchor s in [sA, sB). */
export function rocksIn(ctx, sA, sB) {
  const out = [];
  for (const id of Object.keys(MESA)) {
    const T = MESA[id];
    for (let k = Math.floor(sA / T.pitch) - 1; k <= Math.ceil(sB / T.pitch) + 1; k++) for (const f of planMesa(ctx, id, k)) if (f.s >= sA && f.s < sB) out.push(f);
  }
  for (const id of Object.keys(PLAN)) {
    const T = PLAN[id];
    for (let k = Math.floor(sA / T.pitch) - 1; k <= Math.ceil(sB / T.pitch) + 1; k++) for (const f of planSlot(ctx, id, k)) if (!f.skip && f.s >= sA && f.s < sB) out.push(f);
  }
  return out;
}
/** Natural arches across the road in the canyon: one per ~2.3 km slot, on a straight bit where both walls are high. */
export function archesIn(ctx, sA, sB) {
  const out = [], { road, seed } = ctx, pitch = 2300;
  const cache = ctx.archCache || (ctx.archCache = new Map());
  for (let k = Math.floor(sA / pitch) - 1; k <= Math.ceil(sB / pitch) + 1; k++) {
    let q = cache.get(k);
    if (q === undefined) {
      q = null;
      const s = k * pitch + (hash2(k, 511, seed) - 0.5) * pitch * 0.9;
      const rnd = rngOf(seed, k, 511);
      if (bid(s) === 'canyon' && rnd() < 0.92) {
        road.extendTo(s + 400);
        let best = null, bestScore = -3;
        for (let t = 0; t < 12; t++) {
          const s1 = s + (t - 6) * 22, sm = road.sample(s1, {});
          if (road.featureAt(s1) || road.featuresIn(s1 - 60, s1 + 60).some((f) => f.type !== 'guard' && f.type !== 'boost')) continue;
          if (Math.abs(sm.k) > 1 / 260) continue;
          let score = 1e9;
          for (const ds of [0, 7, 14]) for (const d of [22, -22]) score = Math.min(score, groundAt(road, seed, s1 + ds, d, _G).y - road.sample(s1 + ds, {}).y);
          if (score > bestScore) { bestScore = score; best = s1 + 7; }
        }
        if (best !== null) q = { s: best, span: 24 + rnd() * 6, H: 24 + rnd() * 6, T: 5.5 + rnd() * 2.5, R: 5 + rnd() * 1.5 };
      }
      cache.set(k, q);
    }
    if (q && q.s >= sA && q.s < sB) out.push(q);
  }
  return out;
}

/** Exclusion circles for scatter. */
export function rockExclusions(ctx, sA, sB) {
  const out = [], P = {};
  for (const f of rocksIn(ctx, sA - 80, sB + 80)) { ctx.road.pointAt(f.s, f.d, P); out.push([P.x, P.z, f.R * 1.6 + 3]); }
  for (const q of archesIn(ctx, sA - 80, sB + 80)) for (const sd of [1, -1]) { ctx.road.pointAt(q.s, sd * q.span, P); out.push([P.x, P.z, q.R * 2.5 + 6]); }
  return out;
}

// ------------------------------------------------------------------------------------------------ chunk build
export function buildRocks(ctx, chunk) {
  if (chunk.done.has('rocks')) return true;
  const mat = chunk.rec && chunk.rec.mesh && chunk.rec.mesh.material;
  if (!mat) return false;
  chunk.done.add('rocks');
  const s0 = chunk.s0, s1 = s0 + CHUNK_LEN, { road, seed } = ctx;
  const list = rocksIn(ctx, s0, s1);
  const arches = archesIn(ctx, s0, s1);
  if (!list.length && !arches.length) return true;
  const a = road.sample(s0, {}), rm = new RockMesh(a.x, a.y, a.z);
  const bio = biomeAt(s0 + 48);
  rm.desert = (bio.a === 'desert' || bio.a === 'canyon' ? 1 - bio.w : 0) + (bio.b === 'desert' || bio.b === 'canyon' ? bio.w : 0);
  if (bio.a === 'coast' || bio.b === 'coast') rm.seaY = seaLevel(road, 'coast');
  const P = {};
  for (const f of list) {
    road.pointAt(f.s, f.d, P);
    // ground: lowest terrain under the footprint
    let gy = 1e9; for (const [ds, dd] of [[0, 0], [f.R, 0], [-f.R, 0], [0, f.R], [0, -f.R]]) gy = Math.min(gy, groundAt(road, seed, f.s + ds, f.d + dd, _G).y);
    if (f.mesa) { let sum = 0; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; sum += groundAt(road, seed, f.s + Math.cos(a) * f.R * 0.8, f.d + Math.sin(a) * f.R * 0.8, _G).y; } gy = Math.min(gy + 6, sum / 8 - 2); }
    const fseed = (seed * 31 + Math.round(f.s * 7) + Math.round(f.d * 13)) & 0xffff;
    const near = Math.abs(f.d) - f.R < 70;
    if (f.kind === 'stack') {
      column(rm, { ...f, x: P.x, z: P.z, y: f.y, seed: fseed, splat: greyRock(fseed, f.grass), collide: near, M: 40, N: 28 });
    } else {
      column(rm, { ...f, x: P.x, z: P.z, y: gy, seed: fseed, splat: redRock(fseed), capSplat: capRock(fseed), collide: near });
    }
  }
  for (const q of arches) arch(rm, road, seed, q.s, { span: q.span, H: q.H, T: q.T, R: q.R, splat: redRock(seed + 77) });
  if (!rm.I.length) return true;
  chunk.addExtra(rm.build(mat));
  if (rm.C.idx.length) { const id = `rocks:${chunk.c}`; chunk.hooks.push(id); ctx.hook({ type: 'static', id, asset: 'rocks', collision: { pos: new Float32Array(rm.C.pos), idx: new Uint32Array(rm.C.idx) } }); }
  chunk.dirty = true;
  return true;
}

void clamp; void EDGE;
