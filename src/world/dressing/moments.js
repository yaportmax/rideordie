// Hand-scheduled roadside "moments" so the drive never goes quiet between the procedural sets:
//   coast    - fishing villages (gabled clapboard houses up the hillside, boats on racks, drying frames, a chapel, lit windows)
//            - a rusting freighter aground offshore, broken in two, with its bow on the rocks
//   mountain - cable-car lines crossing high over the road (lattice towers on both slopes, a stranded cabin, beacons)
// Positions are searched deterministically around nominal distances (skipping road features); the chunk containing the anchor
// builds the whole set into one facade-material mesh (+ collider boxes near the road).
import * as THREE from 'three';
import { biomeAt } from '../../data/biomes.js';
import { hash2 } from '../../core/util.js';
import { CHUNK_LEN, groundAt, rngOf } from './util.js';
import { MB, frameYaw, frameBasis } from './mbuild.js';
import { ST, facadeMaterial } from './city_mat.js';
import { seaLevel } from '../terrain_gen.js';
import { lattice, cable, dotAt } from './damroad.js';

const WANT = [
  [21150, 'coast', 'village'], [22600, 'coast', 'wreck'], [25300, 'coast', 'village'], [27800, 'coast', 'wreck'], [29000, 'coast', 'village'],
  [32300, 'mountain', 'cablecar'], [36200, 'mountain', 'cablecar'], [38800, 'mountain', 'cablecar'],
];
const _G = {};
const bid = (s) => { const b = biomeAt(s); return b.w > 0.5 ? b.b : b.a; };

