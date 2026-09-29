// Near-road ground cover: dense grass tufts, dry scrub, wild flowers and pebbles in a ~40 m band along both verges.
// This is the main first-person speed / "HD ground" cue, so it is cheap by construction:
//  - geometry is procedural and tiny (grass tuft 9 tris, scrub 12, flower 10, pebble 20), vertex coloured, no textures;
//  - one InstancedBufferGeometry per (chunk, kind) with a compact 32-byte instance record (pos + yaw, scale + normal + packed colour);
//    base vertex buffers are shared by every chunk; frustum culling per chunk; TerrainStreamer hides chunks outside the cover window;
//  - wind sway + distance shrink-fade in the vertex shader (two shader programs in total, warmed before first use).
// Placement is deterministic per (seed, chunk), time-sliced inside the dressing job system (runScatter tier 3), and respects landmark
// exclusions, tunnels, water, steep slopes and the asphalt.
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
// density per m2 at the road side (before cluster / falloff), colours (sRGB hex) [a, b] mixed per instance
const COVER = {
  desert:   { grass: 0.22, scrub: 0.045, flower: 0.0, pebble: 0.42, g: [0xc4a466, 0x9c8150], s: [0x6b6540, 0x7a5c3e], f: [0xe8d27a, 0xd9a05a], p: [0xb89878, 0x8a6048] },
  canyon:   { grass: 0.08, scrub: 0.03, flower: 0.0, pebble: 0.6, g: [0xb49456, 0x93704a], s: [0x625a3a, 0x72503a], f: [0xe0b060, 0xd08050], p: [0xa8603f, 0x7a4432] },
  coast:    { grass: 1.9, scrub: 0.05, flower: 0.12, pebble: 0.14, g: [0x7d9444, 0xa8a45c], s: [0x55683a, 0x66703e], f: [0xf2efe4, 0xf0cc48], p: [0x9a978f, 0x75726c] },
  mountain: { grass: 1.2, scrub: 0.05, flower: 0.06, pebble: 0.35, g: [0x72843f, 0x958c4e], s: [0x4f5c34, 0x604e36], f: [0xb89ae0, 0xf2efe4], p: [0x8a8886, 0x646260] },
  city:     { grass: 0.26, scrub: 0.035, flower: 0.0, pebble: 0.75, g: [0x86864a, 0x958452], s: [0x5c5c3e, 0x604e3c], f: [0xe8e0c0, 0xe0c060], p: [0x9a958e, 0x94604a] },
  dam:      { grass: 0.5, scrub: 0.045, flower: 0.025, pebble: 0.3, g: [0x939252, 0xab965e], s: [0x5c5c3e, 0x604e3c], f: [0xf2efe4, 0xf0cc48], p: [0x97948e, 0x72706a] },
};
const LIN = {};
for (const [b, c] of Object.entries(COVER)) LIN[b] = Object.fromEntries(['g', 's', 'f', 'p'].map((k) => [k, c[k].map((h) => new THREE.Color().setHex(h))]));
const KEY = { grass: 'g', scrub: 's', flower: 'f', pebble: 'p' };
const SCALE = { grass: [0.55, 1.25], scrub: [0.6, 1.3], flower: [0.7, 1.15], pebble: [0.05, 0.26] };
const FADE = { grass: [80, 118], scrub: [95, 135], flower: [60, 90], pebble: [38, 62] };
const SWAY = { grass: 0.13, scrub: 0.05, flower: 0.12, pebble: 0 };

