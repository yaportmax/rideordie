// Load-time mesh merging for rigid models: within each rigid group (the model body, each wheel_*, panel_*, part_* ...), meshes that share a
// material are merged into one mesh. Cuts vehicle draw calls ~3x while keeping every node the game animates or detaches.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GROUP_RE = /^(wheel_|panel_|part_|weak_|ramp_|gun_mount|gun_mg|turret_\d|turret_main|slide|bolt|pump|mag$|trigger|hammer|cylinder|crane|charging_handle|feed_cover|belt|rocket$|scope|bipod|selector|stock_fold|bolt_handle|pin$|lever$|steering)/;

function attrsKey(g) { return Object.keys(g.attributes).sort().join(',') + (g.index ? ':i' : ':n'); }

/** Merge in place. `root` = a loaded glTF scene (the template that later gets cloned). */
export function mergeRigid(root) {
  const groups = [root];
  root.traverse((o) => { if (o !== root && GROUP_RE.test(o.name)) groups.push(o); });
  const groupSet = new Set(groups);
  let before = 0, after = 0;
  root.updateMatrixWorld(true);
  for (const g of groups) {
    // meshes whose nearest group ancestor is g
    const meshes = [];
    g.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material)) return;
      if (o !== g && groupSet.has(o)) return;   // a mesh that IS a group node (single-material panel/part): keep it detachable
      let p = o.parent; while (p && !groupSet.has(p)) p = p.parent;
      if (p === g || (o === g)) meshes.push(o);
    });
    if (meshes.length < 2) { before += meshes.length; after += meshes.length; continue; }
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const byMat = new Map();
    for (const m of meshes) { const k = m.material.uuid + '|' + attrsKey(m.geometry); if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(m); }
    before += meshes.length;
    for (const list of byMat.values()) {
      if (list.length < 2) { after++; continue; }
      const geos = list.map((m) => { const geo = m.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'uv1', 'color', 'tangent'].includes(k)) geo.deleteAttribute(k); return geo; });
      // all geometries must share the same attribute set
      const names = geos.map((x) => Object.keys(x.attributes).sort().join(','));
      if (new Set(names).size > 1) { after += list.length; continue; }
      const merged = mergeGeometries(geos, false);
      if (!merged) { after += list.length; continue; }
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.name = (g.name || 'body') + '_merged_' + list[0].material.name;
      mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
      g.add(mesh);
      for (const m of list) { m.removeFromParent(); m.geometry.dispose(); }
      after++;
    }
  }
  return { before, after };
}

/** Replace materials that share the same textures (and blend mode) with one canonical material (weapon atlases). */
export function unifyAtlasMaterials(root) {
  const canon = new Map(); let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const m = o.material;
    if (!m.map) return;
    const key = [m.map?.uuid, m.normalMap?.uuid, m.roughnessMap?.uuid, m.transparent, m.alphaTest, m.side].join('|');
    if (!canon.has(key)) { canon.set(key, m); return; }
    if (canon.get(key) !== m) { o.material = canon.get(key); n++; }
  });
  return n;
}
