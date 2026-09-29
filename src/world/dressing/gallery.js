// Rock-fall / avalanche galleries: half-tunnels hugging the uphill cliff (back wall + roof on the hill side, a colonnade of pillars
// on the valley / lake side), 150-320 m long, with a line of ceiling lights. Driving through one strobes the view of the lake or the
// valley between the pillars. Placed on the lakeside dam road and in the mountains where one side rises steeply; never over a
// ramp / roadblock / bridge / tunnel / overpass. Chunk-streamed: every chunk builds its slice (one facade mesh, one neon mesh,
// one collider set). Clearances: roof >= 7.2 m above the asphalt, pillars / wall >= 11 m from the centre line (shoulder ends at 9.5 m).
import * as THREE from 'three';
import { biomeAt } from '../../data/biomes.js';
import { hash2 } from '../../core/util.js';
import { CHUNK_LEN, groundAt } from './util.js';
import { MB, frameBasis } from './mbuild.js';
import { ST, facadeMaterial, NEON_DOT } from './city_mat.js';

const WANT = [[31900, 'mountain'], [34700, 'mountain'], [37600, 'mountain'], [39400, 'mountain'], [52150, 'dam'], [55350, 'dam']];   // none past the boss spawn (59.3 km): the Leviathan is ~8 m tall
const _G = {};

/** Planned gallery near `want` (or null): {s0, s1, side (+1 = hill on the left)}. Pure; each wanted spot is planned once, lazily. */
function planGallery(ctx, want, biome) {
  const { road, seed } = ctx;
  road.extendTo(want + 1500);
  const len = 160 + Math.round(hash2(Math.round(want), 5, seed) * 4) * 40;
  for (let k = 0; k < 24; k++) {
    const s0 = want + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 45, s1 = s0 + len;
    const b = biomeAt((s0 + s1) / 2); if ((b.w > 0.5 ? b.b : b.a) !== biome) continue;
    if (road.featuresIn(s0 - 60, s1 + 60).some((f) => f.type !== 'guard' && f.type !== 'boost')) continue;
    // the hill side: terrain at 36 m and 55 m must stand well above the road over the whole span
    for (const side of [1, -1]) {
      let ok = true;
      for (let s = s0 - 10; s <= s1 + 10 && ok; s += 24) {
        const ry = road.sample(s, {}).y;
        if (groundAt(road, seed, s, side * 36, _G).y < ry + 14 || groundAt(road, seed, s, side * 55, _G).y < ry + 24) ok = false;
      }
      if (ok) return { s0, s1, side };
    }
  }
  return null;
}
/** Galleries that can touch [sA, sB) (plans only the wanted spots within 2.5 km). */
export function galleriesNear(ctx, sA, sB) {
  const cache = ctx.galleryCache || (ctx.galleryCache = new Map()), out = [];
  for (const [want, biome] of WANT) {
    if (want > sB + 2500 || want < sA - 2500) continue;
    if (!cache.has(want)) cache.set(want, planGallery(ctx, want, biome));
    const g = cache.get(want);
    if (g && g.s1 > sA && g.s0 < sB) out.push(g);
  }
  return out;
}

