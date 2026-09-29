// First-person gunner cutaway: parts of the local player's truck that sit in the gunner's eye line (T4 turret ring + gun shield +
// exhaust stacks, T2 roll hoop + light bar + roof cargo) are baked into the truck's merged body meshes, so they cannot be hidden
// by node. At first use each body mesh is split into connected islands (vertices welded by position); islands that lie completely
// inside a per-tier cut box (truck model space, metres, ground origin) move to a separate index. In first person the mesh draws the
// kept triangles and the cut ones are drawn by a shadow-only twin (same program; colour/depth writes off), so the truck still casts
// its full shadow. Only the local truck is touched; third person / chase / other players see the whole truck.
//   setCutaway(carView, on)
import * as THREE from 'three';

/** Cut boxes per truck id: [minX, minY, minZ, maxX, maxY, maxZ]. An island is cut when its bounds lie inside one box. */
export const CUTS = {
  truck_t2: [
    [-1.0, 0.9, -0.95, 1.0, 2.62, -0.68],        // roll hoop behind the cab + light bar + its four lamps
    [-0.75, 1.95, -0.5, 0.75, 2.42, 0.55],       // roof cargo: spare wheel, rim, straps, jerry can
  ],
  truck_t4: [
    [-0.62, 2.0, -0.46, 0.62, 2.8, 0.72],        // gun turret: ring, shield, centre post
    [1.05, 1.0, -0.92, 1.5, 2.8, -0.55],         // exhaust stacks (right) + caps
    [-1.5, 1.0, -0.92, -1.05, 2.8, -0.55],       // exhaust stacks (left) + caps
  ],
};

const _m = new THREE.Matrix4(), _p = new THREE.Vector3();

function inside(b, box) { return b[0] >= box[0] && b[1] >= box[1] && b[2] >= box[2] && b[3] <= box[3] && b[4] <= box[4] && b[5] <= box[5]; }

/** Split one mesh's index into kept / cut triangles. Returns null when nothing is cut. */
function splitMesh(mesh, toModel, boxes) {
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
  const cutRoot = new Set();
  for (const [r, b] of bounds) if (boxes.some((box) => inside(b, box))) cutRoot.add(r);
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

/** Build (once) the split for a truck view. */
function prepare(cv) {
  if (cv._fpCut !== undefined) return cv._fpCut;
  const boxes = CUTS[cv.spec.id];
  if (!boxes || !cv.model) { cv._fpCut = null; return null; }
  cv.root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(cv.model.matrixWorld).invert();
  const parts = [];
  cv.model.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    // wheels / panels / the steering wheel move or detach: never cut those
    for (let p = o; p && p !== cv.model; p = p.parent) if (/^(wheel_|panel_|steering)/.test(p.name)) return;
    _m.multiplyMatrices(inv, o.matrixWorld);
    const s = splitMesh(o, _m, boxes);
    if (!s) return;
    const twin = new THREE.Mesh(s.cut, shadowOnly(o.material));
    twin.name = o.name + '_fpcut'; twin.castShadow = true; twin.receiveShadow = false; twin.visible = false;
    twin.position.copy(o.position); twin.quaternion.copy(o.quaternion); twin.scale.copy(o.scale);
    o.parent.add(twin);
    parts.push({ mesh: o, twin, ...s });
  });
  cv._fpCut = parts.length ? parts : null;
  return cv._fpCut;
}

/** First-person cutaway on/off for the local truck's view. */
export function setCutaway(cv, on) {
  if (!cv || cv._fpCutOn === on) return;
  if (!on && !cv._fpCutOn) { cv._fpCutOn = false; return; }
  const parts = prepare(cv);
  cv._fpCutOn = on;
  if (!parts) return;
  for (const p of parts) { p.mesh.geometry = on ? p.keep : p.full; p.twin.visible = on; }
}
