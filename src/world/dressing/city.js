// Ashen City (41-50 km): a dense procedural ruined metropolis around the road.
//  Row A  street wall  (front 14.5-19 m): 1-24 storey buildings, storefronts, neon, awnings, broken tops, collapsed lots, side streets.
//  Row B  behind       (front 42-95 m): mid / high-rise, setbacks, water tanks, antennas.
//  Row C  skyline      (130-520 m): towers 15-60 storeys, beacons, a few burning.
// Everything is a pure function of (seed, s): blocks of ~118 m per side are planned once and cached; a chunk builds the buildings whose
// centre lies in it into ONE facade mesh (one draw call, one shader) + ONE neon mesh, and registers box colliders for the near rows.
import * as THREE from 'three';
import { hash2, smoothstep, fbm1 } from '../../core/util.js';
import { rngOf, CHUNK_LEN } from './util.js';
import { MB, frameYaw, frameBasis } from './mbuild.js';
import { facadeMaterial, neonMaterial, smokeMaterial, flameMaterial, neonRect, ST, NEON_H, NEON_V, NEON_DOT } from './city_mat.js';

export const CITY_A = 40350, CITY_B = 50250;
/** 0..1 city density along the road (suburbs ramp in/out) and the downtown core weight. */
export const cityDens = (s) => smoothstep(40450, 41400, s) * (1 - smoothstep(49300, 50150, s));
export const cityCore = (s) => smoothstep(41900, 43400, s) * (1 - smoothstep(47600, 49000, s));

const BLOCK = 118;
const PAL = {
  concrete: [[0.5, 0.49, 0.47], [0.42, 0.42, 0.42], [0.58, 0.56, 0.52], [0.36, 0.37, 0.39]],
  stucco: [[0.62, 0.55, 0.45], [0.55, 0.5, 0.44], [0.6, 0.58, 0.52], [0.5, 0.44, 0.38]],
  brick: [[0.46, 0.22, 0.16], [0.4, 0.2, 0.15], [0.52, 0.3, 0.22], [0.35, 0.22, 0.18]],
  glass: [[0.2, 0.22, 0.25], [0.16, 0.18, 0.2], [0.26, 0.26, 0.27]],
  paint: [[0.45, 0.5, 0.46], [0.52, 0.44, 0.36], [0.38, 0.42, 0.5], [0.5, 0.36, 0.32]],
};
const AWN = [[0.45, 0.1, 0.08], [0.1, 0.25, 0.35], [0.25, 0.35, 0.15], [0.5, 0.4, 0.12], [0.3, 0.3, 0.32]];

function district(seed, s) {
  const core = cityCore(s), n = fbm1(s / 950 + 3.3, 2, seed + 41);
  if (core > 0.55) return n < 0.25 ? 'commercial' : 'downtown';
  if (cityDens(s) < 0.5) return n < 0.5 ? 'industrial' : 'residential';
  return n < 0.42 ? 'residential' : n < 0.78 ? 'commercial' : 'industrial';
}

/** Street-side building descriptor from a random stream. row: 'A' | 'B' | 'C'. */
export function makeBuilding(r, dist, row, s, side, dFront, W, D, seed) {
  const core = cityCore(s);
  let floors, style, flh, bay, gh = 0, col;
  const u = r();
  if (dist === 'downtown') {
    style = u < 0.45 ? ST.RIBBON : u < 0.82 ? ST.CURTAIN : ST.PUNCHED;
    floors = row === 'A' ? (r() < 0.3 ? 12 + Math.floor(r() * 12) : 4 + Math.floor(r() * 8)) : row === 'B' ? 10 + Math.floor(r() * 22) : 18 + Math.floor(r() * (30 + 14 * core));
    gh = row === 'C' ? 0 : r() < 0.85 ? 4.8 : 0;
  } else if (dist === 'commercial') {
    style = u < 0.4 ? ST.BRICK : u < 0.75 ? ST.PUNCHED : ST.RIBBON;
    floors = row === 'A' ? (r() < 0.2 ? 6 + Math.floor(r() * 5) : 2 + Math.floor(r() * 4)) : row === 'B' ? 5 + Math.floor(r() * 12) : 10 + Math.floor(r() * 22);
    gh = row === 'C' ? 0 : r() < 0.8 ? 4.4 : 0;
  } else if (dist === 'residential') {
    style = u < 0.6 ? ST.PUNCHED : ST.BRICK;
    floors = row === 'A' ? 3 + Math.floor(r() * 5) : row === 'B' ? 5 + Math.floor(r() * 10) : 9 + Math.floor(r() * 16);
    gh = row === 'A' && r() < 0.3 ? 4.2 : 0;
  } else {
    style = u < 0.75 ? ST.INDUSTRIAL : ST.PUNCHED;
    floors = row === 'C' ? 6 + Math.floor(r() * 10) : 1 + Math.floor(r() * 3);
  }
  flh = style === ST.RIBBON || style === ST.CURTAIN ? 3.9 + r() * 0.4 : style === ST.INDUSTRIAL ? 5.2 + r() * 1.2 : 3.2 + r() * 0.4;
  bay = style === ST.RIBBON ? 1.6 + r() * 0.5 : style === ST.CURTAIN ? 1.5 + r() * 0.3 : style === ST.BRICK ? 2.3 + r() * 0.5 : style === ST.INDUSTRIAL ? 5.5 + r() * 2 : 2.7 + r() * 0.7;
  const pal = style === ST.BRICK ? PAL.brick : style === ST.CURTAIN ? PAL.glass : style === ST.INDUSTRIAL ? PAL.paint : r() < 0.55 ? PAL.concrete : PAL.stucco;
  col = pal[Math.floor(r() * pal.length) % pal.length].map((c) => c * (0.88 + r() * 0.2));
  const dark = r() < 0.18, bright = r() < 0.14;
  const lit = dark ? 0.0 : bright ? 0.55 + r() * 0.2 : 0.06 + r() * (dist === 'downtown' ? 0.3 : 0.22);
  const dmg = 0.12 + r() * 0.55;
  const tall = floors * flh + gh;
  const top = floors >= 4 && r() < (row === 'A' ? 0.38 : 0.3) ? 1 : 0;
  const setback = floors >= 10 && r() < 0.6;
  return { s, side, dFront, W, D, floors, flh, bay, gh, style, col, lit, dmg, fire: 0, top, setback, tall, row, seed, dist,
    tank: row !== 'C' && style !== ST.CURTAIN && floors >= 4 && r() < 0.35, antenna: floors >= 8 && r() < 0.35, beacon: tall > 55 };
}

// ------------------------------------------------------------------------------------------------ planning (pure + cached)
function blockEdge(seed, k, side) { return k * BLOCK + (hash2(k, 901 + side, seed) - 0.5) * 34; }

