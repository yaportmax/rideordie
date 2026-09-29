// THE DAM (58.6-60.5 km): a colossal concrete arch dam closing a side valley on the right of the road. The road runs along the
// tailwater lake at its foot, ~90-200 m from the downstream face; the crest towers ~105 m above the road (~150 m above the water).
// Spillway with radial gates + chutes + ski-jump flip buckets throwing water arcs into the lake, mid-face outlet jets, a powerhouse
// at the toe with penstocks, crest gantry cranes, lamps, raider war banners, rock abutments (terrain material) and the reservoir
// behind. Built once (time-sliced generator) when the player approaches; a handful of draw calls (shared city materials).
import * as THREE from 'three';
import { MB, frameBasis } from './mbuild.js';
import { ST, facadeMaterial, neonMaterial, NEON_DOT } from './city_mat.js';
import { flowMaterial, mistMaterial, bannerMaterial, reservoirMaterial } from './setmat.js';
import { seaLevel } from '../terrain_gen.js';
import { rng, fbm2, smoothstep } from '../../core/util.js';
import { gridMesh } from './features.js';
import { makeBuilding, emitBuilding } from './city.js';

export const DAM = { sA: 58650, sB: 60500, off: 85, sag: 170, crest: 118 };

/** Arc of the dam axis (downstream crest edge) in world xz; n = unit normal toward the road (downstream). */
export function damArc(road) {
  road.extendTo(DAM.sB + 1200);
  const a = road.sample(DAM.sA, {}), b = road.sample(DAM.sB, {});
  const E0 = { x: a.x - a.nx * DAM.off, z: a.z - a.nz * DAM.off }, E1 = { x: b.x - b.nx * DAM.off, z: b.z - b.nz * DAM.off };
  let tx = E1.x - E0.x, tz = E1.z - E0.z; const c = Math.hypot(tx, tz); tx /= c; tz /= c;
  // away-from-road direction w: perpendicular to the chord, on the side of the dam (right of the road)
  const mid = road.sample((DAM.sA + DAM.sB) / 2, {});
  let wx = -tz, wz = tx; if (wx * -mid.nx + wz * -mid.nz < 0) { wx = -wx; wz = -wz; }
  const h = DAM.sag, R = (c * c / 4 + h * h) / (2 * h), phi0 = Math.asin(c / 2 / R);
  const M = { x: (E0.x + E1.x) / 2, z: (E0.z + E1.z) / 2 }, O = { x: M.x + wx * (h - R), z: M.z + wz * (h - R) };
  let yRoad = 0; for (let s = DAM.sA; s <= DAM.sB; s += 50) yRoad += road.sample(s, {}).y; yRoad /= Math.floor((DAM.sB - DAM.sA) / 50) + 1;
  const arc = {
    R, phi0, O, wx, wz, tx, tz, L: 2 * phi0 * R, yRoad, Yc: yRoad + DAM.crest, water: seaLevel(road, 'dam'),
    at(t, out = {}) {
      const ph = -phi0 + 2 * phi0 * t, cs = Math.cos(ph), sn = Math.sin(ph);
      const ux = wx * cs + tx * sn, uz = wz * cs + tz * sn;           // radial (away from the road)
      out.x = O.x + R * ux; out.z = O.z + R * uz; out.nx = -ux; out.nz = -uz;
      // tangent along +t: d/dph of radial = (-wx sn + tx cs, -wz sn + tz cs)
      out.tx = -wx * sn + tx * cs; out.tz = -wz * sn + tz * cs;
      return out;
    },
  };
  return arc;
}

// downstream face profile: offset o (m toward the road from the crest line) at depth D below the crest
const faceO = (D) => (D <= 12 ? 0 : 0.2 * (D - 12) + 0.0011 * (D - 12) * (D - 12));
const faceSlope = (D) => (D <= 12 ? 0 : 0.2 + 0.0022 * (D - 12));

