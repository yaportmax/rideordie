// Roadside set pieces: gas stations, diners, water towers, radio towers, wind farms, raider camps, oil derricks, canyon hoodoos/mesas, the ruined
// city skyline, coastal lighthouse / sea stacks / wharf, the dam gate + control tower + arena. Deterministic slot schedule per biome:
// plan(sA, sB) is a PURE function of (seed, s-range) and is cached, so scatter can query footprints of neighbouring chunks.
import { biomeAt, DAM_START, BOSS_S } from '../../data/biomes.js';
import { hash2, clamp, smoothstep } from '../../core/util.js';
import { terrainPoint, EDGE } from '../terrain_gen.js';
import { groundAt, rngOf, strId, CHUNK_LEN } from './util.js';
import { need, useSpec } from './furniture.js';
import { seaLevel } from '../terrain_gen.js';
import { cityDens, cityExclusions, CITY_PROPS } from './city.js';
import { rockExclusions } from './rocks.js';
import { momentExclusions } from './moments.js';
import { GAUNTLET_ASSETS } from './damroad.js';
import { rbFlankExclusions } from './features.js';

// ------------------------------------------------------------------------------------------------ tables
// part: { a asset, u (metres along the road from the anchor; number or [min,max]), v (lateral distance from the road centre), yaw: 'face' | 'oncoming' | 'free' | 'along',
//   sc, flat (bool: needs level ground, checked for the anchor), rep: {n:[a,b], du, dv} }
const P = (a, o = {}) => ({ a, ...o });
const KINDS = {
  desert: { pitch: 780, chance: 0.82, items: [
    { w: 3, parts: [P('gas_station', { v: [30, 44], flat: 1.2, main: 1 }), P('sign_gas', { u: [-70, -45], v: [13, 15.5], yaw: 'oncoming' }), P('shipping_container', { u: [-16, -12], v: [56, 62], yaw: 'free' }), P('tire_stack', { u: [4, 10], v: [26, 28], yaw: 'free' }), P('barrel', { u: [-6, -3], v: [25, 27], yaw: 'free' })] },
    { w: 2, parts: [P('diner', { v: [30, 42], flat: 1.2, main: 1 }), P('shipping_container_stack3', { u: [30, 42], v: [44, 52], yaw: 'free' })] },
    { w: 1.4, parts: [P('motel', { v: [34, 48], flat: 1.4, main: 1 })] },
    { w: 2, parts: [P('water_tower', { v: [42, 110], flat: 1.6, yaw: 'free', main: 1 })] },
    { w: 1.1, parts: [P('silo_group', { v: [70, 130], flat: 2.0, main: 1 })] },
    { w: 2, parts: [P('radio_tower', { v: [60, 220], flat: 2.0, yaw: 'free', main: 1 })] },
    { w: 1.6, parts: [P('wind_turbine', { v: [110, 180], flat: 2.0, yaw: 'free', main: 1, rep: { n: [3, 5], du: 105, dv: [-10, 10] } })] },
    { w: 2, parts: [P('oil_derrick', { v: [36, 90], flat: 1.5, main: 1, rep: { n: [1, 3], du: 70, dv: [-8, 8] } })] },
    { w: 1.6, parts: [P('barn_ruin', { v: [36, 70], flat: 1.5, main: 1 }), P('debris_pile', { u: [16, 22], v: [36, 44], yaw: 'free' })] },
    { w: 2, parts: [P('raider_camp_tent', { v: [40, 70], flat: 1.4, main: 1 }), P('shanty_hut', { u: [18, 26], v: [36, 52], yaw: 'free' }), P('shanty_hut', { u: [-28, -18], v: [40, 58], yaw: 'free' }), P('banner_skull', { u: [-12, -6], v: [16, 20], yaw: 'oncoming' }), P('watchtower', { u: [30, 42], v: [45, 60] })] },
    { w: 1.4, parts: [P('watchtower', { v: [26, 60], flat: 1.0, main: 1 }), P('banner_skull', { u: [10, 16], v: [14, 18], yaw: 'oncoming' })] },
  ] },
  canyon: { pitch: 700, chance: 0.7, items: [
    { w: 2, parts: [P('watchtower', { v: [24, 60], flat: 1.2, main: 1 }), P('banner_skull', { u: [10, 16], v: [14, 18], yaw: 'oncoming' })] },
    { w: 2.2, parts: [P('raider_camp_tent', { v: [26, 60], flat: 1.5, main: 1 }), P('shanty_hut', { u: [18, 26], v: [26, 44], yaw: 'free' }), P('shanty_hut', { u: [-26, -18], v: [30, 48], yaw: 'free' }), P('banner_skull', { u: [-20, -12], v: [14, 18], yaw: 'oncoming' })] },
    { w: 1.2, parts: [P('oil_derrick', { v: [30, 70], flat: 1.5, main: 1 })] },
    { w: 1.2, parts: [P('gas_station', { v: [26, 44], flat: 1.2, main: 1 }), P('sign_gas', { u: [-70, -45], v: [13, 15.5], yaw: 'oncoming' })] },
    { w: 1.0, parts: [P('radio_tower', { v: [40, 160], flat: 2.0, yaw: 'free', main: 1 })] },
    { w: 1.0, parts: [P('shanty_hut', { v: [24, 44], flat: 1.0, yaw: 'free', main: 1, rep: { n: [2, 3], du: 16, dv: [-4, 8] } })] },
  ] },
  coast: { pitch: 800, chance: 0.75, items: [
    { w: 2, parts: [P('diner', { v: [28, 44], flat: 1.2, main: 1, land: 1 })] },
    { w: 1.6, parts: [P('motel', { v: [30, 50], flat: 1.4, main: 1, land: 1 })] },
    { w: 1.6, parts: [P('gas_station', { v: [26, 44], flat: 1.2, main: 1, land: 1 }), P('sign_gas', { u: [-70, -45], v: [13, 15.5], yaw: 'oncoming' })] },
    { w: 1.6, parts: [P('radio_tower', { v: [50, 200], flat: 2.0, yaw: 'free', main: 1, land: 1 })] },
    { w: 1.8, parts: [P('wind_turbine', { v: [90, 190], flat: 2.0, yaw: 'free', main: 1, land: 1, rep: { n: [3, 5], du: 100, dv: [-10, 10] } })] },
    { w: 1.4, parts: [P('water_tower', { v: [40, 100], flat: 1.6, yaw: 'free', main: 1, land: 1 })] },
    { w: 1.2, parts: [P('barn_ruin', { v: [34, 80], flat: 1.5, main: 1, land: 1 })] },
    { w: 1.2, parts: [P('watchtower', { v: [26, 60], flat: 1.0, main: 1, land: 1 })] },
  ] },
  mountain: { pitch: 720, chance: 0.68, items: [
    { w: 2, parts: [P('radio_tower', { v: [40, 240], flat: 2.4, yaw: 'free', main: 1 })] },
    { w: 2, parts: [P('watchtower', { v: [22, 60], flat: 1.6, main: 1 }), P('banner_skull', { u: [10, 16], v: [14, 18], yaw: 'oncoming' })] },
    { w: 2, parts: [P('raider_camp_tent', { v: [36, 70], flat: 1.6, main: 1 }), P('shanty_hut', { u: [18, 26], v: [36, 52], yaw: 'free' }), P('shanty_hut', { u: [-28, -18], v: [40, 58], yaw: 'free' }), P('banner_skull', { u: [-14, -8], v: [14, 18], yaw: 'oncoming' })] },
    { w: 1.5, parts: [P('wind_turbine', { v: [90, 200], flat: 2.6, yaw: 'free', main: 1, rep: { n: [3, 4], du: 110, dv: [-10, 10] } })] },
    { w: 1.0, parts: [P('water_tower', { v: [36, 90], flat: 1.8, yaw: 'free', main: 1 })] },
    { w: 1.2, parts: [P('barn_ruin', { v: [34, 70], flat: 1.6, main: 1 })] },
    { w: 0.8, parts: [P('gas_station', { v: [26, 40], flat: 1.4, main: 1 }), P('sign_gas', { u: [-70, -45], v: [13, 15.5], yaw: 'oncoming' })] },
  ] },
  city: { pitch: 520, chance: 0.75, items: [
    { w: 1.6, parts: [P('industrial_tanks', { v: [80, 140], flat: 2.0, main: 1 })] },
    { w: 1.4, parts: [P('cooling_tower', { v: [120, 230], flat: 2.6, yaw: 'free', main: 1 })] },
    { w: 1.4, parts: [P('crane', { v: [90, 180], flat: 2.0, yaw: 'free', main: 1 })] },
    { w: 2, parts: [P('warehouse', { v: [50, 90], flat: 1.5, main: 1 }), P('shipping_container', { u: [30, 44], v: [56, 66], yaw: 'free' })] },
    { w: 1.2, parts: [P('silo_group', { v: [90, 150], flat: 2.0, main: 1 })] },
    { w: 1.4, parts: [P('water_tower', { v: [50, 120], flat: 1.6, yaw: 'free', main: 1 })] },
    { w: 1.2, parts: [P('radio_tower', { v: [70, 220], flat: 2.0, yaw: 'free', main: 1 })] },
    { w: 1.2, parts: [P('gas_station', { v: [28, 44], flat: 1.2, main: 1 }), P('sign_gas', { u: [-70, -45], v: [13, 15.5], yaw: 'oncoming' })] },
    { w: 1.0, parts: [P('diner', { v: [30, 44], flat: 1.2, main: 1 })] },
    { w: 1.6, parts: [P('shipping_container_stack3', { v: [30, 60], flat: 1.0, yaw: 'free', main: 1, rep: { n: [2, 4], du: 9, dv: [-3, 6] } })] },
    { w: 1.0, parts: [P('raider_camp_tent', { v: [40, 70], flat: 1.4, main: 1 }), P('banner_skull', { u: [-14, -8], v: [14, 18], yaw: 'oncoming' })] },
  ] },
  dam: { pitch: 900, chance: 0.4, items: [
    { w: 2, parts: [P('watchtower', { v: [26, 60], flat: 1.4, main: 1 }), P('banner_skull', { u: [10, 16], v: [14, 18], yaw: 'oncoming' })] },
    { w: 1.5, parts: [P('radio_tower', { v: [50, 200], flat: 2.4, yaw: 'free', main: 1 })] },
    { w: 1.5, parts: [P('raider_camp_tent', { v: [40, 70], flat: 1.5, main: 1 }), P('shanty_hut', { u: [18, 26], v: [36, 52], yaw: 'free' })] },
  ] },
};

