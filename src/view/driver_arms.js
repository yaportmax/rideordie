// DriverArms: the local first-person driver's arms in the cockpit (public/models/characters/fp_arms.glb, rust-orange leather
// bomber sleeves). Drawn in world space (the hands must sit exactly on the truck's real steering-wheel rim), parented under the
// hidden hero driver's Spine2, so the shoulders follow the seat slide (driverShift), the lean / brace / impact clips and the
// truck's motion. Hands: analytic two-bone IK onto the rim at the grip angles the hidden body uses (10 and 2 o'clock, turned
// with the wheel), palms wrapped round the rim (hand socket Y along the rim toward 12 o'clock, Z into the wheel), curled wheel-grip
// fingers; hand-over-hand regrips when a hand is carried past its comfortable arc; the right hand reaches the shifter knob on gear
// changes while the wheel is near centre.
//   const a = new DriverArms(crew); a.update(dt, s, steer, gear); a.setVisible(false); a.dispose();  DriverArms.available()
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { FP_ARMS_URL, aimBone, twoBoneIK, registerDriverArmsWarm } from './viewmodel.js';
import { ownClonedSkeletons, disposeOwnedSkeletons } from './owned_skeletons.js';

const R_RIM = 0.19;                                    // rim radius (all tiers)
const HOME = { Left: 0.84, Right: 2.3 };               // grip angles on the rim (socket XY, from +X = truck left toward +Y up)
const ARC = 1.05;                                      // a hand may be carried this far past home before it regrips
const REGRIP = 0.22;                                   // s per regrip (lift, travel, re-grab)
const LEATHER = new THREE.Color(0.34, 0.095, 0.032);   // rust-orange (linear)
// rim frame variants (tuning): [tangent sign, column share, hub share] for the palm -> rod direction
const FRAME = { A: [1, 0.8, 0.45], B: [1, -0.8, -0.45], C: [-1, 0.8, 0.45], D: [-1, -0.8, -0.45], E: [1, 0.3, 0.9], F: [1, -0.3, -0.9] };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _p = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qk = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qi = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _hp = new THREE.Vector3(), _pole = new THREE.Vector3(), _sh = new THREE.Vector3();
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let MAT = null, GEO_SLEEVE = null;
/** Leather-sleeve variant of the fp_arms material: vertices skinned to the arm / forearm bones take a rust-orange leather tint
 *  (the albedo's luminance keeps the seams / folds), gloves stay as authored. World-space material (no viewmodel projection). */
function leatherMaterial(src) {
  if (MAT) return MAT;
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLeather = { value: LEATHER };
    sh.vertexShader = 'attribute float sleeve;\nvarying float vSleeve;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSleeve = sleeve;');
    sh.fragmentShader = 'uniform vec3 uLeather;\nvarying float vSleeve;\nfloat sleeveK = 0.0;\n' + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
  sleeveK = smoothstep(0.35, 0.7, vSleeve);
  { float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, uLeather * (0.45 + 1.7 * lum), sleeveK); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.52, sleeveK);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.0, sleeveK);');
  };
  m.customProgramCacheKey = () => 'rod_driver_arms_1';
  MAT = m;
  return m;
}
/** 'sleeve' vertex attribute (1 = arm / forearm, 0 = hand + fingers) on the shared fp_arms geometry (added once). */
function sleeveAttr(mesh) {
  const g = mesh.geometry;
  if (g.attributes.sleeve) return;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, names = mesh.skeleton.bones.map((b) => b.name);
  const a = new Float32Array(si.count), RE = /^(Left|Right)(Arm|ForeArm|Shoulder)$/;
  for (let i = 0; i < si.count; i++) { let w = 0; for (let k = 0; k < 4; k++) if (RE.test(names[si.getComponent(i, k)])) w += sw.getComponent(i, k); a[i] = w; }
  g.setAttribute('sleeve', new THREE.BufferAttribute(a, 1));
  GEO_SLEEVE = g;
}

/** Wheel-grip finger pose: the rifle pose's support hand wraps a handguard (a cylinder like the rim); the right hand gets the
 *  mirror image of it (identity-rest skeleton, mirrored across the character's YZ plane: q = (x, -y, -z, w)). */
const gripClipCache = new WeakMap();
function wheelGripClip(clips) {
  let c = gripClipCache.get(clips);
  if (c) return c;
  const src = clips.find((x) => x.name === 'pose_rifle') || clips.find((x) => /^pose_/.test(x.name));
  if (!src) return null;
  const tracks = [];
  for (const t of src.tracks) {
    const [bone, prop] = t.name.split('.');
    if (!/^LeftHand(Thumb|Index|Middle|Ring|Pinky)\d$/.test(bone) || prop !== 'quaternion') continue;
    tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times, t.values));
    const v = t.values.slice(); for (let i = 0; i < v.length; i += 4) { v[i + 1] = -v[i + 1]; v[i + 2] = -v[i + 2]; }
    tracks.push(new THREE.QuaternionKeyframeTrack(bone.replace('Left', 'Right') + '.' + prop, t.times, v));
  }
  c = new THREE.AnimationClip('wheel_grip', src.duration, tracks);
  gripClipCache.set(clips, c);
  return c;
}