function plan(ctx, want, biome, kind) {
  const { road, seed } = ctx;
  road.extendTo(want + 1500);
  for (let k = 0; k < 30; k++) {
    const s = want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 40;
    if (bid(s - 150) !== biome || bid(s + 150) !== biome) continue;
    if (road.featuresIn(s - 150, s + 150).some((f) => f.type !== 'guard' && f.type !== 'boost')) continue;
    if (kind === 'village') {
      // land side (right, -d) must be gentle enough for houses; sea side (left) must drop to the water within 60 m
      const sea = seaLevel(road, 'coast');
      let ok = true;
      for (const ds of [-60, 0, 60]) { const g1 = groundAt(road, seed, s + ds, -40, _G).y, g2 = groundAt(road, seed, s + ds, -90, _G).y; if (Math.abs(g2 - g1) > 22) ok = false; }
      if (groundAt(road, seed, s, 70, _G).y > sea + 1) ok = false;
      if (ok) return { s, kind };
    } else if (kind === 'wreck') {
      const sea = seaLevel(road, 'coast');
      if (groundAt(road, seed, s, 190, _G).y < sea - 8 && groundAt(road, seed, s + 60, 230, _G).y < sea - 8) return { s, kind };
    } else if (kind === 'cablecar') {
      // both sides must rise: towers on the slopes at +-60..110 m, >= 25 m above the road
      const ry = road.sample(s, {}).y;
      const L = groundAt(road, seed, s, 85, _G).y - ry, R = groundAt(road, seed, s, -85, _G).y - ry;
      if (L > -40 && R > -40 && Math.max(L, R) > 10) return { s, kind };
    }
  }
  return null;
}
/** Is (s, d) within 140 m of a planned shipwreck? (the sea-stack planner keeps clear of them) */
export function wreckNear(ctx, s, d) {
  for (const m of momentsNear(ctx, s - 400, s + 400)) if (m.kind === 'wreck' && Math.abs(m.s - s) < 160 && d > 60) return true;
  return false;
}
export function momentsNear(ctx, sA, sB) {
  const cache = ctx.momentCache || (ctx.momentCache = new Map()), out = [];
  for (const [want, biome, kind] of WANT) {
    if (want > sB + 1500 || want < sA - 1500) continue;
    if (!cache.has(want)) cache.set(want, plan(ctx, want, biome, kind));
    const m = cache.get(want);
    if (m && m.s >= sA && m.s < sB) out.push(m);
  }
  return out;
}
export function momentExclusions(ctx, sA, sB) {
  const out = [], P = {};
  for (const m of momentsNear(ctx, sA - 200, sB + 200)) {
    if (m.kind === 'village') for (let ds = -90; ds <= 90; ds += 30) { ctx.road.pointAt(m.s + ds, -60, P); out.push([P.x, P.z, 34]); }
    if (m.kind === 'cablecar') for (const sd of [1, -1]) { ctx.road.pointAt(m.s, sd * 90, P); out.push([P.x, P.z, 12]); }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ builders
const WOOD = [[0.55, 0.22, 0.16], [0.2, 0.33, 0.42], [0.62, 0.58, 0.48], [0.3, 0.4, 0.3], [0.55, 0.45, 0.2], [0.42, 0.42, 0.44]];

/** Gabled house: box + pitched roof (ridge along local x), in frame F (front = +z). */
function house(mb, F, W, D, H, r, lit) {
  const c = WOOD[Math.floor(r() * WOOD.length) % WOOD.length].map((v) => v * (0.85 + r() * 0.25));
  mb.col(c[0], c[1], c[2]).setFac(ST.PUNCHED, 2.4 + r() * 0.6, 2.9, r()).setFac2(lit, 0, 0.2, 0);
  mb.box(F, -W / 2, W / 2, -1.5, H, -D / 2, D / 2, { vBase: 0.3, skip: 't' });
  // roof
  const rh = D * 0.42, ov = 0.45, rc = [0.2 + r() * 0.15, 0.15 + r() * 0.08, 0.13];
  mb.col(rc[0], rc[1], rc[2]).setFac(ST.PLAIN, 1, 1, r()).setFac2(0, 0, 0, 0);
  const P = [{}, {}, {}, {}];
  for (const sd of [1, -1]) {
    MB.at(F, -W / 2 - ov, H - 0.2, sd * (D / 2 + ov), P[0]); MB.at(F, W / 2 + ov, H - 0.2, sd * (D / 2 + ov), P[1]);
    MB.at(F, W / 2 + ov, H + rh, 0, P[2]); MB.at(F, -W / 2 - ov, H + rh, 0, P[3]);
    const hint = MB.at(F, 0, 1, sd, {}); mb.quadOut(P[0], P[1], P[2], P[3], hint.x - F.x, 1, hint.z - F.z);
  }
  mb.col(c[0], c[1], c[2]).setFac(ST.PLAIN, 1, 1, r());
  for (const sx of [1, -1]) {
    const a = MB.at(F, sx * W / 2, H, D / 2, {}), b = MB.at(F, sx * W / 2, H, -D / 2, {}), t = MB.at(F, sx * W / 2, H + rh, 0, {});
    const hint = MB.at(F, sx, 0, 0, {}); const hx = hint.x - F.x, hz = hint.z - F.z;
    const nx = (b.y - a.y) * (t.z - a.z) - (b.z - a.z) * (t.y - a.y), nz = (b.x - a.x) * (t.y - a.y) - (b.y - a.y) * (t.x - a.x);
    if (nx * hx + nz * hz >= 0) mb.triW(a, b, t, 0, 0, 1, 0, 0.5, 1); else mb.triW(b, a, t, 0, 0, 1, 0, 0.5, 1);
  }
  // chimney
  if (r() < 0.6) { mb.col(0.35, 0.3, 0.28); const cx = (r() - 0.5) * W * 0.6; mb.box(F, cx - 0.4, cx + 0.4, H + rh * 0.4, H + rh + 1.1, -0.9, -0.1); }
}

function village(ctx, mb, cols, m) {
  const { road, seed } = ctx, r = rngOf(seed, Math.round(m.s), 9001), P = {};
  const lit = 0.35 + r() * 0.2;
  // houses on terraces up the land side
  for (let i = 0; i < 16; i++) {
    const s = m.s + (r() - 0.5) * 190, d = -(26 + r() * 95);
    const W = 6 + r() * 4, D = 5 + r() * 3, H = 3.2 + (r() < 0.35 ? 3 : 0) + r() * 0.8;
    let gy = 1e9; for (const [ds, dd] of [[0, 0], [W / 2, D / 2], [-W / 2, D / 2], [W / 2, -D / 2], [-W / 2, -D / 2]]) gy = Math.min(gy, groundAt(road, seed, s + ds, d + dd, _G).y);
    road.pointAt(s, d, P);
    const th = road.sample(s, {}).th, yaw = th + Math.PI / 2 + (r() - 0.5) * 0.5;   // fronts face the sea (the road)
    const F = frameYaw(P.x, gy, P.z, yaw, {});
    house(mb, F, W, D, H, r, lit);
    if (Math.abs(d) < 60) boxCol(cols, F, -W / 2, W / 2, -1, H + 1, -D / 2, D / 2);
  }
  // chapel with a bell tower (the landmark of the village)
  { const s = m.s + 20, d = -72; let gy = 1e9; for (const [ds, dd] of [[0, 0], [6, 4], [-6, 4], [6, -4], [-6, -4]]) gy = Math.min(gy, groundAt(road, seed, s + ds, d + dd, _G).y);
    road.pointAt(s, d, P); const F = frameYaw(P.x, gy, P.z, road.sample(s, {}).th + Math.PI / 2, {});
    house(mb, F, 12, 8, 6.5, () => 0.3, 0.2);
    mb.col(0.7, 0.68, 0.62).setFac(ST.PUNCHED, 3, 4, 0.9).setFac2(0.1, 0, 0.1, 0);
    mb.box(F, 4.5, 8, -1.5, 16, -2, 1.5, { vBase: 8 });
    const T = { ...F, y: F.y }; const P4 = [{}, {}, {}, {}];
    mb.col(0.25, 0.18, 0.15).setFac(ST.PLAIN, 1, 1, 0.9);
    const apex = MB.at(T, 6.25, 21, -0.25, {});
    for (const [a, b] of [[[4.3, -2.2], [8.2, -2.2]], [[8.2, -2.2], [8.2, 1.7]], [[8.2, 1.7], [4.3, 1.7]], [[4.3, 1.7], [4.3, -2.2]]]) {
      MB.at(T, a[0], 16, a[1], P4[0]); MB.at(T, b[0], 16, b[1], P4[1]);
      const mx = (P4[0].x + P4[1].x) / 2 - apex.x, mz = (P4[0].z + P4[1].z) / 2 - apex.z;
      mb.quadOut(P4[0], P4[1], apex, apex, mx, 0.5, mz);
    }
  }
  // boats pulled up on the shoulder / hanging on racks + drying frames (sea side, beyond the guard rail)
  for (let i = 0; i < 5; i++) {
    const s = m.s + (r() - 0.5) * 120, d = 12.5 + r() * 3;
    const g = groundAt(road, seed, s, d, _G); if (g.y < seaLevel(road, 'coast') + 2) continue;
    road.pointAt(s, d, P);
    const F = frameYaw(P.x, g.y + 0.35, P.z, road.sample(s, {}).th + (r() - 0.5) * 0.4, {});
    boat(mb, F, 5 + r() * 2, r);
  }
  for (let i = 0; i < 3; i++) {
    const s = m.s + (r() - 0.5) * 140, d = -(12 + r() * 5), g = groundAt(road, seed, s, d, _G);
    road.pointAt(s, d, P); const F = frameYaw(P.x, g.y, P.z, road.sample(s, {}).th, {});
    mb.col(0.35, 0.27, 0.2).setFac(ST.PLAIN, 1, 1, 0.4);
    for (const z of [-3, 3]) { mb.box(F, -0.1, 0.1, 0, 2.4, z - 0.1, z + 0.1); }
    mb.box(F, -0.08, 0.08, 2.3, 2.45, -3.2, 3.2);
    mb.col(0.3, 0.32, 0.25);
    for (let k = 0; k < 5; k++) mb.box(F, -0.02, 0.02, 1.0 + r() * 0.3, 2.3, -2.6 + k * 1.3, -2.0 + k * 1.3);   // nets
  }
}

function boat(mb, F, L, r) {
  const c = WOOD[Math.floor(r() * WOOD.length) % WOOD.length];
  mb.col(c[0], c[1], c[2]).setFac(ST.PLAIN, 1, 1, r());
  const hw = L * 0.2, P = [{}, {}, {}, {}];
  // simple hull: two slanted sides + transom + deck line, bow at +z
  const pts = (sx) => [[sx * hw, 0.9, -L / 2], [sx * hw, 0.9, L * 0.3], [0, 1.0, L / 2], [0, 0, L * 0.3], [sx * hw * 0.3, 0, -L / 2]];
  for (const sx of [1, -1]) {
    const p = pts(sx).map(([x, y, z]) => MB.at(F, x, y, z, {}));
    const hint = MB.at(F, sx, 0, 0, {}), hx = hint.x - F.x, hz = hint.z - F.z;
    mb.quadOut(p[4], p[3], p[1], p[0], hx, -0.3, hz); mb.quadOut(p[3], p[2], p[1], p[1], hx, -0.3, hz);
  }
  MB.at(F, -hw, 0.9, -L / 2, P[0]); MB.at(F, hw, 0.9, -L / 2, P[1]); MB.at(F, hw * 0.3, 0, -L / 2, P[2]); MB.at(F, -hw * 0.3, 0, -L / 2, P[3]);
  const b = MB.at(F, 0, 0, -1, {}); mb.quadOut(P[0], P[1], P[2], P[3], b.x - F.x, 0, b.z - F.z);
  mb.col(0.22, 0.2, 0.18); mb.box(F, -hw + 0.1, hw - 0.1, 0.5, 0.62, -L / 2 + 0.2, L * 0.28);
}

/** Rusting freighter aground offshore, broken in two (stern section listing). */
function wreck(ctx, mb, m) {
  const { road, seed } = ctx, r = rngOf(seed, Math.round(m.s), 9101), sea = seaLevel(road, 'coast');
  const sm = road.sample(m.s, {}), d = 170 + r() * 50;
  const base = { x: sm.x + sm.nx * d, z: sm.z + sm.nz * d };
  const yaw = sm.th + 0.5 + r() * 0.6;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  const hull = [0.13, 0.05, 0.03], hullDark = [0.05, 0.045, 0.04];
  const section = (cx, cz, L, B, H, roll, pitch, bowEnd, sternEnd, y0) => {
    const lx = fz, lz = -fx;                                                   // left of the heading
    const up = [Math.sin(roll) * lx - Math.sin(pitch) * fx, Math.cos(roll) * Math.cos(pitch), Math.sin(roll) * lz - Math.sin(pitch) * fz];
    const F = frameBasis(cx, y0, cz, up, [fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch)], {});
    // hull rings along local z: beam narrows to the bow; waterline dark
    const n = 10, rings = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, z = -L / 2 + L * t;
      let b = B / 2;
      if (bowEnd && t > 0.7) b *= Math.max(0.05, 1 - Math.pow((t - 0.7) / 0.3, 1.6));
      if (sternEnd && t < 0.1) b *= 0.8 + 2 * t;
      rings.push([[-b, H], [-b * 0.98, H * 0.35], [-b * 0.7, 0], [b * 0.7, 0], [b * 0.98, H * 0.35], [b, H]].map(([x, y]) => MB.at(F, x, y, z, {})));
    }
    mb.col(...hull).setFac(ST.PLAIN, 1, 1, 0.77).setFac2(0, 0, 0, 0);
    for (let i = 0; i < n; i++) for (let k = 0; k < 5; k++) {
      const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k + 1], e = rings[i + 1][k];
      const mid = { x: (a.x + c.x) / 2 - F.x, y: (a.y + c.y) / 2 - F.y - H * 0.5, z: (a.z + c.z) / 2 - F.z };
      if (k === 1 || k === 2 || k === 3) mb.col(...(k === 2 ? hullDark : hull));
      mb.quadOut(a, b, c, e, mid.x, mid.y, mid.z);
    }
    // deck
    mb.col(0.2, 0.18, 0.16);
    for (let i = 0; i < n; i++) mb.quadOut(rings[i][0], rings[i][5], rings[i + 1][5], rings[i + 1][0], F.R[3], F.R[4], F.R[5]);
    return F;
  };
  const L1 = 70, L2 = 45, B = 16, H = 13;
  // bow section, bow up on the rocks
  const Fb = section(base.x + fx * 30, base.z + fz * 30, L1, B, H, 0.05, 0.07, true, false, sea - 6);
  // stern section listing, torn end facing the bow
  const Fs = section(base.x - fx * 32 + 6 * Math.cos(yaw), base.z - fz * 32 - 6 * Math.sin(yaw), L2, B, H, 0.26, -0.04, false, true, sea - 8);
  // superstructure on the stern (windows, lit a little), funnel, cranes on the bow section
  mb.col(0.72, 0.7, 0.64).setFac(ST.RIBBON, 1.4, 2.8, 0.66).setFac2(0.05, 0, 0.8, 0);
  mb.box(Fs, -6, 6, H, H + 12, -18, -8, { vBase: H });
  mb.box(Fs, -7.5, 7.5, H + 12, H + 12.4, -18.5, -7.5, {});
  mb.col(0.15, 0.13, 0.12).setFac(ST.PLAIN, 1, 1, 0.1);
  mb.cyl(Fs, 0, -14, H + 12.4, H + 19, 2.2, 1.9, 10, true);
  mb.col(0.55, 0.42, 0.12).setFac(ST.PLAIN, 1, 1, 0.3);
  for (const z of [-15, 8]) { mb.box(Fb, -0.6, 0.6, H, H + 14, z - 0.6, z + 0.6); mb.beam(Fb, 0, H + 12, z, 7, H + 4, z + 10, 0.5, 0.5); }
  // hatch covers
  mb.col(0.3, 0.2, 0.14);
  for (const z of [-25, -10, 5]) mb.box(Fb, -5.5, 5.5, H, H + 1.3, z - 5, z + 5);
  // torn edges: jagged plates at the break
  mb.col(...hull);
  for (let i = 0; i < 6; i++) { const x = (r() - 0.5) * B * 0.8; mb.box(Fb, x - 1.2, x + 1.2, r() * H * 0.6, H * (0.6 + r() * 0.5), -L1 / 2 - 1.5 - r() * 2, -L1 / 2 + 0.3); }
  void Fs;
}

