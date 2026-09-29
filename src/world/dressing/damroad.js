// The road to the dam (50-66 km): chunk-streamed set dressing that tells you something huge is ahead and keeps the long lakeside
// drive (and the Leviathan chase beyond 60 km) busy: a high-voltage line marching along the left clifftop toward the dam
// (lattice pylons + sagging cables + warning spheres + beacons, one crossing over the road and lake to the dam's powerhouse),
// concrete intake towers standing in the lake with service bridges to the shoulder, rusting half-sunk barges.
// Pure function of (seed, chunk): each chunk builds what is anchored in it into one facade mesh + one neon mesh.
import * as THREE from 'three';
import { DAM_START } from '../../data/biomes.js';
import { hash2, smoothstep } from '../../core/util.js';
import { CHUNK_LEN, groundAt, rngOf } from './util.js';
import { MB, frameBasis, frameYaw } from './mbuild.js';
import { ST, facadeMaterial, NEON_DOT } from './city_mat.js';
import { seaLevel } from '../terrain_gen.js';
import { DAM } from './dam.js';

const S0 = DAM_START + 900, S1 = 66500;
const PYLON_PITCH = 360, PYLON_D = 62;
const CROSS_S = DAM.sA - 260;          // the line turns and crosses the road toward the powerhouse here
const _G = {};

/** Pylon k position (deterministic): s along the road, d on the left clifftop. */
function pylonAt(seed, k) { return { s: k * PYLON_PITCH + (hash2(k, 61, seed) - 0.5) * 60, d: PYLON_D + (hash2(k, 62, seed) - 0.5) * 16 }; }

export function lattice(mb, F, h, w0, w1, panels) {
  const lv = (i) => (h * i) / panels, hw = (y) => w0 + (w1 - w0) * (y / h);
  const C4 = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  for (const [cx, cz] of C4) mb.beam(F, cx * w0, 0, cz * w0, cx * w1, h, cz * w1, 0.45, 0.45);
  for (let i = 0; i < panels; i++) {
    const ya = lv(i), yb = lv(i + 1), a = hw(ya), b = hw(yb);
    for (let k = 0; k < 4; k++) {
      const [x0, z0] = C4[k], [x1, z1] = C4[(k + 1) % 4];
      mb.beam(F, x0 * a, ya, z0 * a, x1 * b, yb, z1 * b, 0.18, 0.18);
      mb.beam(F, x1 * a, ya, z1 * a, x0 * b, yb, z0 * b, 0.18, 0.18);
      if (i % 2 === 0) mb.beam(F, x0 * a, ya, z0 * a, x1 * a, ya, z1 * a, 0.2, 0.2);
    }
  }
}

/** One transmission pylon (46 m) in frame F (local z = along the line). Returns the 4 conductor attachment points (world). */
function pylon(mb, nb, F, rv) {
  mb.col(0.2, 0.21, 0.22).setFac(ST.PLAIN, 1, 1, rv).setFac2(0, 0, 0, 0);
  const H = 40;
  lattice(mb, F, H, 4.2, 1.1, 8);
  // cross arms (x = across the line)
  for (const [y, w] of [[30, 11], [37, 8]]) {
    mb.beam(F, -w, y, 0, w, y, 0, 0.5, 0.9);
    mb.beam(F, -w, y + 0.2, 0, -1.2, y + 3.2, 0, 0.25, 0.25); mb.beam(F, w, y + 0.2, 0, 1.2, y + 3.2, 0, 0.25, 0.25);
  }
  mb.beam(F, 0, H, 0, 0, H + 6, 0, 0.35, 0.35);
  // insulator strings
  mb.col(0.55, 0.52, 0.45);
  const att = [];
  for (const [x, y] of [[-10.5, 30], [10.5, 30], [-7.5, 37], [7.5, 37]]) {
    mb.box(F, x - 0.18, x + 0.18, y - 2.6, y, -0.18, 0.18, {});
    att.push(MB.at(F, x, y - 2.6, 0, {}));
  }
  if (nb) dotAt(nb, MB.at(F, 0, H + 6.3, 0, {}), 0.7, 0, 3, rv);
  return att;
}

export function dotAt(nb, p, size, color, mode, rv) {
  const [u0, v0, u1, v1] = NEON_DOT(color), uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, h = size / 2;
  nb.pushFac().setFac(ST.NEON, rv, mode, 1.6);
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const a = { x: p.x - ax * h, y: p.y - h, z: p.z - az * h }, b = { x: p.x + ax * h, y: p.y - h, z: p.z + az * h };
    const c = { x: b.x, y: p.y + h, z: b.z }, d = { x: a.x, y: p.y + h, z: a.z };
    nb.quadW(a, b, c, d, uc, vc, uc, vc, uc, vc, uc, vc); nb.quadW(d, c, b, a, uc, vc, uc, vc, uc, vc, uc, vc);
  }
  nb.popFac();
}