// far backdrops: rock formations that make the horizon interesting
const BACKDROPS = {
  desert: { pitch: 620, chance: 0.0, items: [] },                     // far mesas are procedural now (rocks.js)
  canyon: { pitch: 520, chance: 0.0, items: [] },
  coast: { pitch: 420, chance: 0.0, items: [] },
  mountain: { pitch: 900, chance: 0.0, items: [] },
  city: { pitch: 900, chance: 0.0, items: [] },
  dam: { pitch: 900, chance: 0.0, items: [] },
};

const SLOT_MARGIN = 320;
const _near = {};
/** Local collision mesh -> world (yaw about +Y, scale xz / y). */
function xformMesh(m, x, y, z, yaw, sxz, sy) {
  const c = Math.cos(yaw), sn = Math.sin(yaw), src = m.pos, out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const lx = src[i] * sxz, ly = src[i + 1] * sy, lz = src[i + 2] * sxz;
    out[i] = x + lx * c + lz * sn; out[i + 1] = y + ly; out[i + 2] = z - lx * sn + lz * c;
  }
  return { pos: out, idx: m.idx };
}

// ------------------------------------------------------------------------------------------------ geometry helpers
const _tp = {};
function facingYaw(th, side) { return side > 0 ? th - Math.PI / 2 : th + Math.PI / 2; }