/** Generator: builds the dam, yielding between parts. add(mesh) receives finished meshes (world-anchored). */
export function* buildDam(ctx, add, getTerrainMat) {
  const road = ctx.road, arc = damArc(road), r = rng(ctx.seed * 31 + 7);
  const { Yc, water, L } = arc;
  const anchor = arc.at(0.5, {}); anchor.y = 0;
  const mb = new MB(anchor, { uvName: 'aUvF', cap: 16384 }), nb = new MB(anchor, { cap: 1024 });
  const fb = new MB(anchor, { cap: 4096 }), mist = new MB(anchor, { cap: 512 }), ban = new MB(anchor, { cap: 1024 });
  const C = {}, C2 = {}, P = [{}, {}, {}, {}];
  const pt = (t, o, y, out) => { arc.at(t, C); out.x = C.x + C.nx * o; out.y = y; out.z = C.z + C.nz * o; return out; };
  const base = water - 24, Dwater = Yc - water;
  const concrete = [0.5, 0.49, 0.465];
  const NT = 280;
  const SPILL = [0.43, 0.57];
  // ---------------------------------------------------------------- 1. downstream face (smooth sweep)
  const rows = [-1.3, 0, 6, 12, 20, 30, 42, 56, 72, 90, 110, 128, Dwater - 6, Dwater, Yc - base];
  mb.col(...concrete).setFac(ST.DAM, 0, 0, 0.31).setFac2(0, 0, 0, 0);
  for (let part = 0; part < 4; part++) {
    const i0 = Math.floor(NT * part / 4), i1 = Math.floor(NT * (part + 1) / 4);
    const b0 = mb.count;
    for (let i = i0; i <= i1; i++) {
      const t = i / NT; arc.at(t, C);
      for (const D of rows) {
        const o = D < 0 ? 0 : faceO(D), y = Yc - D, sl = D < 0 ? 0 : faceSlope(D);
        const l = Math.hypot(1, sl);
        mb.vert(C.x + C.nx * o, y, C.z + C.nz * o, C.nx / l, sl / l, C.nz / l, t * L, y - water);
      }
    }
    const nr = rows.length;
    // winding check against the outward normal of the first quad
    arc.at(i0 / NT, C);
    const flip = windOut(mb, b0, b0 + nr, b0 + nr + 1, b0 + 1, C.nx, 0, C.nz);
    for (let i = 0; i < i1 - i0; i++) for (let j = 0; j < nr - 1; j++) {
      const a = b0 + i * nr + j, b = a + nr, c = b + 1, d = a + 1;
      if (flip) mb.quadIdx(d, c, b, a); else mb.quadIdx(a, b, c, d);
    }
    yield;
  }
  // ---------------------------------------------------------------- 2. crest: parapets, deck, upstream face
  const crestProf = [[0, Yc + 1.3], [-0.6, Yc + 1.3], [-0.6, Yc], [-13.4, Yc], [-13.4, Yc + 1.3], [-14, Yc + 1.3], [-14, Yc - 60]];
  mb.col(...concrete.map((v) => v * 0.92)).setFac(ST.PLAIN, 1, 1, 0.2);
  for (let i = 0; i < NT; i++) {
    const ta = i / NT, tb = (i + 1) / NT;
    for (let k = 0; k < crestProf.length - 1; k++) {
      const [oa, ya] = crestProf[k], [ob, yb] = crestProf[k + 1];
      pt(ta, oa, ya, P[0]); pt(tb, oa, ya, P[1]); pt(tb, ob, yb, P[2]); pt(ta, ob, yb, P[3]);
      // outward: rotate the profile segment (in the n-y plane) by -90 deg -> normal = (dy, -do) in (n, y)
      arc.at((ta + tb) / 2, C2);
      const dn = yb - ya, dyy = -(ob - oa);
      mb.quadOut(P[0], P[1], P[2], P[3], C2.nx * dn, dyy, C2.nz * dn, ta * L, ya, tb * L, ya, tb * L, yb, ta * L, yb);
    }
  }
  yield;
  // ---------------------------------------------------------------- 3. spillway: piers, radial gates, chutes, flip buckets, jets
  const nBays = 12, sp0 = SPILL[0], sp1 = SPILL[1];
  const pierT = [], half = 2.2;
  for (let k = 0; k <= nBays; k++) pierT.push(sp0 + (sp1 - sp0) * k / nBays);
  const Dgate = 18, Dbucket = Dwater - 24;
  for (let k = 0; k <= nBays; k++) {
    const t = pierT[k]; arc.at(t, C);
    const F = frameBasis(C.x, 0, C.z, [0, 1, 0], [C.nx, 0, C.nz], {});
    mb.col(...concrete.map((v) => v * 0.97)).setFac(ST.DAM, 0, 0, 0.5);
    mb.box(F, -half, half, Yc - 34, Yc + 7, -15, 9, { vBase: water });          // pier / buttress
    mb.box(F, -half - 0.6, half + 0.6, Yc + 7, Yc + 9.5, -15, 9.5, { vBase: water });
    // chute training wall down the face (every 3rd pier)
    if (k % 3 === 0) {
      mb.col(...concrete.map((v) => v * 0.9)).setFac(ST.DAM, 0, 0, 0.6);
      for (let D = 34; D < Dbucket; D += 10) {
        const D2 = Math.min(Dbucket, D + 10);
        const oa = faceO(D), ob = faceO(D2);
        mb.box(F, -0.7, 0.7, Yc - D2, Yc - D + 4, ob - 1, oa + 3.2, { vBase: water, topY: [Yc - D + 4, Yc - D + 4, Yc - D2 + 4, Yc - D2 + 4] });
      }
    }
  }
  // bridge deck across the piers (the crest road)
  mb.col(0.42, 0.41, 0.4).setFac(ST.PLAIN, 1, 1, 0.3);
  for (let i = 0; i < 40; i++) {
    const ta = sp0 + (sp1 - sp0) * i / 40, tb = sp0 + (sp1 - sp0) * (i + 1) / 40;
    for (const [oa, ob, y0, y1] of [[9.5, -15, Yc + 9.5, Yc + 9.5]]) {
      pt(ta, oa, y0, P[0]); pt(tb, oa, y0, P[1]); pt(tb, ob, y1, P[2]); pt(ta, ob, y1, P[3]);
      mb.quadOut(P[0], P[1], P[2], P[3], 0, 1, 0);
    }
    pt(ta, 9.5, Yc + 9.5, P[0]); pt(tb, 9.5, Yc + 9.5, P[1]); pt(tb, 9.5, Yc + 7, P[2]); pt(ta, 9.5, Yc + 7, P[3]);
    arc.at(ta, C2); mb.quadOut(P[0], P[1], P[2], P[3], C2.nx, 0, C2.nz);
  }
  // radial gates (dark steel) between the piers; some raised with water roaring out underneath
  for (let k = 0; k < nBays; k++) {
    const ta = pierT[k], tb = pierT[k + 1], tm = (ta + tb) / 2; arc.at(tm, C);
    const F = frameBasis(C.x, 0, C.z, [0, 1, 0], [C.nx, 0, C.nz], {});
    const bw = (tb - ta) * L / 2 - half;
    const open = k % 4 === 1 || k % 4 === 2 ? 5 + r() * 4 : 0;
    mb.col(0.2, 0.17, 0.14).setFac(ST.PLAIN, 1, 1, 0.8);
    mb.box(F, -bw, bw, Yc - Dgate + open, Yc - 3 + open, 3.5, 4.4, {});
    for (let j = 0; j < 4; j++) mb.box(F, -bw, bw, Yc - Dgate + open + j * 4, Yc - Dgate + open + j * 4 + 0.35, 4.4, 4.9, {});
    // chute water: from under the gate, down the face to the bucket, then the ski-jump arc into the lake
    if (open > 0) {
      const sw = bw * 2 - 0.6;
      flowSheet(fb, arc, tm, sw, (D) => faceO(D) + 0.5, Yc - Dgate, Dgate, Dbucket, 16, 0.92, 0.1, r());
      jetArc(fb, mist, arc, tm, sw, faceO(Dbucket) + 14, Yc - Dbucket + 6, 30, 0.55, water, 26, r());
    }
  }
  // flip bucket lip under the whole spillway
  mb.col(...concrete.map((v) => v * 0.95)).setFac(ST.DAM, 0, 0, 0.7);
  for (let i = 0; i < 24; i++) {
    const ta = sp0 + (sp1 - sp0) * i / 24, tb = sp0 + (sp1 - sp0) * (i + 1) / 24;
    const prof = [[faceO(Dbucket), Yc - Dbucket], [faceO(Dbucket) + 8, Yc - Dbucket - 3], [faceO(Dbucket) + 14, Yc - Dbucket + 6], [faceO(Dbucket) + 16, Yc - Dbucket + 6], [faceO(Dbucket) + 16, water - 4]];
    for (let k = 0; k < prof.length - 1; k++) {
      const [oa, ya] = prof[k], [ob, yb] = prof[k + 1];
      pt(ta, oa, ya, P[0]); pt(tb, oa, ya, P[1]); pt(tb, ob, yb, P[2]); pt(ta, ob, yb, P[3]);
      arc.at((ta + tb) / 2, C2); const dn = yb - ya, dyy = -(ob - oa);
      mb.quadOut(P[0], P[1], P[2], P[3], C2.nx * dn, dyy, C2.nz * dn, ta * L, ya - water, tb * L, ya - water, tb * L, yb - water, ta * L, yb - water);
    }
  }
  yield;
  // ---------------------------------------------------------------- 4. mid-face outlet jets
  for (const t of [0.29, 0.34, 0.66, 0.71]) {
    const D = 76, o = faceO(D); arc.at(t, C);
    const F = frameBasis(C.x, 0, C.z, [0, 1, 0], [C.nx, 0, C.nz], {});
    mb.col(0.45, 0.44, 0.42).setFac(ST.DAM, 0, 0, 0.4);
    mb.box(F, -5, 5, Yc - D - 5, Yc - D + 5, o - 2, o + 3.5, { vBase: water });       // outlet hood
    mb.col(0.03, 0.03, 0.03).setFac(ST.PLAIN, 1, 1, 0.1);
    mb.box(F, -3.2, 3.2, Yc - D - 3.4, Yc - D + 3.4, o + 3.5, o + 3.6, {});             // dark mouth
    jetArc(fb, mist, arc, t, 7.5, o + 3.6, Yc - D, 24, 0.05, water, 22, r());
  }
  yield;
  // ---------------------------------------------------------------- 5. powerhouse at the toe + penstocks + tailrace
  const ph0 = 0.1, ph1 = 0.27, oToe = faceO(Dwater), oFront = oToe + 36, yRoof = water + 30;
  mb.col(0.5, 0.48, 0.44).setFac(ST.INDUSTRIAL, 7.5, 7.5, 0.77).setFac2(0.45, 0, 0.35, 0);
  const NP = 36;
  for (let i = 0; i < NP; i++) {
    const ta = ph0 + (ph1 - ph0) * i / NP, tb = ph0 + (ph1 - ph0) * (i + 1) / NP;
    arc.at((ta + tb) / 2, C2);
    // front facade (windows), roof
    pt(ta, oFront, water - 3, P[0]); pt(tb, oFront, water - 3, P[1]); pt(tb, oFront, yRoof, P[2]); pt(ta, oFront, yRoof, P[3]);
    mb.quadOut(P[0], P[1], P[2], P[3], C2.nx, 0, C2.nz, ta * L, -3, tb * L, -3, tb * L, yRoof - water, ta * L, yRoof - water);
    mb.setFac(ST.PLAIN, 1, 1, 0.7);
    pt(ta, oFront, yRoof, P[0]); pt(tb, oFront, yRoof, P[1]); pt(tb, oToe - 10, yRoof, P[2]); pt(ta, oToe - 10, yRoof, P[3]);
    mb.quadOut(P[0], P[1], P[2], P[3], 0, 1, 0);
    mb.setFac(ST.INDUSTRIAL, 7.5, 7.5, 0.77);
  }
  for (const t of [ph0, ph1]) {           // end walls
    arc.at(t, C2);
    pt(t, oToe - 10, water - 3, P[0]); pt(t, oFront, water - 3, P[1]); pt(t, oFront, yRoof, P[2]); pt(t, oToe - 10, yRoof, P[3]);
    mb.quadOut(P[0], P[1], P[2], P[3], C2.tx * (t === ph0 ? -1 : 1), 0, C2.tz * (t === ph0 ? -1 : 1), 0, -3, 46, -3, 46, yRoof - water, 0, yRoof - water);
  }
  // roof: transformers, switchgear, a gantry crane
  for (let i = 0; i < 9; i++) {
    const t = ph0 + (ph1 - ph0) * (i + 0.5) / 9; arc.at(t, C);
    const F = frameBasis(C.x, 0, C.z, [0, 1, 0], [C.nx, 0, C.nz], {});
    mb.col(0.26, 0.28, 0.27).setFac(ST.PLAIN, 1, 1, 0.1 * i);
    mb.box(F, -3, 3, yRoof, yRoof + 5, oFront - 12, oFront - 5, {});
    mb.box(F, -3.4, 3.4, yRoof + 5, yRoof + 5.4, oFront - 12.4, oFront - 4.6, {});
    for (const zz of [-10, -7]) mb.cyl(F, 0, oFront + zz, yRoof + 5.4, yRoof + 8.5, 0.35, 0.25, 6, true);
  }
  // penstocks hugging the face down into the powerhouse, with anchor blocks and stiffener rings
  for (let i = 0; i < 6; i++) {
    const t = ph0 + (ph1 - ph0) * (i + 0.5) / 6;
    const D0 = 52, D1 = Yc - yRoof + 1, nSeg = 5;
    let prev = null;
    for (let k = 0; k <= nSeg; k++) {
      const D = D0 + (D1 - D0) * k / nSeg, p = pt(t, faceO(D) + 3.3, Yc - D, {});
      if (prev) { mb.col(0.34, 0.24, 0.18).setFac(ST.PLAIN, 1, 1, 0.66); mb.tubeW(prev, p, 3.0, 12, k === nSeg); }
      arc.at(t, C);
      const F = frameBasis(p.x, 0, p.z, [0, 1, 0], [C.nx, 0, C.nz], {});
      mb.col(0.46, 0.45, 0.42).setFac(ST.DAM, 0, 0, 0.3);
      if (k === 2 || k === 4) mb.box(F, -4.2, 4.2, p.y - 4.5, p.y + 3.5, -3.5, 2.5, { vBase: water });
      prev = p;
    }
    // intake housing where the pipe leaves the dam
    const top = pt(t, faceO(D0) + 1, Yc - D0 + 1, {}), F = frameBasis(top.x, 0, top.z, [0, 1, 0], [C.nx, 0, C.nz], {});
    mb.col(0.5, 0.49, 0.46).setFac(ST.DAM, 0, 0, 0.35); mb.box(F, -4.5, 4.5, top.y - 5, top.y + 4, -3, 3, { vBase: water });
  }
  // tailrace foam in front of the powerhouse + mist
  for (let i = 0; i < 5; i++) {
    const t = ph0 + (ph1 - ph0) * (i + 0.5) / 5;
    foamPatch(fb, arc, t, 34, oFront, oFront + 45, water + 0.12, r());
    puff(mist, pt(t, oFront + 10 + r() * 20, water + 6, {}), 16 + r() * 8, 0.18, r());
  }
  yield;
  // ---------------------------------------------------------------- 6. crest furniture: lamps, gantry cranes, control buildings, beacons
  const lampT = [];
  for (let s = 12; s < L - 12; s += 42) lampT.push(s / L);
  mb.col(0.18, 0.18, 0.2).setFac(ST.PLAIN, 1, 1, 0.9);
  for (const t of lampT) {
    if (t > sp0 - 0.004 && t < sp1 + 0.004) continue;
    arc.at(t, C);
    const F = frameBasis(C.x, 0, C.z, [0, 1, 0], [C.nx, 0, C.nz], {});
    mb.box(F, -0.15, 0.15, Yc + 1.3, Yc + 9, -0.45, -0.15, {});
    mb.box(F, -0.1, 0.1, Yc + 8.7, Yc + 9, -0.4, 1.8, {});
    dot(nb, F, 0, Yc + 8.55, 1.6, 0.9, 1, 0, r());
  }
  for (const t of [0.455, 0.545]) {                     // gantry cranes straddling the crest road over the spillway bridge
    arc.at(t, C); const F = frameBasis(C.x, 0, C.z, [0, 1, 0], [C.nx, 0, C.nz], {});
    mb.col(0.52, 0.38, 0.1).setFac(ST.PLAIN, 1, 1, 0.4);
    const y0 = Yc + 9.5, H = 34;
    for (const x of [-5, 5]) for (const z of [8.5, -14]) mb.beam(F, x, y0, z, x * 0.55, y0 + H, z > 0 ? 3 : -8.5, 1.4, 1.4);
    mb.box(F, -9, 9, y0 + H - 1, y0 + H + 2.4, -10, 5, {});
    mb.box(F, -9, 9, y0 + H + 2.4, y0 + H + 2.8, -10.4, 5.4, {});
    mb.col(0.2, 0.2, 0.22); mb.box(F, -3, 3, y0 + H + 2.8, y0 + H + 6.5, -5, 1, {});
    mb.beam(F, 2, y0 + H - 1, 3.5, 2, y0 + 6, 3.5, 0.12, 0.12);
    dot(nb, F, 9.2, y0 + H + 2.6, 5.6, 0.8, 0, 3, r()); dot(nb, F, -9.2, y0 + H + 2.6, -10.6, 0.8, 0, 3, r());
  }
  // control towers on the crest (the raiders' lookouts): they break the skyline, visible from far down the valley
  for (const [t, floors] of [[0.2, 6], [0.8, 5], [0.34, 3], [0.66, 3]]) {
    arc.at(t, C);
    const b = makeBuilding(r, 'commercial', 'B', 0, 1, 0, floors > 3 ? 18 : 12, 11, r());
    Object.assign(b, { floors, flh: 3.6, gh: 0, style: ST.PUNCHED, top: 0, setback: false, tank: false, antenna: floors > 3, beacon: floors > 3, lit: 0.35, dmg: 0.5, col: [0.47, 0.46, 0.44] });
    const fr = { x: C.x - C.nx * 7, z: C.z - C.nz * 7, yaw: Math.atan2(C.nx, C.nz) };
    emitBuilding(mb, nb, null, b, fr, Yc, Yc, r);
  }
  yield;
  // ---------------------------------------------------------------- 7. raider war banners draped over the face
  for (const t of [0.36, 0.64, 0.24, 0.77]) {
    const W = 22, D0 = 1.5, D1 = t > 0.3 && t < 0.7 ? 88 : 64;
    const nu = 4, nv = 14, b0 = ban.count;
    for (let j = 0; j <= nv; j++) {
      const D = D0 + (D1 - D0) * j / nv, o = faceO(D) + 0.35, y = Yc + 1.3 - D;
      for (let i = 0; i <= nu; i++) {
        const tt = t + ((i / nu - 0.5) * W) / L; arc.at(tt, C);
        ban.setFac(j / nv, t * 7, 0, 0);
        const sl = faceSlope(D), l = Math.hypot(1, sl);
        ban.vert(C.x + C.nx * o, y, C.z + C.nz * o, C.nx / l, sl / l, C.nz / l, i / nu, 1 - j / nv);
      }
    }
    arc.at(t, C);
    const flip = windOut(ban, b0, b0 + 1, b0 + nu + 2, b0 + nu + 1, C.nx, 0, C.nz);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = b0 + j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
      if (flip) ban.quadIdx(d, c, b, a); else ban.quadIdx(a, b, c, d);
    }
  }
  // ---------------------------------------------------------------- 8. log boom (orange floats) across the tailwater
  mb.col(0.75, 0.32, 0.08).setFac(ST.PLAIN, 1, 1, 0.5);
  for (let i = 0; i < 90; i++) {
    const t = 0.05 + 0.9 * i / 90; arc.at(t, C);
    const F = frameBasis(C.x + C.nx * (oToe + 58 + 8 * Math.sin(t * 9)), 0, C.z + C.nz * (oToe + 58 + 8 * Math.sin(t * 9)), [0, 1, 0], [C.tx, 0, C.tz], {});
    mb.box(F, -0.6, 0.6, water - 0.2, water + 0.55, -3.2, 3.2, {});
  }
  // ---------------------------------------------------------------- 9. reservoir behind the dam
  const res = new MB(anchor, { fac: false, cap: 64 });
  for (let i = 0; i < 16; i++) {
    const ta = -0.2 + 1.4 * i / 16, tb = -0.2 + 1.4 * (i + 1) / 16;
    pt(ta, -14, Yc - 6, P[0]); pt(tb, -14, Yc - 6, P[1]); pt(tb, -1600, Yc - 6, P[2]); pt(ta, -1600, Yc - 6, P[3]);
    res.quadOut(P[0], P[1], P[2], P[3], 0, 1, 0);
  }
  yield;
  // ---------------------------------------------------------------- 10. meshes
  const mk = (b, mat, name, o = {}) => {
    if (!b.count) return null;
    const g = b.build(); if (o.grow) g.boundingSphere.radius += o.grow;
    const m = new THREE.Mesh(g, mat); m.name = name; m.position.set(anchor.x, 0, anchor.z); m.matrixAutoUpdate = false; m.updateMatrix();
    m.castShadow = !!o.cast; m.receiveShadow = !!o.recv; if (o.order) m.renderOrder = o.order;
    add(m); return m;
  };
  mk(mb, facadeMaterial(), 'dam', { cast: true, recv: true });
  mk(nb, neonMaterial(), 'dam-lights');
  mk(ban, bannerMaterial(), 'dam-banners', { cast: true, recv: true });
  mk(res, reservoirMaterial(), 'dam-reservoir');
  mk(fb, flowMaterial(), 'dam-water', { order: 12 });
  mk(mist, mistMaterial(), 'dam-mist', { order: 14, grow: 60 });
  yield;
  // ---------------------------------------------------------------- 11. rock abutments (terrain material, so they match the valley walls)
  let tm = getTerrainMat();
  while (!tm) { yield; tm = getTerrainMat(); }
  for (const end of [0, 1]) { abutment(ctx, add, arc, end, tm); yield; }
}

