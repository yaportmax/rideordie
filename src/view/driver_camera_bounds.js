import * as THREE from 'three';

const _local = new THREE.Vector3(), _inverse = new THREE.Quaternion();
const _from = new THREE.Vector3(), _dir = new THREE.Vector3();
const _partBox = new THREE.Box3(), _partTransform = new THREE.Matrix4(), _rootInverse = new THREE.Matrix4();

function validPoint(point) {
  return point?.length === 3 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Number.isFinite(point[2]);
}

// Bounds are in the authored ground-origin truck frame; render position is COM.
export function driverBodyBounds(spec = {}, restComHeight = 0, out = {}, view) {
  const width = Math.max(.5, Number.isFinite(spec.width) ? spec.width : 2);
  const length = Math.max(1, Number.isFinite(spec.length) ? spec.length : 5.6);
  const height = Math.max(.5, Number.isFinite(spec.height) ? spec.height : 1.9);
  out.minX = -width / 2; out.maxX = width / 2;
  out.minY = -restComHeight; out.maxY = height - restComHeight;
  out.minZ = -length / 2; out.maxZ = length / 2;
  const modelMin = spec.model?.bbox?.min, modelMax = spec.model?.bbox?.max;
  if (validPoint(modelMin) && validPoint(modelMax)) {
    out.minX = Math.min(out.minX, modelMin[0]); out.maxX = Math.max(out.maxX, modelMax[0]);
    out.minY = Math.min(out.minY, modelMin[1] - restComHeight); out.maxY = Math.max(out.maxY, modelMax[1] - restComHeight);
    out.minZ = Math.min(out.minZ, modelMin[2]); out.maxZ = Math.max(out.maxZ, modelMax[2]);
  }
  for (const box of spec.colliders || []) {
    const c = box.center, h = box.half;
    if (!validPoint(c) || !validPoint(h) || h[0] < 0 || h[1] < 0 || h[2] < 0) continue;
    out.minX = Math.min(out.minX, c[0] - h[0]); out.maxX = Math.max(out.maxX, c[0] + h[0]);
    out.minY = Math.min(out.minY, c[1] - h[1] - restComHeight); out.maxY = Math.max(out.maxY, c[1] + h[1] - restComHeight);
    out.minZ = Math.min(out.minZ, c[2] - h[2]); out.maxZ = Math.max(out.maxZ, c[2] + h[2]);
  }
  // Use the actual installed merged meshes, including stage trim, rather than
  // guessed ram/spike/tank margins. Called only when the view/key changes.
  if (view?.root) {
    view.root.updateWorldMatrix(true, true);
    _rootInverse.copy(view.root.matrixWorld).invert();
    for (const kit of [view.upgradeKit, view.stageTrim]) for (const record of kit?.records || []) {
      const mesh = record.mesh;
      if (record.released || !mesh?.geometry?.boundingBox) continue;
      let parent = mesh; while (parent && parent !== view.root) parent = parent.parent;
      if (!parent) continue; // Detached upgrades belong to debris, not the car.
      _partTransform.copy(_rootInverse).multiply(mesh.matrixWorld);
      _partBox.copy(mesh.geometry.boundingBox).applyMatrix4(_partTransform);
      out.minX = Math.min(out.minX, _partBox.min.x); out.maxX = Math.max(out.maxX, _partBox.max.x);
      out.minY = Math.min(out.minY, _partBox.min.y - restComHeight); out.maxY = Math.max(out.maxY, _partBox.max.y - restComHeight);
      out.minZ = Math.min(out.minZ, _partBox.min.z); out.maxZ = Math.max(out.maxZ, _partBox.max.z);
    }
  }
  // Full suspension/steer envelope keeps cached bounds valid while wheels move.
  const wheelRadius = (Number.isFinite(spec.wheelRadius) ? spec.wheelRadius : 0) + .04;
  const wheelWidth = Number.isFinite(spec.wheelWidth) ? spec.wheelWidth : .4;
  const wheelExtent = Math.hypot(wheelRadius, wheelWidth / 2);
  const mountY = spec.mountY ?? .22, minLen = spec.susp?.minLen ?? .16, maxLen = spec.susp?.maxLen ?? .55;
  for (const wheel of spec.wheels || []) {
    if (!Number.isFinite(wheel.x) || !Number.isFinite(wheel.z)) continue;
    out.minX = Math.min(out.minX, wheel.x - wheelExtent); out.maxX = Math.max(out.maxX, wheel.x + wheelExtent);
    out.minY = Math.min(out.minY, mountY - maxLen - wheelRadius); out.maxY = Math.max(out.maxY, mountY - minLen + wheelRadius);
    out.minZ = Math.min(out.minZ, wheel.z - wheelExtent); out.maxZ = Math.max(out.maxZ, wheel.z + wheelExtent);
  }
  return out;
}

export function outsideDriverBody(point, carPos, carQuat, bounds, margin) {
  _local.copy(point).sub(carPos).applyQuaternion(_inverse.copy(carQuat).invert());
  return _local.x < bounds.minX - margin || _local.x > bounds.maxX + margin
    || _local.y < bounds.minY - margin || _local.y > bounds.maxY + margin
    || _local.z < bounds.minZ - margin || _local.z > bounds.maxZ + margin;
}

// Sample near-plane clearance with a center ray and eight parallel corner rays.
// These are world/prop queries: the caller excludes CAR geometry, while the
// explicit body check prevents pulling a camera into its own truck.
export function limitDriverCamera(out, desired, pivot, carPos, carQuat, bounds, radius, raycastWorld, groundY, minHorizontal = 0) {
  out.copy(desired);
  // A lifted floor candidate must be ray-checked again: raising an eye can put
  // it through a tunnel roof. Three passes bound this local settling work.
  for (let pass = 0; pass < 3; pass++) {
    _dir.copy(out).sub(pivot);
    const length = _dir.length();
    if (!Number.isFinite(length) || length < 1e-6) return false;
    _dir.multiplyScalar(1 / length);
    let reach = length;
    if (raycastWorld) {
      for (let i = -1; i < 8; i++) {
        _from.copy(pivot);
        if (i >= 0) _from.add(_local.set(i & 1 ? radius : -radius, i & 2 ? radius : -radius, i & 4 ? radius : -radius));
        const hit = raycastWorld(_from, _dir, length + .06);
        if (hit && Number.isFinite(hit.t)) reach = Math.min(reach, Math.max(0, hit.t - .06));
      }
    }
    out.copy(pivot).addScaledVector(_dir, reach);
    if (reach <= .05) return false;
    let floor = -Infinity;
    if (groundY) {
      // groundY's origin is explicit, unlike Run._groundY's +4m convention.
      // Query from the ray-limited eye/pivot, so overhead roofs stay overhead.
      const originY = Math.max(pivot.y, out.y);
      for (let i = -1; i < 4; i++) {
        const x = out.x + (i < 0 ? 0 : (i & 1 ? radius : -radius));
        const z = out.z + (i < 0 ? 0 : (i & 2 ? radius : -radius));
        const y = groundY(x, originY, z);
        if (Number.isFinite(y)) floor = Math.max(floor, y);
      }
    }
    if (out.y < floor + radius + .02 - 1e-4) { out.y = floor + radius + .02; continue; }
    if (!outsideDriverBody(out, carPos, carQuat, bounds, radius + .02)) return false;
    return Math.hypot(_local.x - (bounds.minX + bounds.maxX) * .5, _local.z - (bounds.minZ + bounds.maxZ) * .5) >= minHorizontal;
  }
  return false;
}