export class DriverArms {
  static available() { return Assets.has(FP_ARMS_URL); }
  /** Warm-up object for Game.prewarm (the leather program). */
  static warmObject() {
    const m = ownClonedSkeletons(Assets.clone(FP_ARMS_URL)); if (!m) return new THREE.Group();
    m.traverse((o) => { if (o.isSkinnedMesh) { sleeveAttr(o); o.material = leatherMaterial(o.material); o.frustumCulled = false; } });
    return m;
  }

  constructor(crew) {
    this.crew = crew;
    const model = ownClonedSkeletons(Assets.clone(FP_ARMS_URL));
    this.ok = !!(model && crew.bones && crew.bones.Spine2);
    if (!this.ok) { disposeOwnedSkeletons(model); return; }
    this.model = model;
    model.traverse((o) => { if (o.isMesh) o.userData.fpArms = true; if (o.isSkinnedMesh) { sleeveAttr(o); o.material = leatherMaterial(o.material); o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; } });
    const B = this.B = {}; model.traverse((o) => { if (o.isBone || /^socket_/.test(o.name)) B[o.name] = o; });
    // the fp Spine2 sits on the hero's Spine2 (both rigs have identity rest rotations, model axes)
    model.updateMatrixWorld(true);
    B.Spine2.getWorldPosition(_v); model.worldToLocal(_v);
    model.position.copy(_v).negate();
    crew.bones.Spine2.add(model);
    this.side = {};
    // both hands use the LEFT socket (the handguard wrap: rod along socket Z, palm toward +Y); the right one mirrored (x -> -x), so
    // with the mirrored finger pose the two grips are exact mirror images
    const sL = B.socket_hand_L, spL = sL.position.clone(), sqL = sL.quaternion.clone();
    for (const s of ['Left', 'Right']) {
      const u = B[s + 'Arm'], l = B[s + 'ForeArm'], h = B[s + 'Hand'];
      model.updateMatrixWorld(true);
      u.getWorldPosition(_v); l.getWorldPosition(_v2); h.getWorldPosition(_p);
      const sp = s === 'Left' ? spL.clone() : new THREE.Vector3(-spL.x, spL.y, spL.z);
      const sq = s === 'Left' ? sqL.clone() : new THREE.Quaternion(sqL.x, -sqL.y, -sqL.z, sqL.w);
      this.side[s] = { u, l, h, c: B[s + 'Shoulder'], la: _v.distanceTo(_v2), lb: _v2.distanceTo(_p), sp, sqi: sq.invert(), twistAx: h.position.clone().normalize(),
        g: HOME[s], mv: -1, from: 0, to: 0, rot0: 0 };
    }
    this.armBones = []; for (const s of ['Left', 'Right']) for (const n of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) if (B[s + n]) this.armBones.push(B[s + n]);
    this.mixer = new THREE.AnimationMixer(model);
    const clip = wheelGripClip(Assets.getAnimations(FP_ARMS_URL));
    if (clip) { const a = this.mixer.clipAction(clip); a.play(); }
    const open = Assets.getAnimations(FP_ARMS_URL).find((c) => c.name === 'pose_open');
    if (open) { this.aOpen = this.mixer.clipAction(new THREE.AnimationClip('open_R', open.duration, open.tracks.filter((t) => /^RightHand(Thumb|Index|Middle|Ring|Pinky)/.test(t.name)))); this.aOpen.play(); this.aOpen.setEffectiveWeight(0); }
    this.gear = -1; this.shiftT = -1; this.visible = true;
  }