/** Returns true if the quad (a,b,c,d) of builder `b` faces away from the hint (i.e. the winding must be flipped). */
function windOut(b, a, bb, c, d, hx, hy, hz) {
  const P = b.P.a, o = (i) => i * 3;
  const ax = P[o(bb)] - P[o(a)], ay = P[o(bb) + 1] - P[o(a) + 1], az = P[o(bb) + 2] - P[o(a) + 2];
  const bx = P[o(d)] - P[o(a)], by = P[o(d) + 1] - P[o(a) + 1], bz = P[o(d) + 2] - P[o(a) + 2];
  const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  void c;
  return nx * hx + ny * hy + nz * hz < 0;
}

/** Water sheet sliding down the face profile oFn(D) between depths D0..D1, width W centred on arc t. */
function flowSheet(fb, arc, t, W, oFn, y0top, D0, D1, speed, alpha, spread, ph) {
  const L = arc.L, C = {}, nv = 12, b0 = fb.count;
  fb.setFac(speed, alpha, spread, ph);
  for (let j = 0; j <= nv; j++) {
    const D = D0 + (D1 - D0) * j / nv, o = oFn(D), y = y0top - (D - D0);
    for (let i = 0; i <= 1; i++) {
      const tt = t + ((i - 0.5) * W) / L; arc.at(tt, C);
      const sl = faceSlope(D), l = Math.hypot(1, sl);
      fb.vert(C.x + C.nx * o, y, C.z + C.nz * o, C.nx / l, sl / l, C.nz / l, i, (D - D0) * 1.0);
    }
  }
  for (let j = 0; j < nv; j++) { const a = b0 + j * 2; fb.quadIdx(a, a + 1, a + 3, a + 2); }
}

