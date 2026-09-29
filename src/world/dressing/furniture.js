// Road furniture: guard rails, utility poles + wires, street lamps, signs, mile markers, billboards, delineator posts, curve chevrons and
// curve-warning signs (placed from the road curvature), ranch / chain-link fences. Deterministic slot schedules per biome.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { biomeAt } from '../../data/biomes.js';
import { hash2, lerp } from '../../core/util.js';
import { roadFrame, groundAt, CHUNK_LEN } from './util.js';
import { GLOW } from './pool.js';
import { instanceMaterial } from './assets.js';

/** Furniture density per biome (0..1 activity). */
const CFG = {
  desert:   { poles: 0.75, signs: 1.0, board: 1.0, mile: 1, lamps: 0, delin: 1, ranch: 0.5, chain: 0 },
  canyon:   { poles: 0.30, signs: 0.8, board: 0.25, mile: 1, lamps: 0, delin: 1, ranch: 0.15, chain: 0 },
  coast:    { poles: 0.0, signs: 0.8, board: 0.35, mile: 1, lamps: 0, delin: 1, ranch: 0.3, chain: 0 },
  mountain: { poles: 0.30, signs: 1.0, board: 0.2, mile: 1, lamps: 0, delin: 1, ranch: 0, chain: 0 },
  city:     { poles: 0.35, signs: 0.7, board: 1.0, mile: 1, lamps: 1, delin: 0, ranch: 0, chain: 0.55 },
  dam:      { poles: 0.0, signs: 0.35, board: 0.0, mile: 0, lamps: 0, delin: 1, ranch: 0, chain: 0.35 },
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
  // the readable face of every sign asset is its -Z side (glTF convention of the props): make it point back toward oncoming traffic,
  // turned toward the road by `ang` => local +Z points the opposite way
  const sm = road.sample(s, {});
  const fx = sm.fx, fz = sm.fz, nx = sm.nx, nz = sm.nz;
  const dx = -fx * Math.cos(ang) - nx * side * Math.sin(ang), dz = -fz * Math.cos(ang) - nz * side * Math.sin(ang);
  return Math.atan2(-dx, -dz);
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
    if (r < 0.78) put('sign_speed', s, side, 11.4, 0.08);          // curve warnings are placed from the road curvature (curveSigns)
    else if (r < 0.9) put('sign_exit', s, -1, 12.6, 0.05);
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

// ------------------------------------------------------------------------------------------------ procedural furniture assets
// Delineator posts (white / amber reflector), curve chevrons (< and >), diamond curve-warning signs (left / right), ranch fence.
// Geometry only (vertex colours, no textures): crisp at any distance, one or two draw calls each. Readable faces point to -Z like the
// glTF props. Reflective parts use materials named in GLOW so they light up at night.
// one material for every procedural sign / post: vertex colours + a 4-texel emissive palette (0 none, 1 white reflector, 2 amber
// reflector, 3 yellow sign sheeting) so each asset is a single draw and the retro-reflective parts light up at night (GLOW).
GLOW.furn_retro = [0xffffff, 2.4];
const PAL = { none: 0, white: 1, amber: 2, yellow: 3 };
const PROC_SPECS = {
  delineator_w: { far: 240, shadow: false }, delineator_a: { far: 240, shadow: false },
  chevron_l: { far: 420, shadow: false, behind: true }, chevron_r: { far: 420, shadow: false, behind: true },
  warn_curve_l: { far: 380, shadow: false, behind: true }, warn_curve_r: { far: 380, shadow: false, behind: true },
  fence_ranch: { far: 260, shadow: false, behind: true },
  fence_chainlink_4m: { far: 240, shadow: false, behind: true },
};

function tint(geo, rgb, pal = 0) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2]; uv[i * 2] = (pal + 0.5) / 4; uv[i * 2 + 1] = 0.5; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
const box = (w, h, d, x, y, z, rgb, pal = 0) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), rgb, pal);
function shape(pts, holes, z, rgb) {
  const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes || []) sh.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  // built facing +Z, then turned to face -Z (the readable side) together with its viewer: callers draw in viewer space (+x = viewer's right)
  return tint(new THREE.ShapeGeometry(sh).rotateY(Math.PI).translate(0, 0, z), rgb);
}
function procAsset(name, parts) {
  const bb = new THREE.Box3(); let tris = 0;
  const out = parts.map((p) => {
    p.geometry.computeBoundingBox(); p.geometry.computeBoundingSphere(); bb.union(p.geometry.boundingBox);
    const t = (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3; tris += t;
    return { name: p.name, geometry: p.geometry, material: p.material, role: 'main', tris: t };
  });
  const size = bb.getSize(new THREE.Vector3());
  return { name, kind: 'prop', url: 'procedural', parts: out, sockets: {}, collision: null, box: bb, tris, size, height: bb.max.y, radius: Math.max(size.x, size.z) * 0.5, sphere: bb.getBoundingSphere(new THREE.Sphere()), hasRoad: false, procedural: true };
}
const merge = (gs) => mergeGeometries(gs, false);

/** Thick polyline ribbon in the plane z (viewer space, +x = viewer's right), for sign arrows. */
function ribbon(pts, w, z, rgb) {
  const P = [], I = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1]; const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    P.push(pts[i][0] - ty * w / 2, pts[i][1] + tx * w / 2, 0, pts[i][0] + ty * w / 2, pts[i][1] - tx * w / 2, 0);
    if (i) { const k = i * 2; I.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I);
  g.computeVertexNormals();
  // make every triangle face +Z before the turn
  const ar = g.index.array; for (let i = 0; i < ar.length; i += 3) {
    const p0 = ar[i] * 3, p1 = ar[i + 1] * 3, p2 = ar[i + 2] * 3;
    const cz = (P[p1] - P[p0]) * (P[p2 + 1] - P[p0 + 1]) - (P[p1 + 1] - P[p0 + 1]) * (P[p2] - P[p0]);
    if (cz < 0) { const t = ar[i + 1]; ar[i + 1] = ar[i + 2]; ar[i + 2] = t; }
  }
  for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 0, 1);
  return tint(g.rotateY(Math.PI).translate(0, 0, z), rgb);
}