export function buildGalleries(ctx, chunk) {
  const s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  if (chunk.done.has('gallery')) return true;
  chunk.done.add('gallery');
  const list = galleriesNear(ctx, s0, s1);
  if (!list.length) return true;
  const { road } = ctx;
  const anchor = road.sample(s0, {});
  const mb = new MB(anchor, { uvName: 'aUvF', cap: 2048 }), nb = mb;
  const cols = { pos: [], idx: [] };
  const P = {};
  const at = (s, d, y) => { road.pointAt(s, d, P); return { x: P.x, y: y ?? P.y, z: P.z }; };
  for (const g of list) {
    const a = Math.max(g.s0, s0), b = Math.min(g.s1, s1), side = g.side, vs = -side;
    const STEP = 4;
    for (let s = a; s < b - 0.01; s += STEP) {
      const sb = Math.min(b, s + STEP);
      const ya = road.sample(s, {}).y, yb = road.sample(sb, {}).y;
      const RY0 = 7.25, RY1 = 8.4;
      // roof slab (valley edge -> into the hill)
      const dV = vs * 11.9, dH = side * 13.5;
      const q = [at(s, dV, ya + RY1), at(sb, dV, yb + RY1), at(sb, dH, yb + RY1), at(s, dH, ya + RY1)];
      mb.col(0.5, 0.49, 0.46).setFac(ST.PLAIN, 1, 1, 0.4).setFac2(0, 0, 0, 0);
      mb.quadOut(q[0], q[1], q[2], q[3], 0, 1, 0);
      const u = [at(s, dV, ya + RY0), at(sb, dV, yb + RY0), at(sb, dH, yb + RY0), at(s, dH, ya + RY0)];
      mb.col(0.34, 0.33, 0.31);
      mb.quadOut(u[0], u[1], u[2], u[3], 0, -1, 0);
      // roof fascia on the valley side
      mb.col(0.46, 0.45, 0.42).setFac(ST.DAM, 0, 0, 0.45);
      const nx = -road.sample(s, {}).nx * side, nz = -road.sample(s, {}).nz * side;
      mb.quadOut(at(s, dV, ya + RY0 - 0.6), at(sb, dV, yb + RY0 - 0.6), at(sb, dV, yb + RY1 + 0.5), at(s, dV, ya + RY1 + 0.5), nx, 0, nz, s, 0, sb, 0, sb, 2, s, 2);
      // back wall against the hill (lift lines of cast concrete)
      const gA = groundAt(road, ctx.seed, s, side * 11.3, _G).y, gB = groundAt(road, ctx.seed, sb, side * 11.3, {}).y;
      mb.col(0.52, 0.51, 0.48).setFac(ST.DAM, 0, 0, 0.47);
      mb.quadOut(at(s, side * 11.3, Math.min(gA, ya) - 1), at(sb, side * 11.3, Math.min(gB, yb) - 1), at(sb, side * 11.3, yb + RY0), at(s, side * 11.3, ya + RY0), nx, 0, nz, s, 0, sb, 0, sb, RY0 + 1, s, RY0 + 1);
      boxCol(cols, road, s, sb, side * 11.3, side * 12.3, ya - 1.5, ya + RY1);
      boxCol(cols, road, s, sb, dV, dH, ya + RY0, ya + RY1);
    }
    // valley-side pillars every 8 m + transverse ribs; ceiling lights every 10 m
    const first = Math.ceil(g.s0 / 8) * 8;
    for (let s = first; s <= g.s1; s += 8) {
      if (s < a || s >= b) continue;
      const sm = road.sample(s, {}), ry = sm.y;
      const dP = vs * 11.35, gy = groundAt(road, ctx.seed, s, dP, _G).y;
      // frame: local z points from the pillar toward the road
      const F2 = frameBasis(sm.x + sm.nx * dP, 0, sm.z + sm.nz * dP, [0, 1, 0], [-sm.nx * vs, 0, -sm.nz * vs], {});
      mb.col(0.5, 0.49, 0.46).setFac(ST.DAM, 0, 0, 0.5);
      mb.box(F2, -0.45, 0.45, Math.min(gy, ry) - 2, ry + 7.3, -0.4, 0.45, { vBase: ry });
      mb.box(F2, -0.65, 0.65, ry + 6.4, ry + 7.3, -0.6, 0.9, {});                 // capital
      boxColPt(cols, F2, -0.45, 0.45, Math.min(gy, ry) - 2, ry + 7.3, -0.4, 0.45);
      // transverse rib under the roof
      mb.col(0.36, 0.35, 0.33).setFac(ST.PLAIN, 1, 1, 0.2);
      const R0 = at(s - 0.35, vs * 11.4, ry + 6.9), R1 = at(s + 0.35, vs * 11.4, ry + 6.9), R2 = at(s + 0.35, side * 11.3, ry + 6.9), R3 = at(s - 0.35, side * 11.3, ry + 6.9);
      mb.quadOut(R0, R1, R2, R3, 0, -1, 0);
      mb.quadOut(at(s - 0.35, vs * 11.4, ry + 6.9), at(s - 0.35, side * 11.3, ry + 6.9), at(s - 0.35, side * 11.3, ry + 7.3), at(s - 0.35, vs * 11.4, ry + 7.3), -sm.fx, 0, -sm.fz);
      mb.quadOut(at(s + 0.35, vs * 11.4, ry + 6.9), at(s + 0.35, side * 11.3, ry + 6.9), at(s + 0.35, side * 11.3, ry + 7.3), at(s + 0.35, vs * 11.4, ry + 7.3), sm.fx, 0, sm.fz);
      if (Math.round(s / 8) % 2 === 0) lamp(nb, at(s, side * 3.5, ry + 6.75), (s * 0.013) % 1);
    }
    // portal frames at both ends (thick concrete, hazard-striped edge)
    for (const e of [g.s0, g.s1]) {
      if (e < s0 || e >= s1) continue;
      const sm = road.sample(e, {}), ry = sm.y, dir = e === g.s0 ? -1 : 1;
      mb.col(0.55, 0.54, 0.5).setFac(ST.PLAIN, 1, 1, 0.6);
      for (const [d0, d1, y0, y1] of [[vs * 12.6, side * 14, ry + 7.0, ry + 9.4], [vs * 12.6, vs * 11.0, ry - 2, ry + 9.4]]) {
        const p = [at(e, d0, y0), at(e, d1, y0), at(e, d1, y1), at(e, d0, y1)];
        mb.quadOut(p[0], p[1], p[2], p[3], sm.fx * dir, 0, sm.fz * dir);
      }
      mb.col(0.8, 0.55, 0.05);
      const h = [at(e + dir * 0.02, vs * 9.6, ry + 7.0), at(e + dir * 0.02, side * 11.3, ry + 7.0), at(e + dir * 0.02, side * 11.3, ry + 7.35), at(e + dir * 0.02, vs * 9.6, ry + 7.35)];
      mb.quadOut(h[0], h[1], h[2], h[3], sm.fx * dir, 0, sm.fz * dir);
    }
  }
  if (mb.count) {
    const m = new THREE.Mesh(mb.build(), facadeMaterial());
    m.position.set(anchor.x, anchor.y, anchor.z); m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true; m.matrixAutoUpdate = false; m.updateMatrix(); m.name = 'gallery'; m.userData.far = 1100;
    chunk.addExtra(m);
  }
  if (cols.idx.length) { const id = `gallery:${chunk.c}`; chunk.hooks.push(id); ctx.hook({ type: 'static', id, asset: 'gallery', collision: { pos: new Float32Array(cols.pos), idx: new Uint32Array(cols.idx) } }); }
  chunk.dirty = true;
  return true;
}

