// Road furniture: guard rails, utility poles + wires, street lamps, signs, mile markers, billboards. Deterministic slot schedules per biome.
import { biomeAt } from '../../data/biomes.js';
import { hash2, lerp } from '../../core/util.js';
import { roadFrame, groundAt, CHUNK_LEN } from './util.js';

/** Furniture density per biome (0..1 activity). */
const CFG = {
  desert:   { poles: 0.75, signs: 1.0, board: 1.0, mile: 1, lamps: 0 },
  canyon:   { poles: 0.30, signs: 0.8, board: 0.25, mile: 1, lamps: 0 },
  coast:    { poles: 0.0, signs: 0.8, board: 0.35, mile: 1, lamps: 0 },
  mountain: { poles: 0.30, signs: 1.0, board: 0.2, mile: 1, lamps: 0 },
  city:     { poles: 0.35, signs: 0.7, board: 1.0, mile: 1, lamps: 1 },
  dam:      { poles: 0.0, signs: 0.35, board: 0.0, mile: 0, lamps: 0 },
};
function cfg(s, key) { const b = biomeAt(s); return lerp(CFG[b.a][key], CFG[b.b][key], b.w); }

export const FURNITURE_SPECS = {
  guardrail_4m: { far: 300, shadow: true, behind: true, lods: [{ asset: 'guardrail_4m', max: 80 }, { asset: 'guardrail_lod', max: 1e9 }] },
  jersey_barrier: { far: 260, shadow: true, behind: true, lods: [{ asset: 'jersey_barrier', max: 90 }, { asset: 'jersey_lod', max: 1e9 }] },
  utility_pole: { far: 560, shadow: true, behind: true, lods: [{ asset: 'utility_pole', max: 160 }, { asset: 'utility_pole_lod', max: 1e9 }] },
  wire_span: { far: 300, shadow: false, behind: true },
  street_lamp: { far: 420, shadow: true, behind: true },
  sign_speed: { far: 300, shadow: true, behind: true },
  sign_warning: { far: 300, shadow: true, behind: true },
  sign_exit: { far: 360, shadow: true, behind: true },
  mile_marker: { far: 170, shadow: false },
  billboard: { far: 1100, shadow: true, behind: true },
  road_cone: { far: 200, shadow: false, lite: true },
  barrel: { far: 200, shadow: false, lite: true },
  bollard: { far: 160, shadow: false },
};

/** ready-check helper: returns asset | null (missing) | undefined (still loading) */
export function need(ctx, name) {
  const st = ctx.kit.state(name);
  if (st === 'idle') ctx.kit.request(name);
  if (st === 'ready') return ctx.kit.get(name);
  return st === 'missing' ? null : undefined;
}
export function useSpec(ctx, name, spec = FURNITURE_SPECS[name]) { ctx.pool.register(name, spec || {}); }

const _f = {};
function faceYaw(road, s, side, ang) {
  // direction the front (+Z) must point: back toward oncoming traffic, turned toward the road by `ang`
  const sm = road.sample(s, {});
  const fx = sm.fx, fz = sm.fz, nx = sm.nx, nz = sm.nz;
  const dx = -fx * Math.cos(ang) - nx * side * Math.sin(ang), dz = -fz * Math.cos(ang) - nz * side * Math.sin(ang);
  return Math.atan2(dx, dz);
}

/** Merge [a,b] intervals, subtract `cuts`, return list. */
function mergeIntervals(list) {
  list.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const iv of list) { const last = out[out.length - 1]; if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]); else out.push([iv[0], iv[1]]); }
  return out;
}
function subtract(list, cuts) {
  let cur = list;
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [a, b] of cur) { if (c1 <= a || c0 >= b) next.push([a, b]); else { if (c0 > a) next.push([a, c0]); if (c1 < b) next.push([c1, b]); } }
    cur = next;
  }
  return cur;
}