/** Sample the terrain under a model footprint placed at (s, d0) with yaw psi. Returns {min, max, mean, ok} (ok=false if any sample is off-terrain). */
function footprint(ctx, asset, s, d0, psi, th, seaY) {
  const b = asset.box, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
  const hx = (b.max.x - b.min.x) / 2 * 0.9, hz = (b.max.z - b.min.z) / 2 * 0.9;
  const cs = Math.cos(psi), sn = Math.sin(psi), fx = Math.sin(th), fz = Math.cos(th), nx = Math.cos(th), nz = -Math.sin(th);
  let min = 1e9, max = -1e9, sum = 0, n = 0;
  for (const [kx, kz] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const lx = cx + kx * hx, lz = cz + kz * hz;
    const dx = lx * cs + lz * sn, dz = -lx * sn + lz * cs;
    const g = groundAt(ctx.road, ctx.seed, s + dx * fx + dz * fz, d0 + dx * nx + dz * nz, _tp);
    if (g.y < min) min = g.y; if (g.y > max) max = g.y; sum += g.y; n++;
  }
  return { min, max, mean: sum / n, ok: min > seaY + 0.5 };
}

const pick = (rnd, list) => { let t = 0; for (const it of list) t += it.w; let r = rnd() * t; for (const it of list) { r -= it.w; if (r <= 0) return it; } return list[list.length - 1]; };
const rr = (rnd, v) => (Array.isArray(v) ? v[0] + (v[1] - v[0]) * rnd() : v);

