// Driver chase camera and gunner over-the-shoulder camera, with shake, speed FOV kick and recoil.
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, wrapAngle, D2R } from '../core/util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

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
    this.camera = camera; this.yaw = 0; this.pos = new THREE.Vector3(); this.init = false;
    this.mode = 0; // 0 chase, 1 far chase, 2 hood
    this.shake = new Shaker(); this.fov = 68; this.roll = 0; this.lookYaw = 0; this.lookPitch = 0; this.lift = 0;
  }
  toggle() { this.mode = (this.mode + 1) % 3; }
  update(dt, carPos, carQuat, vel, opts = {}) {
    const cam = this.camera;
    const fwd = _v.set(0, 0, 1).applyQuaternion(carQuat);
    const heading = Math.atan2(fwd.x, fwd.z);
    const speed = Math.hypot(vel.x, vel.z);
    const velHeading = speed > 6 ? Math.atan2(vel.x, vel.z) : heading;
    const target = heading + wrapAngle(velHeading - heading) * (this.mode === 2 ? 0 : 0.5);
    if (!this.init) { this.yaw = target; this.init = true; }
    this.yaw += wrapAngle(target - this.yaw) * (1 - Math.exp(-dt * (this.mode === 2 ? 20 : 4.2)));
    // free look (right stick / mouse while driving)
    this.lookYaw = damp(this.lookYaw, (opts.lookX || 0) * -1.4, 8, dt);
    this.lookPitch = damp(this.lookPitch, (opts.lookY || 0) * 0.5, 8, dt);
    const y = this.yaw + this.lookYaw;
    const boost = opts.boosting ? 1 : 0;
    const spd01 = smoothstep(5, 62, speed);
    const back = this.mode === 1 ? 10.5 : 7.2 + spd01 * 1.6 + boost * 0.8;
    const height = this.mode === 1 ? 4.0 : 2.7 + spd01 * 0.35;
    this.lift = damp(this.lift, clamp(vel.y * -0.02, -0.4, 0.4) + (opts.airborne ? 0.6 : 0), 3, dt);
    let px, py, pz, lx, ly, lz;
    if (this.mode === 2 && opts.hoodPos) {
      // bonnet cam: hoodPos in world
      px = opts.hoodPos.x; py = opts.hoodPos.y; pz = opts.hoodPos.z;
      lx = px + Math.sin(y) * 30; ly = py - 0.5 + this.lookPitch * 6; lz = pz + Math.cos(y) * 30;
    } else {
      px = carPos.x - Math.sin(y) * back; pz = carPos.z - Math.cos(y) * back; py = carPos.y + height + this.lift;
      lx = carPos.x + Math.sin(y) * 9; lz = carPos.z + Math.cos(y) * 9; ly = carPos.y + 1.3 + this.lookPitch * 8;
    }
    if (!this.pos.lengthSq()) this.pos.set(px, py, pz);
    const k = this.mode === 2 ? 1 : 1 - Math.exp(-dt * 16);
    this.pos.x += (px - this.pos.x) * k; this.pos.z += (pz - this.pos.z) * k; this.pos.y += (py - this.pos.y) * (1 - Math.exp(-dt * 9));
    this.shake.update(dt);
    const so = this.shake.offset(_v2, 0.55);
    cam.position.copy(this.pos).add(so);
    cam.lookAt(lx, ly, lz);
    // roll into corners
    const roll = clamp(-(opts.yawRate || 0) * 0.018 * spd01 * 4, -0.09, 0.09) + so.x * 0.02;
    this.roll = damp(this.roll, roll, 6, dt);
    cam.rotateZ(this.roll);
    const targetFov = (this.mode === 2 ? 78 : 66) + spd01 * 20 + boost * 12;
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}

export class GunnerCam {
  constructor(camera) {
    this.camera = camera; this.pos = new THREE.Vector3(); this.init = false; this.shake = new Shaker();
    this.fov = 62; this.adsK = 0; this.recoil = 0; this.recoilYaw = 0; this.kickPitch = 0; this.kickYaw = 0;
    this.dir = new THREE.Vector3(0, 0, 1);
  }
  addRecoil(pitch, yaw) { this.kickPitch += pitch; this.kickYaw += yaw; }
  /** pivot: world pos of the gunner's head; yaw/pitch: aim angles. Returns view dir. */
  update(dt, pivot, yaw, pitch, ads, opts = {}) {
    const cam = this.camera;
    this.adsK = damp(this.adsK, ads ? 1 : 0, 14, dt);
    this.kickPitch = damp(this.kickPitch, 0, 14, dt); this.kickYaw = damp(this.kickYaw, 0, 12, dt);
    const yw = yaw + this.kickYaw, pt = clamp(pitch + this.kickPitch, -1.25, 1.25);
    const cp = Math.cos(pt);
    const fwd = _v.set(Math.sin(yw) * cp, Math.sin(pt), Math.cos(yw) * cp);
    const right = _v2.set(-Math.cos(yw), 0, Math.sin(yw));
    const dist = lerp(2.55, opts.scoped ? 0.05 : 1.15, this.adsK), shoulder = lerp(0.62, opts.scoped ? 0 : 0.36, this.adsK), up = lerp(0.28, 0.12, this.adsK);
    const wp = _v3.copy(pivot).addScaledVector(fwd, -dist).addScaledVector(right, shoulder); wp.y += up;
    if (!this.init) { this.pos.copy(wp); this.init = true; }
    // smooth follow of the moving truck, but never lag behind by more than a few cm horizontally (crisp aim)
    const k = 1 - Math.exp(-dt * 32);
    this.pos.lerp(wp, k);
    this.shake.update(dt);
    const so = this.shake.offset(_q.identity() && new THREE.Vector3(), 0.4);
    cam.position.copy(this.pos).add(so);
    cam.lookAt(cam.position.x + fwd.x, cam.position.y + fwd.y, cam.position.z + fwd.z);
    cam.rotateZ(so.x * 0.03);
    const baseFov = 62 + (opts.speed01 || 0) * 10;
    const adsFov = opts.scoped ? (opts.scopeFov || 18) : 42;
    const tf = lerp(baseFov, adsFov, this.adsK) + (opts.boosting ? 6 : 0);
    this.fov = damp(this.fov, tf, 12, dt);
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
    this.dir.copy(fwd);
    return this.dir;
  }
}