/** Plan of block k on one side: {street: [s0, s1], lots: [building|rubble|empty], back: [...], sky: [...]} */
function planBlock(ctx, k, side) {
  const key = `cb:${k}:${side}`;
  const cache = ctx.cityCache || (ctx.cityCache = new Map());
  let p = cache.get(key);
  if (p) return p;
  const seed = ctx.seed, r = rngOf(seed, k * 2 + (side > 0 ? 1 : 0), 7311);
  const e0 = blockEdge(seed, k, side), e1 = blockEdge(seed, k + 1, side);
  const sMid = (e0 + e1) / 2, dens = cityDens(sMid), dist = district(seed, sMid);
  p = { k, side, street: null, lots: [], back: [], sky: [] };
  cache.set(key, p);
  if (dens < 0.08) return p;
  const streetW = dist === 'downtown' ? 15 : 12 + r() * 3;
  const hasStreet = r() < 0.55 + 0.4 * dens;
  if (hasStreet) p.street = [e0, e0 + streetW];
  // ---- row A: frontage lots
  let s = e0 + (hasStreet ? streetW : 0) + 0.5;
  const wRange = dist === 'downtown' ? [16, 32] : dist === 'commercial' ? [9, 20] : dist === 'industrial' ? [22, 40] : [11, 22];
  while (s < e1 - 5) {
    let w = wRange[0] + r() * (wRange[1] - wRange[0]);
    if (e1 - (s + w) < wRange[0] * 0.6) w = e1 - s;
    const sc = s + w / 2, dHere = cityDens(sc);
    const kind = r();
    const skip = r() > 0.25 + 0.75 * dHere || heroClear(ctx, sc, w / 2);   // suburbs: sparse; hero areas stay free
    if (!skip) {
      const dF = (dist === 'industrial' ? 18 + r() * 9 : 14.4 + r() * 3.2) + (1 - dHere) * 6;
      const D = dist === 'industrial' ? 18 + r() * 14 : 13 + r() * 12;
      if (kind < 0.075 * (0.5 + dHere)) p.lots.push({ rubble: true, s: sc, side, dFront: dF, W: w - 1.2, D, seed: r(), row: 'A' });
      else if (kind < 0.12) { /* empty lot */ }
      else p.lots.push(makeBuilding(r, dist, 'A', sc, side, dF, w - (r() < 0.5 ? 0.3 : 1.5), D, r()));
    }
    s += w;
  }
  // ---- row B: behind the street wall
  s = e0 + (hasStreet ? streetW : 0) + 2;
  while (s < e1 - 8) {
    const w = 20 + r() * 26, sc = s + Math.min(w, e1 - s) / 2;
    if (r() < 0.2 + 0.8 * cityDens(sc)) {
      const ww = Math.min(w, e1 - s) - 3;
      if (ww > 12 && !heroClear(ctx, sc, ww / 2)) {
        const glb = r() < 0.22;
        const dF = 44 + r() * 45, D = 18 + r() * 22;
        if (glb) p.back.push({ glb: true, s: sc, side, dFront: dF, W: ww, D, seed: r(), row: 'B' });
        else p.back.push(makeBuilding(r, dist, 'B', sc, side, dF, ww, D, r()));
      }
    }
    s += w + 2 + r() * 8;
  }
  // ---- row C: skyline towers
  const nSky = Math.round((0.6 + 1.8 * cityCore(sMid)) * dens * (0.6 + r()));
  for (let i = 0; i < nSky; i++) {
    const sc = e0 + r() * (e1 - e0), dF = 130 + r() * (160 + 230 * r());
    const b = makeBuilding(r, dist === 'residential' && r() < 0.5 ? 'residential' : 'downtown', 'C', sc, side, dF, 20 + r() * 26, 20 + r() * 22, r());
    if (cityCore(sc) > 0.3 && r() < 0.08) { b.fire = Math.max(3, b.floors - 3 - Math.floor(r() * 6)); b.smoke = true; }
    p.sky.push(b);
  }
  return p;
}

/** All planned items (row A, B, C, streets) with centre s in [sA, sB). */
export function cityItems(ctx, sA, sB) {
  const out = { b: [], streets: [] };
  if (sB < CITY_A || sA > CITY_B) return out;
  const k0 = Math.floor(sA / BLOCK) - 1, k1 = Math.floor(sB / BLOCK) + 1;
  for (let k = k0; k <= k1; k++) for (const side of [1, -1]) {
    const p = planBlock(ctx, k, side);
    for (const list of [p.lots, p.back, p.sky]) for (const b of list) if (b.s >= sA && b.s < sB) out.b.push(b);
    if (p.street && (p.street[0] + p.street[1]) / 2 >= sA && (p.street[0] + p.street[1]) / 2 < sB) out.streets.push({ s0: p.street[0], s1: p.street[1], side });
  }
  // hero pieces
  for (const h of heroes(ctx)) if (h.s >= sA && h.s < sB) out.b.push(h);
  return out;
}

/** A stretch of road free of bridges / tunnels / overpasses / roadblocks / ramps near s (searching [sA, sB]); null if none. */
function clearSpot(road, sA, sB, want, margin) {
  for (let k = 0; k < 40; k++) {
    const s = want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 30;
    if (s < sA || s > sB) continue;
    if (!road.featuresIn(s - margin, s + margin).some((f) => f.type !== 'guard')) return s;
  }
  return null;
}

/** Hand-placed hero pieces (deterministic): burning towers near the road + the fallen skyscraper arching over the road. */
function heroes(ctx) {
  if (ctx.cityHeroes) return ctx.cityHeroes;
  const r = rngOf(ctx.seed, 991, 17);
  const list = [];
  for (const [s, side, dF] of [[44650, 1, 70], [46900, -1, 95], [48350, 1, 150]]) {
    const b = makeBuilding(r, 'downtown', 'B', s, side, dF, 30, 26, r());
    b.floors = 26 + Math.floor(r() * 10); b.tall = b.floors * b.flh + b.gh; b.fire = b.floors - 7; b.smoke = true; b.setback = false; b.top = 1; b.lit = 0.05; b.hero = true;
    list.push(b);
  }
  ctx.road.extendTo(47000);
  const sArch = clearSpot(ctx.road, 45700, 46700, 46100, 90);
  if (sArch !== null) list.push({ arch: true, s: sArch, side: 1, dFront: 30, W: 26, D: 26, row: 'A', seed: r() });
  ctx.cityHeroes = list;
  return list;
}
/** Is (s, side, dFront..dFront+D) inside a hero's reserved area? (the planner leaves it empty) */
function heroClear(ctx, s, halfW) {
  for (const h of heroes(ctx)) if (h.arch && Math.abs(s - h.s - 8) < 42 + halfW) return true;
  return false;
}

