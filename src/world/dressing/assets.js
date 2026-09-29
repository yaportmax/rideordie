// Asset kit for the dressing system: reads props/structures manifests at runtime, loads GLBs on demand and
// splits them into instancing-friendly parts (one geometry+material per mesh node), collision meshes and sockets.
// Missing files never throw: state(name) === 'missing' and get(name) === null.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KEEP = new Set(['position', 'normal', 'uv', 'color']);

/** Structures whose drivable surface stays visible in the merged far LOD (the road strip does not run over them). */
const MERGE_ROAD = new Set(['jump_ramp', 'jump_ramp_small', 'overpass_concrete']);

/** Shared wind uniforms (updated by Dressing.update). */
export const WIND = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector3(0.9, 0, 0.42) },
};

export class AssetKit {
  constructor(base = '/models/') {
    this.base = base;
    this.loader = new GLTFLoader();
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.props = {}; this.structs = {};
    this.assets = new Map();   // name -> Asset | null(missing)
    this.loading = new Map();  // name -> Promise
    this.ready = false;
    this.lodPlan = new Map();  // asset -> [cell divisions] : derived 'name@1', 'name@2' assets via vertex clustering
  }

  async init() {
    const get = async (u) => { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch { return null; } };
    const [p, s] = await Promise.all([get(`${this.base}props/manifest.json`), get(`${this.base}structures/manifest.json`)]);
    if (p && p.props) this.props = p.props;
    if (s && s.structures) {
      const arr = Array.isArray(s.structures) ? s.structures : Object.values(s.structures);
      for (const e of arr) this.structs[e.id] = e;
    }
    this.ready = true;
  }

  urlFor(name) {
    if (this.structs[name]) { const f = this.structs[name].file; return f.startsWith('/') ? f : '/' + f; }
    if (this.props[name]) return `${this.base}props/${this.props[name].file}`;
    return null;
  }

  /** 'ready' | 'loading' | 'missing' | 'idle' */
  state(name) {
    if (this.assets.has(name)) return this.assets.get(name) ? 'ready' : 'missing';
    return this.loading.has(name) ? 'loading' : 'idle';
  }
  get(name) { return this.assets.get(name) || null; }

  /** Start loading (idempotent). Resolves to the Asset or null. */
  request(name) {
    if (this.assets.has(name)) return Promise.resolve(this.assets.get(name));
    if (this.loading.has(name)) return this.loading.get(name);
    const known = this.urlFor(name);
    // files that are not in a manifest yet (other agents still adding assets): probe the props folder, then structures.
    const candidates = known ? [known] : [`${this.base}props/${name}.glb`, `${this.base}structures/${name}.glb`];
    const p = (async () => {
      for (const url of candidates) {
        const asset = await this._loadOne(name, url);
        if (asset) {
          this.assets.set(name, asset);
          const plan = this.lodPlan.get(name);
          if (plan) plan.forEach((div, i) => this.assets.set(`${name}@${i + 1}`, deriveLod(asset, div)));
          if (asset.kind === 'struct' && asset.parts.length > 3) this.deriveMerged(name, { includeRoad: MERGE_ROAD.has(name) });
          return asset;
        }
      }
      this.assets.set(name, null);
      return null;
    })();
    this.loading.set(name, p);
    p.finally(() => this.loading.delete(name));
    return p;
  }
  requestMany(names) { return Promise.all(names.map((n) => this.request(n))); }

  async _loadOne(name, url) {
    // HEAD-less probe: Vite dev server answers unknown paths with index.html (200), so check the GLB magic via the loader error path
    let gltf;
    try { gltf = await new Promise((res, rej) => this.loader.load(url, res, undefined, rej)); } catch { return null; }
    try { return this._extract(name, gltf, url); } catch (e) { console.warn('[dressing] bad asset', name, e); return null; }
  }

