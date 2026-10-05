// Driver chase camera and gunner camera (first person by default, over-the-shoulder optional), with shake, speed FOV and recoil.
// IMPORTANT: camera TRANSLATION is never smoothed in world space. Exponential smoothing of a target moving at 40 m/s has a
// lag that depends on the frame time, so uneven frame pacing made the truck shudder back and forth on screen. Cameras are
// positioned relative to the (render-interpolated) truck; only rotations / offsets are smoothed.
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../core/util.js';
import { driverBodyBounds, limitDriverCamera } from './driver_camera_bounds.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _cameraMatrix = new THREE.Matrix4(), _localUp = new THREE.Vector3(0, 1, 0);
export const DRIVER_CAMERA_NAMES = ['COCKPIT', 'CHASE', 'FAR CHASE', 'BUMPER', 'FRONT EXTERIOR'];
const FRONT_CAMERA_OFFSETS = [0, -.35, .35, -.7, .7];

export class Shaker {
  constructor() { this.trauma = 0; this.t = 0; }
  add(v) { this.trauma = Math.min(1, this.trauma + v); }
  update(dt) { this.trauma = Math.max(0, this.trauma - dt * 1.4); this.t += dt * 38; }
  get amount() { return this.trauma * this.trauma; }
  offset(out, scale = 1) {
    const a = this.amount * scale;
    out.set(Math.sin(this.t * 1.13) * a, Math.sin(this.t * 1.71 + 2) * a, Math.sin(this.t * 0.93 + 4) * a);
    return out;
  }
}

export class ChaseCam {
  constructor(camera) {
    this.camera = camera; this.yaw = 0; this.init = false;
    this.mode = 0; // cockpit, chase, far chase, bonnet, front exterior
    this.cockPitch = 0; this.cockRoll = 0;
    this.shake = new Shaker(); this.fov = 68; this.roll = 0; this.lookYaw = 0; this.lookPitch = 0; this.lift = 0;
    this.back = 7.2; this.height = 2.7; this.dy = 0;
    this.frontBounds = {}; this.frontPivot = new THREE.Vector3(); this.frontDesired = new THREE.Vector3();
    this.frontCandidates = Array.from({ length: 5 }, () => new THREE.Vector3());
    this.frontSafe = new THREE.Vector3(); this.frontLast = new THREE.Vector3(); this.frontLastMode = -1;
  }
  toggle() { this.mode = (this.mode + 1) % DRIVER_CAMERA_NAMES.length; }
  get modeName() { return DRIVER_CAMERA_NAMES[this.mode]; }
  get firstPerson() { return this.mode === 0; }
  update(dt, carPos, carQuat, vel, opts = {}) {
    const cam = this.camera;
    if (this.mode === 0 && opts.cockpitEye) { this._cockpit(dt, carQuat, vel, opts); return; }
    if (this.mode === 3 || this.mode === 4) { this._front(dt, carPos, carQuat, vel, opts); return; }
    const fwd = _v.set(0, 0, 1).applyQuaternion(carQuat);
    const heading = Math.atan2(fwd.x, fwd.z);
    const speed = Math.hypot(vel.x, vel.z);
    // Bias towards the direction of travel without averaging wrapped angles.
    // Half of a wrapped slip angle flips by PI when the truck spins through
    // backwards travel, sending the chase camera around the opposite side.
    // A bounded lateral projection remains continuous through a full turn,
    // while a speed fade also avoids a target jump at the old 6 m/s switch.
    const lateralSlip = speed > 1e-3 ? (vel.x * Math.cos(heading) - vel.z * Math.sin(heading)) / speed : 0;
    const target = heading + lateralSlip * 0.5 * smoothstep(3, 8, speed);
    if (!this.init) { this.yaw = target; this.init = true; }
    this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-dt * 4.2));
    this.lookYaw = damp(this.lookYaw, (opts.lookX || 0) * -1.4, 8, dt);
    this.lookPitch = damp(this.lookPitch, (opts.lookY || 0) * 0.5, 8, dt);
    // Reverse the chase offset and view together while held. Keep the filtered
    // forward heading intact so release is an immediate return, not a half-turn
    // through the truck or a long yaw-smoothing spin.
    const y = this.yaw + this.lookYaw + (opts.lookBack ? Math.PI : 0);
    const boost = opts.boosting ? 1 : 0;
    const spd01 = smoothstep(5, 62, speed);
    this.back = damp(this.back, this.mode === 2 ? 10.5 : 7.2 + spd01 * 1.6 + boost * 0.8, 3, dt);
    this.height = damp(this.height, this.mode === 2 ? 4.0 : 2.7 + spd01 * 0.35, 3, dt);
    this.lift = damp(this.lift, clamp(vel.y * -0.02, -0.4, 0.4) + (opts.airborne ? 0.6 : 0), 3, dt);
    let px, py, pz, lx, ly, lz;
    {
      // soften the truck's vertical bounce a little (relative offset, so it cannot drift / lag with speed)
      this.dy = damp(this.dy, 0, 10, dt);
      px = carPos.x - Math.sin(y) * this.back; pz = carPos.z - Math.cos(y) * this.back; py = carPos.y + this.height + this.lift + this.dy;
      lx = carPos.x + Math.sin(y) * 9; lz = carPos.z + Math.cos(y) * 9; ly = carPos.y + 1.3 + this.lookPitch * 8 + this.dy * 0.5;
    }
    this.shake.update(dt);
    const so = this.shake.offset(_v2, 0.55);
    cam.position.set(px, py, pz).add(so);
    cam.lookAt(lx, ly, lz);
    const roll = clamp(-(opts.yawRate || 0) * 0.018 * spd01 * 4, -0.09, 0.09) + so.x * 0.02;
    this.roll = damp(this.roll, roll, 6, dt);
    cam.rotateZ(this.roll);
    const targetFov = 66 + spd01 * 20 + boost * 12;
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    if (cam.near !== 0.15) { cam.near = 0.15; cam.updateProjectionMatrix(); }
  }
}

