// Driver chase camera and gunner camera (first person by default, over-the-shoulder optional), with shake, speed FOV and recoil.
// IMPORTANT: camera TRANSLATION is never smoothed in world space. Exponential smoothing of a target moving at 40 m/s has a
// lag that depends on the frame time, so uneven frame pacing made the truck shudder back and forth on screen. Cameras are
// positioned relative to the (render-interpolated) truck; only rotations / offsets are smoothed.
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle } from '../core/util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

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
    this.mode = 0; // 0 cockpit (first person), 1 chase, 2 far chase
    this.cockPitch = 0; this.cockRoll = 0;
    this.shake = new Shaker(); this.fov = 68; this.roll = 0; this.lookYaw = 0; this.lookPitch = 0; this.lift = 0;
    this.back = 7.2; this.height = 2.7; this.dy = 0;
  }
  toggle() { this.mode = (this.mode + 1) % 3; }
  get firstPerson() { return this.mode === 0; }
  update(dt, carPos, carQuat, vel, opts = {}) {
    const cam = this.camera;
    if (this.mode === 0 && opts.cockpitEye) { this._cockpit(dt, carQuat, vel, opts); return; }
    const fwd = _v.set(0, 0, 1).applyQuaternion(carQuat);
    const heading = Math.atan2(fwd.x, fwd.z);
    const speed = Math.hypot(vel.x, vel.z);
    const velHeading = speed > 6 ? Math.atan2(vel.x, vel.z) : heading;
    const target = heading + wrapAngle(velHeading - heading) * 0.5;
    if (!this.init) { this.yaw = target; this.init = true; }
    this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-dt * 4.2));
    this.lookYaw = damp(this.lookYaw, (opts.lookX || 0) * -1.4, 8, dt);
    this.lookPitch = damp(this.lookPitch, (opts.lookY || 0) * 0.5, 8, dt);
    const y = this.yaw + this.lookYaw;
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
  if (back) {
    // look back: a camera over the tailgate facing backwards (instant cut, like every racing game)
    cam.position.copy(opts.lookBackEye).add(so);
    cam.quaternion.setFromEuler(_e.set(this.cockPitch - 0.07, _e.y, this.cockRoll, 'YXZ'));
  } else {
    cam.position.copy(opts.cockpitEye).add(so).add(_v.copy(this.head).applyQuaternion(carQuat));
    // cameras look down -Z, the truck faces +Z: turn 180 degrees (which also flips the sign of pitch and roll)
    cam.quaternion.setFromEuler(_e.set(-this.cockPitch + this.lookPitch - 0.06, _e.y + Math.PI + this.lookYaw, -this.cockRoll + so.x * 0.02, 'YXZ'));
  }
  const speed = Math.hypot(vel.x, vel.z), spd01 = smoothstep(5, 62, speed);
  const targetFov = back ? 70 : 74 + spd01 * 14 + (opts.boosting ? 10 : 0);
  this.fov = damp(this.fov, targetFov, back ? 30 : 4, dt);
  if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  if (cam.near !== 0.05) { cam.near = 0.05; cam.updateProjectionMatrix(); }
};

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
    if (opts.truckQuat) { _e.setFromQuaternion(opts.truckQuat, 'YXZ'); this.roll = damp(this.roll, _e.z * 0.3, 10, dt); }
    cam.rotateZ(this.roll + so.x * 0.03);
    const baseFov = (this.firstPerson ? 72 : 62) + (opts.speed01 || 0) * 8;
    const adsFov = opts.scoped ? (opts.scopeFov || 18) : (this.firstPerson ? 52 : 42);
    const tf = lerp(baseFov, adsFov, this.adsK) + (opts.boosting ? 6 : 0);
    this.fov = damp(this.fov, tf, 12, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    const near = this.firstPerson ? 0.05 : 0.15;
    if (cam.near !== near) { cam.near = near; cam.updateProjectionMatrix(); }
    this.dir.copy(fwd);
    return this.dir;
  }
}
