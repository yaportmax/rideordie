// Far LOD for vehicles, generated at load time from the full model: every static mesh of the body (incl. panels) is merged into ONE
// vertex-coloured mesh (colour = material colour x average texture colour), each wheel into one mesh. Paint zones keep a mask so the
// per-car tint still works. ~5 draw calls instead of ~35-60.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const avgCache = new WeakMap();
function avgColor(tex) {
  if (!tex || !tex.image) return new THREE.Color(1, 1, 1);
  if (avgCache.has(tex)) return avgCache.get(tex);
  let c = new THREE.Color(1, 1, 1);
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 16;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(tex.image, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data; let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4; c = new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch { /* cross-origin or not ready */ }
  avgCache.set(tex, c); return c;
}

function bake(meshes, relTo) {
  relTo.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(relTo.matrixWorld).invert();
  const geos = [];
  for (const m of meshes) {
    const mat = m.material; if (!mat || mat.transparent) continue;
    const src = m.geometry; const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', src.attributes.position.clone());
    if (src.attributes.normal) geo.setAttribute('normal', src.attributes.normal.clone()); else continue;
    if (src.index) geo.setIndex(src.index.clone());
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    const n = geo.attributes.position.count;
    const col = new THREE.Color().copy(mat.color || new THREE.Color(1, 1, 1)).multiply(avgColor(mat.map));
    if (mat.emissive && mat.emissiveIntensity > 0.5 && (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.3) col.copy(mat.emissive).multiplyScalar(2);
    const paint = mat.name === 'paint' ? 1 : mat.name === 'paint2' ? 2 : 0;
    const ca = new Float32Array(n * 3), pa = new Float32Array(n), ra = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; pa[i] = paint; ra[i * 2] = mat.roughness ?? 0.7; ra[i * 2 + 1] = mat.metalness ?? 0; }
    geo.setAttribute('color', new THREE.BufferAttribute(ca, 3)); geo.setAttribute('aPaint', new THREE.BufferAttribute(pa, 1)); geo.setAttribute('aRM', new THREE.BufferAttribute(ra, 2));
    geos.push(geo.index ? geo : geo);
  }
  if (!geos.length) return null;
  const allIndexed = geos.every((g) => g.index), noneIndexed = geos.every((g) => !g.index);
  const list = allIndexed || noneIndexed ? geos : geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(list, false);
  for (const g of new Set([...geos, ...list])) g.dispose();
  if (merged) { merged.computeBoundingBox(); merged.computeBoundingSphere(); }
  return merged;
}

/** LOD material (one per car instance so paint tints are per car). */
export function makeLodMaterial(paint, paint2) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.name = 'car_lod';
  m.userData.uPaint = { value: new THREE.Color(paint ?? 0xffffff) }; m.userData.uPaint2 = { value: new THREE.Color(paint2 ?? 0x333333) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPaint = m.userData.uPaint; sh.uniforms.uPaint2 = m.userData.uPaint2;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aPaint; attribute vec2 aRM; varying float vPaint; varying vec2 vRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = aPaint; vRM = aRM;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uPaint; uniform vec3 uPaint2; varying float vPaint; varying vec2 vRM;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vPaint > 0.5 && vPaint < 1.5) diffuseColor.rgb *= uPaint; else if (vPaint > 1.5) diffuseColor.rgb *= uPaint2;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;');
  };
  m.customProgramCacheKey = () => 'car_lod';
  return m;
}

const lodCache = new Map();
/** Build (once per template) {body: BufferGeometry, wheels: Map(name -> {geo, pos})}. */
export function buildCarLod(url, template) {
  if (lodCache.has(url)) return lodCache.get(url);
  template.updateMatrixWorld(true);
  const wheelNodes = [], bodyMeshes = [];
  template.traverse((o) => { if (/^wheel_[A-Za-z0-9]+$/.test(o.name)) wheelNodes.push(o); });
  const inWheel = (o) => { let p = o; while (p) { if (wheelNodes.includes(p)) return true; p = p.parent; } return false; };
  template.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh && !inWheel(o) && !/collision/i.test(o.name) && !/^gun_|turret/.test(o.parent?.name || '')) bodyMeshes.push(o); });
  const res = { body: bake(bodyMeshes, template), wheels: new Map() };
  for (const w of wheelNodes) {
    const ms = []; w.traverse((o) => { if (o.isMesh) ms.push(o); });
    const g = bake(ms, w); if (g) res.wheels.set(w.name.slice(6), g);
  }
  lodCache.set(url, res);
  return res;
}