  _extract(name, gltf, url) {
    const root = gltf.scene; root.updateMatrixWorld(true);
    const kind = url.includes('/structures/') ? 'struct' : 'prop';
    const asset = { name, kind, url, parts: [], sockets: {}, collision: null, box: new THREE.Box3(), tris: 0, hasRoad: false };
    const colPos = [], colIdx = []; let colBase = 0;
    root.traverse((o) => {
      if (o.isMesh) {
        const mat = Array.isArray(o.material) ? o.material[0] : o.material;
        const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!KEEP.has(k)) g.deleteAttribute(k);
        const isCol = o.name === 'collision' || (mat && mat.name === 'collision') || (o.userData && o.userData.role === 'collision');
        if (isCol) {
          const p = g.attributes.position; for (let i = 0; i < p.count; i++) colPos.push(p.getX(i), p.getY(i), p.getZ(i));
          if (g.index) for (let i = 0; i < g.index.count; i++) colIdx.push(g.index.getX(i) + colBase); else for (let i = 0; i < p.count; i++) colIdx.push(i + colBase);
          colBase += p.count; g.dispose(); return;
        }
        g.computeBoundingBox(); g.computeBoundingSphere();
        asset.box.union(g.boundingBox);
        const tris = (g.index ? g.index.count : g.attributes.position.count) / 3; asset.tris += tris;
        const role = o.name === 'road_surface' ? 'road' : 'main';
        if (role === 'road') asset.hasRoad = true;
        asset.parts.push({ name: o.name || (mat && mat.name) || 'part', geometry: g, material: mat, role, tris });
        if (mat && mat.map) mat.map.anisotropy = 4;
      } else if (o !== root && o.name && !o.children.length && (o.type === 'Object3D' || o.type === 'Group')) {
        asset.sockets[o.name] = o.getWorldPosition(new THREE.Vector3());
      }
    });
    if (colPos.length) asset.collision = { pos: new Float32Array(colPos), idx: new Uint32Array(colIdx) };
    const size = asset.box.getSize(new THREE.Vector3());
    asset.size = size; asset.height = asset.box.max.y; asset.radius = Math.max(size.x, size.z) * 0.5;
    asset.sphere = asset.box.getBoundingSphere(new THREE.Sphere());
    return asset;
  }

  /** Register 'name@m': every non-emissive part baked into ONE vertex-coloured geometry (1 draw call for the far LOD). */
  deriveMerged(name, opts = {}) {
    const key = name + '@m';
    if (this.assets.has(key)) return this.assets.get(key);
    const base = this.assets.get(name); if (!base) return null;
    const geos = [], keep = [];
    for (const p of base.parts) {
      if (p.role === 'road' && !opts.includeRoad) continue;
      const m = p.material, g = p.geometry, n = g.attributes.position.count;
      const emissive = m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0.05;
      if (emissive) { keep.push(p); continue; }
      const c0 = g.attributes.color, col = new Float32Array(n * 3);
      const glass = m.transparent;
      for (let i = 0; i < n; i++) {
        let r = m.color.r * (c0 ? c0.getX(i) : 1), gg = m.color.g * (c0 ? c0.getY(i) : 1), b = m.color.b * (c0 ? c0.getZ(i) : 1);
        if (glass) { r = r * 0.5 + 0.03; gg = gg * 0.5 + 0.045; b = b * 0.5 + 0.06; }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      }
      const ng = new THREE.BufferGeometry();
      ng.setAttribute('position', g.attributes.position); ng.setAttribute('normal', g.attributes.normal); ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (g.index) ng.setIndex(g.index);
      geos.push(ng);
    }
    const parts = [];
    if (geos.length) {
      const mg = mergeGeometries(geos.map((q) => (q.index ? q : q.toNonIndexed())), false);
      mg.computeBoundingBox(); mg.computeBoundingSphere();
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06, side: THREE.DoubleSide });
      mat.name = 'merged';
      const tris = (mg.index ? mg.index.count : mg.attributes.position.count) / 3;
      parts.push({ name: 'merged', geometry: mg, material: mat, role: 'main', tris });
    }
    for (const p of keep) parts.push(p);
    const out = { ...base, name: key, parts, tris: parts.reduce((a, q) => a + q.tris, 0), derived: true };
    this.assets.set(key, out);
    return out;
  }

  dispose() {
    for (const a of this.assets.values()) if (a) for (const p of a.parts) { p.geometry.dispose(); }
    this.assets.clear(); this.loading.clear();
  }
}

/**
 * Clone + patch a material for instanced use: optional cheap wind sway, distance shrink-fade, texture stripping for tiny props.
 * cfg: { sway (m at unit scale, top of prop), height (m), fadeNear, fadeFar (m; 0 = none), lite (drop normal/orm maps) }
 */