let _mats = null;
function furnMaterials() {
  if (_mats) return _mats;
  const pal = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255, 255, 240, 214, 255, 255, 140, 30, 255, 70, 52, 12, 255]), 4, 1);
  pal.magFilter = THREE.NearestFilter; pal.minFilter = THREE.NearestFilter; pal.generateMipmaps = false; pal.needsUpdate = true;
  const retro = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.2, emissiveMap: pal, emissive: 0x000000 }); retro.name = 'furn_retro';
  const wood = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }); wood.name = 'furn_wood';
  _mats = { retro, wood };
  return _mats;
}
/** Instanced meshes with the same program keys as the pooled procedural furniture (plain + shadow-casting), for Game.prewarm. */
export function furniturePrewarmMeshes() {
  const M = furnMaterials(), out = [];
  const g = tint(new THREE.BoxGeometry(0.1, 0.1, 0.1), [1, 1, 1]);
  for (const mat of [M.retro, M.wood]) for (const shadow of [false, true]) {
    const m = new THREE.InstancedMesh(g, instanceMaterial(mat, {}), 1);
    m.setColorAt(0, new THREE.Color(1, 1, 1)); m.castShadow = shadow; m.receiveShadow = true;
    out.push(m);
  }
  return out;
}
let _furnReg = false;
function registerFurnitureAssets(kit) {
  if (_furnReg && kit.assets.has('delineator_w')) return;
  _furnReg = true;
  const dark = furnMaterials().retro;
  const WHITE = [0.82, 0.82, 0.8], BLACK = [0.03, 0.03, 0.03], GALV = [0.46, 0.47, 0.48], WOOD = [0.3, 0.24, 0.18], YEL = [0.86, 0.62, 0.08];
  // delineator: flexible white post with a black band and a reflector on the traffic side
  const post = merge([tint(new THREE.CylinderGeometry(0.04, 0.05, 0.84, 8).translate(0, 0.42, 0), WHITE), tint(new THREE.CylinderGeometry(0.041, 0.041, 0.16, 8).translate(0, 0.92, 0), BLACK),
    tint(new THREE.CylinderGeometry(0.04, 0.041, 0.1, 8).translate(0, 1.05, 0), WHITE)]);
  const reflG = (rgb, p) => box(0.07, 0.1, 0.012, 0, 0.92, -0.046, rgb, p);
  kit.assets.set('delineator_w', procAsset('delineator_w', [{ name: 'post', geometry: merge([post.clone(), reflG([0.95, 0.93, 0.88], PAL.white)]), material: dark }]));
  kit.assets.set('delineator_a', procAsset('delineator_a', [{ name: 'post', geometry: merge([post.clone(), reflG([0.95, 0.6, 0.15], PAL.amber)]), material: dark }]));
  // chevron alignment sign: yellow retro-reflective panel 0.6 x 0.75 on a 2 m post, black chevron
  const chevronPts = (dir) => [[-0.2, 0.28], [-0.06, 0.28], [0.2, 0], [-0.06, -0.28], [-0.2, -0.28], [0.06, 0]].map(([x, y]) => [x * dir, y]);
  for (const [nm, dir] of [['chevron_r', 1], ['chevron_l', -1]]) {
    const pts = chevronPts(dir), ccw = dir < 0 ? pts.slice().reverse() : pts;
    const panel = box(0.6, 0.75, 0.02, 0, 1.55, 0.0, YEL, PAL.yellow);
    const g = merge([box(0.07, 1.95, 0.07, 0, 0.975, 0.03, GALV), box(0.62, 0.77, 0.018, 0, 1.55, 0.012, GALV), shape(ccw.map(([x, y]) => [x, y + 1.55]), null, -0.012, BLACK), panel]);
    kit.assets.set(nm, procAsset(nm, [{ name: 'sign', geometry: g, material: dark }]));
  }
  // diamond curve-warning sign: 0.76 m diamond on a 2.6 m post, black rim + curved arrow
  const D = 0.54, Y0 = 2.05;
  for (const [nm, dir] of [['warn_curve_r', 1], ['warn_curve_l', -1]]) {
    const outer = [[0, D], [-D, 0], [0, -D], [D, 0]], inner = [[0, D - 0.05], [D - 0.05, 0], [0, -(D - 0.05)], [-(D - 0.05), 0]];
    const rim = shape(outer.map(([x, y]) => [x, y + Y0]), [inner.map(([x, y]) => [x, y + Y0])], -0.012, BLACK);
    const arc = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, a = t * Math.PI * 0.42; arc.push([dir * (0.14 - Math.cos(a) * 0.14) * 1.6, Y0 - 0.26 + t * 0.34 + Math.sin(a) * 0.12]); }
    const stem = ribbon([[0, Y0 - 0.34], ...arc], 0.075, -0.013, BLACK);
    const tip = arc[arc.length - 1], prev = arc[arc.length - 3];
    let tx = tip[0] - prev[0], ty = tip[1] - prev[1]; const tl = Math.hypot(tx, ty); tx /= tl; ty /= tl;
    const hp = [[tip[0] + tx * 0.13, tip[1] + ty * 0.13], [tip[0] - ty * 0.1, tip[1] + tx * 0.1], [tip[0] + ty * 0.1, tip[1] - tx * 0.1]];
    const hcz = (hp[1][0] - hp[0][0]) * (hp[2][1] - hp[0][1]) - (hp[1][1] - hp[0][1]) * (hp[2][0] - hp[0][0]);
    const head = shape(hcz > 0 ? hp : [hp[0], hp[2], hp[1]], null, -0.013, BLACK);
    const back = tint(new THREE.BoxGeometry(D * 1.414, D * 1.414, 0.012).rotateZ(Math.PI / 4).translate(0, Y0, 0.004), GALV);
    const panel = tint(new THREE.PlaneGeometry(D * 1.414, D * 1.414).rotateZ(Math.PI / 4).rotateY(Math.PI).translate(0, Y0, -0.006), YEL, PAL.yellow);
    const g = merge([box(0.07, 2.6, 0.07, 0, 1.3, 0.03, GALV), back, rim, stem, head, panel]);
    kit.assets.set(nm, procAsset(nm, [{ name: 'sign', geometry: g, material: dark }]));
  }
  // ranch fence: weathered post + 3 barbed-wire strands spanning 4 m along +Z
  const wire = [0.48, 0.8, 1.1].map((h) => box(0.014, 0.014, 4.0, 0, h, 2.0, [0.2, 0.19, 0.18]));
  const fence = merge([box(0.11, 1.28, 0.11, 0, 0.6, 0, WOOD), ...wire]);
  const wood = furnMaterials().wood;
  kit.assets.set('fence_ranch', procAsset('fence_ranch', [{ name: 'fence', geometry: fence, material: wood }]));
}