/** Sagging cable between two world points: a crossed pair of thin ribbons (reads from the side and from below). */
export function cable(mb, a, b, sag, w = 0.16, balls = 0) {
  const n = 12, P = [];
  for (let i = 0; i <= n; i++) { const t = i / n; P.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), z: a.z + (b.z - a.z) * t }); }
  let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const sx = -dz * w, sz = dx * w;
  mb.col(0.07, 0.07, 0.075);
  for (let i = 0; i < n; i++) {
    const p = P[i], q = P[i + 1];
    const A = { x: p.x, y: p.y - w, z: p.z }, B = { x: q.x, y: q.y - w, z: q.z }, C = { x: q.x, y: q.y + w, z: q.z }, D = { x: p.x, y: p.y + w, z: p.z };
    mb.quadW(A, B, C, D, 0, 0, 1, 0, 1, 1, 0, 1); mb.quadW(D, C, B, A, 0, 0, 1, 0, 1, 1, 0, 1);
    const E = { x: p.x - sx, y: p.y, z: p.z - sz }, Fp = { x: q.x - sx, y: q.y, z: q.z - sz }, G = { x: q.x + sx, y: q.y, z: q.z + sz }, H = { x: p.x + sx, y: p.y, z: p.z + sz };
    mb.quadW(E, Fp, G, H, 0, 0, 1, 0, 1, 1, 0, 1); mb.quadW(H, G, Fp, E, 0, 0, 1, 0, 1, 1, 0, 1);
  }
  if (balls) {
    mb.col(0.85, 0.35, 0.06);
    for (let i = 1; i < balls + 1; i++) {
      const t = i / (balls + 1), k = Math.min(n - 1, Math.floor(t * n)), p = P[k];
      const F = frameYaw(p.x, p.y - 0.9, p.z, 0, {});
      mb.box(F, -0.9, 0.9, 0, 1.8, -0.9, 0.9, {});
    }
  }
}

