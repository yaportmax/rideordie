import * as THREE from 'three';

const local = new THREE.Vector3(), inverse = new THREE.Quaternion();
export const finiteTriplet = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
export function validHitReport(report) {
  if (!report || !finiteTriplet(report.point) || !finiteTriplet(report.dir) || !Number.isFinite(report.dmg) || report.dmg <= 0 || report.dmg > 10000) return false;
  const directionLength = Math.hypot(...report.dir);
  return Math.abs(directionLength - 1) < .001 && (report.tireMul === undefined || (Number.isFinite(report.tireMul) && report.tireMul > 0 && report.tireMul <= 16));
}

/** A reported contact travels with the rendered target, rather than its old world position. */
export function localHitPoint(car, point) {
  if (!car.veh?.pos || !car.veh?.quat) return undefined;
  return local.copy(point).sub(car.veh.pos).applyQuaternion(inverse.copy(car.veh.quat).invert()).toArray();
}

/** Reject malformed or pre-recovery contacts before damage or an off-center impulse is applied. */
export function resolveHitPoint(car, report, out) {
  if (!validHitReport(report)) return null;
  if (report.poseRevision !== undefined && (!Number.isInteger(report.poseRevision) || report.poseRevision < 0 || report.poseRevision > 65535 || report.poseRevision !== (car.veh.poseRevision || 0))) return null;
  const radius = (car.raycastRadius?.() ?? Math.hypot(car.spec?.length || 6, car.spec?.width || 3, car.spec?.height || 3)) + 1;
  if (report.localPoint !== undefined) {
    if (!finiteTriplet(report.localPoint)) return null;
    out.fromArray(report.localPoint);
    if (out.lengthSq() > radius * radius) return null;
    return out.applyQuaternion(car.veh.quat).add(car.veh.pos);
  }
  out.fromArray(report.point);
  return out.distanceToSquared(car.veh.pos) <= radius * radius ? out : null;
}
