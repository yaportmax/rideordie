// First-person cutaways: parts of the local player's truck that sit in the first-person eye line are baked into the truck's merged
// body meshes, so they cannot be hidden by node. Gunner: T4 turret ring + gun shield + exhaust stacks + their downpipes, T2 roll
// hoop + light bar + roof cargo. Driver (cockpit): T4 hood blower + injector stacks, the T4 roof light bar showing over the
// windshield header. At first use each body mesh is split into connected islands (vertices welded by position); islands that lie completely
// inside a per-tier cut box (truck model space, metres, ground origin) move to a separate index. In first person the mesh draws the
// kept triangles and the cut ones are drawn by a shadow-only twin (same program; colour/depth writes off), so the truck still casts
// its full shadow. Only the local truck is touched; third person / chase / other players see the whole truck.
//   setCutaway(carView, on, view = 'gunner' | 'driver')
import * as THREE from 'three';

/** Cut entries per truck id: a box [minX, minY, minZ, maxX, maxY, maxZ] (an island is cut when its bounds lie inside it) or
 *  {b: box, mat: material name, minTris} (only islands of that material with at least minTris triangles). */
export const CUTS = {
  truck_t2: [
    [-1.0, 0.9, -0.95, 1.0, 2.62, -0.68],        // roll hoop behind the cab + light bar + its four lamps
    [-0.75, 1.95, -0.5, 0.75, 2.42, 0.55],       // roof cargo: spare wheel, rim, straps, jerry can
    [0.85, 1.35, -1.85, 1.05, 2.36, -0.78],      // diagonal braces hoop -> bed rail (right / left): would float without the hoop
    [-1.05, 1.35, -1.85, -0.85, 2.36, -0.78],
  ],
  truck_t4: [
    [-0.62, 2.0, -0.46, 0.62, 2.8, 0.72],        // gun turret: ring, shield, centre post
    [1.05, 1.0, -0.92, 1.5, 2.8, -0.55],         // exhaust stacks (right) + caps
    [-1.5, 1.0, -0.92, -1.05, 2.8, -0.55],       // exhaust stacks (left) + caps
    { b: [0.2, 0.35, -0.85, 1.5, 2.6, 1.3], mat: 'metal_dark', minTris: 400 },    // downpipes rising at the cab's rear corners (read as
    { b: [-1.5, 0.35, -0.85, -0.2, 2.6, 1.3], mat: 'metal_dark', minTris: 400 },  // black slabs beside the gunner once the stacks are cut)
  ],
};
/** Cockpit (local first-person driver) cuts. */
export const DRIVER_CUTS = {
  truck_t4: [
    [-0.3, 1.1, 1.5, 0.3, 1.85, 2.35],           // supercharger blower + scoop (chrome top reaches y 1.79) + injector stacks + belt
    [-1.1, 2.0, 0.7, 1.1, 2.25, 0.92],           // roof light bar + corner lamps (show through the windshield header from inside)
  ],
};

const _m = new THREE.Matrix4(), _p = new THREE.Vector3();

function inside(b, box) { return b[0] >= box[0] && b[1] >= box[1] && b[2] >= box[2] && b[3] <= box[3] && b[4] <= box[4] && b[5] <= box[5]; }
function hits(b, e, mat, tris) { return Array.isArray(e) ? inside(b, e) : inside(b, e.b) && (!e.mat || e.mat === mat) && tris >= (e.minTris || 0); }