  setVisible(v) { if (this.ok && this.visible !== v) { this.visible = v; this.model.visible = v; } }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.mixer?.stopAllAction();
    if (this.ok) this.model.removeFromParent();
    disposeOwnedSkeletons(this.model);
  }

  /** s: crew state (steer...), steer: the crew's smoothed steer, gear: the truck's gear (shift reach). */
  update(dt, s, steer, gear) {
    if (!this.ok) return;
    this.setVisible(true);
    const wheel = this.crew.car?.sockets?.steering_wheel;
    if (!wheel) return;
    dt = Math.min(dt, 0.05);
    const rot = -steer * 2.6;
    // ---- gear change: right hand to the shifter knob (only with the wheel near centre)
    if (this.gear < 0) this.gear = gear;
    if (gear !== this.gear) { if (Math.abs(rot) < 0.5 && this.shiftT < 0) this.shiftT = 0; this.gear = gear; }
    let shiftW = 0;
    if (this.shiftT >= 0) { this.shiftT += dt; const t = this.shiftT; shiftW = sstep(0, 0.16, t) * (1 - sstep(0.34, 0.52, t)); if (t > 0.52) this.shiftT = -1; }
    if (this.aOpen) this.aOpen.setEffectiveWeight(shiftW > 0 ? Math.sin(Math.PI * clamp(this.shiftT / 0.52, 0, 1)) * 0.5 : 0);
    // ---- regrip bookkeeping (hand-over-hand): only one hand lets go at a time
    const L = this.side.Left, R = this.side.Right;
    for (const [S, other, name] of [[L, R, 'Left'], [R, L, 'Right']]) {
      if (S.mv >= 0) {
        S.mv += dt / REGRIP;
        if (S.mv >= 1) { S.g = S.to - rot; S.mv = -1; }
        continue;
      }
      const wa = S.g + rot, d = wa - HOME[name];
      if (Math.abs(d) > ARC && other.mv < 0 && !(name === 'Right' && shiftW > 0)) {
        S.mv = 0; S.from = wa; S.rot0 = rot;
        S.to = HOME[name] - Math.sign(d) * ARC * 0.55;       // re-grab on the far side of home (the hand crosses over the top)
      }
    }
    // ---- pose
    for (const b of this.armBones) b.quaternion.identity();
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);
    wheel.updateWorldMatrix(true, false);
    wheel.getWorldQuaternion(_qw);
    for (const name of ['Left', 'Right']) {
      const S = this.side[name];
      let a, lift = 0;
      if (S.mv >= 0) { const k = sstep(0, 1, S.mv); a = (S.from + (rot - S.rot0)) * (1 - k) + S.to * k; lift = Math.sin(Math.PI * S.mv); }
      else a = S.g + rot;
      // left-hand frame on the rim (the right hand: computed at the mirrored angle, then mirrored x -> -x):
      // Z = the rod (rim tangent toward 12 o'clock), Y = palm -> rod (from the outer back of the rim toward the dash and the hub)
      const mir = name === 'Right', am = mir ? Math.PI - a : a, ca = Math.cos(am), sa = Math.sin(am);
      _p.set(ca * R_RIM, sa * R_RIM, -lift * 0.07);                 // lift: off the rim toward the driver
      const F = FRAME[(typeof window !== 'undefined' && window.__drvFrame) || 'A'];
      _z.set(-sa, ca, 0).multiplyScalar(F[0]);
      _y.set(-ca * F[2], -sa * F[2], F[1]).addScaledVector(_z, -_z.dot(_y)).normalize();
      _x.crossVectors(_y, _z).normalize();
      _m.makeBasis(_x, _y, _z); _q.setFromRotationMatrix(_m);
      if (mir) { _p.x = -_p.x; _q.set(_q.x, -_q.y, -_q.z, _q.w); }
      _p.applyMatrix4(wheel.matrixWorld); _q.premultiply(_qw);
      if (name === 'Right' && shiftW > 0.001) {       // shifter knob: fist on top, knuckles forward
        const knob = this.crew.car?.sockets?.shifter_knob || this.crew.car?.model?.getObjectByName('shifter_knob');
        if (knob) {
          knob.getWorldPosition(_v); this.crew.car.root.getWorldQuaternion(_q2);
          _v.addScaledVector(_v2.set(0, 1, 0).applyQuaternion(_q2), 0.03);
          _m.makeBasis(_x.set(1, 0, 0), _y.set(0, 0, 1), _z.set(0, -1, 0)); _qk.setFromRotationMatrix(_m).premultiply(_q2);
          _p.lerp(_v, shiftW); _q.slerp(_qk, shiftW);
        }
      }
      this._hand(S, name, _p, _q);
    }
  }

  /** IK: the hand's grip socket onto (P, Q) world. */
  _hand(S, side, P, Q) {
    const hq = _q2.copy(Q).multiply(S.sqi);
    _hp.copy(S.sp).applyQuaternion(hq).negate().add(P);
    // elbows down and out (truck left = +X of the crew frame)
    S.u.getWorldPosition(_sh);
    this.crew.root.getWorldQuaternion(_qc);
    _pole.set(side === 'Left' ? 0.5 : -0.5, -0.7, -0.15).applyQuaternion(_qc).add(_sh);
    // clavicle assist when out of reach
    const reach = S.la + S.lb, dist = _sh.distanceTo(_hp);
    if (dist > reach * 0.97 && S.c) { const need = Math.min(0.08, dist - reach * 0.97); _y.copy(_hp).sub(_sh).normalize().multiplyScalar(need).add(_sh); aimBone(S.c, _sh, _y); }
    twoBoneIK(S.u, S.l, S.h, _hp, _pole, S.la, S.lb);
    // wrist: share the twist with the forearm, then the hand rotation
    S.l.getWorldQuaternion(_q);
    _q.invert().multiply(hq);
    const ax = S.twistAx, dp = _q.x * ax.x + _q.y * ax.y + _q.z * ax.z;
    _qt.set(ax.x * dp, ax.y * dp, ax.z * dp, _q.w).normalize();
    _qt.slerpQuaternions(_qi.identity(), _qt, 0.5);
    S.l.quaternion.multiply(_qt); S.l.updateMatrixWorld(true);
    S.l.getWorldQuaternion(_q);
    S.h.quaternion.copy(_q.invert().multiply(hq)); S.h.updateMatrixWorld(true);
  }
}
void GEO_SLEEVE;
registerDriverArmsWarm(() => DriverArms.warmObject());