/** Exclusion circles [x, z, r] of the city buildings with centre s in [sA, sB) (for scatter / ground cover). */
export function cityExclusions(ctx, sA, sB) {
  const out = [];
  if (sB < CITY_A || sA > CITY_B) return out;
  const { b } = cityItems(ctx, sA - 60, sB + 60);
  const road = ctx.road, P = {};
  for (const q of b) {
    if (q.dFront > 260) continue;
    if (q.arch) {
      for (const [ds, dd] of [[0, 43], [16, -45]]) { road.pointAt(q.s + ds, dd, P); out.push([P.x, P.z, 22]); }
      continue;
    }
    const dC = q.side * (q.dFront + q.D / 2);
    const n = Math.max(1, Math.round(q.W / Math.max(8, q.D)));
    const rr = Math.hypot(q.W / n, q.D) * 0.5 + 1.5;
    for (let i = 0; i < n; i++) { road.pointAt(q.s + (i + 0.5 - n / 2) * q.W / n, dC, P); out.push([P.x, P.z, rr]); }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ geometry
const _F = {}, _P = [{}, {}, {}, {}], _G = {};

function groundSpan(chunk, road, s, dC, W, D, yaw) {
  // min / max terrain under the footprint (corners + centre), sampled from the chunk's exact LOD0 grid (s clamped to the chunk)
  let mn = 1e9, mx = -1e9;
  const sm = road.sample(s, _smp);
  for (const [a, b] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    // local (a*W along road, b*D lateral) -> (s, d) approx for a building aligned with the road
    const g = chunk.ground.sample(Math.min(chunk.s0 + CHUNK_LEN, Math.max(chunk.s0, s + a * W)), dC + b * D * Math.sign(dC || 1), _G);
    if (g.y < mn) mn = g.y; if (g.y > mx) mx = g.y;
  }
  void sm; void yaw;
  return [mn, mx];
}
const _smp = {};

function buildingFrame(road, b, out) {
  const sm = road.sample(b.s, _smp);
  const dC = b.side * (b.dFront + b.D / 2);
  const x = sm.x + sm.nx * dC, z = sm.z + sm.nz * dC;
  const yaw = b.side > 0 ? sm.th - Math.PI / 2 : sm.th + Math.PI / 2;
  return { x, z, yaw, dC, th: sm.th };
}

/** One building into the facade builder (and neon builder + collision list). */
export function emitBuilding(mb, nb, cols, b, fr, g0, g1, r) {
  const F = frameYaw(fr.x, g0 - 1.2, fr.z, fr.yaw, _F);
  const W = b.W, D = b.D, hw = W / 2, hd = D / 2;
  const vBase = g1 - (g0 - 1.2);                     // windows start at the highest ground point
  const H = vBase + b.gh + b.floors * b.flh;          // top of the last floor (local y)
  mb.col(b.col[0], b.col[1], b.col[2]);
  mb.setFac(b.style, b.bay, b.flh, b.seed).setFac2(b.lit, b.gh, b.dmg, b.fire);
  const uo = Math.floor(r() * 4) * b.bay;
  let roofY = H, rx0 = -hw, rx1 = hw, rz0 = -hd, rz1 = hd;
  if (b.setback && b.floors >= 10) {
    const fp = Math.max(3, Math.floor(b.floors * (0.25 + r() * 0.35)));
    const hP = vBase + b.gh + fp * b.flh;
    mb.box(F, -hw, hw, 0, hP, -hd, hd, { vBase, uo });
    const ix = W * (0.1 + r() * 0.12), iz = D * (0.1 + r() * 0.15);
    rx0 = -hw + ix; rx1 = hw - ix * (0.4 + r() * 0.6); rz0 = -hd + iz; rz1 = hd - iz * 0.5;
    if (b.top) {
      const cut = b.flh * (1 + Math.floor(r() * 3));
      mb.box(F, rx0, rx1, hP, H - cut, rz0, rz1, { vBase, uo });
      jagged(mb, F, rx0, rx1, H - cut, H, rz0, rz1, vBase, uo, r, b);
    } else mb.box(F, rx0, rx1, hP, H, rz0, rz1, { vBase, uo });
  } else if (b.top) {
    const cut = b.flh * (1 + Math.floor(r() * 2.5));
    mb.box(F, -hw, hw, 0, H - cut, -hd, hd, { vBase, uo });
    jagged(mb, F, -hw, hw, H - cut, H, -hd, hd, vBase, uo, r, b);
    roofY = H - cut;
  } else mb.box(F, -hw, hw, 0, H, -hd, hd, { vBase, uo });
  // facade relief on the street face: balconies (residential concrete) / iron fire escapes (brick)
  if (b.row !== 'C' && !b.setback && b.floors >= 3) {
    const nB = Math.floor(W / b.bay), fl0 = b.gh > 0 ? 0 : 1, top = b.top ? b.floors - 3 : b.floors;
    if (b.style === ST.PUNCHED && r() < 0.5) {
      const bc = b.col.map((c) => c * 0.85);
      mb.col(bc[0], bc[1], bc[2]).setFac(ST.PLAIN, 1, 1, b.seed);
      const every = r() < 0.5 ? 1 : 2, off = Math.floor(r() * 2);
      for (let j = fl0; j < top; j++) {
        const y = vBase + b.gh + j * b.flh;
        for (let k = off; k < nB; k += every + 1) {
          const x0 = -hw + k * b.bay + 0.1, x1 = -hw + (k + 1) * b.bay - 0.1;
          if (x1 > hw - 0.3) continue;
          mb.box(F, x0, x1, y - 0.16, y + 0.02, hd, hd + 1.2);
          mb.box(F, x0, x1, y + 0.02, y + 0.95, hd + 1.1, hd + 1.2, { skip: 'd' });
        }
      }
    } else if (b.style === ST.BRICK && W > 3 * b.bay && r() < 0.6) {
      mb.col(0.13, 0.12, 0.12).setFac(ST.PLAIN, 1, 1, b.seed);
      const k0 = Math.floor(r() * Math.max(1, nB - 3)), x0 = -hw + k0 * b.bay + 0.2, x1 = x0 + 3 * b.bay - 0.4;
      for (let j = fl0; j < top; j++) {
        const y = vBase + b.gh + j * b.flh;
        mb.box(F, x0, x1, y - 0.07, y, hd, hd + 1.3);                               // grating platform
        mb.box(F, x0, x1, y + 0.95, y + 1.0, hd + 1.25, hd + 1.3, { skip: 'd' });    // top rail
        for (const xx of [x0, x1]) mb.box(F, xx - 0.03, xx + 0.03, y, y + 1.0, hd + 1.25, hd + 1.3, { skip: 'td' });
        if (j < top - 1) {                                                          // stair flight to the next platform (zig-zag)
          const a = j % 2 ? x0 + 0.3 : x1 - 0.3, c = j % 2 ? x1 - 1.1 : x0 + 1.1;
          mb.beam(F, a, y, hd + 0.75, c, y + b.flh, hd + 0.75, 0.7, 0.06);
        }
      }
    }
  }
  // parapet + roof clutter (plain concrete, darker)
  const rc = b.col.map((c) => c * 0.72);
  mb.col(rc[0], rc[1], rc[2]).setFac(ST.PLAIN, 1, 1, b.seed);
  if (!b.top && b.row !== 'C') {
    const t = 0.3, ph = 0.9;
    mb.box(F, rx0, rx1, roofY, roofY + ph, rz1 - t, rz1, { skip: 'd' });
    mb.box(F, rx0, rx1, roofY, roofY + ph, rz0, rz0 + t, { skip: 'd' });
    mb.box(F, rx0, rx0 + t, roofY, roofY + ph, rz0 + t, rz1 - t, { skip: 'd' });
    mb.box(F, rx1 - t, rx1, roofY, roofY + ph, rz0 + t, rz1 - t, { skip: 'd' });
  }
  if (!b.top) {
    // stair / lift housing + AC units
    const sx = rx0 + (rx1 - rx0) * (0.2 + r() * 0.6), sz = rz0 + (rz1 - rz0) * (0.25 + r() * 0.5);
    mb.box(F, sx - 2.2, sx + 2.2, roofY, roofY + 3.2, sz - 1.8, sz + 1.8);
    if (b.row !== 'C') for (let i = 0; i < 2; i++) { const ax = rx0 + (rx1 - rx0) * r(), az = rz0 + (rz1 - rz0) * r(); mb.box(F, ax - 0.9, ax + 0.9, roofY, roofY + 1.2, az - 0.7, az + 0.7); }
    if (b.tank) {
      const tx = rx0 + (rx1 - rx0) * (0.15 + r() * 0.7), tz = rz0 + (rz1 - rz0) * (0.2 + r() * 0.6), tr = 1.5 + r() * 0.7;
      mb.col(0.32, 0.22, 0.14);
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mb.box(F, tx + ox * tr * 0.7 - 0.12, tx + ox * tr * 0.7 + 0.12, roofY, roofY + 3.0, tz + oz * tr * 0.7 - 0.12, tz + oz * tr * 0.7 + 0.12, { skip: 'td' });
      mb.cyl(F, tx, tz, roofY + 3.0, roofY + 6.2, tr, tr, 10, false);
      mb.cyl(F, tx, tz, roofY + 6.2, roofY + 7.3, tr, 0.15, 10, false);
    }
  }
  if (b.antenna || b.beacon) {
    const ah = 6 + r() * (b.row === 'C' ? 22 : 10), ax = (rx0 + rx1) / 2 + (r() - 0.5) * 4, az = (rz0 + rz1) / 2;
    mb.col(0.2, 0.2, 0.22);
    mb.box(F, ax - 0.18, ax + 0.18, roofY, roofY + ah, az - 0.18, az + 0.18, { skip: 'd' });
    if (b.beacon && nb) neonDot(nb, F, ax, roofY + ah + 0.25, az, 0.55, 0, 3, r());
  }
  // storefront details: awnings + shop signs (row A only)
  if (b.row === 'A' && b.gh > 0) {
    const nShop = Math.max(1, Math.round(W / (7 + r() * 5))), sign0 = Math.floor(r() * NEON_H);
    for (let i = 0; i < nShop; i++) {
      const x0 = -hw + (i + 0.08) * W / nShop, x1 = -hw + (i + 0.92) * W / nShop, yA = vBase + b.gh - 1.2;
      if (r() < 0.45) {
        const c = AWN[Math.floor(r() * AWN.length) % AWN.length];
        mb.col(c[0], c[1], c[2]).setFac(ST.PLAIN, 1, 1, b.seed);
        const P = _P; MB.at(F, x0, yA, hd, P[0]); MB.at(F, x1, yA, hd, P[1]); MB.at(F, x1, yA - 1.0, hd + 1.9, P[2]); MB.at(F, x0, yA - 1.0, hd + 1.9, P[3]);
        mb.quadW(P[3], P[2], P[1], P[0], 0, 0, 1, 0, 1, 1, 0, 1); mb.quadW(P[0], P[1], P[2], P[3], 0, 0, 1, 0, 1, 1, 0, 1);
      }
      if (nb && r() < 0.62) {
        const sw = Math.min(x1 - x0 - 0.4, 3.6 + r() * 2.6), cx = (x0 + x1) / 2, sh = sw / 4;
        neonPanel(nb, F, cx - sw / 2, cx + sw / 2, vBase + b.gh - 0.15 - sh, vBase + b.gh - 0.15, hd + 0.08, 'h', (sign0 + i * 5) % NEON_H, r());
      }
    }
  }
  // blade signs (vertical, projecting from the facade: readable while driving along the road)
  if (nb && b.row !== 'C' && (b.dist === 'commercial' || b.dist === 'downtown') && b.floors >= 3 && r() < 0.34) {
    const bx = -hw + W * (0.15 + r() * 0.7), y0 = vBase + b.gh + b.flh * (0.3 + r() * 1.5), hh = 3.6 + r() * 2.2;
    neonBlade(nb, F, bx, y0, y0 + hh, hd, hd + 1.35, Math.floor(r() * NEON_V), r());
  }
  // rooftop sign
  if (nb && b.row !== 'C' && !b.top && b.floors <= 9 && r() < 0.1) {
    const sw = Math.min(W * 0.8, 10 + r() * 6), sh = sw / 4;
    mb.col(0.18, 0.18, 0.2).setFac(ST.PLAIN, 1, 1, b.seed);
    mb.box(F, -sw * 0.35 - 0.1, -sw * 0.35 + 0.1, roofY, roofY + 1.6, hd - 2.1, hd - 1.9, { skip: 'd' });
    mb.box(F, sw * 0.35 - 0.1, sw * 0.35 + 0.1, roofY, roofY + 1.6, hd - 2.1, hd - 1.9, { skip: 'd' });
    neonPanel(nb, F, -sw / 2, sw / 2, roofY + 1.6, roofY + 1.6 + sh, hd - 1.85, 'h', Math.floor(r() * NEON_H), r());
  }
  if (cols) boxCollider(cols, F, -hw, hw, 0, Math.min(H, 60), -hd, hd);
  return H;
}

/** Jagged broken crown: 2-5 columns of random height with slanted tops (windows continue into them). */
function jagged(mb, F, x0, x1, y0, y1, z0, z1, vBase, uo, r, b) {
  const n = 2 + Math.floor(r() * 3), W = x1 - x0;
  for (let i = 0; i < n; i++) {
    const a = x0 + W * i / n, c = x0 + W * (i + 1) / n;
    if (r() < 0.22) continue;
    const h = y0 + (y1 - y0) * (0.25 + r() * 0.95);
    const za = r() < 0.4 ? z0 + (z1 - z0) * r() * 0.5 : z0, zb = r() < 0.3 ? z1 - (z1 - z0) * r() * 0.4 : z1;
    const tY = [h + (r() - 0.5) * b.flh, h + (r() - 0.5) * b.flh, h - r() * b.flh, h - r() * b.flh];
    mb.box(F, a, c, y0, h, za, zb, { vBase, uo, topY: tY });
  }
}

function boxCollider(cols, F, x0, x1, y0, y1, z0, z1) {
  const P = [];
  for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]) { const p = MB.at(F, x, y, z, {}); P.push(p.x, p.y, p.z); }
  const base = cols.pos.length / 3;
  for (const v of P) cols.pos.push(v);
  for (const t of [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) cols.idx.push(base + t);
}

// ------------------------------------------------------------------------------------------------ neon helpers
function neonMode(r) { const u = r(); return u < 0.62 ? 0 : u < 0.86 ? 1 : 2; }
/** Flat sign facing +z at z (local). */
function neonPanel(nb, F, x0, x1, y0, y1, z, kind, idx, rv) {
  const [u0, v0, u1, v1] = neonRect(kind, idx);
  const dead = rv < 0.12;
  nb.setFac(rv * 7.3 % 1, dead ? 2 : neonMode(() => (rv * 13.7) % 1), dead ? 0.25 : 0.8 + (rv * 3.1 % 1) * 0.5, 0);
  const P = _P; MB.at(F, x0, y0, z, P[0]); MB.at(F, x1, y0, z, P[1]); MB.at(F, x1, y1, z, P[2]); MB.at(F, x0, y1, z, P[3]);
  nb.quadW(P[0], P[1], P[2], P[3], u0, v0, u1, v0, u1, v1, u0, v1);
}
/** Blade sign: a slab perpendicular to the facade from z0 to z1 at x, readable from both road directions. */
function neonBlade(nb, F, x, y0, y1, z0, z1, idx, rv) {
  const [u0, v0, u1, v1] = neonRect('v', idx);
  nb.setFac(rv * 5.1 % 1, neonMode(() => (rv * 17.3) % 1), 0.9 + (rv * 2.3 % 1) * 0.4, 0);
  const P = _P, t = 0.12;
  // face toward +x (text reads top->bottom, uv mirrored so it reads correctly from that side)
  MB.at(F, x + t, y0, z1, P[0]); MB.at(F, x + t, y0, z0, P[1]); MB.at(F, x + t, y1, z0, P[2]); MB.at(F, x + t, y1, z1, P[3]);
  nb.quadW(P[0], P[1], P[2], P[3], u0, v0, u1, v0, u1, v1, u0, v1);
  MB.at(F, x - t, y0, z0, P[0]); MB.at(F, x - t, y0, z1, P[1]); MB.at(F, x - t, y1, z1, P[2]); MB.at(F, x - t, y1, z0, P[3]);
  nb.quadW(P[0], P[1], P[2], P[3], u0, v0, u1, v0, u1, v1, u0, v1);
  // outer edge (dark frame)
  const [a0, b0, a1, b1] = NEON_DOT(0);
  nb.setFac(0, 0, 0, 0);
  MB.at(F, x - t, y0, z1, P[0]); MB.at(F, x + t, y0, z1, P[1]); MB.at(F, x + t, y1, z1, P[2]); MB.at(F, x - t, y1, z1, P[3]);
  nb.quadW(P[0], P[1], P[2], P[3], a0, b0, a1, b0, a1, b1, a0, b1);
}
/** Small glowing dot (beacon / lamp) as a camera-agnostic cross of two quads. colour index into the dot palette, mode 3 = blink. */
export function neonDot(nb, F, x, y, z, size, color, mode, rv) {
  const [u0, v0, u1, v1] = NEON_DOT(color);
  const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  nb.setFac(rv, mode, 1.4, 0);
  const P = _P, h = size / 2;
  MB.at(F, x - h, y - h, z, P[0]); MB.at(F, x + h, y - h, z, P[1]); MB.at(F, x + h, y + h, z, P[2]); MB.at(F, x - h, y + h, z, P[3]);
  nb.quadW(P[0], P[1], P[2], P[3], uc, vc, uc, vc, uc, vc, uc, vc); nb.quadW(P[3], P[2], P[1], P[0], uc, vc, uc, vc, uc, vc, uc, vc);
  MB.at(F, x, y - h, z - h, P[0]); MB.at(F, x, y - h, z + h, P[1]); MB.at(F, x, y + h, z + h, P[2]); MB.at(F, x, y + h, z - h, P[3]);
  nb.quadW(P[0], P[1], P[2], P[3], uc, vc, uc, vc, uc, vc, uc, vc); nb.quadW(P[3], P[2], P[1], P[0], uc, vc, uc, vc, uc, vc, uc, vc);
}

// ------------------------------------------------------------------------------------------------ hero: the fallen skyscraper
/** A tower snapped at its 5th floor on the left side of the road and fell across it; its crown rests on a building on the right.
 *  The road passes underneath (>= 9.5 m clearance over the whole road + shoulders, checked here). */
function emitArch(ctx, chunk, mb, nb, cols, h) {
  const { road, seed } = ctx, r = rngOf(seed, Math.round(h.s), 4242);
  const P = {};
  // stump (left) and support (right) buildings
  const stump = makeBuilding(r, 'downtown', 'A', h.s, 1, 30, 26, 26, r());
  Object.assign(stump, { floors: 5, flh: 3.9, gh: 4.8, style: ST.CURTAIN, top: 1, setback: false, tank: false, antenna: false, beacon: false, lit: 0.1, dmg: 0.8 });
  const sup = makeBuilding(r, 'downtown', 'A', h.s + 16, -1, 32, 28, 26, r());
  Object.assign(sup, { floors: 7, flh: 3.9, gh: 4.8, style: ST.RIBBON, top: 0, setback: false, tank: false, antenna: false, beacon: false, lit: 0.12, dmg: 0.6 });
  const tops = [];
  for (const b of [stump, sup]) {
    const fr = buildingFrame(road, b, {});
    const [g0, g1] = groundSpan(chunk, road, b.s, fr.dC, b.W, b.D, fr.yaw);
    const H = emitBuilding(mb, nb, cols, b, fr, g0, g1, r);
    tops.push({ fr, y: g0 - 1.2 + H, g0 });
  }
  // the fallen tower: base end on the stump top, crown resting on the support roof edge (a bit beyond it)
  const smA = road.sample(h.s, {}), smB = road.sample(h.s + 16, {});
  const A = { x: smA.x + smA.nx * 40, y: tops[0].y - 3, z: smA.z + smA.nz * 40 };
  const B = { x: smB.x - smB.nx * 42, y: tops[1].y + 11, z: smB.z - smB.nz * 42 };
  const half = 11, L = 112;
  let ax = B.x - A.x, ay = B.y - A.y, az = B.z - A.z; const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
  // clearance: lowest point of the tower over the road strip must be >= 9.5 m above the asphalt
  const F0 = frameBasis(A.x, A.y, A.z, [ax, ay, az], [0, 1, 0], {});
  let worst = 1e9;
  for (let t = 0; t <= L; t += 2) for (const [x, z] of [[-half, -half], [half, -half], [-half, half], [half, half], [0, -half]]) {
    MB.at(F0, x, t, z, P);
    const n = road.nearest(P.x, P.z, h.s + 8, 80, _nn);
    if (Math.abs(n.d) > 11) continue;
    const ry = road.surfaceY(road.sample(n.s, _smp), n.d);
    worst = Math.min(worst, P.y - ry);
  }
  const lift = worst < 9.5 ? 9.5 - worst : 0;
  const F = frameBasis(A.x, A.y + lift, A.z, [ax, ay, az], [0, 1, 0], {});
  const tc = [0.2, 0.22, 0.25];
  mb.col(tc[0], tc[1], tc[2]).setFac(ST.CURTAIN, 1.6, 3.9, h.seed).setFac2(0.08, 0, 0.75, 17);
  mb.box(F, -half, half, 0, L, -half, half, { vBase: 0, bottom: true });
  // broken base end: jagged slab stubs + interior floor plates sticking out
  mb.col(0.3, 0.29, 0.28).setFac(ST.PLAIN, 1, 1, h.seed).setFac2(0, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const x = (r() - 0.5) * 2 * (half - 2), z = (r() - 0.5) * 2 * (half - 2), w = 2 + r() * 4, d = 2 + r() * 4;
    mb.box(F, x - w / 2, x + w / 2, -1 - r() * 5, 0.5, z - d / 2, z + d / 2, { bottom: true });
  }
  for (let j = 1; j < 4; j++) mb.box(F, -half + 0.4, half - 0.4, -j * 1.3 - 0.2, -j * 1.3, -half + 0.4, half - 0.4 - r() * 6, { bottom: true });
  // crown: roof machinery + a bent antenna
  mb.col(0.18, 0.18, 0.2);
  mb.box(F, -6, 6, L, L + 4, -5, 5);
  mb.beam(F, 2, L + 4, 0, 5, L + 30, 3, 0.6, 0.6);
  if (nb) neonDot(nb, F, 5, L + 30.6, 3, 0.7, 0, 3, r());
  boxCollider(cols, F, -half, half, 0, L, -half, half);
  MB.at(F, 0, L * 0.72, half, P);
  (chunk.citySmoke || (chunk.citySmoke = [])).push({ x: P.x, y: P.y, z: P.z, w: 14, s: h.s + 3 });
  // rubble at both contact points + chunks that fell on the sidewalks (never on the road)
  mb.col(0.36, 0.35, 0.33).setFac(ST.PLAIN, 1, 1, h.seed).setFac2(0, 0, 0, 0);
  for (const [s0, d0, n] of [[h.s, 24, 8], [h.s + 16, -26, 8], [h.s + 6, 13, 4], [h.s + 10, -13.5, 4]]) {
    for (let i = 0; i < n; i++) {
      const s = s0 + (r() - 0.5) * 14, d = d0 + Math.sign(d0) * r() * 5;
      if (Math.abs(d) < 11.5) continue;
      const g = chunk.ground.sample(Math.min(chunk.s0 + CHUNK_LEN, Math.max(chunk.s0, s)), d, _G), sm = road.sample(s, _smp);
      const Fr = frameYaw(sm.x + sm.nx * d, g.y - 0.3, sm.z + sm.nz * d, sm.th + r() * 3, {});
      const w = 1.5 + r() * 3.5, dd = 1.5 + r() * 3, hh = 0.8 + r() * 2.2;
      mb.box(Fr, -w / 2, w / 2, 0, hh, -dd / 2, dd / 2, { topY: [hh * r(), hh, hh * (0.3 + r() * 0.7), hh * r()] });
    }
  }
}
const _nn = {};

// ------------------------------------------------------------------------------------------------ rubble lot
function emitRubble(mb, b, fr, g0, r) {
  const F = frameYaw(fr.x, g0 - 0.6, fr.z, fr.yaw, _F), hw = b.W / 2, hd = b.D / 2;
  mb.col(0.4, 0.38, 0.36).setFac(ST.PLAIN, 1, 1, b.seed).setFac2(0, 0, 0, 0);
  // low mound: a few slanted slabs + chunks
  for (let i = 0; i < 7; i++) {
    const x = (r() - 0.5) * b.W * 0.8, z = (r() - 0.5) * b.D * 0.7, w = 2 + r() * 5, d = 2 + r() * 4, h = 0.6 + r() * 2.2;
    mb.box(F, x - w / 2, x + w / 2, 0, h, z - d / 2, z + d / 2, { topY: [h * (0.3 + r()), h * (0.3 + r()), h * r(), h * (0.4 + r())] });
  }
  // standing wall stub with windows (the last fragment of the facade)
  const c = [0.46, 0.44, 0.41];
  mb.col(c[0], c[1], c[2]).setFac(ST.PUNCHED, 3.0, 3.4, b.seed).setFac2(0, 0, 0.9, 0);
  const h = 4 + r() * 8, x0 = -hw + r() * b.W * 0.3, x1 = x0 + b.W * (0.3 + r() * 0.4);
  mb.box(F, x0, x1, 0, h, hd - 0.4, hd, { vBase: 0.6, topY: [h * (0.5 + r() * 0.5), h, h * (0.6 + r() * 0.4), h * 0.7] });
}

// ------------------------------------------------------------------------------------------------ sidewalks + side streets
function emitStreetLevel(mb, chunk, road, streets) {
  const s0 = chunk.s0, P = [{}, {}, {}, {}], G = {};
  const inStreet = (s, side) => streets.some((q) => q.side === side && s > q.s0 - 1.5 && s < q.s1 + 1.5);
  for (const side of [1, -1]) {
    const d0 = side * 9.55, d1 = side * 14.0;
    mb.setFac(ST.PAVING, 1, 1, 0.3).setFac2(0, 0, 0, 0);
    for (let s = s0; s < s0 + CHUNK_LEN - 0.01; s += 3) {
      const sa = s, sb = s + 3, sm = (sa + sb) / 2;
      if (cityDens(sm) < 0.35 || inStreet(sm, side) || road.featureAt(sm, 'bridge') || road.featureAt(sm, 'overpass')) continue;
      const ya0 = chunk.ground.sample(sa, d0, G).y, yb0 = chunk.ground.sample(sb, d0, G).y;
      const ya1 = chunk.ground.sample(sa, d1, G).y, yb1 = chunk.ground.sample(sb, d1, G).y;
      const top = 0.16;
      const pa0 = road.pointAt(sa, d0, P[0]), pb0 = road.pointAt(sb, d0, P[1]);
      const A0 = { x: pa0.x, y: ya0 + top, z: pa0.z }, B0 = { x: pb0.x, y: yb0 + top, z: pb0.z };
      const pa1 = road.pointAt(sa, d1, P[2]), pb1 = road.pointAt(sb, d1, P[3]);
      const A1 = { x: pa1.x, y: ya1 + top, z: pa1.z }, B1 = { x: pb1.x, y: yb1 + top, z: pb1.z };
      mb.col(0.52, 0.51, 0.49);
      if (side > 0) mb.quadW(A0, B0, B1, A1, sa, 9.55, sb, 9.55, sb, 14, sa, 14); else mb.quadW(A1, B1, B0, A0, sa, 14, sb, 14, sb, 9.55, sa, 9.55);
      // curb face toward the road
      mb.col(0.46, 0.45, 0.43);
      const A2 = { x: A0.x, y: ya0 - 0.08, z: A0.z }, B2 = { x: B0.x, y: yb0 - 0.08, z: B0.z };
      if (side > 0) mb.quadW(A2, B2, B0, A0, 0, 0, 1, 0, 1, 1, 0, 1); else mb.quadW(B2, A2, A0, B0, 0, 0, 1, 0, 1, 1, 0, 1);
    }
  }
  // side streets: asphalt strip from the road edge into the block
  for (const q of streets) {
    mb.col(0.2, 0.2, 0.21).setFac(ST.ASPHALT, 1, 1, 0.5).setFac2(0, 0, 0, 0);
    const W = q.s1 - q.s0, sc = (q.s0 + q.s1) / 2, sm = road.sample(sc, {});
    const L = 80, step = 8;
    for (let a = 9.55; a < L; a += step) {
      const b = Math.min(L, a + step);
      const pts = [];
      for (const [ds, dd] of [[-W / 2, a], [W / 2, a], [W / 2, b], [-W / 2, b]]) {
        const d = q.side * dd, x = sm.x + sm.nx * d + sm.fx * ds, z = sm.z + sm.nz * d + sm.fz * ds;
        const g = chunk.ground.sample(Math.min(chunk.s0 + CHUNK_LEN, Math.max(chunk.s0, sc + ds)), d, G);
        pts.push({ x, y: g.y + 0.1, z, u: ds, v: dd });
      }
      const [p0, p1, p2, p3] = q.side > 0 ? pts : [pts[1], pts[0], pts[3], pts[2]];
      mb.quadW(p0, p1, p2, p3, p0.u, p0.v, p1.u, p1.v, p2.u, p2.v, p3.u, p3.v);
    }
  }
}

// ------------------------------------------------------------------------------------------------ street props
export const CITY_PROPS = ['wreck_sedan', 'wreck_sedan_b', 'wreck_pickup', 'wreck_van', 'wreck_flipped', 'wreck_bus', 'barrel', 'dead_tree_c'];
const WRECKS = [['wreck_sedan', 3], ['wreck_sedan_b', 3], ['wreck_pickup', 2], ['wreck_van', 2], ['wreck_flipped', 1.4]];
const pickW = (r, list) => { let t = 0; for (const [, w] of list) t += w; let u = r() * t; for (const [n, w] of list) { u -= w; if (u <= 0) return n; } return list[0][0]; };
const PROP_SPEC = { far: 520, shadow: true, behind: true };

/** Put a wreck at road coords (s, d) with yaw offset psi relative to the road direction; keeps clear of |d| < 10.3 and adds its collider. */
function putWreck(ctx, chunk, cols, name, s, d, psi, r) {
  const a = ctx.kit.get(name); if (!a) return false;
  const L = a.size.z, W = a.size.x, ext = Math.abs(Math.sin(psi)) * L / 2 + Math.abs(Math.cos(psi)) * W / 2;
  if (Math.abs(d) - ext < 10.3) d = Math.sign(d) * (10.3 + ext);
  const g = chunk.ground.sample(Math.min(chunk.s0 + CHUNK_LEN, Math.max(chunk.s0, s)), d, _G);
  const th = ctx.road.sample(s, _smp).th, yaw = th + psi;
  const t = 0.7 + r() * 0.5;
  ctx.pool.register(name, PROP_SPEC);
  chunk.list(name).push(g.x, g.y - 0.05, g.z, yaw, 1, 1, 1, g.nx, g.ny, g.nz, 0.6, a.sphere.radius, t, t * (0.9 + r() * 0.15), t * (0.85 + r() * 0.2));
  if (cols && a.collision) {
    const c = Math.cos(yaw), sn = Math.sin(yaw), src = a.collision.pos, base = cols.pos.length / 3;
    for (let i = 0; i < src.length; i += 3) cols.pos.push(g.x + src[i] * c + src[i + 2] * sn, g.y - 0.05 + src[i + 1], g.z - src[i] * sn + src[i + 2] * c);
    for (const k of a.collision.idx) cols.idx.push(base + k);
  }
  return true;
}

function emitStreetProps(ctx, chunk, mb, nb, fb, cols, items) {
  const { road, seed } = ctx, s0 = chunk.s0;
  const r = rngOf(seed, chunk.c, 6161);
  const dens = cityDens(s0 + 48), core = cityCore(s0 + 48);
  if (dens < 0.25) return;
  const blocked = (s) => road.featuresIn(s - 45, s + 25).some((f) => f.type !== 'guard' && s > f.s0 - 45 && s < f.s1 + 25);
  const inStreet = (s, side) => items.streets.some((q) => q.side === side && s > q.s0 - 3 && s < q.s1 + 3);
  // ---- wrecks on the sidewalks (crashed, parked askew) + in the side streets
  const nW = Math.round((1 + 3 * dens) * (0.6 + r()));
  for (let i = 0; i < nW; i++) {
    const s = s0 + r() * CHUNK_LEN, side = r() < 0.5 ? 1 : -1;
    if (blocked(s) || inStreet(s, side)) { r(); r(); r(); continue; }
    putWreck(ctx, chunk, cols, pickW(r, WRECKS), s, side * (11.4 + r() * 1.6), (r() - 0.5) * 0.9 + (r() < 0.15 ? Math.PI : 0), r);
  }
  for (const q of items.streets) {
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const along = 16 + r() * 50, sc = (q.s0 + q.s1) / 2 + (r() - 0.5) * (q.s1 - q.s0) * 0.5;
      const name = r() < 0.18 ? 'wreck_bus' : pickW(r, WRECKS);
      putWreck(ctx, chunk, along < 60 ? cols : null, name, sc, q.side * along, Math.PI / 2 + (r() - 0.5) * 1.2, r);
    }
  }
  // ---- fire barrels (raider / survivor spots): barrel + flame
  const nF = Math.round((0.5 + 2.5 * core) * (0.5 + r()));
  const barrel = ctx.kit.get('barrel');
  for (let i = 0; i < nF && barrel; i++) {
    const s = s0 + r() * CHUNK_LEN, side = r() < 0.5 ? 1 : -1, d = side * (10.9 + r() * 2.4);
    if (blocked(s)) continue;
    const g = chunk.ground.sample(s, d, _G);
    ctx.pool.register('barrel', { far: 320, shadow: false, lite: true });
    chunk.list('barrel').push(g.x, g.y + 0.1, g.z, r() * 6.28, 1.05, 1.05, 1.05, 0, 1, 0, 0, 0.7, 0.55, 0.42, 0.36);
    flame(fb, g.x, g.y + 0.1 + 0.86, g.z, 0.95, 1.5, r());
    if (r() < 0.5) { const d2 = d + side * (0.6 + r() * 0.6), s2 = s + (r() - 0.5) * 2.5, g2 = chunk.ground.sample(s2, d2, _G); chunk.list('barrel').push(g2.x, g2.y + 0.1, g2.z, r() * 6.28, 1, 1, 1, 0, 1, 0, 0, 0.7, 0.4, 0.3, 0.26); }
  }
  // ---- traffic lights at the side streets: pole + arm over the shoulder, dead signal heads blinking amber
  for (const q of items.streets) {
    const s = q.s1 + 1.2; if (s < s0 || s >= s0 + CHUNK_LEN || blocked(s)) continue;
    const side = q.side, sm = road.sample(s, _smp), d = side * 10.7;
    const F = frameYaw(sm.x + sm.nx * d, chunk.ground.sample(s, d, _G).y - 0.1, sm.z + sm.nz * d, side > 0 ? sm.th - Math.PI / 2 : sm.th + Math.PI / 2, {});
    mb.col(0.16, 0.17, 0.18).setFac(ST.PLAIN, 1, 1, 0.2).setFac2(0, 0, 0, 0);
    mb.box(F, -0.12, 0.12, 0, 6.3, -0.12, 0.12, { skip: 'd' });
    mb.box(F, -0.08, 0.08, 5.9, 6.1, 0, 4.2, {});                    // arm toward the road (+z local)
    for (const zz of [2.2, 4.0]) {
      mb.box(F, -0.2, 0.2, 5.0, 5.95, zz - 0.18, zz + 0.18, {});
      if (nb) { neonDot(nb, F, 0.24, 5.45, zz, 0.32, 2, 3, r()); neonDot(nb, F, -0.24, 5.45, zz, 0.32, 2, 3, r()); }
    }
  }
  // ---- dead trees in pavement grates (residential / commercial blocks)
  const tree = ctx.kit.get('dead_tree_c');
  if (tree) {
    ctx.pool.register('dead_tree_c', { far: 420, shadow: true, behind: true });
    for (const side of [1, -1]) {
      if (district(seed, s0 + 48) === 'industrial' || r() < 0.4) continue;
      for (let s = s0 + 4 + r() * 10; s < s0 + CHUNK_LEN; s += 13 + r() * 9) {
        if (blocked(s) || inStreet(s, side)) continue;
        const d = side * 13.1, g = chunk.ground.sample(s, d, _G), sc = 0.7 + r() * 0.45;
        chunk.list('dead_tree_c').push(g.x, g.y, g.z, r() * 6.28, sc, sc, sc, 0, 1, 0, 0, 3 * sc, 0.75, 0.72, 0.7);
      }
    }
  }
}

