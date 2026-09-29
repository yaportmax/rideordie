// GLB loading + caching. Models are cloned per use; skinned models via SkeletonUtils.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeRigid, unifyAtlasMaterials } from './merge.js';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();

export function loadGLB(url) {
  if (!cache.has(url)) {
    cache.set(url, new Promise((res) => {
      loader.load(url, (g) => res(g), undefined, (e) => { console.warn('GLB failed', url, e?.message || e); res(null); });
    }));
  }
  return cache.get(url);
}

/** Loads (once) and returns a fresh clone of the scene graph (null if the asset does not exist yet). */
export async function instantiate(url) {
  const g = await loadGLB(url);
  if (!g) return null;
  const root = SkeletonUtils.clone(g.scene);
  root.animations = g.animations;
  return root;
}

/** Synchronous clone from an already-loaded asset. */
export function cloneLoaded(url) {
  return null; // filled by preload cache below
}

const loaded = new Map();
export const mergeStats = [];
export async function preload(urls, onProgress) {
  let n = 0;
  await Promise.all(urls.map(async (u) => {
    const g = await loadGLB(u);
    if (g && /\/models\/vehicles\//.test(u) && !g.__tuned) {
      g.__tuned = true; // chrome reflected the bright sky as flat white in the gunner's face: darker, slightly rougher
      g.scene.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.name === 'chrome' && !m.__t) { m.__t = true; m.color.multiplyScalar(0.45); m.roughness = Math.max(m.roughness, 0.28); } });
    }
    if (g && /\/models\/(vehicles|weapons)\//.test(u) && !g.__merged) { g.__merged = true; if (/weapons/.test(u)) unifyAtlasMaterials(g.scene); const r = mergeRigid(g.scene); mergeStats.push([u.split('/').pop(), r.before, r.after]); }
    loaded.set(u, g); n++; if (onProgress) onProgress(n, urls.length, u);
  }));
}
/** Sync clone; returns null when not preloaded / missing. */
export function clone(url) {
  const g = loaded.get(url);
  if (!g) return null;
  const root = SkeletonUtils.clone(g.scene);
  root.animations = g.animations;
  return root;
}
/** The (shared, merged) template scene of a preloaded asset. Do not modify. */
export function template(url) { return loaded.get(url)?.scene || null; }
export function getAnimations(url) { return loaded.get(url)?.animations || []; }
export function has(url) { return !!loaded.get(url); }

export function findNode(root, name) {
  let out = null;
  root.traverse((o) => { if (!out && o.name === name) out = o; });
  return out;
}
export function findNodes(root, re) {
  const out = [];
  root.traverse((o) => { if (re.test(o.name)) out.push(o); });
  return out;
}
/** Deep-clones materials on a cloned scene so per-instance tinting doesn't leak. */
export function ownMaterials(root, names) {
  const seen = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const res = arr.map((m) => {
      if (names && !names.test(m.name)) return m;
      if (!seen.has(m)) seen.set(m, m.clone());
      return seen.get(m);
    });
    o.material = Array.isArray(o.material) ? res : res[0];
  });
}