ChaseCam.prototype._front = function (dt, carPos, carQuat, vel, opts) {
  const cam = this.camera, bonnet = this.mode === 3, back = !!opts.lookBack;
  const restComHeight = opts.restComHeight ?? 0;
  const view = opts.vehicleView;
  if (this.frontSpec !== opts.vehicleSpec || this.frontComHeight !== restComHeight || this.frontView !== view
    || this.frontVisualKey !== view?.upgradeKey || !Number.isFinite(this.frontBounds.minX)) {
    driverBodyBounds(opts.vehicleSpec, restComHeight, this.frontBounds, view);
    this.frontSpec = opts.vehicleSpec; this.frontComHeight = restComHeight;
    this.frontView = view; this.frontVisualKey = view?.upgradeKey;
    this.frontLastMode = -1;
  }
  const b = this.frontBounds;
  const speed = Math.hypot(vel.x, vel.z), spd01 = smoothstep(5, 62, speed);
  const targetFov = bonnet ? (back ? 78 : (opts.fovBase ?? 85) + spd01 * 12 + (opts.boosting ? 11 : 0)) : 66 + spd01 * 20 + (opts.boosting ? 12 : 0);
  const near = bonnet ? .05 : .15;
  const aspect = Number.isFinite(cam.aspect) && cam.aspect > 0 ? cam.aspect : 16 / 9;
  const nearHeight = near * Math.tan(clamp(Math.max(cam.fov, this.fov, targetFov), 1, 140) * Math.PI / 360);
  const radius = Math.max(bonnet ? .22 : .4, Math.hypot(nearHeight * aspect, nearHeight, near) + .02);
  // A held rear cut does not erase the filtered live free-look state. Release
  // returns to the current mouse/stick aim without rebuilding a half-turn.
  this.lookYaw = damp(this.lookYaw, (opts.lookX || 0) * -1.6 + (opts.mouseYaw || 0), 16, dt);
  this.lookPitch = damp(this.lookPitch, (opts.lookY || 0) * -.5 + (opts.mousePitch || 0), 16, dt);
  const viewPitch = back ? 0 : this.lookPitch;
  this.shake.update(dt);
  const so = this.shake.offset(_v2, bonnet ? .08 : .3);
  const centerX = (b.minX + b.maxX) * .5, centerY = (b.minY + b.maxY) * .5, centerZ = (b.minZ + b.maxZ) * .5;
  this.frontPivot.set(centerX, centerY, centerZ).applyQuaternion(carQuat).add(carPos);
  const candidates = this.frontCandidates;
  if (bonnet) {
    // Free look moves around the expanded body boundary, always facing away
    // from the truck. Held look-back cuts to the rear bumper and returns at once.
    const a = back ? Math.PI : this.lookYaw, sx = Math.sin(a), sz = Math.cos(a);
    const edgeX = sx >= 0 ? b.maxX : -b.minX, edgeZ = sz >= 0 ? b.maxZ : -b.minZ;
    const reach = Math.min(Math.abs(sx) > 1e-6 ? (edgeX + radius + .08) / Math.abs(sx) : Infinity,
      Math.abs(sz) > 1e-6 ? (edgeZ + radius + .08) / Math.abs(sz) : Infinity);
    const y = b.minY + (b.maxY - b.minY) * .68;
    candidates[0].set(sx * reach, y, sz * reach);
    candidates[1].copy(candidates[0]); candidates[1].y = b.maxY + radius + .08;
    candidates[2].set(0, b.maxY + radius + .08, 0);
    candidates[3].set(b.maxX + radius + .08, y, sz * reach);
    candidates[4].set(b.minX - radius - .08, y, sz * reach);
    for (const p of candidates) p.applyQuaternion(carQuat).add(carPos);
  } else {
    // Compose in the chassis frame instead of projecting its forward axis onto
    // the ground. A nose-up rollover otherwise reverses that heading at zenith.
    const a = back ? Math.PI : this.lookYaw;
    const halfVertical = clamp(Math.min(cam.fov, this.fov, targetFov), 1, 140) * Math.PI / 360;
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
    const bodyRadius = Math.hypot(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ) * .5;
    const distance = Math.max(7.2 + spd01 * 1.6, bodyRadius / Math.sin(Math.min(halfVertical, halfHorizontal)) + .6);
    const height = Math.max(2.7 + spd01 * .35, b.maxY + radius + .1) + viewPitch * 3;
    for (let i = 0; i < candidates.length; i++) candidates[i].set(centerX + Math.sin(a + FRONT_CAMERA_OFFSETS[i]) * distance,
      height + so.y, centerZ + Math.cos(a + FRONT_CAMERA_OFFSETS[i]) * distance).applyQuaternion(carQuat).add(carPos);
  }
  this.frontDesired.copy(candidates[0]);
  // An exterior camera aimed at the truck must keep a horizontal lever arm;
  // a roof-pulled eye at the target's zenith makes lookAt's up direction singular.
  const minHorizontal = bonnet ? 0 : Math.min(b.maxX - b.minX, b.maxZ - b.minZ) * .5 + radius + .08;
  // Revalidate a relative last clear position before changing hemisphere. There
  // is no world-space translation filter, so a 40m/s truck never outruns its eye.
  this.frontCameraClear = limitDriverCamera(this.frontSafe, candidates[0], this.frontPivot, carPos, carQuat, b, radius, opts.raycastWorld, opts.groundY, minHorizontal);
  if (!this.frontCameraClear && this.frontLastMode === this.mode && this.frontLastBack === back) {
    _v3.copy(this.frontLast).applyQuaternion(carQuat).add(carPos);
    this.frontCameraClear = limitDriverCamera(this.frontSafe, _v3, this.frontPivot, carPos, carQuat, b, radius, opts.raycastWorld, opts.groundY, minHorizontal);
  }
  for (let i = 1; !this.frontCameraClear && i < candidates.length; i++)
    this.frontCameraClear = limitDriverCamera(this.frontSafe, candidates[i], this.frontPivot, carPos, carQuat, b, radius, opts.raycastWorld, opts.groundY, minHorizontal);
  // No exterior point may exist when the truck itself is enclosed in solids.
  // Keep that unresolved state explicit instead of accepting a body-interior eye.
  cam.position.copy(this.frontCameraClear ? this.frontSafe : this.frontDesired);
  if (this.frontCameraClear) {
    this.frontLast.copy(cam.position).sub(carPos).applyQuaternion(_q.copy(carQuat).invert());
    this.frontLastMode = this.mode; this.frontLastBack = back;
  }
  // Derive aim from the accepted eye, including fallback choices. A bonnet eye
  // moved to the opposite side must face away from that side, not into the car.
  _v3.copy(cam.position).sub(carPos).applyQuaternion(_q.copy(carQuat).invert());
  if (bonnet) {
    const a = Math.hypot(_v3.x, _v3.z) > .05 ? Math.atan2(_v3.x, _v3.z) : back ? Math.PI : this.lookYaw;
    const roofFallback = _v3.y > b.maxY && _v3.x >= b.minX && _v3.x <= b.maxX && _v3.z >= b.minZ && _v3.z <= b.maxZ;
    // A clearance fallback above the roof must look outward from that face.
    // A downward free-look there would look through the roof despite clear eyes.
    const pitch = roofFallback ? Math.max(0, viewPitch - .035) : viewPitch - .035;
    cam.quaternion.copy(carQuat).multiply(_q.setFromEuler(_e.set(pitch, Math.PI + a, 0, 'YXZ')));
  } else {
    _v.set(centerX, centerY, centerZ);
    _cameraMatrix.lookAt(_v3, _v, _localUp);
    cam.quaternion.copy(carQuat).multiply(_q.setFromRotationMatrix(_cameraMatrix));
    this.roll = damp(this.roll, clamp(-(opts.yawRate || 0) * .018 * spd01 * 4, -.09, .09), 6, dt);
    cam.rotateZ(this.roll);
  }
  this.fov = damp(this.fov, targetFov, back ? 30 : 4, dt);
  if (Math.abs(cam.fov - this.fov) > .05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
};

ChaseCam.prototype._cockpit = function (dt, carQuat, vel, opts) {
  // first person from the driver's seat: yaw locked to the truck, a damped share of its pitch/roll (so the suspension
  // doesn't shake the view), free look (right stick / mouse), and the head swaying with the G-forces (all in the truck
  // frame => no lag, no judder). Position = the eye point attached to the truck.
  const cam = this.camera;
  if (!this.head) { this.head = new THREE.Vector3(); this.acc = new THREE.Vector3(); this.pvel = new THREE.Vector3().copy(vel); }
  _v3.copy(vel).sub(this.pvel).multiplyScalar(1 / Math.max(dt, 1e-3)); this.pvel.copy(vel);
  _v3.applyQuaternion(_q.copy(carQuat).invert()).clampScalar(-60, 60);          // truck-local acceleration (x left, y up, z fwd)
  this.acc.x = damp(this.acc.x, _v3.x, 5, dt); this.acc.y = damp(this.acc.y, _v3.y, 8, dt); this.acc.z = damp(this.acc.z, _v3.z, 4, dt);
  this.head.set(clamp(-this.acc.x * 0.0035, -0.06, 0.06), clamp(-this.acc.y * 0.0022, -0.05, 0.03), clamp(-this.acc.z * 0.003, -0.05, 0.04));
  _e.setFromQuaternion(carQuat, 'YXZ');
  this.cockPitch = damp(this.cockPitch, _e.x * 0.7, 12, dt); this.cockRoll = damp(this.cockRoll, _e.z * 0.55, 12, dt);
  const back = !!(opts.lookBack && opts.lookBackEye);
  this.lookYaw = damp(this.lookYaw, back ? 0 : (opts.lookX || 0) * -1.6 + (opts.mouseYaw || 0), 16, dt);
  this.lookPitch = damp(this.lookPitch, back ? 0 : (opts.lookY || 0) * -0.5 + (opts.mousePitch || 0), 16, dt);
  this.shake.update(dt);
  const so = this.shake.offset(_v2, 0.18);
  // speed: a road buzz through the seat that grows with speed, and a punch when the nitro lights
  const spdB = smoothstep(15, 60, Math.hypot(vel.x, vel.z));
  this.buzzT = (this.buzzT || 0) + dt;
  const bz = (0.0012 + 0.0045 * spdB * spdB) * (opts.boosting ? 1.8 : 1);
  so.x += Math.sin(this.buzzT * 71) * bz; so.y += Math.sin(this.buzzT * 53 + 1.3) * bz * 1.4;
  if (opts.boosting && !this.wasBoost) { this.shake.add(0.22); this.fov += 6; }
  this.wasBoost = !!opts.boosting;
  if (back) {
    // look back: a camera over the tailgate facing backwards (instant cut, like every racing game)
    cam.position.copy(opts.lookBackEye).add(so);
    cam.quaternion.setFromEuler(_e.set(this.cockPitch - 0.08, _e.y + 0.1, this.cockRoll, 'YXZ')); // yaw a touch outboard, clear of the bed
  } else {
    cam.position.copy(opts.cockpitEye).add(so).add(_v.copy(this.head).applyQuaternion(carQuat));
    // cameras look down -Z, the truck faces +Z: turn 180 degrees (which also flips the sign of pitch and roll)
    cam.quaternion.setFromEuler(_e.set(-this.cockPitch + this.lookPitch - 0.035, _e.y + Math.PI + this.lookYaw, -this.cockRoll + so.x * 0.02, 'YXZ'));
  }
  const speed = Math.hypot(vel.x, vel.z), spd01 = smoothstep(5, 62, speed);
  const targetFov = back ? 78 : (opts.fovBase ?? 85) + spd01 * 12 + (opts.boosting ? 11 : 0);
  this.fov = damp(this.fov, targetFov, back ? 30 : 4, dt);
  if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  if (cam.near !== 0.05) { cam.near = 0.05; cam.updateProjectionMatrix(); }
};

/** Perspective magnification relative to the unboosted, stationary hip field. */
export function scopeFovForZoom(baseFov, zoom) {
  return 2 * Math.atan(Math.tan(baseFov * Math.PI / 360) / zoom) * 180 / Math.PI;
}
export class GunnerCam {
  constructor(camera) {
    this.camera = camera; this.shake = new Shaker();
    this.fov = 70; this.adsK = 0; this.kickPitch = 0; this.kickYaw = 0; this.tpK = 0;
    this.firstPerson = true;
    this.dir = new THREE.Vector3(0, 0, 1);
    this.roll = 0;
  }
  toggle() { this.firstPerson = !this.firstPerson; }
  addRecoil(pitch, yaw) { this.kickPitch += pitch; this.kickYaw += yaw; }
  /**
   * eye: world position of the gunner's eye (attached to the truck frame, not the animated head). yaw/pitch: aim angles (world).
   * opts: {scoped, scopeFov, speed01, boosting, truckQuat}
   */
  update(dt, eye, yaw, pitch, ads, opts = {}) {
    const cam = this.camera;
    this.adsK = damp(this.adsK, ads ? 1 : 0, 16, dt);
    this.tpK = damp(this.tpK, this.firstPerson ? 0 : 1, 10, dt);
    this.kickPitch = damp(this.kickPitch, 0, 14, dt); this.kickYaw = damp(this.kickYaw, 0, 12, dt);
    const yw = yaw + this.kickYaw, pt = clamp(pitch + this.kickPitch, -1.25, 1.25);
    const cp = Math.cos(pt);
    const fwd = _v.set(Math.sin(yw) * cp, Math.sin(pt), Math.cos(yw) * cp);
    const right = _v2.set(-Math.cos(yw), 0, Math.sin(yw));
    // third-person offsets fade in with tpK (all relative to the eye => no translation lag)
    const tp = this.tpK * (1 - this.adsK * 0.85);
    const dist = lerp(0, opts.scoped ? 0 : 2.4, tp), shoulder = lerp(0, 0.6, tp), up = lerp(0, 0.22, tp);
    this.shake.update(dt);
    const so = this.shake.offset(_v3, this.firstPerson ? 0.25 : 0.4);
    cam.position.copy(eye).addScaledVector(fwd, -dist).addScaledVector(right, shoulder).add(so); cam.position.y += up;
    cam.lookAt(cam.position.x + fwd.x, cam.position.y + fwd.y, cam.position.z + fwd.z);
    // a share of the truck's roll reaches the gunner's head (you are standing on it)
    if (opts.truckQuat) {
      // Pure chassis pitch must not become a PI roll as it crosses vertical.
      const lateralTilt = Math.asin(clamp(_v2.set(1, 0, 0).applyQuaternion(opts.truckQuat).y, -1, 1));
      this.roll = damp(this.roll, lateralTilt * 0.3, 10, dt);
    }
    cam.rotateZ(this.roll + so.x * 0.03);
    const baseFov = (this.firstPerson ? (opts.fovBase ?? 80) - 4 : 62) + (opts.speed01 || 0) * 8;
    const fixedZoom = opts.scoped && Number.isFinite(opts.scopeZoom) && opts.scopeZoom > 1;
    const referenceFov = this.firstPerson ? (opts.fovBase ?? 80) - 4 : 62;
    const adsFov = opts.scoped ? (fixedZoom ? scopeFovForZoom(referenceFov, opts.scopeZoom) : (opts.scopeFov || 18)) : (this.firstPerson ? 52 : 42);
    // A selected fixed-power optic retains its advertised projection ratio at
    // full ADS. Existing factory scope/ordinary ADS camera rules stay unchanged.
    const boostFov = (opts.boosting ? 6 : 0) * (fixedZoom ? 1 - this.adsK : 1);
    const tf = lerp(baseFov, adsFov, this.adsK) + boostFov;
    this.fov = damp(this.fov, tf, 12, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    // looking through a scope: push the near plane past the own truck's roll cage / mounts so they never fill the scope
    // (the first-person viewmodel uses its own projection, so it is unaffected)
    // (the first-person viewmodel uses its own projection, so it is unaffected); looking over the cab it must clear the roof mount too
    let near = this.firstPerson ? 0.05 : 0.15;
    if (this.firstPerson && opts.scoped && this.adsK > 0.8) {
      const ahead = opts.truckQuat ? Math.max(0, fwd.dot(_v2.set(0, 0, 1).applyQuaternion(opts.truckQuat))) : 0;
      near = Math.round((1.8 + 3.4 * ahead * ahead) * 10) / 10;   // quantised: no projection rebuild every frame
    }
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
    this.dir.copy(fwd);
    return this.dir;
  }
}
