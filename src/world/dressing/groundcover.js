// Near-road ground cover: dense grass clumps, seed stalks, scrub bushes, wild flowers and pebbles in a ~40 m band along both verges.
// This is the main first-person speed / "HD ground" cue, so it is cheap by construction:
//  - grass / stalks / scrub are crossed alpha-to-coverage cards from one 1024 atlas (6 / 4 tris), flowers are procedural stems + heads,
//    pebbles are flat-shaded 20-tri stones; no per-kind textures, two shader programs in total (card, rock), prewarmed;
//  - one InstancedBufferGeometry per (chunk, kind) with a compact 32-byte instance record (pos + yaw/cell, scale + normal + packed colour);
//    base vertex buffers are shared by every chunk; frustum culling per chunk; TerrainStreamer hides chunks outside the cover window;
//  - wind sway + distance shrink-fade in the vertex shader; grass is lit with the ground normal so it sits in the terrain.
// Placement is deterministic per (seed, chunk), time-sliced inside the dressing job system (runScatter tier 3), and respects landmark
// exclusions, tunnels, bridges, water, steep slopes and the asphalt.
import * as THREE from 'three';
import { biomeAt } from '../../data/biomes.js';
import { vnoise2, smoothstep } from '../../core/util.js';
import { WIND } from './assets.js';
import { rngOf, strId, CHUNK_LEN, EDGE } from './util.js';
import { HALF_ROAD } from '../road.js';

/** Cover window around the player (m along the road): chunks overlapping it are drawn. */
export const COVER_BEHIND = 70, COVER_AHEAD = 150;
const A0 = -2.2, A1 = 36;                         // lateral band, metres beyond the road-strip edge (negative = on the gravel shoulder)
const KINDS = ['grass', 'scrub', 'flower', 'pebble'];
// density per m2 at the road side (before clumping / falloff); dry = share of dry grass cards; tints are linear multipliers [a, b]
const COVER = {
  desert:   { grass: 0.3, scrub: 0.05, flower: 0.0, pebble: 0.42, dry: 1.0, g: [[1.08, 1.0, 0.86], [0.92, 0.82, 0.66]], s: [[2.0, 1.85, 1.35], [1.75, 1.5, 1.15]], f: [0xe8d27a, 0xd9a05a], p: [0xb89878, 0x8a6048] },
  canyon:   { grass: 0.12, scrub: 0.04, flower: 0.0, pebble: 0.6, dry: 1.0, g: [[1.02, 0.86, 0.7], [0.88, 0.7, 0.56]], s: [[1.9, 1.6, 1.2], [1.7, 1.4, 1.05]], f: [0xe0b060, 0xd08050], p: [0xa8603f, 0x7a4432] },
  coast:    { grass: 1.3, scrub: 0.05, flower: 0.14, pebble: 0.14, dry: 0.22, g: [[1.12, 1.12, 0.78], [1.22, 1.12, 0.72]], s: [[1.7, 1.8, 1.3], [1.85, 1.8, 1.3]], f: [0xf2efe4, 0xf0cc48], p: [0x9a978f, 0x75726c] },
  mountain: { grass: 0.9, scrub: 0.06, flower: 0.06, pebble: 0.35, dry: 0.45, g: [[1.0, 1.05, 0.78], [1.08, 1.0, 0.74]], s: [[1.5, 1.65, 1.2], [1.7, 1.6, 1.2]], f: [0xb89ae0, 0xf2efe4], p: [0x8a8886, 0x646260] },
  city:     { grass: 0.35, scrub: 0.04, flower: 0.0, pebble: 0.75, dry: 0.75, g: [[0.85, 0.85, 0.72], [0.95, 0.9, 0.74]], s: [[1.5, 1.5, 1.15], [1.6, 1.5, 1.15]], f: [0xe8e0c0, 0xe0c060], p: [0x9a958e, 0x94604a] },
  dam:      { grass: 0.6, scrub: 0.05, flower: 0.03, pebble: 0.3, dry: 0.65, g: [[0.98, 0.96, 0.82], [1.05, 0.96, 0.78]], s: [[1.6, 1.6, 1.2], [1.7, 1.6, 1.2]], f: [0xf2efe4, 0xf0cc48], p: [0x97948e, 0x72706a] },
};
const HEX = (h) => new THREE.Color().setHex(h);
const LIN = {};
for (const [b, c] of Object.entries(COVER)) LIN[b] = { g: c.g.map((v) => new THREE.Color(...v)), s: c.s.map((v) => new THREE.Color(...v)), f: c.f.map(HEX), p: c.p.map(HEX) };
const KEY = { grass: 'g', scrub: 's', flower: 'f', pebble: 'p' };
const SCALE = { grass: [0.5, 1.15], scrub: [0.5, 1.2], flower: [0.7, 1.15], pebble: [0.05, 0.26] };
const FADE = { grass: [85, 125], scrub: [100, 140], flower: [60, 90], pebble: [38, 62] };
const SWAY = { grass: 0.11, scrub: 0.04, flower: 0.12, pebble: 0 };
const CELL = { dry: 0, green: 1, stalks: 2, bush: 3 };