export function instanceMaterial(src, cfg = {}) {
  const m = src.clone();
  if (cfg.lite) {
    m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.aoMap = null;
    m.roughness = Math.max(m.roughness, 0.9); m.metalness = 0;
  }
  if (m.alphaTest > 0) { m.transparent = false; m.side = THREE.DoubleSide; }
  const sway = cfg.sway || 0, fadeFar = cfg.fadeFar || 0;
  if (!sway && !fadeFar) return m;
  const u = { uSway: { value: new THREE.Vector2(Math.max(0.1, cfg.height || 1), sway) }, uFade: { value: new THREE.Vector2(cfg.fadeNear || 0, fadeFar) } };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = u.uSway; sh.uniforms.uFade = u.uFade; sh.uniforms.uTime = WIND.uTime; sh.uniforms.uWind = WIND.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; uniform vec3 uWind; uniform vec2 uSway; uniform vec2 uFade;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          mat3 iM = mat3(instanceMatrix);
          vec3 iO = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          mat3 iM = mat3(1.0); vec3 iO = vec3(0.0);
        #endif
        if (uSway.y > 0.0) {
          float hh = clamp(position.y / uSway.x, 0.0, 1.3);
          float ph = iO.x * 0.083 + iO.z * 0.061;
          float gust = 0.55 + 0.45 * sin(uTime * 1.25 + ph) + 0.22 * sin(uTime * 2.9 + ph * 1.9 + position.y * 0.6);
          float s2 = max(dot(iM[0], iM[0]), 1e-4);
          vec3 wl = (transpose(iM) * uWind) / s2;
          transformed += wl * (uSway.y * hh * hh * gust);
          transformed.y += 0.02 * uSway.y * sin(uTime * 5.3 + position.x * 3.1 + position.z * 2.3 + ph) * hh;
        }
        if (uFade.y > 0.0) {
          float dcam = distance(iO, cameraPosition);
          transformed *= 1.0 - smoothstep(uFade.x, uFade.y, dcam);
        }`);
  };
  m.customProgramCacheKey = () => `dress|${sway > 0 ? 1 : 0}|${fadeFar > 0 ? 1 : 0}`;
  return m;
}

/** Vertex-clustering decimation of one geometry: cell = maxDim / div. Keeps uv/colour of the first vertex in a cell. */
function decimate(src, div) {
  src.computeBoundingBox();
  const bb = src.boundingBox, size = bb.getSize(new THREE.Vector3());
  const cell = Math.max(size.x, size.y, size.z) / div;
  const pos = src.attributes.position, nor = src.attributes.normal, uv = src.attributes.uv, col = src.attributes.color;
  const n = pos.count, map = new Map(), cid = new Int32Array(n);
  const P = [], N = [], C = [], first = [];
  for (let i = 0; i < n; i++) {
    const kx = Math.floor((pos.getX(i) - bb.min.x) / cell), ky = Math.floor((pos.getY(i) - bb.min.y) / cell), kz = Math.floor((pos.getZ(i) - bb.min.z) / cell);
    const key = kx + ky * 4096 + kz * 16777216;
    let id = map.get(key);
    if (id === undefined) { id = C.length; map.set(key, id); C.push(0); P.push(0, 0, 0); N.push(0, 0, 0); first.push(i); }
    cid[i] = id; C[id]++;
    P[id * 3] += pos.getX(i); P[id * 3 + 1] += pos.getY(i); P[id * 3 + 2] += pos.getZ(i);
    if (nor) { N[id * 3] += nor.getX(i); N[id * 3 + 1] += nor.getY(i); N[id * 3 + 2] += nor.getZ(i); }
  }
  const m = C.length, np = new Float32Array(m * 3), nn = new Float32Array(m * 3);
  const nuv = uv ? new Float32Array(m * 2) : null, ncol = col ? new Float32Array(m * col.itemSize) : null;
  for (let k = 0; k < m; k++) {
    np[k * 3] = P[k * 3] / C[k]; np[k * 3 + 1] = P[k * 3 + 1] / C[k]; np[k * 3 + 2] = P[k * 3 + 2] / C[k];
    const l = Math.hypot(N[k * 3], N[k * 3 + 1], N[k * 3 + 2]) || 1; nn[k * 3] = N[k * 3] / l; nn[k * 3 + 1] = N[k * 3 + 1] / l; nn[k * 3 + 2] = N[k * 3 + 2] / l;
    if (nuv) { nuv[k * 2] = uv.getX(first[k]); nuv[k * 2 + 1] = uv.getY(first[k]); }
    if (ncol) { ncol[k * col.itemSize] = col.getX(first[k]); ncol[k * col.itemSize + 1] = col.getY(first[k]); ncol[k * col.itemSize + 2] = col.getZ(first[k]); if (col.itemSize > 3) ncol[k * col.itemSize + 3] = col.getW(first[k]); }
  }
  const idx = src.index ? src.index.array : null, tri = (idx ? idx.length : n) / 3, out = [];
  for (let t = 0; t < tri; t++) {
    const a = cid[idx ? idx[t * 3] : t * 3], b = cid[idx ? idx[t * 3 + 1] : t * 3 + 1], c = cid[idx ? idx[t * 3 + 2] : t * 3 + 2];
    if (a !== b && b !== c && a !== c) out.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(np, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  if (nuv) g.setAttribute('uv', new THREE.BufferAttribute(nuv, 2));
  if (ncol) g.setAttribute('color', new THREE.BufferAttribute(ncol, col.itemSize));
  g.setIndex(out); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}

function deriveLod(asset, div) {
  const parts = asset.parts.map((p) => { const g = decimate(p.geometry, div); return { ...p, geometry: g, tris: g.index.count / 3 }; });
  return { ...asset, name: asset.name + '@lod', parts, tris: parts.reduce((a, p) => a + p.tris, 0), derived: true };
}