/** Parabolic jet launched from (arc t, offset o, height y) toward the road: v0 m/s at angle up (rad); lands in the lake (+ spray). */
function jetArc(fb, mist, arc, t, W, o0, y0, v0, up, water, spreadW, ph) {
  const L = arc.L, C = {}, g = 9.81, vx = v0 * Math.cos(up), vy = v0 * Math.sin(up);
  const T = (vy + Math.sqrt(vy * vy + 2 * g * (y0 - water))) / g;
  const nv = 18, b0 = fb.count;
  let dist = 0, px = 0, py = y0;
  for (let j = 0; j <= nv; j++) {
    const tau = T * j / nv, x = o0 + vx * tau, y = y0 + vy * tau - 0.5 * g * tau * tau;
    if (j > 0) dist += Math.hypot(x - px, y - py); px = x; py = y;
    const w = W + (spreadW - W) * (j / nv) * (j / nv);
    fb.setFac(12, 0.9 - 0.35 * j / nv, Math.min(1, 0.2 + j / nv), ph);
    for (let i = 0; i <= 1; i++) {
      const tt = t + ((i - 0.5) * w) / L; arc.at(tt, C);
      fb.vert(C.x + C.nx * x, y, C.z + C.nz * x, 0, 1, 0, i, dist);
    }
  }
  for (let j = 0; j < nv; j++) { const a = b0 + j * 2; fb.quadIdx(a, a + 1, a + 3, a + 2); }
  // impact: foam + spray clouds
  const oLand = o0 + vx * T;
  foamPatch(fb, arc, t, spreadW * 1.8, oLand - 18, oLand + 30, water + 0.1, ph);
  for (let k = 0; k < 4; k++) { arc.at(t + (Math.sin(ph * 30 + k) * spreadW * 0.4) / L, C); puff(mist, { x: C.x + C.nx * (oLand + k * 6 - 6), y: water + 6 + k * 5, z: C.z + C.nz * (oLand + k * 6 - 6) }, 14 + k * 5, 0.28 - k * 0.04, ph + k); }
}