// ------------------------------------------------------------------------------------------------ planning
/** A placement: {asset, x,y,z, yaw, sc, found: {cx,cz,w,d,ymin}|null, r (exclusion radius), s (owner s)} */
export class LandmarkPlanner {
  constructor(ctx) { this.ctx = ctx; this.cache = new Map(); }

  /** All placements whose anchor s lies in [sA, sB). Requires the assets of the anchor to be loaded (returns null while loading). */
  plan(sA, sB) {
    const out = [];
    for (const [tableName, table, salt] of [['kinds', KINDS, 1], ['back', BACKDROPS, 2]]) {
      const steps = new Set();
      // slots depend on the biome at their position; we iterate over every biome pitch (cheap) and keep those inside the range and of that biome
      for (const id of Object.keys(table)) {
        const T = table[id]; if (!T.items.length || T.chance <= 0) continue;
        const kA = Math.floor(sA / T.pitch) - 1, kB = Math.ceil(sB / T.pitch) + 1;
        for (let k = kA; k <= kB; k++) {
          const sc = k * T.pitch + (hash2(k, 71 + salt, this.ctx.seed) - 0.5) * T.pitch * 0.7;
          if (sc < sA || sc >= sB) continue;
          const bio = biomeAt(sc), bid = bio.w > 0.5 ? bio.b : bio.a;
          if (bid !== id) continue;
          const key = `${tableName}:${id}:${k}`;
          if (steps.has(key)) continue; steps.add(key);
          let r = this.cache.get(key);
          if (r === undefined) { r = this._slot(tableName, T, id, k, sc); if (r === 'wait') return null; this.cache.set(key, r); }
          if (r) for (const p of r) out.push(p);
        }
      }
    }
    const sp = specials(this.ctx, sA, sB);
    if (sp === null) return null;
    for (const p of sp) out.push(p);
    return out;
  }