// ------------------------------------------------------------------------------------------------ geometry
/** n vertical quads crossing at the centre (w x h, base at y = -0.04), uv = local 0..1 in one atlas cell. */
function cards(n, w, h, seed) {
  const R = rngOf(seed, 1, 2), P = [], N = [], U = [], H = [], I = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI + (R() - 0.5) * 0.3, c = Math.cos(a) * w * 0.5, s = Math.sin(a) * w * 0.5;
    const ox = (R() - 0.5) * w * 0.12, oz = (R() - 0.5) * w * 0.12, b = P.length / 3;
    P.push(ox - c, -0.04, oz - s, ox + c, -0.04, oz + s, ox + c, h, oz + s, ox - c, h, oz - s);
    for (let k = 0; k < 4; k++) { N.push(0, 1, 0); H.push(0); }
    U.push(0, 0, 1, 0, 1, 1, 0, 1);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('aHead', new THREE.Float32BufferAttribute(H, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(P.length).fill(1), 3));
  g.setIndex(I); g.computeBoundingSphere();
  return g;
}
/** Flowers: 5 thin stems (uv pinned to an opaque stem texel of the green grass cell) with small coloured heads (instance colour). */
function flowers(seed) {
  const R = rngOf(seed, 3, 4), P = [], N = [], U = [], H = [], C = [];
  const stemUV = [0.5, 0.06];                       // cell-local: dense base of the green clump
  for (let i = 0; i < 5; i++) {
    const a = R() * 6.283, r = 0.07 * Math.sqrt(R()), bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = 0.3 + 0.2 * R(), lean = 0.12 * R(), tx = bx + Math.cos(a) * lean, tz = bz + Math.sin(a) * lean, w = 0.012;
    P.push(bx - w, 0, bz, bx + w, 0, bz, tx, h, tz);
    for (let k = 0; k < 3; k++) { N.push(0, 1, 0); U.push(...stemUV); H.push(0); C.push(0.55, 0.62, 0.5); }
    const s = 0.035 + 0.02 * R(), q = R() * 3;
    const cx = Math.cos(q) * s, cz = Math.sin(q) * s;
    P.push(tx - cx, h, tz - cz, tx + cz, h + 0.012, tz - cx, tx + cx, h, tz + cz, tx - cx, h, tz - cz, tx + cx, h, tz + cz, tx - cz, h + 0.012, tz + cx);
    for (let k = 0; k < 6; k++) { N.push(0, 1, 0); U.push(...stemUV); H.push(1); C.push(1, 1, 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('aHead', new THREE.Float32BufferAttribute(H, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); g.computeBoundingSphere();
  return g;
}
function pebble() {
  let pb = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const pp = pb.attributes.position, R = rngOf(14, 5, 6);
  for (let i = 0; i < pp.count; i++) pp.setXYZ(i, pp.getX(i) * (0.9 + 0.2 * R()), pp.getY(i) * 0.55, pp.getZ(i) * (0.75 + 0.2 * R()));
  pb = pb.toNonIndexed(); pb.computeVertexNormals();
  const pc = [], ph = [];
  for (let i = 0; i < pp.count; i++) { const k = 0.55 + 0.45 * Math.min(1, Math.max(0, pp.getY(i) / 0.55 + 0.5)); pc.push(k, k, k); ph.push(0); }
  pb.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3)); pb.setAttribute('aHead', new THREE.Float32BufferAttribute(ph, 1));
  pb.translate(0, 0.12, 0); pb.computeBoundingSphere();
  return pb;
}
const BASE_ATTRS = ['position', 'normal', 'uv', 'color', 'aHead'];

// ------------------------------------------------------------------------------------------------ materials
function coverMaterial(kind, atlas) {
  const rock = kind === 'pebble';
  const m = rock
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, map: atlas, alphaTest: 0.38, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
  m.name = 'cover_' + kind;
  const u = { uFade: { value: new THREE.Vector2(FADE[kind][0], FADE[kind][1]) }, uSway: { value: SWAY[kind] } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.uTime; sh.uniforms.uWind = WIND.uWind; sh.uniforms.uFade = u.uFade; sh.uniforms.uSway = u.uSway;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aInst; attribute vec4 aInst2; attribute float aHead;
        uniform float uTime; uniform vec3 uWind; uniform vec2 uFade; uniform float uSway;
        varying float vHead; varying float vLocalY;
        vec3 unpackCol(float v) { float r = floor(v / 65536.0); float g = floor((v - r * 65536.0) / 256.0); return vec3(r, g, v - r * 65536.0 - g * 256.0) * (2.5 / 255.0); }`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        float cCell = floor(aInst.w / 8.0), cYaw = aInst.w - cCell * 8.0;
        #ifdef USE_MAP
          vMapUv = vMapUv * 0.5 + vec2(mod(cCell, 2.0) * 0.5, (1.0 - floor(cCell / 2.0)) * 0.5);
        #endif`)
      .replace('#include <beginnormal_vertex>', `
        float cUpY = sqrt(max(0.05, 1.0 - dot(aInst2.yz, aInst2.yz)));
        vec3 cUp = vec3(aInst2.y, cUpY, aInst2.z);
        float cCy = cos(cYaw), cSy = sin(cYaw);
        mat2 cRot = mat2(cCy, -cSy, cSy, cCy);
        vec3 objectNormal = normal; objectNormal.xz = cRot * objectNormal.xz;
        ${rock ? '' : 'objectNormal = cUp;'}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position * aInst2.x;
        transformed.xz = cRot * transformed.xz;
        transformed.xz += cUp.xz * transformed.y / cUpY;
        ${rock ? '' : `{
          float hh = clamp(position.y, 0.0, 1.2);
          float ph = aInst.x * 0.37 + aInst.z * 0.29;
          float gust = 0.55 + 0.45 * sin(uTime * 1.9 + ph) + 0.3 * sin(uTime * 4.7 + ph * 2.3 + position.x * 5.0);
          transformed.xz += uWind.xz * (uSway * hh * hh * gust * aInst2.x);
        }`}
        vec3 cW = (modelMatrix * vec4(aInst.xyz, 1.0)).xyz;
        transformed *= 1.0 - smoothstep(uFade.x, uFade.y, distance(cW, cameraPosition));
        transformed += aInst.xyz;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vHead = aHead; vLocalY = position.y;
        vColor.rgb = mix(vColor.rgb * unpackCol(aInst2.w), unpackCol(aInst2.w), aHead);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vHead; varying float vLocalY;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        #ifdef USE_MAP
          // keep the clumps full at a distance: boost alpha by the mip level (cards would otherwise thin out)
          vec2 mT = vMapUv * 1024.0; float mipL = 0.5 * log2(max(max(dot(dFdx(mT), dFdx(mT)), dot(dFdy(mT), dFdy(mT))), 1.0));
          diffuseColor.a *= 1.0 + mipL * 0.28;
          diffuseColor.rgb = mix(diffuseColor.rgb, vColor.rgb, vHead); diffuseColor.a = mix(diffuseColor.a, 1.0, vHead);
          diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.0, 0.65, vLocalY));   // self-shadowed base of the clump
        #endif`);
    if (!rock) sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal);`);
  };
  m.customProgramCacheKey = () => (rock ? 'cover-rock' : 'cover-card');
  return m;
}

let _shared = null;
/** Shared geometries + materials (created once per page; reused by every run). */
function shared() {
  if (_shared) return _shared;
  const atlas = new THREE.TextureLoader().load('/textures/cover/cover_atlas.png');
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  const geos = { grass: cards(3, 1, 1, 11), scrub: cards(2, 1.2, 1, 12), flower: flowers(13), pebble: pebble() };
  _shared = { geos, atlas, mats: Object.fromEntries(KINDS.map((k) => [k, coverMaterial(k, atlas)])), ready: false, warming: false };
  return _shared;
}
/** True once the cover programs are compiled (meshes stay hidden until then). */
export function coverReady() { return !!(_shared && _shared.ready); }

function warm(ctx) {
  const S = shared();
  if (S.ready || S.warming) return;
  S.warming = true;
  const w = ctx.pool && ctx.pool.warmer;
  if (!w) { S.ready = true; return; }
  const dummies = ['grass', 'pebble'].map((k) => makeMesh(k, new Float32Array(8), 1, [0, -5000, 0]));
  w(dummies).then(() => { S.ready = true; for (const d of dummies) disposeCoverMesh(d); }, () => { S.ready = true; });
}

/** Meshes using every cover program (for Game.prewarm: compiled up front, so the runtime warm-up is instant). */
export function coverPrewarmMeshes() {
  return ['grass', 'pebble'].map((k) => { const m = makeMesh(k, new Float32Array(8), 1, [0, 0, 0]); m.visible = true; return m; });
}

function makeMesh(kind, data, n, anchor) {
  const S = shared(), base = S.geos[kind];
  const g = new THREE.InstancedBufferGeometry();
  for (const k of BASE_ATTRS) if (base.attributes[k]) g.setAttribute(k, base.attributes[k]);
  if (base.index) g.setIndex(base.index);
  const buf = new THREE.InstancedInterleavedBuffer(data, 8, 1);
  g.setAttribute('aInst', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  g.setAttribute('aInst2', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, CHUNK_LEN / 2), 80);
  const mesh = new THREE.Mesh(g, S.mats[kind]);
  mesh.position.set(anchor[0], anchor[1], anchor[2]); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.visible = false;
  mesh.userData.cover = kind; mesh.name = 'cover_' + kind;
  return mesh;
}
/** Free one chunk's cover mesh (keeps the shared base buffers alive). */
export function disposeCoverMesh(mesh) {
  const g = mesh.geometry;
  for (const k of BASE_ATTRS) if (g.attributes[k]) g.deleteAttribute(k);
  g.setIndex(null);
  g.dispose();
}

// ------------------------------------------------------------------------------------------------ placement
const _g = {}, _rs = {};
const PACK = 2.5; // packed colours cover 0..2.5 (tints brighten the darker cards)
const packCol = (c) => Math.round(Math.min(1, c.r / PACK) * 255) * 65536 + Math.round(Math.min(1, c.g / PACK) * 255) * 256 + Math.round(Math.min(1, c.b / PACK) * 255);
const _c = new THREE.Color();
function bdens(bio, kind) { return (COVER[bio.a][kind] ?? 0) * (1 - bio.w) + (COVER[bio.b][kind] ?? 0) * bio.w; }

/**
 * Generate this chunk's cover (time-sliced). Meshes are attached to the terrain record (chunk.rec.cover) and added to its group;
 * TerrainStreamer toggles their visibility and disposes them with the chunk.
 * @returns {true|false|null} true = done, false = out of time (call again), null = waiting for the landmark plan
 */
export function buildCover(ctx, chunk, deadline = Infinity) {
  const rec = chunk.rec;
  if (!rec || !rec.group || !chunk.ground) return true;
  warm(ctx);
  const { road, seed } = ctx, s0 = chunk.s0;
  let st = chunk._cover;
  if (!st) {
    const excl = ctx.exclusions(s0 - 40, s0 + CHUNK_LEN + 40);
    if (!excl) return null;                                    // landmark plan not ready yet
    const bios = [biomeAt(s0), biomeAt(s0 + 48), biomeAt(s0 + CHUNK_LEN)];
    const feats = road.featuresIn(s0 - 40, s0 + CHUNK_LEN + 40).filter((f) => f.type === 'tunnel' || f.type === 'bridge' || f.type === 'overpass');
    st = chunk._cover = { k: 0, i: 0, excl, bios, feats, anchor: road.sample(s0), data: null, n: 0 };
  }
  const q = Math.max(0, Math.min(3, ctx.quality ?? 2)), qk = [0.35, 0.65, 1, 1.25][q];
  while (st.k < KINDS.length) {
    const kind = KINDS[st.k];
    if (!st.data) {
      let D = 0; for (const b of st.bios) D = Math.max(D, bdens(b, kind));
      st.nCand = Math.ceil(D * qk * CHUNK_LEN * 2 * (A1 - A0)); st.D = D;
      st.data = new Float32Array(Math.max(8, st.nCand * 8)); st.n = 0; st.i = 0;
      st.rnd = rngOf(seed, chunk.c, strId('cover:' + kind));
    }
    const rnd = st.rnd, data = st.data, ax = st.anchor.x, ay = st.anchor.y, az = st.anchor.z;
    const [sc0, sc1] = SCALE[kind], ck = KEY[kind];
    while (st.i < st.nCand) {
      if ((st.i & 127) === 0 && st.i > 0 && performance.now() > deadline) return false;
      st.i++;
      const uSide = rnd(), uA = rnd(), uS = rnd(), uAcc = rnd(), uYaw = rnd(), uSc = rnd(), uCol = rnd(), uCl = rnd(), uV = rnd();
      const side = uSide < 0.5 ? 1 : -1;
      const a = A0 + (A1 - A0) * (kind === 'pebble' ? uA * uA : Math.pow(uA, 1.35));
      const s = s0 + uS * CHUNK_LEN;
      const bio = biomeAt(s);
      let dens = bdens(bio, kind);
      if (dens <= 0) continue;
      // lateral profile: sparse weeds on the gravel shoulder, full just past it, thinning out with distance
      const prof = a < 0 ? (kind === 'pebble' ? 1.3 : kind === 'grass' ? 0.2 : 0.04) : (kind === 'pebble' ? 1.0 - 0.6 * smoothstep(4, 30, a) : (0.55 + 0.45 * smoothstep(0, 3, a)) * (1 - 0.45 * smoothstep(10, 36, a)));
      dens *= prof;
      if (uAcc * st.D > dens) continue;
      const d = side * (EDGE + a);
      if (Math.abs(d) < HALF_ROAD + 0.45) continue;
      let gx, gy, gz, nx = 0, nz = 0;
      if (a < 0) { const p = road.pointAt(s, d, _rs); gx = p.x; gy = p.y; gz = p.z; }
      else { const g = chunk.ground.sample(s, d, _g); gx = g.x; gy = g.y; gz = g.z; nx = g.nx; nz = g.nz; if (1 - g.ny > (kind === 'pebble' ? 0.55 : 0.42)) continue; }
      // clumps: grass / flowers grow in patches, scrub is sparse and even, pebbles gather in washes
      const cn = vnoise2(gx / 7.5, gz / 7.5, seed + 71) * 0.65 + vnoise2(gx / 23, gz / 23, seed + 72) * 0.35;
      const cl = kind === 'grass' ? smoothstep(0.28, 0.6, cn) : kind === 'flower' ? smoothstep(0.55, 0.7, cn) : kind === 'pebble' ? 0.35 + 0.65 * smoothstep(0.62, 0.35, cn) : 1;
      if (uCl > cl) continue;
      if (gy < chunk.seaY + 0.6) continue;
      const roadY = road.sample(s, _rs).y;
      if (roadY - gy > 7) continue;                                    // down a cliff: not visible from the road anyway
      let bad = false;
      for (const f of st.feats) if (s > f.s0 - 25 && s < f.s1 + 25 && (f.type !== 'bridge' || Math.abs(d) < 14)) { bad = true; break; }
      if (bad) continue;
      for (let k = 0; k < st.excl.length; k++) { const z = st.excl[k], dx = gx - z[0], dz = gz - z[1]; if (dx * dx + dz * dz < z[2] * z[2]) { bad = true; break; } }
      if (bad) continue;
      if (kind !== 'pebble' && bio.a === 'mountain' && gy > 200) continue;   // no grass on the snow fields
      const bid = bio.w > 0.5 ? bio.b : bio.a, C = COVER[bid];
      let cell = 0;
      if (kind === 'grass') { const dry = uV < C.dry; cell = dry ? (uV < C.dry * 0.14 ? CELL.stalks : CELL.dry) : CELL.green; }
      else if (kind === 'scrub') cell = CELL.bush;
      else if (kind === 'flower') cell = CELL.green;
      let scl = (sc0 + (sc1 - sc0) * uSc * uSc) * (kind === 'grass' && a < 0 ? 0.65 : 1);
      if (cell === CELL.stalks) scl *= 1.25;
      const L = LIN[bid][ck];
      _c.copy(L[0]).lerp(L[1], uCol);
      if (kind === 'pebble') _c.multiplyScalar(0.8 + 0.4 * uCl);
      else if (kind !== 'flower') _c.multiplyScalar(0.88 + 0.24 * uCl);
      const o = st.n * 8;
      data[o] = gx - ax; data[o + 1] = gy - ay - (kind === 'pebble' ? scl * 0.45 : 0.02); data[o + 2] = gz - az; data[o + 3] = uYaw * 6.2832 + cell * 8;
      const al = kind === 'pebble' ? 1 : 0.5;
      data[o + 4] = scl; data[o + 5] = nx * al; data[o + 6] = nz * al; data[o + 7] = packCol(_c);
      st.n++;
    }
    if (st.n > 0) {
      const arr = st.data.slice(0, st.n * 8);
      const mesh = makeMesh(kind, arr, st.n, [ax, ay, az]);
      // bounding sphere around the actual instances (local to the anchor)
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
      for (let i = 0; i < st.n; i++) { const x = arr[i * 8], y = arr[i * 8 + 1], z = arr[i * 8 + 2]; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z; }
      mesh.geometry.boundingSphere.center.set((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2);
      mesh.geometry.boundingSphere.radius = 0.5 * Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) + 2;
      mesh.userData.s0 = s0;
      (rec.cover || (rec.cover = [])).push(mesh); rec.group.add(mesh);
    }
    st.k++; st.data = null;
  }
  chunk._cover = null;
  return true;
}