/** Two crossed flame quads (additive shader) at (x, y, z) world. */
function flame(fb, x, y, z, w, h, ph) {
  fb.setFac(ph, 0, 0, 0);
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const a = { x: x - ax * w / 2, y, z: z - az * w / 2 }, b = { x: x + ax * w / 2, y, z: z + az * w / 2 };
    const c = { x: b.x, y: y + h, z: b.z }, d = { x: a.x, y: y + h, z: a.z };
    fb.quadW(a, b, c, d, 0, 0, 1, 0, 1, 1, 0, 1);
  }
}

// ------------------------------------------------------------------------------------------------ chunk build
/** Build the city geometry of one chunk. Returns true when done. */
export function buildCity(ctx, chunk) {
  const s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  if (s1 < CITY_A || s0 > CITY_B || chunk.done.has('city')) return true;
  for (const n of [...GLB_RUINS, ...CITY_PROPS]) { const st = ctx.kit.state(n); if (st === 'idle') ctx.kit.request(n); if (st === 'idle' || st === 'loading') return false; }
  chunk.done.add('city');
  const { road, seed } = ctx;
  road.extendTo(s1 + 600);
  const items = cityItems(ctx, s0, s1);
  if (!items.b.length && !items.streets.length && cityDens(s0 + 48) < 0.3) return true;
  const anchor = road.sample(s0, {});
  const mb = new MB(anchor, { uvName: 'aUvF', cap: 8192 }), nb = new MB(anchor, { cap: 1024 });
  const cols = { pos: [], idx: [] };
  for (const b of items.b) {
    if (b.arch) { emitArch(ctx, chunk, mb, nb, cols, b); continue; }
    const r = rngOf(seed, Math.round(b.s * 10), 5501 + (b.side > 0 ? 1 : 0) + b.row.charCodeAt(0));
    const fr = buildingFrame(road, b, _fr);
    const [g0, g1] = groundSpan(chunk, road, b.s, fr.dC, b.W, b.D, fr.yaw);
    if (b.glb) { placeGlbRuin(ctx, chunk, b, fr, g0, r); continue; }
    if (b.rubble) { emitRubble(mb, b, fr, g0, r); continue; }
    const H = emitBuilding(mb, nb, b.dFront < 130 ? cols : null, b, fr, g0, g1, r);
    if (b.smoke) (chunk.citySmoke || (chunk.citySmoke = [])).push({ x: fr.x, y: g0 - 1.2 + H, z: fr.z, w: Math.max(b.W, b.D) * 0.8, s: b.s });
  }
  emitStreetLevel(mb, chunk, road, items.streets);
  const fb = new MB(anchor, { cap: 128 });
  emitStreetProps(ctx, chunk, mb, nb, fb, cols, items);
  if (fb.count) {
    const m = new THREE.Mesh(fb.build(), flameMaterial());
    m.position.set(anchor.x, anchor.y, anchor.z); m.userData.ownGeo = true; m.matrixAutoUpdate = false; m.updateMatrix(); m.renderOrder = 13; m.name = 'city-flames';
    chunk.addExtra(m);
  }
  if (mb.count) {
    const m = new THREE.Mesh(mb.build(), facadeMaterial());
    m.position.set(anchor.x, anchor.y, anchor.z); m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true;
    m.matrixAutoUpdate = false; m.updateMatrix(); m.name = 'city';
    chunk.addExtra(m);
  }
  if (nb.count) {
    const m = new THREE.Mesh(nb.build(), neonMaterial());
    m.position.set(anchor.x, anchor.y, anchor.z); m.userData.ownGeo = true; m.matrixAutoUpdate = false; m.updateMatrix(); m.name = 'city-neon';
    chunk.addExtra(m);
  }
  if (chunk.citySmoke) {
    const sb = new MB(anchor, { cap: 256 });
    for (const q of chunk.citySmoke) smokeColumn(sb, q, rngOf(seed, Math.round(q.s), 77));
    const g = sb.build(); g.boundingSphere.radius += 260;
    const m = new THREE.Mesh(g, smokeMaterial());
    m.position.set(anchor.x, anchor.y, anchor.z); m.userData.ownGeo = true; m.matrixAutoUpdate = false; m.updateMatrix(); m.renderOrder = 12; m.name = 'city-smoke';
    chunk.addExtra(m);
  }
  if (cols.idx.length) {
    const id = `city:${chunk.c}`; chunk.hooks.push(id);
    ctx.hook({ type: 'static', id, asset: 'city', collision: { pos: new Float32Array(cols.pos), idx: new Uint32Array(cols.idx) } });
  }
  chunk.dirty = true;
  return true;
}
const _fr = {};

