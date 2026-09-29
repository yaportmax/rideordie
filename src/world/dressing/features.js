// Road feature structures built from road.features: ramp, boost pad, roadblock, bridge, tunnel, overpass.
// Instanced structure pieces go through the shared pool (chunk lists); one-off procedural meshes (boost pad, bridge piers, tunnel hill cap) are chunk extras.
import * as THREE from 'three';
import { biomeAt } from '../../data/biomes.js';
import { terrainPoint, EDGE } from '../terrain_gen.js';
import { fbm2, smoothstep, clamp } from '../../core/util.js';
import { roadFrame, groundAt, CHUNK_LEN, seedOf } from './util.js';
import { need, useSpec } from './furniture.js';
import { makePierGeometry } from './procedural.js';

export const FEATURE_SPECS = {
  jump_ramp: { far: 650, shadow: true, behind: true, showRoad: true },
  jump_ramp_small: { far: 600, shadow: true, behind: true, showRoad: true },
  roadblock_wreck_line: { far: 650, shadow: true, behind: true },
  bridge_span_20m: { far: 1400, shadow: true, behind: true },
  bridge_span_20m_damaged: { far: 1400, shadow: true, behind: true },
  overpass_concrete: { far: 900, shadow: true, behind: true, showRoad: true },
  tunnel_portal_rock: { far: 2000, shadow: true, behind: true },
  tunnel_exit: { far: 2000, shadow: true, behind: true },
  tunnel_portal_rock_grey: { far: 2000, shadow: true, behind: true },
  tunnel_exit_grey: { far: 2000, shadow: true, behind: true },
  tunnel_portal_concrete: { far: 1500, shadow: true, behind: true },
  tunnel_exit_concrete: { far: 1500, shadow: true, behind: true },
  tunnel_mid_10m: { far: 700, shadow: true, behind: true },
  road_cone: { far: 220, shadow: false, lite: true },
  jersey_barrier: { far: 260, shadow: true, behind: true, lods: [{ asset: 'jersey_barrier', max: 90 }, { asset: 'jersey_lod', max: 1e9 }] },
  barrel: { far: 200, shadow: false, lite: true },
};

const _fr = {};
const _v = new THREE.Vector3();

/** Flatten an asset's local mesh ({pos, idx}) into world space through a road frame (+ optional local scale/offset). */
export function worldMesh(local, fr, sx = 1, sy = 1, sz = 1, ox = 0, oy = 0, oz = 0) {
  if (!local) return null;
  const src = local.pos, n = src.length / 3, out = new Float32Array(src.length);
  for (let i = 0; i < n; i++) {
    const x = src[i * 3] * sx + ox, y = src[i * 3 + 1] * sy + oy, z = src[i * 3 + 2] * sz + oz;
    out[i * 3] = fr.x + fr.lx * x + fr.ux * y + fr.fx * z;
    out[i * 3 + 1] = fr.y + fr.ly * x + fr.uy * y + fr.fy * z;
    out[i * 3 + 2] = fr.z + fr.lz * x + fr.uz * y + fr.fz * z;
  }
  return { pos: out, idx: local.idx };
}
function surfaceLocal(asset) {
  const p = asset.parts.find((q) => q.role === 'road'); if (!p) return null;
  const g = p.geometry, pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 3); for (let i = 0; i < pos.count; i++) { arr[i * 3] = pos.getX(i); arr[i * 3 + 1] = pos.getY(i); arr[i * 3 + 2] = pos.getZ(i); }
  const idx = new Uint32Array(g.index ? g.index.count : pos.count); if (g.index) for (let i = 0; i < idx.length; i++) idx[i] = g.index.getX(i); else for (let i = 0; i < idx.length; i++) idx[i] = i;
  return { pos: arr, idx };
}
function mergeMeshes(list) {
  let np = 0, ni = 0; for (const m of list) if (m) { np += m.pos.length; ni += m.idx.length; }
  const pos = new Float32Array(np), idx = new Uint32Array(ni); let po = 0, io = 0, base = 0;
  for (const m of list) { if (!m) continue; pos.set(m.pos, po); for (let i = 0; i < m.idx.length; i++) idx[io + i] = m.idx[i] + base; po += m.pos.length; io += m.idx.length; base += m.pos.length / 3; }
  return { pos, idx };
}
const frameOf = (fr) => ({ x: fr.x, y: fr.y, z: fr.z, fx: fr.fx, fy: fr.fy, fz: fr.fz, ux: fr.ux, uy: fr.uy, uz: fr.uz, lx: fr.lx, ly: fr.ly, lz: fr.lz, yaw: fr.yaw });