/** Build the dam-road dressing anchored in this chunk. */
export function buildDamRoad(ctx, chunk) {
  const s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  if (s1 < S0 - PYLON_PITCH || s0 > S1 || chunk.done.has('damroad')) return true;
  if (s1 > GAUNTLET_A) for (const n of GAUNTLET_ASSETS) { const st = ctx.kit.state(n); if (st === 'idle') ctx.kit.request(n); if (st === 'idle' || st === 'loading') return false; }
  chunk.done.add('damroad');
  const { road, seed } = ctx;
  road.extendTo(s1 + 800);
  const anchor = road.sample(s0, {});
  const mb = new MB(anchor, { uvName: 'aUvF', cap: 4096 }), nb = mb;
  const water = seaLevel(road, 'dam');
  const cols = { pos: [], idx: [] };
  // ---- high-voltage line on the left clifftop
  for (let k = Math.floor(s0 / PYLON_PITCH) - 1; k <= Math.ceil(s1 / PYLON_PITCH) + 1; k++) {
    const p = pylonAt(seed, k);
    if (p.s < s0 || p.s >= s1 || p.s < S0 || p.s > S1 || (p.s > CROSS_S && p.s < DAM.sB + 200)) continue;
    if (road.featuresIn(p.s - 30, p.s + 30).some((f) => f.type === 'tunnel' || f.type === 'bridge')) continue;
    const q = pylonAt(seed, k + 1);
    const g = groundAt(road, seed, p.s, p.d, _G), gq = groundAt(road, seed, q.s, q.d, {});
    if (g.y < road.sample(p.s, {}).y + 20) continue;                 // only on the high clifftop
    const yaw = Math.atan2(gq.x - g.x, gq.z - g.z);
    const F = frameBasis(g.x, g.y - 0.5, g.z, [0, 1, 0], [Math.sin(yaw), 0, Math.cos(yaw)], {});
    const att = pylon(mb, nb, F, hash2(k, 63, seed));
    mb.col(0.4, 0.39, 0.37).setFac(ST.PLAIN, 1, 1, 0.3);
    for (const [cx, cz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) { const Fp = frameBasis(g.x, g.y - 1.5, g.z, [0, 1, 0], [Math.sin(yaw), 0, Math.cos(yaw)], {}); mb.box(Fp, cx * 4.2 - 0.9, cx * 4.2 + 0.9, 0, 2.2, cz * 4.2 - 0.9, cz * 4.2 + 0.9, {}); }
    // cables to the next pylon (it is deterministic, even if it lives in another chunk)
    const crossing = p.s <= CROSS_S && q.s > CROSS_S;
    if (!crossing && q.s <= S1 && !(q.s > CROSS_S && q.s < DAM.sB + 200) && gq.y > road.sample(q.s, {}).y + 20) {
      const Fq = frameBasis(gq.x, gq.y - 0.5, gq.z, [0, 1, 0], [Math.sin(yaw), 0, Math.cos(yaw)], {});
      const attQ = [[-10.5, 30], [10.5, 30], [-7.5, 37], [7.5, 37]].map(([x, y]) => MB.at(Fq, x, y - 2.6, 0, {}));
      for (let i = 0; i < 4; i++) cable(mb, att[i], attQ[i], 7.5, 0.13, i === 3 && k % 2 ? 3 : 0);
    }
    // the last pylon before the dam carries the line over the road + lake down to the powerhouse roof
    if (crossing) {
      const tgt = road.sample(DAM.sA + 90, {});
      const dst = { x: tgt.x - tgt.nx * 150, z: tgt.z - tgt.nz * 150 };
      for (let i = 0; i < 4; i++) cable(mb, att[i], { x: dst.x + (i - 1.5) * 6, y: water + 38 + (i % 2) * 5, z: dst.z }, 14, 0.14, i === 3 ? 5 : 0);
    }
  }
  // ---- intake towers standing in the lake, with a service bridge to the right shoulder
  for (const sT of [DAM_START + 3400, DAM_START + 6900, 62400, 64800]) {
    if (sT < s0 || sT >= s1) continue;
    if (road.featuresIn(sT - 60, sT + 60).some((f) => f.type !== 'guard' && f.type !== 'boost')) continue;
    const sm = road.sample(sT, {}), dT = -88;
    const c = { x: sm.x + sm.nx * dT, z: sm.z + sm.nz * dT };
    const yTop = sm.y + 14, R = 11;
    const F = frameYaw(c.x, water - 30, c.z, sm.th, {});
    mb.col(0.52, 0.51, 0.48).setFac(ST.DAM, 0, 0, 0.61).setFac2(0, 0, 0, 0);
    mb.cyl(F, 0, 0, 0, yTop - (water - 30), R + 2, R, 18, false, -(water - 30) + water);
    mb.col(0.44, 0.43, 0.41).setFac(ST.PUNCHED, 2.8, 3.5, 0.62).setFac2(0.3, 0, 0.5, 0);
    mb.box(F, -8, 8, yTop - (water - 30), yTop - (water - 30) + 8, -8, 8, { vBase: yTop - (water - 30) });
    mb.col(0.3, 0.3, 0.32).setFac(ST.PLAIN, 1, 1, 0.3);
    mb.box(F, -9, 9, yTop - (water - 30) + 8, yTop - (water - 30) + 8.6, -9, 9, {});
    mb.box(F, -1, 1, yTop - (water - 30) + 8.6, yTop - (water - 30) + 20, -1, 1, {});
    dotAt(nb, MB.at(F, 0, yTop - (water - 30) + 20.4, 0, {}), 0.8, 0, 3, 0.3);
    // truss bridge from the tower to the shoulder (deck at road level - 1, ends 13 m right of the centre line)
    const e = road.pointAt(sT, -13.5, {}), yD = sm.y - 0.8;
    const A = { x: c.x + (e.x - c.x) * (R / Math.hypot(e.x - c.x, e.z - c.z)), z: c.z + (e.z - c.z) * (R / Math.hypot(e.x - c.x, e.z - c.z)) };
    const len = Math.hypot(e.x - A.x, e.z - A.z), dir = [(e.x - A.x) / len, 0, (e.z - A.z) / len];
    const Fb = frameBasis(A.x, yD, A.z, [0, 1, 0], dir, {});
    mb.col(0.46, 0.34, 0.14).setFac(ST.PLAIN, 1, 1, 0.5);
    mb.box(Fb, -2.2, 2.2, -0.6, 0, 0, len, {});
    for (const x of [-2.2, 2.2]) {
      mb.beam(Fb, x, 0, 0, x, 0, len, 0.3, 0.3); mb.beam(Fb, x, 3, 0, x, 3, len, 0.3, 0.3);
      for (let i = 0; i < len / 4; i++) mb.beam(Fb, x, 0, i * 4, x, 3, i * 4 + 4, 0.18, 0.18);
    }
    // piers down to the water
    mb.col(0.45, 0.44, 0.42).setFac(ST.DAM, 0, 0, 0.3);
    for (let i = 1; i < 3; i++) mb.box(Fb, -1.4, 1.4, water - 10 - yD, -0.6, (len * i) / 3 - 1.4, (len * i) / 3 + 1.4, {});
  }
  // ---- half-sunk barges and a crane barge near the shore
  for (let k = Math.floor(s0 / 1300); k <= Math.floor(s1 / 1300); k++) {
    const sB = k * 1300 + hash2(k, 71, seed) * 400;
    if (sB < s0 || sB >= s1 || sB < S0 || sB > S1 || Math.abs(sB - (DAM.sA + DAM.sB) / 2) < 1100) continue;
    const sm = road.sample(sB, {}), d = -(55 + hash2(k, 72, seed) * 60);
    const F = frameBasis(sm.x + sm.nx * d, water, sm.z + sm.nz * d, [Math.sin(0.14), Math.cos(0.14), 0], [Math.sin(sm.th + hash2(k, 73, seed)), 0, Math.cos(sm.th + hash2(k, 73, seed))], {});
    mb.col(0.34, 0.2, 0.12).setFac(ST.PLAIN, 1, 1, 0.8);
    mb.box(F, -5, 5, -2.5, 2.2, -18, 18, {});
    mb.box(F, -4.6, 4.6, 2.2, 2.6, -17.6, 17.6, {});
    if (hash2(k, 74, seed) < 0.5) { mb.col(0.5, 0.4, 0.1); mb.box(F, -2, 2, 2.6, 7, 8, 13, {}); mb.beam(F, 0, 7, 10, 0, 22, -6, 0.8, 0.8); }
    else { mb.col(0.18, 0.18, 0.2); mb.box(F, -3, 3, 2.6, 6.5, -16, -9, {}); }
  }
  gauntlet(ctx, chunk, mb, cols, water);
  if (mb.count) {
    const m = new THREE.Mesh(mb.build(), facadeMaterial());
    m.position.set(anchor.x, anchor.y, anchor.z); m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true;
    m.matrixAutoUpdate = false; m.updateMatrix(); m.name = 'damroad'; m.userData.far = 1500;
    chunk.addExtra(m);
  }
  if (cols.idx.length) { const id = `damroad:${chunk.c}`; chunk.hooks.push(id); ctx.hook({ type: 'static', id, asset: 'damroad', collision: { pos: new Float32Array(cols.pos), idx: new Uint32Array(cols.idx) } }); }
  chunk.dirty = true;
  return true;
}

// ------------------------------------------------------------------------------------------------ the Leviathan's gauntlet
// From the boss spawn onward the lakeside road is the war-train's territory: burning wrecks on the shoulders, raider watchtowers,
// banner poles and floodlights on the cliff side, burning oil slicks and sunken boats on the lake with smoke columns rising into
// the dawn sky. All instanced (dressing pool) + a few facade-mesh pieces. Nothing within |d| < 10.3 m (road + shoulders).
const GAUNTLET_A = 59350, GAUNTLET_B = 72000;
export const GAUNTLET_ASSETS = ['wreck_sedan', 'wreck_pickup', 'wreck_van', 'wreck_flipped', 'wreck_bus', 'watchtower', 'banner_skull', 'floodlight_tower', 'spike_wall'];
const G_SPEC = { far: 900, shadow: true, behind: true, mergeNear: 22 };

function placeGlb(ctx, chunk, cols, name, s, d, yaw, sc = 1, tint = 1) {
  const a = ctx.kit.get(name); if (!a) return;
  const g = groundAt(ctx.road, ctx.seed, s, d, _G);
  ctx.pool.register(name, G_SPEC);
  chunk.list(name).push(g.x, g.y - 0.08, g.z, yaw, sc, sc, sc, 0, 1, 0, 0, a.sphere.radius * sc, tint, tint * 0.95, tint * 0.9);
  if (cols && a.collision) {
    const c = Math.cos(yaw), sn = Math.sin(yaw), src = a.collision.pos, base = cols.pos.length / 3;
    for (let i = 0; i < src.length; i += 3) cols.pos.push(g.x + (src[i] * c + src[i + 2] * sn) * sc, g.y - 0.08 + src[i + 1] * sc, g.z + (-src[i] * sn + src[i + 2] * c) * sc);
    for (const k of a.collision.idx) cols.idx.push(base + k);
  }
}
function fire(ctx, chunk, x, y, z, w, h) {
  ctx.pool.register('fx_flame', { far: 1400, shadow: false });
  chunk.list('fx_flame').push(x, y, z, (x * 0.37) % 6.28, w, h, w, 0, 1, 0, 0, h);
}
function smoke(ctx, chunk, x, y, z, w, h) {
  ctx.pool.register('fx_smoke', { far: 3200, shadow: false });
  chunk.list('fx_smoke').push(x, y, z, 0, w, h, w, 0, 1, 0, 0, h + 60);
}

function gauntlet(ctx, chunk, mb, cols, water) {
  const s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  if (s1 < GAUNTLET_A || s0 > GAUNTLET_B) return;
  const { road, seed } = ctx, P = {};
  const r = rngOf(seed, chunk.c, 7707);
  const blocked = (s) => road.featuresIn(s - 30, s + 30).some((f) => f.type !== 'guard' && f.type !== 'boost');
  // burning wrecks on the shoulders (both sides), one or two per chunk
  const nW = 1 + (r() < 0.6 ? 1 : 0);
  for (let i = 0; i < nW; i++) {
    const s = s0 + (i + 0.2 + r() * 0.6) * CHUNK_LEN / nW, side = r() < 0.55 ? 1 : -1;
    if (blocked(s)) continue;
    const name = ['wreck_sedan', 'wreck_pickup', 'wreck_van', 'wreck_flipped'][Math.floor(r() * 4)], a = ctx.kit.get(name); if (!a) continue;
    const psi = (r() - 0.5) * 1.2, ext = Math.abs(Math.sin(psi)) * a.size.z / 2 + Math.abs(Math.cos(psi)) * a.size.x / 2, d = side * (10.6 + ext + r() * 2.5);
    placeGlb(ctx, chunk, cols, name, s, d, road.sample(s, {}).th + psi, 1, 0.45);
    road.pointAt(s, d, P); const gy = groundAt(road, seed, s, d, _G).y;
    fire(ctx, chunk, P.x, gy + 0.6, P.z, 2.6 + r(), 3.2 + r() * 1.5);
    if (r() < 0.5) smoke(ctx, chunk, P.x, gy + 2, P.z, 3.5, 45 + r() * 30);
  }
  // cliff side (left): watchtowers, banner poles, floodlight towers
  if (r() < 0.45) { const s = s0 + r() * CHUNK_LEN; if (!blocked(s)) placeGlb(ctx, chunk, cols, 'banner_skull', s, 13 + r() * 1.5, road.sample(s, {}).th + Math.PI + 0.3, 1.15); }
  if (r() < 0.22) { const s = s0 + r() * CHUNK_LEN; if (!blocked(s)) placeGlb(ctx, chunk, cols, 'watchtower', s, 16 + r() * 6, road.sample(s, {}).th - Math.PI / 2, 1.1); }
  if (chunk.c % 6 === 0) {
    const s = s0 + 48; if (!blocked(s)) { const d = 15.5, c = road.pointAt(s + 20, 0, {}); road.pointAt(s, d, P); placeGlb(ctx, chunk, cols, 'floodlight_tower', s, d, Math.atan2(c.x - P.x, c.z - P.z)); }
  }
  // spiked barricades lining the lake-side shoulder (outside the rail)
  if (r() < 0.35) { const s = s0 + r() * CHUNK_LEN; if (!blocked(s)) placeGlb(ctx, chunk, cols, 'spike_wall', s, -(12 + r() * 2), road.sample(s, {}).th + (r() - 0.5) * 0.4); }
  // the lake: burning oil slicks + a sunken boat now and then, smoke columns
  const besideDam = s1 > DAM.sA - 250 && s0 < DAM.sB + 150;          // the dam's own jets + mist own that stretch of water
  if (r() < 0.55 && !besideDam) {
    const s = s0 + r() * CHUNK_LEN, d = -(60 + r() * 200), sm = road.sample(s, {});
    const cx = sm.x + sm.nx * d, cz = sm.z + sm.nz * d;
    if (groundAt(road, seed, s, d, _G).y < water - 3) {
      const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) { const a = r() * 6.28, rr = r() * 14; fire(ctx, chunk, cx + Math.cos(a) * rr, water - 0.2, cz + Math.sin(a) * rr, 4 + r() * 4, 3 + r() * 5); }
      smoke(ctx, chunk, cx, water + 2, cz, 10 + r() * 6, 110 + r() * 80);
    }
  }
}

void smoothstep;