  _slot(tableName, T, biomeId, k, sc) {
    const { road, seed, kit } = this.ctx;
    const rnd = rngOf(seed, k * 7 + (tableName === 'kinds' ? 1 : 2), strId(biomeId));
    if (rnd() > T.chance) return [];
    const item = pick(rnd, T.items);
    road.extendTo(sc + 800);
    const sm = road.sample(sc, {}), th = sm.th;
    const seaY = biomeId === 'coast' ? seaLevel(road, 'coast') : biomeId === 'dam' ? seaLevel(road, 'dam') : -1e9;
    // the dense city has its own procedural street wall (city.js): industrial set pieces only on the outskirts
    if (biomeId === 'city' && cityDens(sc) > 0.22) return [];
    // avoid road features
    for (const f of road.featuresIn(sc - 90, sc + 90)) if ((f.type === 'bridge' || f.type === 'tunnel' || f.type === 'overpass') && sc > f.s0 - 90 && sc < f.s1 + 90) return [];
    const placements = [];
    if (tableName === 'back') {
      const name = item.a[Math.floor(rnd() * item.a.length) % item.a.length];
      const a = kit.state(name) === 'ready' ? kit.get(name) : null;
      if (kit.state(name) === 'idle') kit.request(name);
      if (kit.state(name) === 'loading') return 'wait';
      if (!a) return [];
      for (let tries = 0; tries < 6; tries++) {
        const side = rnd() < 0.5 ? 1 : -1, v = rr(rnd, item.v), u = (rnd() - 0.5) * 60;
        const psi = rnd() * 6.283, s = sc + u, d0 = side * v;
        const sc2 = item.sc[0] + (item.sc[1] - item.sc[0]) * rnd();
        const fp = footprint(this.ctx, a, s, d0, psi, th, seaY);
        if (!fp.ok || fp.max - fp.min > item.flatTol) continue;
        const g = groundAt(road, seed, s, d0, {});
        const y = fp.min - 0.5;
        placements.push({ asset: name, x: g.x, y, z: g.z, yaw: psi, sc: sc2, r: a.radius * sc2 * 0.9, s, found: null });
        break;
      }
      return placements;
    }
    // ---- compounds: anchor = part with main:1
    const mainPart = item.parts.find((q) => q.main) || item.parts[0];
    const names = [...new Set(item.parts.map((q) => q.a))];
    for (const n of names) { const st = kit.state(n); if (st === 'idle') kit.request(n); }
    if (names.some((n) => kit.state(n) === 'loading')) return 'wait';
    const A = kit.get(mainPart.a); if (!A) return [];
    let best = null;
    const nRep = mainPart.rep ? Math.round(rr(rnd, mainPart.rep.n)) : 1;
    for (let tries = 0; tries < 8 && !best; tries++) {
      const side = rnd() < 0.5 ? 1 : -1, v = rr(rnd, mainPart.v), u = (rnd() - 0.5) * 80;
      if (mainPart.land) { const seaSide = biomeId === 'dam' ? -1 : 1; if (side === seaSide) continue; }
      const s = sc + u, d0 = side * v;
      const yawMode = mainPart.yaw || 'face';
      const psi = yawMode === 'free' ? rnd() * 6.283 : facingYaw(road.sample(s, {}).th, side) + (rnd() - 0.5) * 0.2;
      const fp = footprint(this.ctx, A, s, d0, psi, road.sample(s, {}).th, seaY);
      if (!fp.ok || fp.max - fp.min > (mainPart.flat ?? 1.5) * 1.6) continue;
      best = { side, s, d0, psi, fp, u, v };
    }
    if (!best) return [];
    const th0 = road.sample(best.s, {}).th;
    // anchor (and repetitions)
    for (let i = 0; i < nRep; i++) {
      const du = mainPart.rep ? (i - (nRep - 1) / 2) * mainPart.rep.du : 0, dv = mainPart.rep ? rr(rnd, mainPart.rep.dv) : 0;
      const s = best.s + du, d0 = best.d0 + best.side * dv;
      const yawMode = mainPart.yaw || 'face';
      const psi = yawMode === 'free' ? rnd() * 6.283 : facingYaw(road.sample(s, {}).th, best.side) + (rnd() - 0.5) * 0.12;
      const fp = i === 0 ? best.fp : footprint(this.ctx, A, s, d0, psi, road.sample(s, {}).th, seaY);
      if (!fp.ok || fp.max - fp.min > (mainPart.flat ?? 1.5) * 2.4) continue;
      const g = groundAt(road, seed, s, d0, {});
      const sc2 = mainPart.sc ? mainPart.sc[0] + (mainPart.sc[1] - mainPart.sc[0]) * rnd() : 1;
      const range = fp.max - fp.min;
      const y = fp.min + range * 0.3;
      const b = A.box;
      placements.push({ asset: mainPart.a, x: g.x, y, z: g.z, yaw: psi, sc: sc2, r: Math.max(A.radius, 8) * sc2 * 1.05 + 4, s,
        found: range > 0.35 ? { ymin: fp.min - 2.5, ytop: y + 0.06, box: b, sc: sc2 } : null });
    }
    // companions: relative to the anchor in (u along road, v from road)
    for (const q of item.parts) {
      if (q === mainPart) continue;
      const a = kit.get(q.a); if (!a) continue;
      const s = best.s + rr(rnd, q.u ?? 0), d0 = best.side * rr(rnd, q.v ?? best.v);
      const th = road.sample(s, {}).th;
      const yawMode = q.yaw || 'face';
      const psi = yawMode === 'free' ? rnd() * 6.283 : yawMode === 'oncoming' ? Math.atan2(-Math.sin(th) * 0.95 - Math.cos(th) * best.side * 0.3, -Math.cos(th) * 0.95 + Math.sin(th) * best.side * 0.3) : facingYaw(th, best.side);
      const fp = footprint(this.ctx, a, s, d0, psi, th, seaY);
      if (!fp.ok || fp.max - fp.min > 3.0) continue;
      const g = groundAt(road, seed, s, d0, {});
      const sc2 = q.sc ? q.sc[0] + (q.sc[1] - q.sc[0]) * rnd() : 1;
      placements.push({ asset: q.a, x: g.x, y: fp.min + (fp.max - fp.min) * 0.3, z: g.z, yaw: psi, sc: sc2, r: Math.max(2, a.radius * sc2), s, found: null });
    }
    void th0;
    return placements;
  }
}

// ------------------------------------------------------------------------------------------------ city (procedural, see city.js)
const RUINS = ['ruin_lowrise_a', 'ruin_lowrise_b', 'ruin_lowrise_c', 'ruin_apartment_a', 'ruin_apartment_b'];
const TOWERS = ['ruin_office_a', 'ruin_office_b', 'ruin_office_c'];