/** Warm ceiling light: a flat amber strip facing down. */
function lamp(nb, p, rv) {
  const [u0, v0, u1, v1] = NEON_DOT(2), uc = (u0 + u1) / 2, vc = (v0 + v1) / 2;
  nb.pushFac().setFac(ST.NEON, rv, rv < 0.12 ? 2 : 0, 1.2);
  const w = 1.4, dd = 0.25;
  const a = { x: p.x - w, y: p.y, z: p.z - dd }, b = { x: p.x + w, y: p.y, z: p.z - dd }, c = { x: p.x + w, y: p.y, z: p.z + dd }, d = { x: p.x - w, y: p.y, z: p.z + dd };
  nb.quadOut(a, b, c, d, 0, -1, 0, uc, vc, uc, vc, uc, vc, uc, vc);
  nb.popFac();
}

/** Box collider in road coordinates (s0..s1, d0..d1, y0..y1). */
function boxCol(cols, road, s0, s1, d0, d1, y0, y1) {
  const P = {}, base = cols.pos.length / 3;
  for (const [s, d, y] of [[s0, d0, y0], [s1, d0, y0], [s1, d1, y0], [s0, d1, y0], [s0, d0, y1], [s1, d0, y1], [s1, d1, y1], [s0, d1, y1]]) { road.pointAt(s, d, P); cols.pos.push(P.x, y, P.z); }
  for (const t of [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) cols.idx.push(base + t);
}
function boxColPt(cols, F, x0, x1, y0, y1, z0, z1) {
  const base = cols.pos.length / 3;
  for (const [x, y, z] of [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]) { const p = MB.at(F, x, y, z, {}); cols.pos.push(p.x, p.y, p.z); }
  for (const t of [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]) cols.idx.push(base + t);
}