// ------------------------------------------------------------------------------------------------ geometry
function blades(n, r, h, w, tilt0, tilt1, seed, colBase, colTip) {
  const R = rngOf(seed, 1, 2), P = [], N = [], C = [], H = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + R() * 0.8, rr = r * Math.sqrt(R()), bx = Math.cos(a) * rr, bz = Math.sin(a) * rr;
    const tilt = tilt0 + (tilt1 - tilt0) * R(), hh = h * (0.6 + 0.4 * R()), ww = w * (0.7 + 0.6 * R());
    const ox = Math.cos(a) * Math.sin(tilt), oz = Math.sin(a) * Math.sin(tilt), oy = Math.cos(tilt);
    const px = -Math.sin(a) * ww * 0.5, pz = Math.cos(a) * ww * 0.5;           // blade width across its lean direction
    P.push(bx - px, 0, bz - pz, bx + px, 0, bz + pz, bx + ox * hh, oy * hh, bz + oz * hh);
    for (let k = 0; k < 3; k++) N.push(Math.cos(a) * 0.45, 1, Math.sin(a) * 0.45);
    C.push(...colBase, ...colBase, ...colTip); H.push(0, 0, 0);
  }
  return { P, N, C, H };
}
function toGeo({ P, N, C, H }) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aHead', new THREE.Float32BufferAttribute(H, 1));
  g.computeBoundingSphere();
  return g;
}
function buildGeos() {
  const grass = toGeo(blades(13, 0.11, 0.55, 0.085, 0.15, 0.7, 11, [0.3, 0.29, 0.25], [1.1, 1.08, 1.0]));
  const scrub = toGeo(blades(12, 0.16, 0.42, 0.11, 0.55, 1.15, 12, [0.28, 0.25, 0.22], [0.95, 0.9, 0.85]));
  // flowers: 4 stems (green) + a small 2-triangle head each (instance colour)
  const f = blades(4, 0.06, 0.45, 0.03, 0.05, 0.35, 13, [0.12, 0.2, 0.08], [0.22, 0.34, 0.14]);
  const R = rngOf(13, 3, 4);
  for (let i = 0; i < 4; i++) {
    const tx = f.P[i * 9 + 6], ty = f.P[i * 9 + 7], tz = f.P[i * 9 + 8], s = 0.05 + 0.03 * R(), a = R() * 3;
    const c = Math.cos(a) * s, d = Math.sin(a) * s;
    f.P.push(tx - c, ty, tz - d, tx + d, ty + 0.012, tz - c, tx + c, ty, tz + d, tx - c, ty, tz - d, tx + c, ty, tz + d, tx - d, ty + 0.012, tz + c);
    for (let k = 0; k < 6; k++) { f.N.push(0, 1, 0); f.C.push(1, 1, 1); f.H.push(1); }
  }
  const flower = toGeo(f);
  // pebble: squashed icosahedron, flat shaded (non-indexed, face normals), darker underside
  let pb = new THREE.IcosahedronGeometry(1, 0).toNonIndexed();
  const pp = pb.attributes.position; const RR = rngOf(14, 5, 6);
  for (let i = 0; i < pp.count; i++) pp.setXYZ(i, pp.getX(i) * (0.9 + 0.2 * RR()), pp.getY(i) * 0.55, pp.getZ(i) * (0.75 + 0.2 * RR()));
  pb = pb.toNonIndexed(); pb.computeVertexNormals();
  const pc = [], ph = [];
  for (let i = 0; i < pp.count; i++) { const k = 0.55 + 0.45 * Math.min(1, Math.max(0, pp.getY(i) / 0.55 + 0.5)); pc.push(k, k, k); ph.push(0); }
  pb.setAttribute('color', new THREE.Float32BufferAttribute(pc, 3)); pb.setAttribute('aHead', new THREE.Float32BufferAttribute(ph, 1));
  pb.deleteAttribute('uv'); pb.translate(0, 0.12, 0); pb.computeBoundingSphere();
  return { grass, scrub, flower, pebble: pb };
}