/** Cable-car line crossing over the road: lattice towers on both slopes, cables, a stranded cabin and a counterweight. */
function cablecar(ctx, mb, cols, m) {
  const { road, seed } = ctx, r = rngOf(seed, Math.round(m.s), 9201), P = {};
  const sm = road.sample(m.s, {}), cross = 0.35 + r() * 0.3;       // the line crosses at an angle
  const tops = [];
  for (const sd of [1, -1]) {
    let best = null;
    for (let a = 40; a <= 140; a += 5) {
      const g = groundAt(road, seed, m.s + sd * a * cross, sd * a, _G), h = g.y - sm.y;
      if (h > 6 && h < 40) { best = { a, y: g.y }; break; }
      if (!best || Math.abs(h - 20) < Math.abs(best.y - sm.y - 20)) best = { a, y: g.y };
    }
    const s = m.s + sd * best.a * cross, d = sd * best.a; road.pointAt(s, d, P);
    const H = Math.max(16, sm.y + 50 - best.y);
    const F = frameBasis(P.x, best.y - 1, P.z, [0, 1, 0], [-sd * sm.nx, 0, -sd * sm.nz], {});   // local z toward the road
    mb.col(0.3, 0.32, 0.34).setFac(ST.PLAIN, 1, 1, 0.3).setFac2(0, 0, 0, 0);
    lattice(mb, F, H, 2.4, 1.1, 7);
    mb.box(F, -4.5, 4.5, H, H + 1.6, -1.6, 1.6, {});                 // head frame with sheaves
    for (const x of [-3.6, 3.6]) mb.cyl(F, x, 0, H + 1.6, H + 1.9, 1.1, 1.1, 10, true);
    dotAt(mb, MB.at(F, 0, H + 2.4, 0, {}), 0.8, 0, 3, r());
    mb.col(0.4, 0.39, 0.37); mb.box(F, -3.5, 3.5, -2, 1.2, -3.5, 3.5, {});
    tops.push([MB.at(F, -3.6, H + 1.9, 0, {}), MB.at(F, 3.6, H + 1.9, 0, {})]);
    if (best.a < 70) boxCol(cols, F, -3, 3, -1, H, -3, 3);
  }
  // cables (two ropes), the far tower's left is our right
  cable(mb, tops[0][0], tops[1][1], 9, 0.1); cable(mb, tops[0][1], tops[1][0], 9, 0.1);
  // stranded cabin hanging from the first rope at ~40% of the span
  const t = 0.4, a = tops[0][0], b = tops[1][1];
  const hx = a.x + (b.x - a.x) * t, hz = a.z + (b.z - a.z) * t, hy = a.y + (b.y - a.y) * t - 9 * 4 * t * (1 - t);
  const yaw = Math.atan2(b.x - a.x, b.z - a.z);
  const F = frameYaw(hx, hy, hz, yaw, {});
  mb.col(0.2, 0.2, 0.22).setFac(ST.PLAIN, 1, 1, 0.5);
  mb.box(F, -0.15, 0.15, -3.2, 0, -0.15, 0.15, {});
  mb.col(0.72, 0.2, 0.12).setFac(ST.RIBBON, 1.2, 2.2, 0.4).setFac2(0.0, 0, 0.9, 0);
  mb.box(F, -1.6, 1.6, -6.2, -3.2, -2.2, 2.2, { vBase: -6.2 });
  mb.col(0.25, 0.25, 0.27).setFac(ST.PLAIN, 1, 1, 0.5); mb.box(F, -1.7, 1.7, -3.3, -3.0, -2.3, 2.3, {});
}

