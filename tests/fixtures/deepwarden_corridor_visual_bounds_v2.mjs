// One boss's conservative commit guard, using the actual extracted body bounds
// and shared driving projection. This is a sampled gate, not swept collision or
// a replacement for Rapier contacts, ordinary driving, rescue or catch-up.
import * as THREE from 'three';

const CLEARANCE = .35;
const _pose = {}, _projection = {}, _point = new THREE.Vector3();

function boundsOf(spec) {
  const box = spec?.model?.bbox;
  return box && [box.min, box.max].every(a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite))
    && box.min.every((v, i) => v < box.max[i]) ? box : null;
}

function pointFits(road, ground, x, z, s, route, window) {
  road.projectDriving(x, z, s, window, _projection);
  return Number.isFinite(_projection.s) && Number.isFinite(_projection.d)
    && Number.isFinite(_projection.dist) && Number.isFinite(_projection.halfWidth)
    && (_projection.route || null) === (route || null)
    && Math.abs(_projection.d) <= _projection.halfWidth - CLEARANCE
    // A projection onto a distant segment end is not support for this point.
    && _projection.dist <= Math.abs(_projection.d) + .3
    && ground.hasColliderAt(_projection.s);
}

/** Test a road-aligned body envelope at one requested lane. Both branch and
 * main geometry come from drivingPointAt/projectDriving, never a fictitious
 * straight road or a nominal width-only test. Boundary midpoint samples retain
 * asymmetric cutter/body extents; centre samples also require loaded support. */
export function drillLaneFootprintFits(road, ground, spec, s, lane, route = null) {
  const box = boundsOf(spec);
  if (!box || !Number.isFinite(s) || !Number.isFinite(lane)
    || typeof road?.drivingPointAt !== 'function' || typeof road.projectDriving !== 'function'
    || typeof ground?.hasColliderAt !== 'function') return false;
  road.drivingPointAt(s, lane, route, _pose);
  if (![ _pose.x, _pose.z, _pose.th ].every(Number.isFinite)) return false;
  const nx = Math.cos(_pose.th), nz = -Math.sin(_pose.th), fx = -nz, fz = nx;
  const window = Math.max(12, box.max[2] - box.min[2] + 6);
  for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) {
    const x = box.min[0] + (box.max[0] - box.min[0]) * ix / 2;
    const z = box.min[2] + (box.max[2] - box.min[2]) * iz / 2;
    if (!pointFits(road, ground, _pose.x + nx * x + fx * z,
      _pose.z + nz * x + fz * z, s, route, window)) return false;
  }
  return true;
}

/** Current body corners use the live quaternion and COM offset. A spun/rolled
 * long tractor cannot qualify merely because its centre and width are safe.
 * This deliberately leaves vertical floor/ceiling collision to the unchanged
 * generated-hull/terrain pipeline and separately authored physical tests. */
export function drillPhysicalFootprintFits(road, ground, car) {
  const box = boundsOf(car?.spec), v = car?.veh;
  if (!box || !v?.pos || !v.quat || !Number.isFinite(v.restComHeight) || !Number.isFinite(car.s)
    || typeof road?.projectDriving !== 'function' || typeof ground?.hasColliderAt !== 'function') return false;
  const window = Math.max(12, box.max[2] - box.min[2] + 6);
  for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
    _point.set(box[ix ? 'max' : 'min'][0], box[iy ? 'max' : 'min'][1] - v.restComHeight,
      box[iz ? 'max' : 'min'][2]).applyQuaternion(v.quat).add(v.pos);
    if (!pointFits(road, ground, _point.x, _point.z, car.s, car.route || null, window)) return false;
  }
  return true;
}
