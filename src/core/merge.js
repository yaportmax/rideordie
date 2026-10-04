// Load-time mesh merging for rigid models: within each rigid group (the model body, each wheel_*, panel_*, part_* ...), meshes that share a
// material are merged into one mesh. Cuts vehicle draw calls ~3x while keeping every node the game animates or detaches.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GROUP_RE = /^(wheel_|panel_|part_|weak_|drill_|ramp_|gun_mount|gun_mg|turret_\d|turret_main|slide|bolt|pump|mag$|trigger|hammer|cylinder|crane|charging_handle|feed_cover|belt|rocket$|scope|optic$|bipod|selector|stock_fold|bolt_handle|pin$|lever$|steering)/;

const KEEP_ATTRIBUTES = new Set(['position', 'normal', 'uv', 'uv1', 'color', 'tangent']);
function attrsKey(g) {
  return Object.keys(g.attributes).filter((k) => KEEP_ATTRIBUTES.has(k)).sort()
    .map((k) => { const a = g.attributes[k]; return `${k}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`; }).join(',') + (g.index ? ':i' : ':n');
}

/** Merge in place. `associations` optionally identifies authored glTF nodes versus generated primitive meshes. */
export function mergeRigid(root, associations = null) {
  const groups = [root];
  root.traverse((o) => {
    if (o === root || !GROUP_RE.test(o.name)) return;
    const source = associations?.get(o);
    // GLTFLoader names primitive children after their mesh, e.g. panel_hood_1.
    // They are rigid geometry under the authored panel pivot, not extra parts.
    // A single-primitive authored Mesh has both primitives and nodes, so its
    // own geometry/pivot must still survive animation and detachment intact.
    if (o.isMesh && source?.primitives !== undefined && source.nodes === undefined) return;
    groups.push(o);
  });
  const groupSet = new Set(groups);
  let before = 0, after = 0;
  root.updateMatrixWorld(true);
  for (const g of groups) {
    // meshes whose nearest group ancestor is g
    const meshes = [];
    g.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || Object.keys(o.geometry.morphAttributes).length) return;
      if (groupSet.has(o)) return;   // a mesh that IS a group node: preserve its pivot and geometry
      let p = o.parent; while (p && !groupSet.has(p)) p = p.parent;
      if (p === g || (o === g)) meshes.push(o);
    });
    if (meshes.length < 2) { before += meshes.length; after += meshes.length; continue; }
    const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
    const byMat = new Map();
    for (const m of meshes) {
      // A hidden primitive or a non-shadowing detail must not inherit the
      // visibility/shadow flags of whichever primitive happened to come first.
      const k = [m.material.uuid, attrsKey(m.geometry), m.visible, m.castShadow, m.receiveShadow, m.renderOrder, m.layers.mask].join('|');
      if (!byMat.has(k)) byMat.set(k, []); byMat.get(k).push(m);
    }
    before += meshes.length;
    for (const list of byMat.values()) {
      if (list.length < 2) { after++; continue; }
      const geos = list.map((m) => { const geo = m.geometry.clone(); geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)); for (const k of Object.keys(geo.attributes)) if (!KEEP_ATTRIBUTES.has(k)) geo.deleteAttribute(k); return geo; });
      // all geometries must share the same attribute set
      const names = geos.map((x) => Object.keys(x.attributes).sort().join(','));
      if (new Set(names).size > 1) { for (const geo of geos) geo.dispose(); after += list.length; continue; }
      const merged = mergeGeometries(geos, false);
      for (const geo of geos) geo.dispose();
      if (!merged) { after += list.length; continue; }
      // Every clone shares these bounds; computing once avoids first-spawn
      // geometry scans when a car enters the camera/shadow frustum.
      merged.computeBoundingBox(); merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, list[0].material);
      mesh.name = (g.name || 'body') + '_merged_' + list[0].material.name;
      mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
      mesh.visible = list[0].visible; mesh.renderOrder = list[0].renderOrder; mesh.layers.mask = list[0].layers.mask;
      g.add(mesh);
      for (const m of list) { m.removeFromParent(); m.geometry.dispose(); }
      after++;
    }
  }
  return { before, after };
}

/** Share identical atlas materials without losing different tint/PBR/depth settings. */
export function unifyAtlasMaterials(root) {
  const canon = new Map(); let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || Array.isArray(o.material)) return;
    const m = o.material;
    if (!m.map) return;
    // Texture identity alone is insufficient: atlas parts can have different
    // roughness, normal scale, emissive strength or depth behavior.
    const data = m.toJSON({ textures: {}, images: {} });
    delete data.uuid; delete data.name; delete data.userData;
    const key = JSON.stringify(data);
    if (!canon.has(key)) { canon.set(key, m); return; }
    if (canon.get(key) !== m) { o.material = canon.get(key); n++; }
  });
  return n;
}