/** Rising smoke column over a burning building: a vertical strip whose width is applied in the (camera-facing) vertex shader. */
function smokeColumn(sb, q, r) {
  const N = 10, Hs = 150 + r() * 80, ph = r();
  const wx = 0.9, wz = 0.42, base = sb.count;
  for (let i = 0; i <= N; i++) {
    const t = i / N, y = q.y - 2 + t * Hs, drift = t * t * 70;
    const hw = q.w * (0.35 + 2.2 * t);
    sb.setFac(ph, 1.0, hw, 0);
    const x = q.x + wx * drift, z = q.z + wz * drift;
    sb.vert(x, y, z, 0, 1, 0, 0, t); sb.vert(x, y, z, 0, 1, 0, 1, t);
    if (i > 0) { const a = base + (i - 1) * 2; sb.quadIdx(a, a + 1, a + 3, a + 2); }
  }
}

const GLB_RUINS = ['ruin_office_a', 'ruin_office_b', 'ruin_office_c', 'ruin_apartment_a', 'ruin_apartment_b'];
export const CITY_GLB = GLB_RUINS;
function placeGlbRuin(ctx, chunk, b, fr, g0, r) {
  const name = GLB_RUINS[Math.floor(r() * GLB_RUINS.length) % GLB_RUINS.length];
  const a = ctx.kit.get(name); if (!a) return;
  ctx.pool.register(name, { far: 1700, shadow: true, behind: true });
  const sc = 0.95 + r() * 0.15, sy = 0.9 + r() * 0.45, t = 0.85 + r() * 0.25;
  chunk.list(name).push(fr.x, g0 - 0.4, fr.z, fr.yaw + (r() - 0.5) * 0.12, sc, sy, sc, 0, 1, 0, 0, a.sphere.radius * Math.max(sc, sy) * 1.1, t, t, t);
}