function boxCol(cols, F, x0, x1, y0, y1, z0, z1) {
  const base = cols.pos.length / 3;
  for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]) { const p = MB.at(F, x, y, z, {}); cols.pos.push(p.x, p.y, p.z); }
  for (const t of [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) cols.idx.push(base + t);
}

export function buildMoments(ctx, chunk) {
  if (chunk.done.has('moments')) return true;
  chunk.done.add('moments');
  const s0 = chunk.s0, list = momentsNear(ctx, s0, s0 + CHUNK_LEN);
  if (!list.length) return true;
  const a = ctx.road.sample(s0, {});
  const mb = new MB(a, { uvName: 'aUvF', cap: 8192 }), cols = { pos: [], idx: [] };
  for (const m of list) {
    if (m.kind === 'village') village(ctx, mb, cols, m);
    else if (m.kind === 'wreck') wreck(ctx, mb, m);
    else if (m.kind === 'cablecar') cablecar(ctx, mb, cols, m);
  }
  if (mb.count) {
    const g = mb.build(); g.boundingSphere.radius += 40;
    const m = new THREE.Mesh(g, facadeMaterial());
    m.position.set(a.x, a.y, a.z); m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true; m.matrixAutoUpdate = false; m.updateMatrix(); m.name = 'moments';
    chunk.addExtra(m);
  }
  if (cols.idx.length) { const id = `moments:${chunk.c}`; chunk.hooks.push(id); ctx.hook({ type: 'static', id, asset: 'moments', collision: { pos: new Float32Array(cols.pos), idx: new Uint32Array(cols.idx) } }); }
  chunk.dirty = true;
  return true;
}

void hash2;