function put(chunk, name, fr, sx = 1, sy = 1, sz = 1, lift = 0, rad = 12) {
  chunk.list(name).pushBasis(fr.x + fr.ux * lift, fr.y + fr.uy * lift, fr.z + fr.uz * lift, fr.lx, fr.ly, fr.lz, fr.ux, fr.uy, fr.uz, fr.fx, fr.fy, fr.fz, sx, sy, sz, rad);
}
function putFlip(chunk, name, fr, len, sx = 1, lift = 0, rad = 12) { // 180 degrees about up, origin at the far end of the piece
  const ox = fr.x + fr.fx * len, oy = fr.y + fr.fy * len, oz = fr.z + fr.fz * len;
  chunk.list(name).pushBasis(ox + fr.ux * lift, oy + fr.uy * lift, oz + fr.uz * lift, -fr.lx, -fr.ly, -fr.lz, fr.ux, fr.uy, fr.uz, -fr.fx, -fr.fy, -fr.fz, sx, 1, 1, rad);
}

// ------------------------------------------------------------------------------------------------ boost pad texture / material
let _boostMat = null, _boostTex = null;
export function boostTexture() {
  if (_boostTex) return _boostTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#04131a'; g.fillRect(0, 0, 128, 256);
  // hazard edge stripes
  for (let y = 0; y < 256; y += 16) { g.fillStyle = (y / 16) % 2 ? '#e8b400' : '#151515'; g.fillRect(0, y, 7, 16); g.fillRect(121, y, 7, 16); }
  // chevrons pointing up (+v = forward)
  for (let k = 0; k < 4; k++) {
    const y0 = 20 + k * 62;
    const grad = g.createLinearGradient(0, y0, 0, y0 + 46); grad.addColorStop(0, '#9af6ff'); grad.addColorStop(1, '#19b8ff');
    g.fillStyle = grad; g.beginPath(); g.moveTo(64, y0); g.lineTo(116, y0 + 34); g.lineTo(116, y0 + 52); g.lineTo(64, y0 + 20); g.lineTo(12, y0 + 52); g.lineTo(12, y0 + 34); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  _boostTex = t; return t;
}
function boostMaterial() {
  if (_boostMat) return _boostMat;
  const t = boostTexture();
  _boostMat = new THREE.MeshStandardMaterial({ color: 0x223038, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 2.3, roughness: 0.45, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  _boostMat.name = 'boost_pad';
  return _boostMat;
}
export function updateBoostAnim(dt) { if (_boostTex) _boostTex.offset.y = (_boostTex.offset.y - dt * 0.9) % 1; }

// ------------------------------------------------------------------------------------------------ builders
function buildRamp(ctx, chunk, f) {
  const name = f.big ? 'jump_ramp' : 'jump_ramp_small';
  const a = need(ctx, name); if (a === undefined) return false; if (!a) return true;
  useSpec(ctx, name, FEATURE_SPECS[name]);
  const d = f.big ? 0 : f.lane * 3.5;
  const len = f.big ? 12 : 7.5;
  const fr = roadFrame(ctx.road, f.s0 + 0.5, len, d, _fr);
  put(chunk, name, fr, 1, 1, 1, 0.03, 12);
  const id = `ramp:${Math.round(f.s0 * 10)}`; chunk.hooks.push(id);
  ctx.hook({ type: 'ramp', id, s0: f.s0, s1: f.s1, lane: f.lane, big: f.big, d, length: len, lipHeight: f.big ? 2.2 : 1.15, frame: frameOf(fr),
    surface: worldMesh(surfaceLocal(a), fr, 1, 1, 1, 0, 0.03, 0), collision: worldMesh(a.collision, fr, 1, 1, 1, 0, 0.03, 0) });
  return true;
}

function buildBoost(ctx, chunk, f) {
  const { road } = ctx;
  const d = f.lane * 3.5, hw = 1.62, n = Math.max(2, Math.round((f.s1 - f.s0) / 1) + 1);
  const pos = new Float32Array(n * 2 * 3), uv = new Float32Array(n * 2 * 2), idx = [];
  const p = {}; let ax = 0, ay = 0, az = 0;
  const a0 = road.pointAt(f.s0, d, {}); ax = a0.x; ay = a0.y; az = a0.z;
  for (let i = 0; i < n; i++) {
    const s = f.s0 + (f.s1 - f.s0) * i / (n - 1);
    for (let k = 0; k < 2; k++) {
      road.pointAt(s, d + (k ? -hw : hw), p);
      const o = (i * 2 + k) * 3; pos[o] = p.x - ax; pos[o + 1] = p.y + 0.045 - ay; pos[o + 2] = p.z - az;
      uv[(i * 2 + k) * 2] = k; uv[(i * 2 + k) * 2 + 1] = (s - f.s0) / 3.2;
    }
    if (i < n - 1) { const a = i * 2, b = i * 2 + 1, c = i * 2 + 2, e = i * 2 + 3; idx.push(a, c, b, b, c, e); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  const flipUp = g.attributes.normal.getY(0) < 0; if (flipUp) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, boostMaterial()); m.position.set(ax, ay, az); m.userData.ownGeo = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
  chunk.addExtra(m);
  const fr = roadFrame(road, f.s0, f.s1 - f.s0, d, {});
  const id = `boost:${Math.round(f.s0 * 10)}`; chunk.hooks.push(id);
  ctx.hook({ type: 'boost', id, s0: f.s0, s1: f.s1, lane: f.lane, d, halfWidth: hw, length: f.s1 - f.s0, frame: frameOf(fr) });
  return true;
}

function buildRoadblock(ctx, chunk, f) {
  const a = need(ctx, 'roadblock_wreck_line'), cone = need(ctx, 'road_cone'), jb = need(ctx, 'jersey_barrier'), jl = need(ctx, 'jersey_lod'), brl = need(ctx, 'barrel');
  if ([a, cone, jb, jl, brl].some((x) => x === undefined)) return false;
  if (!a) return true;
  const { road } = ctx;
  useSpec(ctx, 'roadblock_wreck_line', FEATURE_SPECS.roadblock_wreck_line);
  if (cone) useSpec(ctx, 'road_cone', FEATURE_SPECS.road_cone);
  if (jb) useSpec(ctx, 'jersey_barrier', FEATURE_SPECS.jersey_barrier);
  if (brl) useSpec(ctx, 'barrel', FEATURE_SPECS.barrel);
  const dGap = clamp(f.gap * 2.2, -4.6, 4.6);
  let fr;
  if (dGap >= 0) { fr = roadFrame(road, f.s0, 9, dGap - 2.6, _fr); put(chunk, 'roadblock_wreck_line', fr, 1, 1, 1, 0.02, 14); }
  else { fr = roadFrame(road, f.s0, 9, dGap + 2.6, _fr); putFlip(chunk, 'roadblock_wreck_line', fr, 9, 1, 0.02, 14); }
  const meshFr = frameOf(fr);
  const collision = dGap >= 0 ? worldMesh(a.collision, fr, 1, 1, 1, 0, 0.02, 0)
    : worldMesh(a.collision, { ...meshFr, x: fr.x + fr.fx * 9, y: fr.y + fr.fy * 9, z: fr.z + fr.fz * 9, lx: -fr.lx, ly: -fr.ly, lz: -fr.lz, fx: -fr.fx, fy: -fr.fy, fz: -fr.fz }, 1, 1, 1, 0, 0.02, 0);
  // approach: taper of cones from both edges toward the gap, jersey barriers, a couple of barrels
  const P = {};
  if (cone) {
    const L = chunk.list('road_cone');
    for (let side = -1; side <= 1; side += 2) {
      const from = side * 7.6, to = dGap + side * 2.9;
      if (Math.abs(to) > Math.abs(from) - 0.5) continue;
      for (let k = 0; k < 9; k++) {
        const t = k / 8, s = f.s0 - 36 + 29 * t, d = from + (to - from) * t;
        road.pointAt(s, d, P); L.push(P.x, P.y, P.z, k * 1.7, 1.15, 1.15, 1.15, 0, 1, 0, 0, 1);
      }
    }
  }
  if (jb) {
    const L = chunk.list('jersey_barrier');
    for (const [ds, d, ang] of [[-14, -6.4, 0.5], [-10, 6.2, -0.45], [-6.5, dGap - 4.0, 0.25], [-5.5, dGap + 4.4, -0.3]]) {
      const q = roadFrame(road, f.s0 + ds - 1.8, 3.7, d, {});
      const c = Math.cos(ang), s = Math.sin(ang);
      const lx = q.lx * c + q.fx * s, ly = q.ly * c + q.fy * s, lz = q.lz * c + q.fz * s, fx = q.fx * c - q.lx * s, fy = q.fy * c - q.ly * s, fz = q.fz * c - q.lz * s;
      L.pushBasis(q.x + q.fx * 1.85, q.y + q.fy * 1.85, q.z + q.fz * 1.85, lx, ly, lz, q.ux, q.uy, q.uz, fx, fy, fz, 1, 1, 1, 2.2);
    }
  }
  if (brl) {
    const L = chunk.list('barrel');
    for (const [ds, d] of [[-3.5, dGap - 3.4], [-2.6, dGap + 3.7], [-4.4, dGap + 3.2]]) { road.pointAt(f.s0 + ds, d, P); L.push(P.x, P.y, P.z, ds * 3, 1, 1, 1, 0, 1, 0, 0, 0.6); }
  }
  const id = `roadblock:${Math.round(f.s0 * 10)}`; chunk.hooks.push(id);
  ctx.hook({ type: 'roadblock', id, s0: f.s0, s1: f.s1, gap: dGap, gapLane: f.gap, width: 4.4, frame: meshFr, collision });
  return true;
}

function buildOverpass(ctx, chunk, f) {
  const a = need(ctx, 'overpass_concrete'); if (a === undefined) return false; if (!a) return true;
  useSpec(ctx, 'overpass_concrete', FEATURE_SPECS.overpass_concrete);
  const sm = (f.s0 + f.s1) / 2;
  const fr = roadFrame(ctx.road, sm - 6, 12, 0, _fr);
  put(chunk, 'overpass_concrete', fr, 1, 1, 1, 0, 30);
  const id = `overpass:${Math.round(f.s0 * 10)}`; chunk.hooks.push(id);
  ctx.hook({ type: 'overpass', id, s0: f.s0, s1: f.s1, deckY: fr.y + 8, clearance: 6.5, frame: frameOf(fr), collision: worldMesh(a.collision, fr), surface: worldMesh(surfaceLocal(a), fr) });
  return true;
}

let _pierMat = null;
function pierMaterial() { return _pierMat || (_pierMat = new THREE.MeshStandardMaterial({ color: 0x9a9588, roughness: 0.95, metalness: 0, vertexColors: true })); }

function buildBridge(ctx, chunk, f) {
  const a = need(ctx, 'bridge_span_20m'), b = need(ctx, 'bridge_span_20m_damaged');
  if (a === undefined || b === undefined) return false;
  if (!a) return true;
  const { road, seed } = ctx;
  useSpec(ctx, 'bridge_span_20m', FEATURE_SPECS.bridge_span_20m); if (b) useSpec(ctx, 'bridge_span_20m_damaged', FEATURE_SPECS.bridge_span_20m_damaged);
  const N = Math.max(1, Math.round((f.s1 - f.s0) / 20)), L = (f.s1 - f.s0) / N, sx = 19.4 / 16;
  const cols = [];
  for (let k = 0; k < N; k++) {
    const fr = roadFrame(road, f.s0 + k * L, L, 0, {});
    const dmg = b && ((seedOf(seed, Math.round(f.s0), k) >>> 5) % 100) < 14;
    const name = dmg ? 'bridge_span_20m_damaged' : 'bridge_span_20m';
    put(chunk, name, fr, sx, 1, L / 20, -0.09, 22);
    cols.push(worldMesh((dmg ? b : a).collision, fr, sx, 1, L / 20, 0, -0.09, 0));
  }
  // piers down to the ravine floor
  const P = {};
  const bridges = [f];
  for (let k = 0; k <= N; k++) {
    const s = f.s0 + k * L;
    const sm = road.sample(s, {});
    const g = terrainPoint(road, seed, s, EDGE + 1.0, P, bridges);
    const g2 = terrainPoint(road, seed, s, -(EDGE + 1.0), {}, bridges);
    const gy = Math.min(g.y, g2.y);
    const deckUnder = sm.y - 2.0;
    const h = deckUnder - gy + 0.6;
    if (h < 3.5) continue;
    const geo = makePierGeometry(h);
    const m = new THREE.Mesh(geo, pierMaterial());
    m.position.set(sm.x, gy - 0.6, sm.z); m.rotation.y = sm.th; m.userData.ownGeo = true; m.castShadow = true; m.receiveShadow = true;
    chunk.addExtra(m);
  }
  if (f.depth > 6 && !buildRavineFloor(ctx, chunk, f)) return false;
  const id = `bridge:${Math.round(f.s0 * 10)}`; chunk.hooks.push(id);
  ctx.hook({ type: 'bridge', id, s0: f.s0, s1: f.s1, depth: f.depth, spans: N, collision: mergeMeshes(cols) });
  return true;
}

// ------------------------------------------------------------------------------------------------ tunnel
function tunnelKit(f, s) {
  const b = biomeAt(s), id = b.w > 0.5 ? b.b : b.a;
  if (!f.rock) return { pin: 'tunnel_portal_concrete', pout: 'tunnel_exit_concrete', rockKind: null };
  if (id === 'canyon' || id === 'desert') return { pin: 'tunnel_portal_rock', pout: 'tunnel_exit', rockKind: 'red' };
  return { pin: 'tunnel_portal_rock_grey', pout: 'tunnel_exit_grey', rockKind: 'grey' };
}

const LAYER = { dirt_red: 1, rock_red: 4, rock_grey: 5, forest_floor: 7, grass_green: 8, cliff: 10 };

/** Build a terrain-material mesh from a (rows x cols) grid of {x,y,z,ty}; splat weights derived from slope and rock kind. Winding matches the terrain strips (+d = left, +s = forward). */
function gridMesh(ctx, chunk, mat, grid, kind, opts = {}) {
  const ROWS = grid.length, NC = grid[0].length, seed = ctx.seed;
  const a0 = grid[0][0], ax = a0.x, ay = a0.y, az = a0.z;
  const pos = [], nor = [], sp0 = [], sp1 = [], sp2 = [], mac = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < NC; c++) {
    const p = grid[r][c];
    const pr = grid[Math.min(ROWS - 1, r + 1)][c], pl = grid[Math.max(0, r - 1)][c], pc = grid[r][Math.min(NC - 1, c + 1)], pd = grid[r][Math.max(0, c - 1)];
    const tsx = pr.x - pl.x, tsy = pr.y - pl.y, tsz = pr.z - pl.z, tdx = pc.x - pd.x, tdy = pc.y - pd.y, tdz = pc.z - pd.z;
    let nx = tsy * tdz - tsz * tdy, ny = tsz * tdx - tsx * tdz, nz = tsx * tdy - tsy * tdx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    pos.push(p.x - ax, p.y - ay, p.z - az); nor.push(nx, ny, nz);
    const steep = smoothstep(0.35, 0.7, 1 - ny);
    const w = new Float32Array(12);
    if (kind === 'red') { w[LAYER.rock_red] = 0.75 * (1 - steep) + 0.2; w[LAYER.cliff] = steep * 0.8; w[LAYER.dirt_red] = 0.25 * (1 - steep); }
    else if (kind === 'dirt') { w[LAYER.dirt_red] = 0.8 * (1 - steep) + 0.1; w[LAYER.rock_red] = 0.3 * (1 - steep) + steep * 0.4; w[LAYER.cliff] = steep * 0.5; }
    else { w[LAYER.rock_grey] = 0.7 * (1 - steep) + 0.2; w[LAYER.cliff] = steep * 0.8; w[LAYER.forest_floor] = 0.3 * (1 - steep) * smoothstep(0.02, 0.15, p.y - p.ty); }
    let sum = 0; for (let k = 0; k < 12; k++) sum += w[k]; if (sum < 1e-3) { w[LAYER.rock_grey] = 1; sum = 1; }
    for (let k = 0; k < 4; k++) { sp0.push(w[k] / sum); sp1.push(w[4 + k] / sum); sp2.push(w[8 + k] / sum); }
    mac.push(0.92 + 0.16 * fbm2(p.x / 60, p.z / 60, 2, seed + 993));
  }
  const idx = [];
  const at = (r, c) => r * NC + c;
  for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < NC - 1; c++) { const a = at(r, c), b = at(r + 1, c), cc = at(r + 1, c + 1), d = at(r, c + 1); idx.push(a, b, cc, a, cc, d); }
  if (opts.skirt) {
    const ring = [];
    for (let c = 0; c < NC; c++) ring.push([0, c]);
    for (let r = 1; r < ROWS; r++) ring.push([r, NC - 1]);
    for (let c = NC - 2; c >= 0; c--) ring.push([ROWS - 1, c]);
    for (let r = ROWS - 2; r >= 1; r--) ring.push([r, 0]);
    const s0i = pos.length / 3;
    for (const [r, c] of ring) {
      const src = at(r, c);
      pos.push(pos[src * 3], pos[src * 3 + 1] - opts.skirt, pos[src * 3 + 2]); nor.push(nor[src * 3], nor[src * 3 + 1], nor[src * 3 + 2]);
      for (let k = 0; k < 4; k++) { sp0.push(sp0[src * 4 + k]); sp1.push(sp1[src * 4 + k]); sp2.push(sp2[src * 4 + k]); } mac.push(mac[src]);
    }
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length, a = at(ring[i][0], ring[i][1]), b = at(ring[j][0], ring[j][1]), a2 = s0i + i, b2 = s0i + j;
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aSplat0', new THREE.Float32BufferAttribute(sp0, 4)); g.setAttribute('aSplat1', new THREE.Float32BufferAttribute(sp1, 4)); g.setAttribute('aSplat2', new THREE.Float32BufferAttribute(sp2, 4));
  g.setAttribute('aMacro', new THREE.Float32BufferAttribute(mac, 1)); g.setIndex(idx); g.computeBoundingSphere();
  const m = new THREE.Mesh(g, mat); m.position.set(ax, ay, az); m.castShadow = !!opts.cast; m.receiveShadow = true; m.userData.ownGeo = true; m.matrixAutoUpdate = false; m.updateMatrix();
  chunk.addExtra(m);
  return m;
}

function buildCap(ctx, chunk, f, rockKind) {
  const mat = chunk.rec && chunk.rec.mesh && chunk.rec.mesh.material;
  if (!mat) return false;
  const { road, seed } = ctx;
  const s0 = f.s0 + 9, s1 = f.s1 - 9;
  if (s1 - s0 < 20) return true;
  const ROWS = Math.max(3, Math.round((s1 - s0) / 7) + 1);
  const DCOL = [0, 5, 9, 13, 18, 24, 31, 39, 48, 58];
  const NC = DCOL.length * 2 - 1;   // -58 .. 58
  const at = (c) => (c < DCOL.length ? -DCOL[DCOL.length - 1 - c] : DCOL[c - DCOL.length + 1]);
  const P = {}, grid = [];
  for (let r = 0; r < ROWS; r++) {
    const s = s0 + (s1 - s0) * r / (ROWS - 1), sm = road.sample(s, {});
    const endK = smoothstep(s0, s0 + 26, s) * (1 - smoothstep(s1 - 26, s1, s));
    const H = 14.5 + 6.5 * endK;
    const row = [];
    for (let c = 0; c < NC; c++) {
      const d = at(c), ad = Math.abs(d);
      let ty;
      if (ad <= EDGE) ty = road.surfaceY(sm, d); else { terrainPoint(road, seed, s, d, P, undefined); ty = P.y; }
      const prof = 1 - smoothstep(4, 56, ad);
      const noise = (fbm2(s / 26, d / 22, 3, seed + 991) - 0.5) * 6.5 * smoothstep(6, 30, ad) + (fbm2(s / 9, d / 9, 2, seed + 992) - 0.5) * 1.2;
      const capY = sm.y + H * prof * prof * (3 - 2 * prof) + noise * prof;
      row.push({ x: sm.x + sm.nx * d, y: Math.max(ty, capY), z: sm.z + sm.nz * d, ty });
    }
    grid.push(row);
  }
  gridMesh(ctx, chunk, mat, grid, rockKind, { skirt: 9, cast: true });
  return true;
}

/** Ravine floor under a bridge deck (the terrain strips only exist outside |d| > 9.5 m, so without this you can look through the world under the deck). */
function buildRavineFloor(ctx, chunk, f) {
  const mat = chunk.rec && chunk.rec.mesh && chunk.rec.mesh.material;
  if (!mat) return false;
  const { road, seed } = ctx;
  const bridges = [f];
  const sA = f.s0 - 45, sB = f.s1 + 45, ROWS = Math.max(3, Math.round((sB - sA) / 8) + 1);
  const P = {}, grid = [];
  const bio = biomeAt((f.s0 + f.s1) / 2), id = bio.w > 0.5 ? bio.b : bio.a;
  for (let r = 0; r < ROWS; r++) {
    const s = sA + (sB - sA) * r / (ROWS - 1), sm = road.sample(s, {});
    const yl = terrainPoint(road, seed, s, EDGE + 0.02, P, bridges).y, yr = terrainPoint(road, seed, s, -(EDGE + 0.02), P, bridges).y;
    const row = [];
    for (let c = 0; c < 5; c++) {
      const d = (c - 2) * (EDGE + 0.05) / 2;                       // -9.55 .. +9.55, d increases with c (left is +d)
      const t = (d / (EDGE + 0.02) + 1) / 2;                       // 0 right .. 1 left
      const y = Math.min(yr + (yl - yr) * t, sm.y - 0.45);
      row.push({ x: sm.x + sm.nx * d, y, z: sm.z + sm.nz * d, ty: y });
    }
    grid.push(row);
  }
  gridMesh(ctx, chunk, mat, grid, id === 'canyon' || id === 'desert' ? 'dirt' : 'grey', { skirt: 0 });
  return true;
}

function buildTunnel(ctx, chunk, f) {
  const kit = tunnelKit(f, (f.s0 + f.s1) / 2);
  const names = [kit.pin, kit.pout, 'tunnel_mid_10m'];
  const A = names.map((n) => need(ctx, n));
  if (A.some((x) => x === undefined)) return false;
  if (A.some((x) => x === null)) return true;
  const { road } = ctx;
  for (const n of names) useSpec(ctx, n, FEATURE_SPECS[n]);
  const cols = [];
  const fin = roadFrame(road, f.s0, 12, 0, {});
  put(chunk, kit.pin, fin, 1, 1, 1, 0, 40); cols.push(worldMesh(A[0].collision, fin));
  const fout = roadFrame(road, f.s1 - 12, 12, 0, {});
  put(chunk, kit.pout, fout, 1, 1, 1, 0, 40); cols.push(worldMesh(A[1].collision, fout));
  const s0 = f.s0 + 12, s1 = f.s1 - 12, n = Math.max(1, Math.round((s1 - s0) / 10)), L = (s1 - s0) / n;
  for (let k = 0; k < n; k++) {
    const fr = roadFrame(road, s0 + k * L, L, 0, {});
    put(chunk, 'tunnel_mid_10m', fr, 1, 1, L / 10, 0, 12);
    cols.push(worldMesh(A[2].collision, fr, 1, 1, L / 10));
  }
  const capOk = buildCap(ctx, chunk, f, kit.rockKind || 'grey');
  if (!capOk) return false;
  const id = `tunnel:${Math.round(f.s0 * 10)}`; chunk.hooks.push(id);
  ctx.hook({ type: 'tunnel', id, s0: f.s0, s1: f.s1, rock: f.rock, collision: mergeMeshes(cols), clearHeight: 7.4, halfWidth: 7.4 });
  return true;
}

// ------------------------------------------------------------------------------------------------ dispatcher
/** Features are built by the chunk that contains their END (long structures live as long as their last chunk) or, for short ones, their start. */
export function buildFeatures(ctx, chunk) {
  const { road } = ctx, s0 = chunk.s0, s1 = s0 + CHUNK_LEN;
  const list = road.featuresIn(s0 - 500, s1 + 1, undefined);
  let ok = true;
  for (const f of list) {
    const long = f.type === 'bridge' || f.type === 'tunnel';
    const key = f.type === 'overpass' ? (f.s0 + f.s1) / 2 : long ? f.s1 : f.s0;
    if (key < s0 || key >= s1) continue;
    const tag = `feat:${f.type}:${Math.round(f.s0 * 10)}`;
    if (chunk.done.has(tag)) continue;
    let r = true;
    switch (f.type) {
      case 'ramp': r = buildRamp(ctx, chunk, f); break;
      case 'boost': r = buildBoost(ctx, chunk, f); break;
      case 'roadblock': r = buildRoadblock(ctx, chunk, f); break;
      case 'bridge': r = buildBridge(ctx, chunk, f); break;
      case 'tunnel': r = buildTunnel(ctx, chunk, f); break;
      case 'overpass': r = buildOverpass(ctx, chunk, f); break;
      default: break;
    }
    if (r) chunk.done.add(tag); else ok = false;
  }
  chunk.dirty = true;
  return ok;
}

export { groundAt };
void _v;
