// Installed modifier geometry: at most one extra opaque draw per
// detachable anchor. Debris retirement releases only modifier-owned buffers.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { UPGRADE_SURFACES } from './car_upgrade_plan.js';

const deferred = new WeakMap();
let sharedMaterial;
function material() {
  if (sharedMaterial) return sharedMaterial;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
  m.name = 'car_upgrade_surfaces';
  m.userData.sharedVehicleUpgrade = true;
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aUpgradeRM; varying vec2 vUpgradeRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUpgradeRM = aUpgradeRM;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vUpgradeRM;')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vUpgradeRM.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vUpgradeRM.y;');
  };
  m.customProgramCacheKey = () => 'car_upgrade_surfaces_v1';
  return sharedMaterial = m;
}

const pos = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Euler(), quaternion = new THREE.Quaternion();
function partGeometry(part) {
  let geo;
  if (part.shape === 'box') geo = new THREE.BoxGeometry(1, 1, 1);
  else if (part.shape === 'cylinder') geo = new THREE.CylinderGeometry(.5, .5, 1, 10);
  else if (part.shape === 'cone') geo = new THREE.ConeGeometry(.5, 1, 8);
  else if (part.shape === 'torus') geo = new THREE.TorusGeometry(part.size[0], part.size[1], 5, 20);
  else throw new Error(`Unknown upgrade shape ${part.shape}`);
  const src = geo, flat = geo.toNonIndexed();
  geo = flat; src.dispose();
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  const n = geo.attributes.position.count, colors = new Float32Array(n * 3), rm = new Float32Array(n * 2), s = UPGRADE_SURFACES[part.surface];
  const color = new THREE.Color(s.color);
  for (let i = 0; i < n; i++) {
    color.toArray(colors, i * 3); rm[i * 2] = s.roughness; rm[i * 2 + 1] = s.metalness;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aUpgradeRM', new THREE.BufferAttribute(rm, 2));
  pos.fromArray(part.p); scale.fromArray(part.shape === 'torus' ? [1, 1, 1] : part.size);
  quaternion.setFromEuler(rotation.fromArray(part.rotation));
  geo.applyMatrix4(new THREE.Matrix4().compose(pos, quaternion, scale));
  return geo;
}
const belongsTo = (node, root) => { for (let p = node; p; p = p.parent) if (p === root) return true; return false; };

/** Call when a detached part is retired/evicted/cleared by DebrisSystem.
 * Shared GLB buffers/materials are never disposed here.
 */
export function disposeUpgradeNode(node) {
  node.traverse(o => {
    const records = deferred.get(o); if (!records) return;
    for (const r of [...records]) r.release();
  });
}

/** root is the CarView ground-frame root, anchor resolver returns existing
 * authored panels/wheels. Wheel plans use wheel-local positions; other
 * plans use the car frame, transformed exactly into that panel's frame.
 */
export class UpgradeKit {
  constructor(root, plan, resolveAnchor) {
    this.root = root; this.plan = plan; this.records = []; this.disposed = false;
    const groups = new Map();
    for (const p of plan.parts) {
      const anchor = resolveAnchor(p.anchor);
      if (!anchor) throw new Error(`Missing authored anchor ${p.anchor} for ${p.upgrade}`);
      let group = groups.get(anchor); if (!group) groups.set(anchor, group = []);
      group.push(p);
    }
    root.updateWorldMatrix(true, true);
    const rootWorld = root.matrixWorld.clone();
    try {
      for (const [anchor, parts] of groups) {
        const wheelLocal = /^wheel_/.test(parts[0].anchor), toAnchor = new THREE.Matrix4().copy(anchor.matrixWorld).invert().multiply(rootWorld);
        const geos = parts.map(p => { const g = partGeometry(p); if (!wheelLocal) g.applyMatrix4(toAnchor); return g; });
        const merged = mergeGeometries(geos, false);
        for (const g of geos) g.dispose();
        if (!merged) throw new Error('Upgrade merge failed');
        merged.computeBoundingBox(); merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, material()); mesh.name = `installed_upgrades_${parts[0].anchor}`;
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.upgradeIds = [...new Set(parts.map(p => p.upgrade))]; mesh.userData.ownedVehicleUpgradeGeometry = true;
        anchor.add(mesh); mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
        const record = { anchor, mesh, released: false };
        record.release = () => {
          if (record.released) return;
          record.released = true; mesh.removeFromParent(); merged.dispose();
          const set = deferred.get(anchor); set?.delete(record); if (set?.size === 0) deferred.delete(anchor);
        };
        let set = deferred.get(anchor); if (!set) deferred.set(anchor, set = new Set()); set.add(record);
        this.records.push(record);
      }
    } catch (error) { this.dispose({ includeDetached: true }); throw error; }
  }
  /** Preserve buffers on visible detached panels. Those buffers are released
   * by disposeUpgradeNode at debris retirement. includeDetached is for a
   * complete world teardown AFTER debris has been removed.
   */
  dispose({ includeDetached = false } = {}) {
    for (const record of this.records) if (includeDetached || belongsTo(record.anchor, this.root)) record.release();
    this.disposed = this.records.every(r => r.released);
  }
  get meshCount() { return this.records.filter(r => !r.released).length; }
  get triangles() { return this.records.reduce((n, r) => n + r.mesh.geometry.attributes.position.count / 3, 0); }
}