function foamPatch(fb, arc, t, W, oa, ob, y, ph) {
  const L = arc.L, C = {}, b0 = fb.count;
  fb.setFac(2.5, 0.8, 1.0, ph);
  for (let j = 0; j <= 2; j++) {
    const o = oa + (ob - oa) * j / 2;
    for (let i = 0; i <= 1; i++) { const tt = t + ((i - 0.5) * W) / L; arc.at(tt, C); fb.vert(C.x + C.nx * o, y, C.z + C.nz * o, 0, 1, 0, i, (o - oa)); }
  }
  for (let j = 0; j < 2; j++) { const a = b0 + j * 2; fb.quadIdx(a, a + 1, a + 3, a + 2); }
}

function puff(mist, p, radius, alpha, ph) {
  mist.setFac(ph, alpha, radius, 0);
  const a = mist.vert(p.x, p.y, p.z, 0, 1, 0, 0, 0), b = mist.vert(p.x, p.y, p.z, 0, 1, 0, 1, 0);
  const c = mist.vert(p.x, p.y, p.z, 0, 1, 0, 1, 1), d = mist.vert(p.x, p.y, p.z, 0, 1, 0, 0, 1);
  mist.quadIdx(a, b, c, d);
}

function dot(nb, F, x, y, z, size, color, mode, rv) {
  const [u0, v0, u1, v1] = NEON_DOT(color), uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, h = size / 2, P = [{}, {}, {}, {}];
  nb.setFac(rv, mode, 1.6, 0);
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    MB.at(F, x - ax * h, y - h, z - az * h, P[0]); MB.at(F, x + ax * h, y - h, z + az * h, P[1]); MB.at(F, x + ax * h, y + h, z + az * h, P[2]); MB.at(F, x - ax * h, y + h, z - az * h, P[3]);
    nb.quadW(P[0], P[1], P[2], P[3], uc, vc, uc, vc, uc, vc, uc, vc); nb.quadW(P[3], P[2], P[1], P[0], uc, vc, uc, vc, uc, vc, uc, vc);
  }
}