// ------------------------------------------------------------------------------------------------ hand-placed specials (coast, canyon arch, dam)
function assetReady(ctx, names) {
  let wait = false;
  for (const n of names) { const st = ctx.kit.state(n); if (st === 'idle') ctx.kit.request(n); if (st === 'idle' || st === 'loading') wait = true; }
  return !wait;
}


function specials(ctx, sA, sB) {
  const { road, seed, kit } = ctx;
  const out = [];
  const cached = (key, fn) => {
    let r = ctx.lm.cache.get(key);
    if (r === undefined) { r = fn(); if (r === 'wait') return 'wait'; ctx.lm.cache.set(key, r); }
    return r;
  };
  const push = (r) => { if (r === 'wait') return false; if (r) for (const p of r) out.push(p); return true; };
  const slots = (pitch, salt, jitter = 0.6) => {
    const res = [];
    for (let k = Math.floor(sA / pitch) - 1; k <= Math.ceil(sB / pitch) + 1; k++) {
      const s = k * pitch + (hash2(k, salt, seed) - 0.5) * pitch * jitter;
      if (s >= sA && s < sB) res.push([k, s]);
    }
    return res;
  };
  const inBiome = (s, id) => { const b = biomeAt(s); return (b.w > 0.5 ? b.b : b.a) === id; };

  // ---- coast: sea stacks, lighthouse, wharf
  if (sB > 19500 && sA < 30500) {
    const names = ['lighthouse', 'wharf_ruin'];
    if (!assetReady(ctx, names)) return null;
    for (const [k, s] of slots(2600, 502)) {
      if (!inBiome(s, 'coast')) continue;
      if (!push(cached(`light:${k}`, () => {
        const rnd = rngOf(seed, k, 502), seaY = seaLevel(road, 'coast');
        if (rnd() > 0.9 || !kit.get('lighthouse')) return [];
        for (let t = 0; t < 8; t++) {
          const v = 140 + rnd() * 160, g = groundAt(road, seed, s, v, {});
          if (g.y > seaY - 8) continue;
          const th = road.sample(s, {}).th;
          return [{ asset: 'lighthouse', x: g.x, y: seaY, z: g.z, yaw: facingYaw(th, 1) + 0.3 * (rnd() - 0.5), sc: 1.15, r: 40, s, found: null }];
        }
        return [];
      }))) return null;
    }
    for (const [k, s] of slots(2100, 503)) {
      if (!inBiome(s, 'coast')) continue;
      if (!push(cached(`wharf:${k}`, () => {
        const rnd = rngOf(seed, k, 503), seaY = seaLevel(road, 'coast');
        if (rnd() > 0.85 || !kit.get('wharf_ruin')) return [];
        // walk out from the road until the terrain drops below sea level
        let dPrev = 12;
        for (let d = 12; d < 160; d += 3) { const g = groundAt(road, seed, s, d, {}); if (g.y < seaY) { dPrev = d; break; } }
        if (dPrev >= 159) return [];
        const g = groundAt(road, seed, s, dPrev, {}), th = road.sample(s, {}).th;
        return [{ asset: 'wharf_ruin', x: g.x, y: seaY, z: g.z, yaw: th + Math.PI / 2, sc: 1, r: 30, s, found: null }];
      }))) return null;
    }
  }
  // ---- the dam: gate, control tower, floodlights, banners, boss arena
  if (sB > DAM_START - 200) {
    const names = ['dam_gate_big', 'dam_control_tower', 'floodlight_tower', 'banner_skull', 'spike_wall', 'boss_arena_lights'];
    if (!assetReady(ctx, names)) return null;
    if (!push(cached('dam:gate', () => {
      road.extendTo(DAM_START + 800);
      const res = [], at = (s, d) => { const p = road.pointAt(s, d, {}); return p; };
      const gs = DAM_START + 60, gp = at(gs, 0), th = road.sample(gs, {}).th;
      res.push({ asset: 'dam_gate_big', x: gp.x, y: gp.y - 0.02, z: gp.z, yaw: th, sc: 1, r: 26, s: gs, found: null });
      const tp = groundAt(road, seed, gs + 45, 24, {});
      res.push({ asset: 'dam_control_tower', x: tp.x, y: tp.y - 0.2, z: tp.z, yaw: facingYaw(road.sample(gs + 45, {}).th, 1), sc: 1, r: 18, s: gs + 45, found: { ymin: tp.y - 6, ytop: tp.y - 0.14, box: kit.get('dam_control_tower').box, sc: 1 } });
      for (const [ds, d] of [[-30, 15.5], [-30, -15.5], [26, 15.5], [26, -15.5]]) {
        const g = groundAt(road, seed, gs + ds, d, {}), t2 = road.sample(gs + ds, {}).th;
        res.push({ asset: 'floodlight_tower', x: g.x, y: g.y - 0.1, z: g.z, yaw: Math.atan2(gp.x - g.x, gp.z - g.z), sc: 1, r: 4, s: gs + ds, found: null });
        void t2;
      }
      for (let i = 0; i < 12; i++) {
        const s = DAM_START + 130 + i * 55, side = i % 2 ? 1 : -1, d = side * 14.5;
        const g = groundAt(road, seed, s, d, {}), t2 = road.sample(s, {}).th;
        res.push({ asset: 'banner_skull', x: g.x, y: g.y - 0.1, z: g.z, yaw: t2 + Math.PI + side * 0.3, sc: 1, r: 3, s, found: null });
      }
      return res;
    }))) return null;
    if (sB > BOSS_S - 400) {
      if (!push(cached('dam:arena', () => {
        road.extendTo(BOSS_S + 800);
        const res = [];
        for (const [ds, d] of [[-34, 15.5], [-34, -14], [34, 15.5], [34, -14]]) {
          const g = groundAt(road, seed, BOSS_S + ds, d, {}), t2 = road.sample(BOSS_S + ds, {}).th;
          const c = road.pointAt(BOSS_S, 0, {});
          res.push({ asset: 'floodlight_tower', x: g.x, y: g.y - 0.1, z: g.z, yaw: Math.atan2(c.x - g.x, c.z - g.z), sc: 1, r: 4, s: BOSS_S + ds, found: null });
          void t2;
        }
        return res;
      }))) return null;
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ specs
export const LANDMARK_SPECS = (() => {
  const big = { far: 1500, shadow: true, behind: true };
  const mid = { far: 1000, shadow: true, behind: true };
  const s = {};
  for (const n of ['ruin_office_a', 'ruin_office_b', 'ruin_office_c', 'ruin_apartment_a', 'ruin_apartment_b']) s[n] = { far: 1700, shadow: true, behind: true, mergeNear: 75 };
  for (const n of ['ruin_lowrise_a', 'ruin_lowrise_b', 'ruin_lowrise_c', 'ruin_apartment_a', 'ruin_apartment_b']) s[n] = { far: 1200, shadow: true, behind: true };
  for (const n of ['gas_station', 'diner', 'motel', 'warehouse', 'barn_ruin', 'shanty_hut', 'raider_camp_tent', 'watchtower', 'oil_derrick', 'industrial_tanks', 'crane', 'water_tower', 'silo_group', 'banner_skull', 'shipping_container', 'shipping_container_stack3']) s[n] = { ...mid };
  for (const n of ['radio_tower', 'wind_turbine', 'cooling_tower']) s[n] = { ...big, far: 2000 };
  for (const n of ['mesa_a', 'mesa_b']) s[n] = { far: 3200, shadow: false, behind: true };
  for (const n of ['hoodoo_a', 'hoodoo_b', 'natural_arch', 'sea_stack_a', 'sea_stack_b', 'sea_stack_c', 'lighthouse']) s[n] = { far: 2300, shadow: true, behind: true };
  s.wharf_ruin = { ...mid }; s.sign_gas = { far: 400, shadow: true, behind: true };
  s.tire_stack = { far: 240, shadow: false }; s.debris_pile = { far: 280, shadow: true }; s.barrel = { far: 200, shadow: false, lite: true };
  for (const n of ['dam_gate_big', 'dam_control_tower', 'boss_arena_lights', 'floodlight_tower', 'spike_wall', 'spike_gate', 'dam_road_10m', 'dam_wall', 'toll_booth_ruined', 'road_gate']) s[n] = { far: 2500, shadow: true, behind: true };
  s.dam_wall_backdrop = { far: 4500, shadow: false, behind: true };
  return s;
})();


/** Instantiate the placements of the chunk into its lists (+ foundations as extras). */
export function buildLandmarks(ctx, chunk) {
  if (!ctx.lm) ctx.lm = new LandmarkPlanner(ctx);
  const s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  ctx.road.extendTo(s1 + 900);
  // placements can drift up to ~±300 m from the slot that owns them (compounds, turbine rows, arch search): plan a margin, keep what lands here
  const list = ctx.lm.plan(s0 - SLOT_MARGIN, s1 + SLOT_MARGIN);
  if (!list) return false;
  const all = list;
  for (const p of all) {
    if (p.s < s0 || p.s >= s1) continue;
    const tag = `lm:${p.asset}:${Math.round(p.x)}:${Math.round(p.z)}`;
    if (chunk.done.has(tag)) continue;
    chunk.done.add(tag);
    const a = ctx.kit.get(p.asset); if (!a) continue;
    useSpec(ctx, p.asset, LANDMARK_SPECS[p.asset]);
    const t = p.tint || (0.92 + hash2(Math.round(p.x), Math.round(p.z), ctx.seed) * 0.16);
    const sy = p.sy || p.sc;
    chunk.list(p.asset).push(p.x, p.y, p.z, p.yaw, p.sc, sy, p.sc, 0, 1, 0, 0, a.sphere.radius * Math.max(p.sc, sy) * 1.1, t, t, t);
    // collider request for anything a car can reach (within ~70 m of the road centre)
    if (a.collision) {
      const near = ctx.road.nearest(p.x, p.z, p.s, 120, _near);
      if (near.dist - a.radius * p.sc < 70) {
        const id = `static:${p.asset}:${Math.round(p.x)}:${Math.round(p.z)}`; chunk.hooks.push(id);
        ctx.hook({ type: 'static', id, asset: p.asset, pos: [p.x, p.y, p.z], yaw: p.yaw, scale: [p.sc, sy, p.sc], collision: xformMesh(a.collision, p.x, p.y, p.z, p.yaw, p.sc, sy) });
      }
    }
    if (p.found) {
      const b = p.found.box, w = (b.max.x - b.min.x) * p.found.sc + 1.5, d = (b.max.z - b.min.z) * p.found.sc + 1.5, h = p.found.ytop - p.found.ymin;
      const cx = (b.min.x + b.max.x) / 2 * p.found.sc, cz = (b.min.z + b.max.z) / 2 * p.found.sc, cs = Math.cos(p.yaw), sn = Math.sin(p.yaw);
      useSpec(ctx, 'foundation', { far: 1200, shadow: false, behind: true });
      chunk.list('foundation').push(p.x + cx * cs + cz * sn, p.found.ymin, p.z - cx * sn + cz * cs, p.yaw, w, h, d, 0, 1, 0, 0, Math.hypot(w, d) * 0.5);
    }
  }
  chunk.dirty = true;
  return true;
}

/** Every landmark asset a biome may use (for preloading). */
export function landmarkAssets(id) {
  const out = new Set();
  for (const it of (KINDS[id] || { items: [] }).items) for (const q of it.parts) out.add(q.a);
  for (const it of (BACKDROPS[id] || { items: [] }).items) for (const a of it.a) out.add(a);
  if (id === 'city') for (const a of [...RUINS, ...TOWERS, ...CITY_PROPS]) out.add(a);
  if (id === 'coast') for (const a of ['lighthouse', 'wharf_ruin']) out.add(a);
  if (id === 'dam') for (const a of ['dam_gate_big', 'dam_control_tower', 'floodlight_tower', 'banner_skull', 'spike_wall', 'boss_arena_lights', ...GAUNTLET_ASSETS]) out.add(a);
  return [...out];
}

/** Exclusion circles [x, z, r] for scatter within [sA, sB]. Never blocks (returns what is already planned). */
export function landmarkExclusions(ctx, sA, sB) {
  if (!ctx.lm) ctx.lm = new LandmarkPlanner(ctx);
  const out = [];
  const list = ctx.lm.plan(sA - SLOT_MARGIN, sB + SLOT_MARGIN);
  if (!list) return null;
  for (const p of list) if (p.s > sA - p.r - 60 && p.s < sB + p.r + 60) out.push([p.x, p.z, p.r]);
  for (const c of cityExclusions(ctx, sA, sB)) out.push(c);
  for (const c of rockExclusions(ctx, sA, sB)) out.push(c);
  for (const c of momentExclusions(ctx, sA, sB)) out.push(c);
  for (const c of rbFlankExclusions(ctx.road, sA - 40, sB + 40)) out.push(c);
  return out;
}

void clamp; void smoothstep; void terrainPoint; void EDGE; void DAM_START; void BOSS_S; void need;