const splitCache = new WeakMap(); // Shared asset geometry reuses cuts; disposed instance kits are not retained.
/** Owned attachment meshes must retain their authored/moving geometry. */
export function canCutViewmodelMesh(mesh) {
  return !!mesh?.isMesh && !mesh.isSkinnedMesh && !Array.isArray(mesh.material) && !mesh.userData?.weaponMod;
}
/** Split a mesh's triangles into islands kept / cut by boxes given in the mesh's own (geometry) space. {full, keep, cut, n} | null */
export function splitIslands(mesh, boxes) { return splitMesh(mesh, new THREE.Matrix4(), boxes); }
/** Split one mesh's index into kept / cut triangles. Returns null when nothing is cut. */
function splitMesh(mesh, toModel, boxes, key = 'g') {
  let c = splitCache.get(mesh.geometry); if (!c) { c = new Map(); splitCache.set(mesh.geometry, c); }
  if (c.has(key)) return c.get(key);
  const r = splitMeshNow(mesh, toModel, boxes);
  c.set(key, r);
  return r;
}
function splitMeshNow(mesh, toModel, boxes) {
  const g = mesh.geometry, pos = g.attributes.position, idx = g.index ? g.index.array : null;
  if (!idx || !pos) return null;
  const n = pos.count, par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const weld = new Map();
  for (let i = 0; i < n; i++) {
    const k = Math.round(pos.getX(i) * 2000) + ',' + Math.round(pos.getY(i) * 2000) + ',' + Math.round(pos.getZ(i) * 2000);
    const e = weld.get(k); if (e !== undefined) union(i, e); else weld.set(k, i);
  }
  for (let i = 0; i < idx.length; i += 3) { union(idx[i], idx[i + 1]); union(idx[i], idx[i + 2]); }
  // island bounds in model space
  const bounds = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i); let b = bounds.get(r);
    if (!b) { b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; bounds.set(r, b); }
    _p.fromBufferAttribute(pos, i).applyMatrix4(toModel);
    if (_p.x < b[0]) b[0] = _p.x; if (_p.y < b[1]) b[1] = _p.y; if (_p.z < b[2]) b[2] = _p.z;
    if (_p.x > b[3]) b[3] = _p.x; if (_p.y > b[4]) b[4] = _p.y; if (_p.z > b[5]) b[5] = _p.z;
  }
  const tris = new Map(); for (let i = 0; i < idx.length; i += 3) { const r = find(idx[i]); tris.set(r, (tris.get(r) || 0) + 1); }
  const mat = mesh.material && mesh.material.name;
  const cutRoot = new Set();
  for (const [r, b] of bounds) if (boxes.some((e) => hits(b, e, mat, tris.get(r) || 0))) cutRoot.add(r);
  if (!cutRoot.size) return null;
  const keep = [], cut = [];
  for (let i = 0; i < idx.length; i += 3) (cutRoot.has(find(idx[i])) ? cut : keep).push(idx[i], idx[i + 1], idx[i + 2]);
  const mk = (list) => {
    const geo = new THREE.BufferGeometry();
    for (const k of Object.keys(g.attributes)) geo.setAttribute(k, g.attributes[k]);
    geo.setIndex(list); geo.boundingSphere = g.boundingSphere; geo.boundingBox = g.boundingBox;
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    return geo;
  };
  return { full: g, keep: mk(keep), cut: mk(cut), n: cut.length / 3 };
}

const shadowMats = new Map();
function shadowOnly(m) {
  let c = shadowMats.get(m);
  if (!c) { c = m.clone(); c.colorWrite = false; c.depthWrite = false; shadowMats.set(m, c); }
  return c;
}

/** Build (once) the split for a truck view (call early: the first split of a truck type costs 40-80 ms). */
export function prepareCutaway(cv, view = 'gunner') {
  const store = cv._fpCuts || (cv._fpCuts = {});
  if (store[view] !== undefined) return store[view];
  const boxes = (view === 'driver' ? DRIVER_CUTS : CUTS)[cv.spec.id];
  if (!boxes || !cv.model) { store[view] = null; return null; }
  cv.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(cv.model.matrixWorld).invert();
  const parts = [];
  cv.model.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    // wheels / panels / the steering wheel move or detach: never cut those
    for (let p = o; p && p !== cv.model; p = p.parent) if (/^(wheel_|panel_|steering)/.test(p.name)) return;
    _m.multiplyMatrices(inv, o.matrixWorld);
    const s = splitMesh(o, _m, boxes, view);
    if (!s) return;
    const twin = new THREE.Mesh(s.cut, shadowOnly(o.material));
    twin.name = o.name + '_fpcut_' + view; twin.castShadow = true; twin.receiveShadow = false; twin.visible = false;
    twin.position.copy(o.position); twin.quaternion.copy(o.quaternion); twin.scale.copy(o.scale);
    o.parent.add(twin);
    parts.push({ mesh: o, twin, ...s });
  });
  store[view] = parts.length ? parts : null;
  return store[view];
}

/** First-person cutaway on/off for the local truck's view (one view at a time: the local player is the gunner OR the driver). */
export function setCutaway(cv, on, view = 'gunner') {
  if (!cv) return;
  const cur = cv._fpCutView || null, want = on ? view : null;
  if (cur === want || (!on && cur !== view)) return;     // never switch off the other view's cut
  if (cur) { const old = prepareCutaway(cv, cur); if (old) for (const p of old) { p.mesh.geometry = p.full; p.twin.visible = false; } }
  cv._fpCutView = want;
  if (!want) return;
  const parts = prepareCutaway(cv, want);
  if (parts) for (const p of parts) { p.mesh.geometry = p.keep; p.twin.visible = true; }
}