/** Rock abutment massif at one end of the dam: a grid heightfield in the (along-axis, toward-road) frame of the dam end. */
function abutment(ctx, add, arc, end, mat) {
  const road = ctx.road, seed = ctx.seed, C = {};
  arc.at(end, C);
  const sgn = end ? 1 : -1;                                   // outward along the dam axis
  const ux = C.tx * sgn, uz = C.tz * sgn, vx = C.nx, vz = C.nz;  // u outward, v toward the road
  // distance to the road on the RIGHT (lake) side; anything on or left of the road counts as "at the road" (the rock must not cross it)
  const roadDist = (x, z) => { const q = road.nearest(x, z, end ? DAM.sB : DAM.sA, 900, _n); return q.d > 0 ? 0 : q.dist; };
  const us = [], vs = [];
  for (let u = -70; u <= 520; u += 14) us.push(u);
  for (let v = -900; v <= 140; v += 13) vs.push(v);
  // gridMesh winds (row, col) like the terrain strips: (row dir x col dir) must point up, else walk the rows backwards
  const uMax = us[us.length - 1], vMin = vs[0];
  if (vz * ux - vx * uz < 0) vs.reverse();
  const grid = [];
  for (const v of vs) {
    const row = [];
    for (const u of us) {
      const x = C.x + ux * u + vx * v, z = C.z + uz * u + vz * v;
      const dRoad = roadDist(x, z);
      const n1 = fbm2(x / 110, z / 110, 4, seed + 311), n2 = fbm2(x / 28, z / 28, 3, seed + 312);
      // broad rounded massif: highest just beside the dam end (it holds the crest), sloping away outward along the valley side and
      // staying high upstream (it encloses the reservoir); a steep rock face drops into the lake on the road side
      const out = Math.max(0, u - 30), up = Math.max(0, -v);
      let y = arc.Yc + 22 + 38 * (n1 - 0.5) - 0.0009 * out * out - 0.18 * out * (0.6 + 0.8 * n1) - 0.015 * up;
      y += (n2 - 0.5) * 9;
      const cliff = smoothstep(95, 42, dRoad);                // keep ~42 m clear of the road: plunge into the lake before it
      y = y * (1 - cliff * cliff) + (arc.water - 26) * cliff * cliff;
      if (u < 12) y = Math.max(y, arc.Yc + 3 + (n2 - 0.5) * 5);                // bury the dam end
      // the grid's far borders sink into the lake (no cut edges hanging in the air)
      const edge = smoothstep(0, 160, Math.min(uMax - u, v - vMin));
      y = arc.water - 30 + (y - (arc.water - 30)) * edge;
      row.push({ x, y: Math.max(y, arc.water - 40), z, ty: arc.water - 40 });
    }
    grid.push(row);
  }
  const sink = { addExtra: (m) => { m.castShadow = true; add(m); } };
  gridMesh(ctx, sink, mat, grid, 'grey', { skirt: 30, cast: true, aux: [0, 0, 0, arc.water] });
}
const _n = {};
