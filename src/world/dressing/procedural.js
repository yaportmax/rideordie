// Procedural stand-in assets (cheap LODs and things that are not in the model folders) registered into the AssetKit.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const boxAt = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const noIndex = (g) => g;

function makeAsset(name, parts, extra = {}) {
  const box = new THREE.Box3();
  let tris = 0;
  const outParts = parts.map((p) => {
    p.geometry.computeBoundingBox(); p.geometry.computeBoundingSphere(); box.union(p.geometry.boundingBox);
    const t = (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3; tris += t;
    return { name: p.name, geometry: p.geometry, material: p.material, role: 'main', tris: t };
  });
  const size = box.getSize(new THREE.Vector3());
  return { name, kind: 'prop', url: 'procedural', parts: outParts, sockets: {}, collision: null, box, tris, size, height: box.max.y, radius: Math.max(size.x, size.z) * 0.5, sphere: box.getBoundingSphere(new THREE.Sphere()), hasRoad: false, procedural: true, ...extra };
}

export function registerProcedural(kit) {
  const galv = new THREE.MeshStandardMaterial({ color: 0x9da3a6, metalness: 0.55, roughness: 0.5 });
  galv.name = 'galvanized';
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b5a48, roughness: 0.9, metalness: 0 });
  // guard rail LOD: same footprint as guardrail_4m (4 m along Z, traffic side +X): a beam + two posts
  const rail = mergeGeometries([boxAt(0.05, 0.34, 4.0, 0.12, 0.62, 0), boxAt(0.12, 0.72, 0.12, 0.0, 0.36, 1.0), boxAt(0.12, 0.72, 0.12, 0.0, 0.36, -1.0)]);
  kit.assets.set('guardrail_lod', makeAsset('guardrail_lod', [{ name: 'rail', geometry: rail, material: galv }]));
  // cheap jersey barrier LOD
  const conc = new THREE.MeshStandardMaterial({ color: 0x9a968c, roughness: 0.95, metalness: 0 });
  const jb = mergeGeometries([boxAt(0.6, 0.28, 3.7, 0, 0.14, 0), boxAt(0.36, 0.6, 3.7, 0, 0.58, 0)]);
  kit.assets.set('jersey_lod', makeAsset('jersey_lod', [{ name: 'jb', geometry: jb, material: conc }]));
  // utility pole LOD
  const pole = mergeGeometries([boxAt(0.3, 10, 0.3, 0, 5, 0), boxAt(2.5, 0.16, 0.16, 0, 9.5, 0)]);
  kit.assets.set('utility_pole_lod', makeAsset('utility_pole_lod', [{ name: 'pole', geometry: pole, material: wood }]));
  void noIndex;
}

/** Tapered concrete bridge pier from the ground (y=0) up to `h`, hammerhead cap under the deck. Vertex colours give fake AO (darker at the base). */
export function makePierGeometry(h, capW = 15.2, top = 3.4) {
  const parts = [];
  const shaftH = Math.max(1, h - 1.5);
  const shaft = new THREE.CylinderGeometry(top * 0.5, top * 0.5 + Math.min(1.4, h * 0.06), shaftH, 4, 1).rotateY(Math.PI / 4).scale(1, 1, 0.78).translate(0, shaftH / 2, 0);
  parts.push(shaft);
  parts.push(boxAt(capW, 1.5, 3.4, 0, h - 0.75, 0));
  parts.push(boxAt(6.4, 1.2, 4.6, 0, 0.6, 0));
  const g = mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; return q; }));
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const k = 0.55 + 0.45 * Math.min(1, pos.getY(i) / Math.max(4, h * 0.6)); col[i * 3] = k; col[i * 3 + 1] = k; col[i * 3 + 2] = k; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