const _pa = {};
/** Features that suppress roadside furniture around them. */
function blockedBy(feats, s, pad = 10) {
  for (const f of feats) if ((f.type === 'bridge' || f.type === 'tunnel' || f.type === 'overpass' || f.type === 'ramp' || f.type === 'roadblock') && s > f.s0 - pad && s < f.s1 + pad) return true;
  return false;
}

// ------------------------------------------------------------------------------------------------ delineators (every 50 m, both sides)
function delineators(ctx, chunk) {
  const { road } = ctx, s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  if (cfg(s0, 'delin') < 0.5 && cfg(s1, 'delin') < 0.5) return true;
  useSpec(ctx, 'delineator_w', PROC_SPECS.delineator_w); useSpec(ctx, 'delineator_a', PROC_SPECS.delineator_a);
  const feats = road.featuresIn(s0 - 30, s1 + 30);
  const guards = feats.filter((f) => f.type === 'guard');
  for (let k = Math.ceil(s0 / 50); k * 50 < s1; k++) {
    const s = k * 50;
    if (cfg(s, 'delin') < 0.5 || blockedBy(feats, s, 6)) continue;
    for (const side of [1, -1]) {
      if (guards.some((f) => s > f.s0 - 4 && s < f.s1 + 4 && (f.side === 'both' || (f.side === 'L') === (side > 0)))) continue;
      const p = road.pointAt(s, side * 9.15, _pa);
      const name = side > 0 ? 'delineator_a' : 'delineator_w';
      chunk.list(name).push(p.x, p.y - 0.02, p.z, faceYaw(road, s, side, 0.05), 1, 1, 1, 0, 1, 0, 0, 1.2);
    }
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ curve chevrons + curve warnings
const K_CHEV = 1 / 300, K_WARN = 1 / 280;
function curveSigns(ctx, chunk) {
  const { road } = ctx, s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  for (const n of ['chevron_l', 'chevron_r', 'warn_curve_l', 'warn_curve_r']) useSpec(ctx, n, PROC_SPECS[n]);
  const feats = road.featuresIn(s0 - 60, s1 + 400);
  const sm = {}, g = {};
  // chevrons on the outside of tight curves, every 24 m, facing the approaching driver
  for (let k = Math.ceil(s0 / 24); k * 24 < s1; k++) {
    const s = k * 24; road.sample(s, sm);
    if (Math.abs(sm.k) < K_CHEV || blockedBy(feats, s, 8)) continue;
    const side = sm.k > 0 ? -1 : 1;                                // k > 0 turns left: the outside is the right-hand side
    const pg = chunk.ground.sample(s, side * 10.8, g);
    chunk.list(sm.k > 0 ? 'chevron_l' : 'chevron_r').push(pg.x, pg.y - 0.05, pg.z, faceYaw(road, s, side, 0.12), 1, 1, 1, 0, 1, 0, 0, 2.2);
  }
  // one warning sign ~140 m before each curve onset, on the right
  for (let k = Math.ceil(s0 / 12); k * 12 < s1; k++) {
    const s = k * 12, ka = road.sample(s + 140, sm).k, kb = road.sample(s + 128, {}).k;
    if (Math.abs(ka) < K_WARN || Math.abs(kb) >= K_WARN) continue;
    let kmax = 0; for (let t = 140; t <= 260; t += 20) kmax = Math.max(kmax, Math.abs(road.sample(s + t, {}).k));
    if (kmax < 1 / 220 || blockedBy(feats, s, 12)) continue;
    const pg = chunk.ground.sample(s, -11.4, g);
    chunk.list(ka > 0 ? 'warn_curve_l' : 'warn_curve_r').push(pg.x, pg.y - 0.05, pg.z, faceYaw(road, s, -1, 0.1), 1, 1, 1, 0, 1, 0, 0, 2.8);
  }
  return true;
}

// ------------------------------------------------------------------------------------------------ fences (ranch wire / chain link) in stretches
/** Runs with the far scatter tier (needs the landmark plan for exclusions; must not hold up road features). */
export function buildFences(ctx, chunk) {
  registerFurnitureAssets(ctx.kit);
  const { road, seed } = ctx, s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  if (Math.max(cfg(s0, 'ranch'), cfg(s1, 'ranch'), cfg(s0, 'chain'), cfg(s1, 'chain')) < 0.01) return true;
  const chain = need(ctx, 'fence_chainlink_4m');
  if (chain === undefined) return false;
  const excl = ctx.exclusions(s0 - 20, s1 + 20);
  if (!excl) return false;
  useSpec(ctx, 'fence_ranch', PROC_SPECS.fence_ranch); if (chain) useSpec(ctx, 'fence_chainlink_4m', PROC_SPECS.fence_chainlink_4m);
  const feats = road.featuresIn(s0 - 30, s1 + 30);
  const BL = 600, g0 = {}, g1 = {}, sm = {};
  for (const side of [1, -1]) {
    for (let b = Math.floor((s0 - BL) / BL); b * BL < s1; b++) {
      const h = hash2(b, side > 0 ? 51 : 52, seed);
      const st0 = b * BL + hash2(b, 53 + side, seed) * 200, len = 150 + hash2(b, 55 + side, seed) * 300, st1 = st0 + len;
      if (st1 < s0 || st0 > s1) continue;
      const bio = biomeAt(st0 + len / 2), id = bio.w > 0.5 ? bio.b : bio.a;
      const isChain = CFG[id].chain > 0;
      if (h > (isChain ? CFG[id].chain : CFG[id].ranch)) continue;
      if (isChain && !chain) continue;
      const dist = isChain ? 12.6 + hash2(b, 57 + side, seed) * 2 : 16 + hash2(b, 57 + side, seed) * 9;
      const name = isChain ? 'fence_chainlink_4m' : 'fence_ranch', list = chunk.list(name);
      for (let k = Math.ceil(Math.max(st0, s0) / 4); k * 4 < Math.min(st1, s1); k++) {
        const s = k * 4;
        if (blockedBy(feats, s, 14)) continue;
        const d = side * dist;
        const a = chunk.ground.sample(s, d, g0), c = groundAt(road, seed, s + 4, d, g1);
        const ry = road.sample(s, sm).y;
        if (Math.abs(a.y - ry) > 6 || a.ny < 0.8) continue;
        let bad = false;
        for (const z of excl) { const dx = a.x - z[0], dz = a.z - z[1]; if (dx * dx + dz * dz < (z[2] + 3) * (z[2] + 3)) { bad = true; break; } }
        if (bad) continue;
        let fx = c.x - a.x, fy = c.y - a.y, fz = c.z - a.z; const L = Math.hypot(fx, fy, fz) || 1; fx /= L; fy /= L; fz /= L;
        let lx = fz, lz = -fx; const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
        const ux = fy * lz, uy = fz * lx - fx * lz, uz = -fy * lx;
        if (isChain) list.pushBasis((a.x + c.x) / 2, (a.y + c.y) / 2 - 0.05, (a.z + c.z) / 2, lx, 0, lz, 0, 1, 0, fx, fy, fz, 1, 1, L / 4, 2.4);
        else list.pushBasis(a.x, a.y - 0.08, a.z, lx, 0, lz, ux, uy, uz, fx, fy, fz, 1, 1, L / 4, 2.6);
      }
    }
  }
  return true;
}

export function buildFurniture(ctx, chunk) {
  let ok = true;
  registerFurnitureAssets(ctx.kit);
  for (const [key, fn] of [['guard', guardrails], ['poles', poles], ['lamps', lamps], ['signs', signs], ['delin', delineators], ['curves', curveSigns]]) {
    if (chunk.done.has('f:' + key)) continue;
    if (fn(ctx, chunk)) chunk.done.add('f:' + key); else ok = false;
  }
  chunk.dirty = true;
  return ok;
}
