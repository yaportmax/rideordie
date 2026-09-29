// CrewView: a person riding a vehicle. Rigged character (public/models/characters/*.glb, Mixamo bone names, shared clips)
// + procedural layer: body/spine aiming, weapon placed on the aim line, analytic two-bone arm IK onto the weapon grips
// (gunners) or the steering wheel (drivers), flinches, grenade throws, deaths (gunners tumble off the vehicle).
// API: constructor(kind, opts), attach(carView, seat), setWeapon(id), fire(rate, mode, actionLen), update(dt, s), die(e), flinch(e),
//      headWorld(out), muzzleWorld(out), dispose().
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { WeaponView } from './weapon_view.js';
import { ViewModel } from './viewmodel.js';
import { clamp } from '../core/util.js';

// first person: the local gunner's own body only casts its shadow (the viewmodel draws the arms + gun)
const shadowMats = new Map();
function shadowOnly(m) {
  let c = shadowMats.get(m);
  if (!c) { c = m.clone(); c.colorWrite = false; c.depthWrite = false; shadowMats.set(m, c); }
  return c;
}

const ENEMY_GUN_MODEL = { pistol: 'pistol', smg: 'smg', rifle: 'rifle', shotgun: 'shotgun', mg: 'lmg', hmg: 'lmg', rpg: 'rpg' };
const ONE_HANDED = new Set(['pistol', 'revolver']);
const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _t = V(), _e = V(), _n = V(), _u = V(), _p = V(), _d = V(), _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _m = new THREE.Matrix4(), _eul = new THREE.Euler(0, 0, 0, 'YXZ');
const FINGER = /Hand(Thumb|Index|Middle|Ring|Pinky)\d|Hand$/;

/** Rotate `bone` (world space) so that the direction from its origin to `from` becomes the direction to `to`. */
function aimBone(bone, from, to) {
  bone.getWorldPosition(_p);
  _d.copy(from).sub(_p).normalize(); _t.copy(to).sub(_p).normalize();
  if (_d.lengthSq() < 1e-8 || _t.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(_d, _t);
  bone.getWorldQuaternion(_q2); _q2.premultiply(_q);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_q2));
  bone.updateMatrixWorld(true);
}