// ------------------------------------------------------------------------------------------------ material
function coverMaterial(kind) {
  const rock = kind === 'pebble';
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: rock ? 0.88 : 0.82, metalness: 0, side: rock ? THREE.FrontSide : THREE.DoubleSide });
  m.name = 'cover_' + kind;
  const u = { uFade: { value: new THREE.Vector2(FADE[kind][0], FADE[kind][1]) }, uSway: { value: SWAY[kind] } };
  m.userData.u = u;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = WIND.uTime; sh.uniforms.uWind = WIND.uWind; sh.uniforms.uFade = u.uFade; sh.uniforms.uSway = u.uSway;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aInst; attribute vec4 aInst2; attribute float aHead;
        uniform float uTime; uniform vec3 uWind; uniform vec2 uFade; uniform float uSway;
        vec3 unpackCol(float v) { float r = floor(v / 65536.0); float g = floor((v - r * 65536.0) / 256.0); return vec3(r, g, v - r * 65536.0 - g * 256.0) / 255.0; }`)
      .replace('#include <beginnormal_vertex>', `
        float cUpY = sqrt(max(0.05, 1.0 - dot(aInst2.yz, aInst2.yz)));
        vec3 cUp = vec3(aInst2.y, cUpY, aInst2.z);
        float cCy = cos(aInst.w), cSy = sin(aInst.w);
        mat2 cRot = mat2(cCy, -cSy, cSy, cCy);
        vec3 objectNormal = normal; objectNormal.xz = cRot * objectNormal.xz;
        ${rock ? '' : 'objectNormal = normalize(cUp + vec3(objectNormal.x, 0.0, objectNormal.z) * 0.9);'}`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position * aInst2.x;
        transformed.xz = cRot * transformed.xz;
        transformed.xz += cUp.xz * transformed.y / cUpY;
        ${rock ? '' : `{
          float hh = position.y;
          float ph = aInst.x * 0.37 + aInst.z * 0.29;
          float gust = 0.55 + 0.45 * sin(uTime * 1.9 + ph) + 0.3 * sin(uTime * 4.7 + ph * 2.3 + position.x * 5.0);
          transformed.xz += uWind.xz * (uSway * hh * hh * gust * aInst2.x);
        }`}
        vec3 cW = (modelMatrix * vec4(aInst.xyz, 1.0)).xyz;
        transformed *= 1.0 - smoothstep(uFade.x, uFade.y, distance(cW, cameraPosition));
        transformed += aInst.xyz;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vColor.rgb = mix(vColor.rgb * unpackCol(aInst2.w), unpackCol(aInst2.w), aHead);`);
    if (!rock) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal);`);
    }
  };
  m.customProgramCacheKey = () => (rock ? 'cover-rock' : 'cover-grass');
  return m;
}

let _shared = null;
/** Shared geometries + materials (created once per page; reused by every run). */
function shared() {
  if (_shared) return _shared;
  const geos = buildGeos();
  // one material per kind (own fade / sway uniforms) but only two shader programs (grass-like and rock)
  _shared = { geos, mats: Object.fromEntries(KINDS.map((k) => [k, coverMaterial(k)])), ready: false, warming: false };
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
  const dummies = ['grass', 'pebble'].map((k) => makeMesh(k, new Float32Array(8), 1, [0, -5000, 0], 1));
  w(dummies).then(() => { S.ready = true; for (const d of dummies) disposeCoverMesh(d); }, () => { S.ready = true; });
}

/** Meshes using every cover program (for Game.prewarm: compiled up front, so the runtime warm-up is instant). */
export function coverPrewarmMeshes() {
  return ['grass', 'pebble'].map((k) => { const m = makeMesh(k, new Float32Array(8), 1, [0, 0, 0], 1); m.visible = true; return m; });
}

function makeMesh(kind, data, n, anchor, rad) {
  const S = shared(), base = S.geos[kind];
  const g = new THREE.InstancedBufferGeometry();
  for (const k of ['position', 'normal', 'color', 'aHead']) g.setAttribute(k, base.attributes[k]);
  const buf = new THREE.InstancedInterleavedBuffer(data, 8, 1);
  g.setAttribute('aInst', new THREE.InterleavedBufferAttribute(buf, 4, 0));
  g.setAttribute('aInst2', new THREE.InterleavedBufferAttribute(buf, 4, 4));
  g.instanceCount = n;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, CHUNK_LEN / 2), rad);
  const mesh = new THREE.Mesh(g, S.mats[kind]);
  mesh.position.set(anchor[0], anchor[1], anchor[2]); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
  mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.visible = false;
  mesh.userData.cover = kind; mesh.name = 'cover_' + kind;
  return mesh;
}
/** Free one chunk's cover mesh (keeps the shared base buffers alive). */
export function disposeCoverMesh(mesh) {
  const g = mesh.geometry;
  for (const k of ['position', 'normal', 'color', 'aHead']) g.deleteAttribute(k);
  g.dispose();
}

// ------------------------------------------------------------------------------------------------ placement
const _g = {}, _rs = {};
const packCol = (c) => Math.round(Math.min(1, c.r) * 255) * 65536 + Math.round(Math.min(1, c.g) * 255) * 256 + Math.round(Math.min(1, c.b) * 255);
const _c = new THREE.Color();
function bdens(bio, kind) { return (COVER[bio.a][kind] ?? 0) * (1 - bio.w) + (COVER[bio.b][kind] ?? 0) * bio.w; }

/**
 * Generate this chunk's cover (time-sliced: returns false when the deadline hit; call again). Meshes are attached to the terrain record
 * (chunk.rec.cover) and added to its group; TerrainStreamer toggles their visibility and disposes them with the chunk.
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
    st = chunk._cover = { k: 0, i: 0, excl, bios, feats, out: [], anchor: road.sample(s0), data: null, n: 0, rad: 0 };
  }
  const q = Math.max(0, Math.min(3, ctx.quality ?? 2)), qk = [0.35, 0.65, 1, 1.25][q];
  while (st.k < KINDS.length) {
    const kind = KINDS[st.k];
    if (!st.data) {
      let D = 0; for (const b of st.bios) D = Math.max(D, bdens(b, kind));
      st.nCand = Math.ceil(D * qk * CHUNK_LEN * 2 * (A1 - A0)); st.D = D;
      st.data = new Float32Array(Math.max(8, st.nCand * 8)); st.n = 0; st.i = 0; st.rad = 0;
      st.rnd = rngOf(seed, chunk.c, strId('cover:' + kind));
    }
    const rnd = st.rnd, data = st.data, ax = st.anchor.x, ay = st.anchor.y, az = st.anchor.z;
    const [sc0, sc1] = SCALE[kind], ck = KEY[kind];
    while (st.i < st.nCand) {
      if ((st.i & 127) === 0 && st.i > 0 && performance.now() > deadline) return false;
      st.i++;
      const uSide = rnd(), uA = rnd(), uS = rnd(), uAcc = rnd(), uYaw = rnd(), uSc = rnd(), uCol = rnd(), uCl = rnd();
      const side = uSide < 0.5 ? 1 : -1;
      const a = A0 + (A1 - A0) * (kind === 'pebble' ? uA * uA : Math.pow(uA, 1.35));
      const s = s0 + uS * CHUNK_LEN;
      const bio = biomeAt(s);
      let dens = bdens(bio, kind);
      if (dens <= 0) continue;
      // lateral profile: sparse weeds on the gravel shoulder, full just past it, thinning out with distance
      const prof = a < 0 ? (kind === 'pebble' ? 1.3 : kind === 'grass' ? 0.22 : 0.05) : (kind === 'pebble' ? 1.0 - 0.6 * smoothstep(4, 30, a) : (0.55 + 0.45 * smoothstep(0, 3, a)) * (1 - 0.45 * smoothstep(10, 36, a)));
      dens *= prof;
      if (uAcc * st.D > dens) continue;
      const d = side * (EDGE + a);
      if (Math.abs(d) < HALF_ROAD + 0.45) continue;
      let gx, gy, gz, nx = 0, nz = 0;
      if (a < 0) { const p = road.pointAt(s, d, _rs); gx = p.x; gy = p.y; gz = p.z; }
      else { const g = chunk.ground.sample(s, d, _g); gx = g.x; gy = g.y; gz = g.z; nx = g.nx; nz = g.nz; if (1 - g.ny > (kind === 'pebble' ? 0.55 : 0.42)) continue; }
      // clumps: grass / flowers grow in patches, scrub is sparse and even, pebbles gather in washes
      const cn = vnoise2(gx / 7.5, gz / 7.5, seed + 71) * 0.65 + vnoise2(gx / 23, gz / 23, seed + 72) * 0.35;
      const cl = kind === 'grass' ? smoothstep(0.3, 0.62, cn) : kind === 'flower' ? smoothstep(0.55, 0.7, cn) : kind === 'pebble' ? 0.35 + 0.65 * smoothstep(0.62, 0.35, cn) : 1;
      if (uCl > cl) continue;
      if (gy < chunk.seaY + 0.6) continue;
      const roadY = road.sample(s, _rs).y;
      if (roadY - gy > 7) continue;                                    // down a cliff: not visible from the road anyway
      let bad = false;
      for (const f of st.feats) if (s > f.s0 - 25 && s < f.s1 + 25 && (f.type !== 'bridge' || Math.abs(d) < 14)) { bad = true; break; }
      if (bad) continue;
      for (let k = 0; k < st.excl.length; k++) { const z = st.excl[k], dx = gx - z[0], dz = gz - z[1]; if (dx * dx + dz * dz < z[2] * z[2]) { bad = true; break; } }
      if (bad) continue;
      // mountain snow fields: no grass above the snow line
      if (kind !== 'pebble' && bio.a === 'mountain' && gy > 200) continue;
      const scl = (sc0 + (sc1 - sc0) * uSc * uSc) * (kind === 'grass' && a < 0 ? 0.7 : 1);
      const L = LIN[bio.w > 0.5 ? bio.b : bio.a][ck];
      _c.copy(L[0]).lerp(L[1], uCol);
      if (kind !== 'flower') _c.multiplyScalar(0.8 + 0.4 * uCl);
      const o = st.n * 8;
      data[o] = gx - ax; data[o + 1] = gy - ay - (kind === 'pebble' ? scl * 0.45 : 0.02); data[o + 2] = gz - az; data[o + 3] = uYaw * 6.2832;
      const al = kind === 'pebble' ? 1 : 0.55;
      data[o + 4] = scl; data[o + 5] = nx * al; data[o + 6] = nz * al; data[o + 7] = packCol(_c);
      st.n++;
      const r2 = Math.hypot(gx - ax, gz - az - 0) + 2; if (r2 > st.rad) st.rad = r2;
    }
    if (st.n > 0) {
      const mesh = makeMesh(kind, st.data.slice(0, st.n * 8), st.n, [ax, ay, az], 0);
      // bounding sphere around the actual instances (local to the anchor)
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9, mnz = 1e9, mxz = -1e9;
      const dd = mesh.geometry.attributes.aInst.data.array;
      for (let i = 0; i < st.n; i++) { const x = dd[i * 8], y = dd[i * 8 + 1], z = dd[i * 8 + 2]; if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y; if (z < mnz) mnz = z; if (z > mxz) mxz = z; }
      mesh.geometry.boundingSphere.center.set((mnx + mxx) / 2, (mny + mxy) / 2, (mnz + mxz) / 2);
      mesh.geometry.boundingSphere.radius = 0.5 * Math.hypot(mxx - mnx, mxy - mny, mxz - mnz) + 1.5;
      mesh.userData.s0 = s0;
      (rec.cover || (rec.cover = [])).push(mesh); rec.group.add(mesh);
    }
    st.k++; st.data = null;
  }
  chunk._cover = null;
  return true;
}
