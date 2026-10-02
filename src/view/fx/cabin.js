// The local player's cab as a clip volume for the particle shader, plus the hood area own-truck damage effects emit from.
// Measured once per CarView from the truck GLB (root space, +Z forward): the cab box comes from the interior / glass
// meshes, the windshield plane from the front glass (top + bottom edge), the hood from the `hood` panel.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _inv = new THREE.Matrix4(), _mw = new THREE.Matrix4();

/**
 * @returns {{min: THREE.Vector3, max: THREE.Vector3, plane: THREE.Vector4, hood: THREE.Box3, shieldBot: number, shieldZ: number}}
 *   min/max: cab box, plane: (n.xyz, d) with dot(n, p) > d in front of the windshield, hood: hood top area (root space).
 */
export function measureCabin(cv) {
  const root = cv.root, M = cv.model || root;
  const spec = cv.spec || {}, enginePanel = spec.enginePanel || 'panel_hood';
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const interior = new THREE.Box3(), glass = new THREE.Box3(), hood = new THREE.Box3();
  const shield = [];
  const s = cv.sockets || {};
  const wheelZ = s.steering_wheel ? s.steering_wheel.getWorldPosition(_v).applyMatrix4(_inv).z : 0.6;
  M.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    let door = false, isHood = false;
    for (let p = o; p && p !== M; p = p.parent) { if (/^panel_(?:door|armor)_/.test(p.name)) door = true; if (p.name === enginePanel) isHood = true; }
    const mats = [].concat(o.material), pos = o.geometry.attributes.position, idx = o.geometry.index;
    _mw.multiplyMatrices(_inv, o.matrixWorld);
    const groups = o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: idx ? idx.count : pos.count, materialIndex: 0 }];
    for (const g of groups) {
      const name = (mats[g.materialIndex] || mats[0])?.name || '';
      const isGlass = name === 'glass', isInt = name === 'interior';
      if (!isGlass && !isInt && !isHood) continue;
      const step = Math.max(1, Math.floor(g.count / 4000));
      for (let i = g.start; i < g.start + g.count; i += step) {
        _v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(_mw);
        if (isHood) { hood.expandByPoint(_v); continue; }
        if (isInt) { interior.expandByPoint(_v); continue; }
        glass.expandByPoint(_v);
        if (!door && _v.z > wheelZ - 0.05) shield.push(_v.y, _v.z);
      }
    }
  });
  const L = spec.length || 5, Wd = spec.width || 2, H = spec.height || 1.8;
  if (glass.isEmpty()) glass.set(new THREE.Vector3(-Wd * 0.4, H * 0.62, -0.5), new THREE.Vector3(Wd * 0.4, H * 0.9, 1.0));
  if (interior.isEmpty()) interior.set(new THREE.Vector3(glass.min.x, H * 0.3, glass.min.z), new THREE.Vector3(glass.max.x, glass.max.y, glass.max.z));
  // windshield line in (y, z): average z of the top-most and bottom-most front glass points
  let top = -1e9, bot = 1e9;
  for (let i = 0; i < shield.length; i += 2) { top = Math.max(top, shield[i]); bot = Math.min(bot, shield[i]); }
  let tz = 0, tn = 0, bz = 0, bn = 0;
  for (let i = 0; i < shield.length; i += 2) { const y = shield[i], z = shield[i + 1]; if (y > top - 0.05) { tz += z; tn++; } if (y < bot + 0.05) { bz += z; bn++; } }
  if (!tn || !bn || top - bot < 0.1) { top = glass.max.y; bot = glass.min.y; tz = glass.max.z - 0.35; bz = glass.max.z; tn = bn = 1; }
  const zt = tz / tn, zb = bz / bn;
  const dy = top - bot, dz = zt - zb, l = Math.hypot(dy, dz) || 1;
  const n = new THREE.Vector3(0, -dz / l, dy / l);                   // forward / up, out of the glass
  if (n.z < 0) n.multiplyScalar(-1);
  const plane = new THREE.Vector4(n.x, n.y, n.z, n.y * bot + n.z * zb);
  const min = new THREE.Vector3(Math.min(interior.min.x, glass.min.x) + 0.02, interior.min.y, glass.min.z + 0.02);
  const max = new THREE.Vector3(Math.max(interior.max.x, glass.max.x) - 0.02, glass.max.y + 0.02, zb + 0.25);
  if (hood.isEmpty()) {
    const e = s.smoke_engine ? s.smoke_engine.getWorldPosition(new THREE.Vector3()).applyMatrix4(_inv) : new THREE.Vector3(0, H * 0.55, L / 2 - 0.9);
    if (spec.engineLayout === 'rear') hood.set(new THREE.Vector3(e.x - Wd * .2, e.y, e.z - .3), new THREE.Vector3(e.x + Wd * .2, e.y + .2, e.z + .3));
    else hood.set(new THREE.Vector3(-Wd * 0.33, e.y, zb + 0.05), new THREE.Vector3(Wd * 0.33, e.y + 0.3, L / 2 - 0.15));
  }
  return { min, max, plane, hood, rearEngine: spec.engineLayout === 'rear', shieldBot: bot, shieldZ: zb, shieldTop: top, shieldTopZ: zt };
}