/** Analytic two-bone IK: upper (shoulder joint), lower (elbow), end (wrist) -> target, elbow bends toward `pole` (world). */
const _ia = V(), _ib = V(), _ic = V(), _it = V(), _ie = V(), _in = V(), _iu = V(), _ip = V(), _iw = V();
function twoBoneIK(upper, lower, end, target, pole, lens) {
  upper.getWorldPosition(_ia);
  const la = lens[0], lb = lens[1];
  _it.copy(target).sub(_ia); let d = _it.length();
  d = Math.min(Math.max(d, Math.abs(la - lb) + 1e-3), la + lb - 1e-3);
  _it.normalize();
  const cosA = (la * la + d * d - lb * lb) / (2 * la * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _ip.copy(pole).sub(_ia);
  _iu.copy(_ip).addScaledVector(_it, -_ip.dot(_it));          // pole direction, perpendicular to the reach line
  if (_iu.lengthSq() < 1e-8) _iu.set(0, -1, 0); _iu.normalize();
  _ie.copy(_ia).addScaledVector(_it, la * cosA).addScaledVector(_iu, la * sinA);   // new elbow
  lower.getWorldPosition(_ib); aimBone(upper, _ib, _ie);
  end.getWorldPosition(_ic); _iw.copy(_ia).addScaledVector(_it, d);                 // wrist goal on the reach line
  aimBone(lower, _ic, _iw);
}

export class CrewView {
  constructor(kind, opts = {}) {
    this.kind = kind; this.role = opts.role; this.opts = opts; this.alive = true; this.hero = /^hero/.test(kind);
    this.root = new THREE.Group(); this.root.name = 'crew_' + kind;
    this.body = new THREE.Group(); this.root.add(this.body);             // yawed toward the aim
    const url = `/models/characters/${kind}.glb`;
    const model = Assets.clone(url);
    this.rigged = !!model;
    this.clips = Assets.getAnimations(url).length ? Assets.getAnimations(url) : Assets.getAnimations('/models/characters/hero_gunner.glb');
    if (model) this._setupRig(model); else this._placeholder();
    this.gun = new THREE.Group(); this.gun.name = 'gunframe';
    this.weapon = null; this.weaponId = null;
    if (this.role !== 'driver') this.setWeapon(opts.weapon === 'enemy' ? ENEMY_GUN_MODEL[opts.enemyGun] || 'rifle' : opts.weapon || 'pistol');
    this.aimYawL = 0; this.bodyYaw = 0; this.pitch = 0; this.crouch = 0; this.kick = 0; this.flinchT = 0; this.throwT = 0; this.steer = 0;
    this.deadT = -1; this.fallVel = V(); this.fallSpin = V();
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = !o.isSkinnedMesh; } });
  }

  _setupRig(model) {
    this.model = model; this.body.add(model);
    this.bones = {};
    model.traverse((o) => { if (o.isBone || o.type === 'Bone' || /^(socket_|armor_t)/.test(o.name)) this.bones[o.name] = o; });
    // armour tiers on the hero gunner
    for (const t of [1, 2, 3]) { const a = model.getObjectByName('armor_t' + t); if (a) a.visible = this.opts.armorTier === t; }
    this.mixer = new THREE.AnimationMixer(model);
    const clip = (n) => this.clips.find((c) => c.name === n);
    const act = (n, w = 0) => { const c = clip(n); if (!c) return null; const a = this.mixer.clipAction(c); a.enabled = true; a.setEffectiveWeight(w); a.play(); return a; };
    if (this.role === 'driver') {
      this.aBase = act('idle_sit_drive', 1); this.aL = act('sit_lean_L', 0); this.aR = act('sit_lean_R', 0);
    } else {
      this.aBase = act('idle_stand', 1); this.aCrouch = act('crouch_idle', 0);
      // finger/hand shape only from the weapon pose
      const pose = clip('pose_rifle');
      if (pose) {
        const hands = new THREE.AnimationClip('hands_rifle', pose.duration, pose.tracks.filter((t) => FINGER.test(t.name.split('.')[0])));
        this.aHands = this.mixer.clipAction(hands); this.aHands.setEffectiveWeight(1); this.aHands.play();
      }
    }
    // random phase so a group of raiders doesn't breathe in sync
    this.mixer.update(Math.random() * 3);
    const B = this.bones;
    this.arm = {};
    for (const side of ['Right', 'Left']) {
      const u = B[side + 'Arm'], l = B[side + 'ForeArm'], h = B[side + 'Hand'];
      if (u && l && h) { u.getWorldPosition(_a); l.getWorldPosition(_b); h.getWorldPosition(_c); this.arm[side] = { u, l, h, lens: [_a.distanceTo(_b), _b.distanceTo(_c)] }; }
    }
    this.spine = ['Spine', 'Spine1', 'Spine2'].map((n) => B[n]).filter(Boolean);
    this.head = B.Head || B.socket_head || model;
    // seated: the seat socket is the hip point, so drop the model so its Hips land there
    if (this.role === 'driver') { this.mixer.update(0); model.updateMatrixWorld(true); const hips = B.Hips; if (hips) { hips.getWorldPosition(_a); this.body.worldToLocal(_a); model.position.y -= _a.y; model.position.z -= _a.z * 0.5; } }
  }

  _placeholder() {
    const skin = new THREE.MeshStandardMaterial({ color: 0xc89a78, roughness: 0.8 });
    const cloth = new THREE.MeshStandardMaterial({ color: this.hero ? 0xd9a441 : 0x5a4a3a, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.62, 0.28), cloth); torso.position.y = 1.08; this.body.add(torso);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), skin); this.head.position.y = 1.55; this.body.add(this.head);
  }

  setWeapon(id) {
    if (!id || id === this.weaponId || this.role === 'driver') return;
    this.weaponId = id;
    if (this.weapon) this.weapon.dispose();
    this.weapon = new WeaponView(id);
    this.gun.add(this.weapon.root);
    this._shadowOnlyOn = undefined;   // re-apply to the new weapon's meshes
    if (!this.gun.parent) this.body.add(this.gun);
    const st = this.weapon.sockets.stock; this.stockZ = st ? st.position.z : null;
  }
  fire(rate, mode, actionLen) { if (!this.weapon) return; this.weapon.fire(rate); if (mode === 'pump' || mode === 'bolt') this.weapon.action(actionLen || 0.6); this.kick = 1; }
  attach(carView, seat) { this.car = carView; this.seat = seat; this.root.position.set(seat[0], seat[1], seat[2]); this.root.rotation.order = 'YXZ'; }

  update(dt, s) {
    if (this.deadT >= 0) { this._dead(dt); return; }
    if (!s.alive) { this.die({}); return; }
    this.mixer?.update(dt);
    const fp = !!(s.local && s.local.firstPerson);
    // local first-person gunner: the viewmodel draws arms + gun; this body stays in the scene as an invisible shadow caster
    const useVm = fp && this.role !== 'driver' && this.hero && !!(s.local.camera && s.local.gunner);
    if (useVm && !this.vm) { this.vm = new ViewModel(); s.local.gunner.vm = this.vm; }
    this.useVm = useVm;
    this._setShadowOnly(useVm);
    this.body.visible = useVm || !(fp && s.local.scoped);
    // first person: collapse our own head (face, hair, eyes are skinned to it) so it never blocks the camera
    if (this.bones && this.bones.Head) { const k = fp && !useVm ? 1e-4 : 1; this.bones.Head.scale.setScalar(k); if (this.bones.Neck && this.role === 'driver') this.bones.Neck.scale.setScalar(fp ? 0.2 : 1); }
    if (this.seat && this.role !== 'driver') this.root.position.set(this.seat[0] + (s.local ? s.local.bedX : s.bedX || 0), this.seat[1], this.seat[2] + (s.local ? s.local.bedZ : s.bedZ || 0));
    if (this.role === 'driver') { this._driver(dt, s); return; }
    // ---------------- gunner: aim is world space; convert to the vehicle frame
    _eul.setFromQuaternion(s.quat, 'YXZ');
    let yawL = s.aimYaw - _eul.y; yawL = Math.atan2(Math.sin(yawL), Math.cos(yawL));
    this.crouch += ((s.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    if (this.aCrouch) { this.aCrouch.setEffectiveWeight(this.crouch); this.aBase.setEffectiveWeight(1 - this.crouch); }
    // body follows the aim with a lag (spine takes up to ~50 deg of the difference)
    let diff = Math.atan2(Math.sin(yawL - this.bodyYaw), Math.cos(yawL - this.bodyYaw));
    const lim = 0.85;
    if (Math.abs(diff) > lim) this.bodyYaw += diff - Math.sign(diff) * lim;
    this.bodyYaw += diff * Math.min(1, dt * 3);
    if (fp) this.bodyYaw = yawL - 0.15; // first person: the body sits under the camera (slightly bladed)
    this.body.rotation.y = this.bodyYaw;
    if (this.bones) {
      this.body.updateMatrixWorld(true);
      diff = Math.atan2(Math.sin(yawL - this.bodyYaw), Math.cos(yawL - this.bodyYaw));
      const pitch = s.aimPitch;
      const n = this.spine.length || 1;
      for (const b of this.spine) { _q.setFromEuler(_eul.set(-pitch * 0.55 / n, diff / n, 0, 'YXZ')); b.quaternion.premultiply(_q); }
      if (this.flinchT > 0) { this.flinchT -= dt; const k = Math.sin(Math.min(1, this.flinchT / 0.3) * Math.PI) * 0.35; if (this.spine[0]) this.spine[0].quaternion.premultiply(_q.setFromAxisAngle(_n.set(1, 0, 0), -k)); }
      this.model.updateMatrixWorld(true);
    }
    // ---------------- weapon on the aim line
    this.kick = Math.max(0, this.kick - dt * 10);
    const cp = Math.cos(s.aimPitch);
    _d.set(Math.sin(s.aimYaw) * cp, Math.sin(s.aimPitch), Math.cos(s.aimYaw) * cp); // world aim dir
    const sh = this.arm.Right ? this.arm.Right.u : this.head;
    sh.getWorldPosition(_p);
    const one = ONE_HANDED.has(this.weaponId), rpg = this.weaponId === 'rpg';
    // gun frame in world: looking along the aim, rolled level
    _m.lookAt(_c.set(0, 0, 0), _d.clone().negate(), _up); _q2.setFromRotationMatrix(_m);
    const right = _u.set(-1, 0, 0).applyQuaternion(_q2); // gun right (-X)
    _a.copy(_p);
    if (rpg) _a.addScaledVector(_up, 0.1).addScaledVector(right, 0.02).addScaledVector(_d, -0.35);
    else if (one) _a.addScaledVector(_d, 0.5 - this.kick * 0.05).addScaledVector(_up, 0.08).addScaledVector(right, 0.12);
    else _a.addScaledVector(_d, -(this.stockZ ?? -0.25) - 0.08 - this.kick * 0.06).addScaledVector(_up, -0.06).addScaledVector(right, 0.07);
    // first person (no viewmodel): the gun's sight comes to the eye when aiming down sights; at the hip it sits low and right
    if (fp && !useVm && s.local.eye && this.weapon) {
      const adsK = s.local.adsK || 0;
      if (one) { _b.copy(s.local.eye).addScaledVector(_d, 0.5).addScaledVector(_up, -0.13).addScaledVector(right, 0.06); _a.lerp(_b, 1 - adsK); }
      if (adsK > 0.01 && this.weapon.sockets.sight) {
        // sight socket position in gun-frame space (gun frame = weapon root at identity)
        const sg = this.weapon.sockets.sight; sg.updateWorldMatrix(true, false); this.weapon.root.updateWorldMatrix(true, false);
        _c.setFromMatrixPosition(sg.matrixWorld); this.weapon.root.worldToLocal(_c);
        _b.copy(_c).applyQuaternion(_q2);
        _t.copy(s.local.eye).sub(_b).addScaledVector(_d, one ? 0.42 : rpg ? 0.02 : 0.05); // pistols are aimed at arm's length
        if (this.weaponId === 'lmg') _t.addScaledVector(_up, -0.028); // look over the feed cover, not into it
        _a.lerp(_t, adsK);
      }
    }
    if (this.throwT > 0) { this.throwT -= dt; _a.addScaledVector(_up, -0.35); }
    if (s.reloading) _a.addScaledVector(_up, -0.08).addScaledVector(_d, -0.08);
    this.gun.parent.updateMatrixWorld(true);
    this.gun.parent.worldToLocal(this.gun.position.copy(_a));
    this.gun.parent.getWorldQuaternion(_qp).invert(); this.gun.quaternion.copy(_qp.multiply(_q2));
    if (s.reloading) this.gun.quaternion.multiply(_q.setFromEuler(_eul.set(0.25, 0, 0.5)));
    this.gun.updateMatrixWorld(true);
    // ---------------- hands onto the grips
    if (this.bones && this.weapon) {
      const W = this.weapon.sockets;
      const gR = W.grip_R, gL = W.grip_L;
      if (this.arm.Right && gR) { gR.getWorldPosition(_t); const pole = _e.copy(_p).addScaledVector(_up, -0.6).addScaledVector(right, 0.35); twoBoneIK(this.arm.Right.u, this.arm.Right.l, this.arm.Right.h, _t.clone(), pole, this.arm.Right.lens); this._handTo(this.arm.Right.h, gR); }
      if (this.arm.Left && (gL || one)) {
        const reloadHand = s.reloading && W.mag_well;
        (reloadHand ? W.mag_well : gL || gR).getWorldPosition(_t);
        this.arm.Left.u.getWorldPosition(_b);
        const pole = _e.copy(_b).addScaledVector(_up, -0.6).addScaledVector(right, -0.3);
        twoBoneIK(this.arm.Left.u, this.arm.Left.l, this.arm.Left.h, _t.clone(), pole, this.arm.Left.lens);
        this._handTo(this.arm.Left.h, gL || gR);
      }
      if (s.weaponId) this.setWeapon(s.weaponId);
    }
    if (this.weapon) {
      if (s.reloading && !this.reloadStart) this.reloadStart = performance.now(); else if (!s.reloading) this.reloadStart = 0;
      const r01 = s.local ? (s.local.reloadLen ? s.local.reloadT / s.local.reloadLen : 0) : this.reloadStart ? Math.min(1, (performance.now() - this.reloadStart) / 2000) : 0;
      this.weapon.update(dt, { trigger: s.fire, reloading: s.reloading, reload01: r01 });
    }
    if (this.vm) {
      if (useVm) this.vm.update(dt, s, !s.local.scoped);
      else { this.vm.setVisible(false); if (s.local && s.local.gunner) s.local.gunner.fp = false; }
    }
  }

  /** Swap every mesh of this character (+ its weapon) to shadow-only material clones (same programs) or back. */
  _setShadowOnly(on) {
    if (this._shadowOnlyOn === on) return;
    this._shadowOnlyOn = on;
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if (!o.userData.mat0) o.userData.mat0 = o.material;
      o.material = on ? (Array.isArray(o.userData.mat0) ? o.userData.mat0.map(shadowOnly) : shadowOnly(o.userData.mat0)) : o.userData.mat0;
    });
  }

  /** Orient a hand so its palm faces along the grip: keep the animated finger shape, align the hand's forward to the gun's forward. */
  _handTo(hand, sock) {
    sock.getWorldQuaternion(_q2);
    // hand bone local axes (Mixamo): +Y along the fingers. Point fingers forward-down along the grip.
    _q.setFromEuler(_eul.set(-Math.PI / 2 + 0.35, 0, 0));
    _q2.multiply(_q);
    hand.parent.getWorldQuaternion(_qp).invert();
    hand.quaternion.slerp(_qp.multiply(_q2), 0.7);
  }

  _driver(dt, s) {
    this.steer += ((s.steer || 0) - this.steer) * Math.min(1, dt * 8);
    const k = Math.max(-1, Math.min(1, this.steer * 2.5));
    if (this.aL) { this.aL.setEffectiveWeight(Math.max(0, k)); this.aR.setEffectiveWeight(Math.max(0, -k)); this.aBase.setEffectiveWeight(1 - Math.abs(k) * 0.8); }
    // hands on the wheel rim (10 and 2 o'clock, rotated by the steering angle)
    const wheel = this.car?.sockets?.steering_wheel;
    if (this.bones && wheel && this.arm.Right && this.arm.Left) {
      this.model.updateMatrixWorld(true);
      wheel.updateWorldMatrix(true, false);
      // slide forward on the seat until the hands can reach the rim (trucks put the wheel at different distances)
      if (this.driverShift === undefined) {
        this.arm.Right.u.getWorldPosition(_b); _t.set(0, 0.12, 0).applyMatrix4(wheel.matrixWorld);
        const reach = _b.distanceTo(_t), sum = this.arm.Right.lens[0] + this.arm.Right.lens[1];
        this.driverShift = clamp(reach - sum * 0.9, 0, 0.45);
        this.model.position.z += this.driverShift; this.model.updateMatrixWorld(true);
      }
      const rot = -this.steer * 2.6;
      for (const [side, base] of [['Left', 0.84], ['Right', 2.3]]) {
        const a = base + rot, R = 0.18;
        _t.set(Math.cos(a) * R, Math.sin(a) * R, 0).applyMatrix4(wheel.matrixWorld);
        const arm = this.arm[side]; arm.u.getWorldPosition(_b);
        const pole = _e.copy(_b).add(_c.set(side === 'Left' ? 0.4 : -0.4, -0.5, 0).applyQuaternion(this.root.getWorldQuaternion(_q)));
        twoBoneIK(arm.u, arm.l, arm.h, _t.clone(), pole, arm.lens);
      }
    }
    if (this.flinchT > 0) { this.flinchT -= dt; }
  }

  die(e = {}) {
    if (this.deadT >= 0) return;
    this.alive = false; this.deadT = 0;
    if (this.vm) { this.vm.setVisible(false); this._setShadowOnly(false); this.useVm = false; }
    if (this.role === 'driver' || !this.car) {
      // slump over the wheel
      if (this.spine[0]) for (const b of this.spine) b.quaternion.premultiply(_q.setFromAxisAngle(_n.set(1, 0, 0), 0.35));
      if (this.mixer) this.mixer.timeScale = 0;
      return;
    }
    // gunners are thrown off the vehicle
    const scene = this._scene(); if (!scene) { this.root.visible = false; return; }
    const carVel = e.vel ? new THREE.Vector3(...e.vel) : (this.lastVel || new THREE.Vector3());
    scene.attach(this.root);
    this.fallVel.copy(carVel).multiplyScalar(0.85).add(_t.set((Math.random() - 0.5) * 4, 3 + Math.random() * 3, (Math.random() - 0.5) * 4));
    this.fallSpin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 6);
    if (this.weapon) this.weapon.root.visible = false;
    const c = this.clips.find((x) => x.name === 'death_fall');
    if (this.mixer && c) { this.mixer.stopAllAction(); const a = this.mixer.clipAction(c); a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; a.play(); }
  }
  _scene() { let o = this.root; while (o.parent) o = o.parent; return o.isScene ? o : null; }

  _dead(dt) {
    this.deadT += dt;
    if (!this.car || this.role === 'driver' || this.root.parent?.isScene !== true) return;
    this.mixer?.update(dt);
    const r = this.root;
    if (!this.landed) {
      this.fallVel.y -= 17.5 * dt;
      r.position.addScaledVector(this.fallVel, dt);
      r.rotation.x += this.fallSpin.x * dt; r.rotation.z += this.fallSpin.z * dt;
      const gy = this.groundY ? this.groundY(r.position.x, r.position.y, r.position.z) : null;
      if (gy !== null && r.position.y < gy) { r.position.y = gy; this.landed = true; r.rotation.x = -Math.PI / 2 * Math.sign(this.fallSpin.x || 1); r.rotation.z = 0; }
      if (this.deadT > 6) this.landed = true;
    }
    if (this.deadT > 9) r.visible = false;
  }

  flinch() { this.flinchT = 0.3; }
  throwGrenade() { this.throwT = 0.7; const c = this.clips.find((x) => x.name === 'throw_grenade'); if (this.mixer && c) { const a = this.mixer.clipAction(c); a.reset(); a.setLoop(THREE.LoopOnce); a.setEffectiveWeight(0.8); a.play(); } }
  headWorld(out) { if (!this.head) return false; this.head.getWorldPosition(out); return true; }
  muzzleWorld(out) { if (this.vm && this.useVm) return this.vm.muzzleWorld(out); return this.weapon ? this.weapon.muzzleWorld(out) : false; }
  dispose() { this.root.removeFromParent(); this.mixer?.stopAllAction(); if (this.vm) this.vm.dispose(); }
}