// ------------------------------------------------------------------------------------------------ guard rails
function guardrails(ctx, chunk) {
  const rail = need(ctx, 'guardrail_4m'), lod = need(ctx, 'guardrail_lod');
  if (rail === undefined || lod === undefined) return false;
  if (!rail) return true;
  useSpec(ctx, 'guardrail_4m');
  const { road } = ctx, s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  const feats = road.featuresIn(s0 - 6, s1 + 6, 'guard');
  if (!feats.length) return true;
  const per = { 1: [], '-1': [] };
  for (const f of feats) { const sides = f.side === 'both' ? [1, -1] : f.side === 'L' ? [1] : [-1]; for (const sd of sides) per[sd].push([f.s0, f.s1]); }
  const cuts = [];
  for (const f of road.featuresIn(s0 - 30, s1 + 30)) {
    if (f.type === 'bridge') cuts.push([f.s0 - 4, f.s1 + 4]);
    else if (f.type === 'tunnel') cuts.push([f.s0 - 4, f.s1 + 4]);
    else if (f.type === 'overpass') cuts.push([f.s0 - 14, f.s1 + 14]);
    else if (f.type === 'ramp') cuts.push([f.s0 - 2, f.s1 + 2]);
  }
  const list = chunk.list('guardrail_4m');
  for (const sd of [1, -1]) {
    const runs = subtract(mergeIntervals(per[sd]), cuts);
    for (const [a, b] of runs) {
      const lo = Math.max(a, s0), hi = Math.min(b, s1);
      if (hi - lo < 3) continue;
      const poly = [];
      for (let k = Math.ceil((lo - 2) / 4); ; k++) {
        const sc = 4 * k + 2; if (sc >= hi) break; if (sc < lo) continue;
        const fr = roadFrame(road, sc - 2, 4, sd * 9.3, _f);
        const sgn = sd > 0 ? -1 : 1; // left rail is turned around so its +X (traffic) side faces the road
        list.pushBasis(fr.x + fr.fx * 2 * 1, fr.y + fr.fy * 2, fr.z + fr.fz * 2, fr.lx * sgn, fr.ly * sgn, fr.lz * sgn, fr.ux, fr.uy, fr.uz, fr.fx * sgn, fr.fy * sgn, fr.fz * sgn, 1, 1, 1, 2.2);
        poly.push([fr.x + fr.fx * 2, fr.y + fr.fy * 2, fr.z + fr.fz * 2]);
      }
      if (poly.length) {
        const id = `guard:${chunk.c}:${sd}:${Math.round(lo)}`;
        chunk.hooks.push(id);
        ctx.hook({ type: 'guardrail', id, s0: lo, s1: hi, side: sd > 0 ? 'L' : 'R', d: sd * 9.3, height: 0.8, halfThickness: 0.1, polyline: poly });
      }
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ poles & wires
function poles(ctx, chunk) {
  const pole = need(ctx, 'utility_pole'), wire = need(ctx, 'wire_span');
  if (pole === undefined || wire === undefined) return false;
  if (!pole) return true;
  const { road, seed } = ctx, s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  useSpec(ctx, 'utility_pole'); if (wire) useSpec(ctx, 'wire_span');
  const cutsF = road.featuresIn(s0 - 60, s1 + 60);
  const inMajor = (s) => cutsF.some((f) => (f.type === 'bridge' || f.type === 'tunnel') && s > f.s0 - 12 && s < f.s1 + 12);
  const activeAt = (s) => {
    const blk = Math.floor(s / 1500);
    if (hash2(blk, 11, seed) > cfg(blk * 1500 + 750, 'poles')) return 0;
    return hash2(blk, 12, seed) < 0.5 ? 1 : -1;
  };
  const lp = chunk.list('utility_pole'), lw = chunk.list('wire_span');
  const P0 = {}, P1 = {};
  for (let k = Math.ceil(s0 / 40); k * 40 < s1; k++) {
    const s = k * 40, side = activeAt(s);
    if (!side || inMajor(s)) continue;
    const d = side * 14.2;
    const g = chunk.ground.sample(s, d, P0);
    const sm = road.sample(s, {});
    const jit = (hash2(k, 13, seed) - 0.5) * 0.12;
    lp.push(g.x, g.y - 0.15, g.z, sm.th + jit, 1, 1, 1, 0, 1, 0, 0, 6);
    if (wire && activeAt(s + 40) === side && !inMajor(s + 40)) {
      const g1 = groundAt(road, seed, s + 40, d, P1);
      const ax = g.x, ay = g.y - 0.15, az = g.z, bx = g1.x, by = g1.y - 0.15, bz = g1.z;
      let fx = bx - ax, fy = by - ay, fz = bz - az; const len = Math.hypot(fx, fy, fz); fx /= len; fy /= len; fz /= len;
      // lateral from world-up x f, up = f x lateral
      let lx = fz, ly = 0, lz = -fx; const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
      const ux = fy * lz - fz * ly, uy = fz * lx - fx * lz, uz = fx * ly - fy * lx;
      lw.pushBasis(ax, ay, az, lx, ly, lz, ux, uy, uz, fx, fy, fz, 1, 1, len / 20, 22);
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ lamps
function lamps(ctx, chunk) {
  const lamp = need(ctx, 'street_lamp');
  if (lamp === undefined) return false;
  if (!lamp) return true;
  const { road, seed } = ctx, s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  if (cfg(s0 + 48, 'lamps') < 0.05 && cfg(s0, 'lamps') < 0.05 && cfg(s1, 'lamps') < 0.05) return true;
  useSpec(ctx, 'street_lamp'); useSpec(ctx, 'lamp_pool', { far: 330 }); useSpec(ctx, 'lamp_cone', { far: 330 });
  const cutsF = road.featuresIn(s0 - 30, s1 + 30);
  const list = chunk.list('street_lamp'), P = {};
  const PITCH = 34;
  for (let k = Math.ceil(s0 / PITCH); k * PITCH < s1; k++) {
    const s = k * PITCH;
    if (hash2(k, 21, seed) > cfg(s, 'lamps')) continue;
    if (cutsF.some((f) => (f.type === 'bridge' || f.type === 'tunnel' || f.type === 'overpass') && s > f.s0 - 8 && s < f.s1 + 8)) continue;
    const side = k % 2 ? 1 : -1;
    const g = chunk.ground.sample(s, side * 11.2, P);
    const sm = road.sample(s, {});
    // arm extends along local +X (left); on the left shoulder turn the lamp around so the arm reaches over the road
    list.push(g.x, g.y - 0.05, g.z, sm.th + (side > 0 ? Math.PI : 0), 1, 1, 1, 0, 1, 0, 0, 6);
    // light pool on the road under the lamp head + the faint beam
    const fr = roadFrame(road, s - 1, 2, side * 8.4, _f);
    chunk.list('lamp_pool').pushBasis(fr.x + fr.fx + fr.ux * 0.03, fr.y + fr.fy + fr.uy * 0.03, fr.z + fr.fz + fr.uz * 0.03, fr.lx, fr.ly, fr.lz, fr.ux, fr.uy, fr.uz, fr.fx, fr.fy, fr.fz, 8.5, 1, 8.5, 9);
    const hp = road.pointAt(s, side * 9.9, {});
    chunk.list('lamp_cone').push(hp.x, g.y - 0.05 + 9.05, hp.z, 0, 1, 1, 1, 0, 1, 0, 0, 5);
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ signs, mile markers, billboards
function signs(ctx, chunk) {
  const names = ['sign_speed', 'sign_warning', 'sign_exit', 'mile_marker', 'billboard'];
  const A = names.map((n) => need(ctx, n));
  if (A.some((a) => a === undefined)) return false;
  const { road, seed } = ctx, s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  names.forEach((n, i) => { if (A[i]) useSpec(ctx, n); });
  const cutsF = road.featuresIn(s0 - 30, s1 + 30);
  const blocked = (s) => cutsF.some((f) => (f.type === 'bridge' || f.type === 'tunnel' || f.type === 'overpass') && s > f.s0 - 10 && s < f.s1 + 10);
  const P = {};
  // speed / warning signs: ~ every 380 m
  const put = (name, s, side, dist, ang, sc = 1) => {
    const asset = ctx.kit.get(name); if (!asset) return;
    const g = chunk.ground.sample(s, side * dist, P);
    chunk.list(name).push(g.x, g.y - 0.03, g.z, faceYaw(road, s, side, ang), sc, sc, sc, 0, 1, 0, 0, asset.sphere.radius * sc);
  };
  const SP = 380;
  for (let k = Math.ceil((s0 - 60) / SP); ; k++) {
    const s = k * SP + (hash2(k, 31, seed) - 0.5) * 140;
    if (s >= s1) break; if (s < s0) continue;
    if (hash2(k, 32, seed) > cfg(s, 'signs') || blocked(s)) continue;
    const r = hash2(k, 33, seed);
    const side = hash2(k, 34, seed) < 0.6 ? -1 : 1;
    if (r < 0.42) put('sign_speed', s, side, 11.4, 0.08);
    else if (r < 0.92) put('sign_warning', s, side, 11.4, 0.08);
    else put('sign_exit', s, -1, 12.6, 0.05);
  }
  // mile markers every 500 m on the right
  for (let k = Math.ceil(s0 / 500); k * 500 < s1; k++) {
    const s = k * 500 + 30;
    if (s < s0 || s >= s1 || cfg(s, 'mile') < 0.5 || blocked(s)) continue;
    put('mile_marker', s, -1, 11.0, 0.15);
  }
  // billboards ~ every 1.9 km
  const BP = 1900;
  for (let k = Math.ceil((s0 - 500) / BP); ; k++) {
    const s = k * BP + 400 + (hash2(k, 41, seed) - 0.5) * 900;
    if (s >= s1) break; if (s < s0) continue;
    if (hash2(k, 42, seed) > cfg(s, 'board') || blocked(s)) continue;
    const side = hash2(k, 43, seed) < 0.5 ? -1 : 1;
    put('billboard', s, side, 26 + hash2(k, 44, seed) * 14, 0.42 + hash2(k, 45, seed) * 0.15, 1);
  }
  return true;
}

export function buildFurniture(ctx, chunk) {
  let ok = true;
  for (const [key, fn] of [['guard', guardrails], ['poles', poles], ['lamps', lamps], ['signs', signs]]) {
    if (chunk.done.has('f:' + key)) continue;
    if (fn(ctx, chunk)) chunk.done.add('f:' + key); else ok = false;
  }
  chunk.dirty = true;
  return ok;
}
