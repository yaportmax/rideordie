// CrewView: a person riding a vehicle. Rigged character (public/models/characters/*.glb, Mixamo bone names, baked clips - see
// public/models/characters/README.md for the clip list) + a procedural layer on top.
//  * Gunners, third person (raiders, the co-op partner, title / garage / death camera): clip-driven. The weapon is parented to
//    socket_hand_R (identity = the clips' contract), idle / aim / crouch loops per weapon class, additive fire kicks + a
//    full-auto loop, reload / throw / taunt / heavy-hit overrides, light hits additive; the spine turns toward the aim and a
//    final Spine2 correction puts the muzzle exactly on the aim line; the support hand is IK'd onto the real weapon's grip_L.
//  * Gunner, local first person: the older procedural path (weapon placed on the aim line, two-bone IK onto the grips); the
//    body is only a shadow caster while the viewmodel (viewmodel.js) draws the arms.
//  * Drivers: seated loops + lean / brace / glance / shout / hit / impact clips, hands IK'd onto the wheel rim (per-hand IK
//    weight fades for the clips that let go of the wheel and for the seated deaths).
//  * Deaths: standing deaths chosen by cause / hit direction / speed; thrown and blown-up bodies leave the vehicle with an
//    upright root that follows the vehicle's momentum and eases down to the ground over the clip's airborne window.
// API: constructor(kind, opts), attach(carView, seat), setWeapon(id), fire(rate, mode, actionLen), update(dt, s), die(e), flinch(e),
//      impact(dv), cheer(), throwGrenade(), headWorld(out), muzzleWorld(out), dispose().
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { WeaponView } from './weapon_view.js';
import { ViewModel, inCinematic } from './viewmodel.js';
import { setCutaway, prepareCutaway } from './fp_cutaway.js';
import { clamp } from '../core/util.js';
import { WEAPONS } from '../data/weapons.js';
import { ENEMY_GUNS } from '../data/enemies.js';

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
const _v1 = V(), _v2 = V();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qI = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _eul = new THREE.Euler(0, 0, 0, 'YXZ');
const FINGER = /Hand(Thumb|Index|Middle|Ring|Pinky)\d|Hand$/;

// ---- clip contract (see public/models/characters/README.md) --------------------------------------------------------------
const CLASS_OF = (id) => (id === 'pistol' || id === 'revolver' ? 'pistol' : id === 'shotgun' ? 'shotgun' : id === 'rpg' ? 'launcher' : 'rifle');
const IDLE_OF = { rifle: 'idle_stand', shotgun: 'idle_stand', pistol: 'idle_pistol', launcher: 'idle_launcher' };
const GRIP_L_OF = { rifle: [0.008, 0.048, 0.325], pistol: [0.015, 0.004, 0.014], shotgun: [0, 0.019, 0.358], launcher: [0, 0.018, 0.215] };
const MAG_OF = { rifle: 30, pistol: 12, shotgun: 6, launcher: 1 };   // cosmetic reloads of AI crews (the sim never reloads them)
// throw_grenade: weapon in the LEFT hand 0.08-1.18 s (clip time), grenade in the right hand 0.18 s .. release 0.55 s.  The sim
// spawns the grenade on the event, so the clip starts at the wind-up and runs faster to release right away.
const THROW = { left0: 0.08, left1: 1.18, prop0: 0.18, rel: 0.55, start: 0.30, scale: 1.6 };
const SHOUT_IK = [0.05, 0.22, 1.55, 2.0];   // sit_shout: left-hand wheel IK fades out / back in (clip time)
const SIT_DEATH_IK = { death_sit_slump: [0.2, 0.6], death_sit_jerk_L: [0.3, 0.5], death_sit_jerk_R: [0.3, 0.5], death_sit_headback: [0.06, 0.3] };
// standing deaths that can leave the vehicle: [airborne start, landing] clip seconds
const LEAVES = { death_thrown_back: [0.10, 0.82], death_thrown_left: [0.10, 0.82], death_thrown_right: [0.10, 0.82], death_blown_up: [0.08, 1.24],
  death_fall: [0.30, 0.74], death_crumple: [0.20, 0.84] };
const OPEN_CABS = new Set(['e_buggy', 'e_technical']);   // sit_shout puts the fist out of the window: only where there is no door glass
const RAIL_CARS = new Set(['e_buggy', 'e_technical']);   // a waist-high bar in front of the gunner (death_slump_rail folds over it)
const WHEEL_HANDS = [['Left', 0.84], ['Right', 2.3]];
// ---- procedural readability layer: everything is exaggerated so it reads at 10-30 m -----------------------------------------
const SWAY_W = 2 * Math.PI * 1.5, SWAY_Z = 0.42;      // upper-body inertia spring (the car's real accelerations)
const WHIP_W = 2 * Math.PI * 2.4, WHIP_Z = 0.30;      // hit whip spring (overshoots: jolt, rebound, settle)
const RAIDER_WHEEL_RATIO = 10;                         // steering-wheel turns per road-wheel angle (raiders; heroes keep 2.6)
const G = 9.81;
const _ax = V(), _ay = V(), _az = V(), _hq = new THREE.Quaternion(), _yq = new THREE.Quaternion();
/** Premultiply `bone` by a rotation of `ang` about `axis` (expressed in the bone parent's frame ~ the body frame). */
function turn(bone, axis, ang) { if (bone && ang) bone.quaternion.premultiply(_hq.setFromAxisAngle(axis, ang)); }
function springStep(x, v, target, w, z, dt) {   // critically-ish damped vector spring, in place
  v.x += (w * w * (target.x - x.x) - 2 * z * w * v.x) * dt; v.y += (w * w * (target.y - x.y) - 2 * z * w * v.y) * dt; v.z += (w * w * (target.z - x.z) - 2 * z * w * v.z) * dt;
  x.addScaledVector(v, dt);
}
const smooth01 = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const rnd = (a, b) => a + Math.random() * (b - a);

const clipIndex = new WeakMap();      // clips array -> Map(name -> clip)
const additiveCache = new Map();      // source clip -> additive clone (shared by every crew using that GLB)
function additiveOf(clip, ref) {
  let c = additiveCache.get(clip);
  if (!c) { c = THREE.AnimationUtils.makeClipAdditive(clip.clone(), 0, ref ? ref : undefined); additiveCache.set(clip, c); }
  return c;
}
// procedural hand grenade prop (no GLB needed: 5-30 m away it is a dark olive egg in the fist)
let nadeGeo = null, nadeMat = null;

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

/** Analytic two-bone IK: upper (shoulder joint), lower (elbow), end (wrist) -> target, elbow bends toward `pole` (world).
 *  `target` is read before any temp is overwritten, so module temps may be passed. */
const _ia = V(), _ib = V(), _ic = V(), _it = V(), _ie = V(), _iu = V(), _ip = V(), _iw = V();
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
    this.ai = opts.weapon === 'enemy';
    this.enemyRate = this.ai ? ENEMY_GUNS[opts.enemyGun]?.rate ?? null : null;
    this.root = new THREE.Group(); this.root.name = 'crew_' + kind;
    this.body = new THREE.Group(); this.root.add(this.body);             // yawed toward the aim
    const url = `/models/characters/${kind}.glb`;
    const model = Assets.clone(url);
    this.rigged = !!model;
    this.clips = Assets.getAnimations(url).length ? Assets.getAnimations(url) : Assets.getAnimations('/models/characters/hero_gunner.glb');
    this.acts = new Map();
    this.ov = null;                                                        // current full-body one-shot override
    this.aimK = 0; this.autoK = 0; this.braceK = 0; this.shaken = 0; this.sinceShot = 99; this.shots = 0; this.fireRate = 8;
    this.mountAt = null; this.cls = null; this.wasReloading = false; this.lastHitDir = null; this.lastSpeed = 0; this.hitRT = 0; this.lastHeavy = -9;
    this.actT = rnd(3, 9); this.tauntT = rnd(2, 6); this.tauntDelay = -1; this.wasFire = false;
    this.ikW = { Left: 1, Right: 1 };
    // procedural layer state
    this.pVel = null; this.acc = V();                                     // car-frame acceleration (smoothed)
    this.sway = V(); this.swayV = V(); this._swT = V();                   // x = roll about car fwd, z = pitch about car left (rad)
    this.whip = V(); this.whipV = V();                                    // body frame: x = pitch (+ forward), y = twist (+ left), z = roll
    this.lookW = 0; this.lookYaw = 0; this.lookPitch = 0; this.lookT = rnd(0.5, 2); this.looking = false;
    this.sawT = rnd(0, 20); this.fly = null; this.slide = null;
    this.gun = new THREE.Group(); this.gun.name = 'gunframe';
    if (model) this._setupRig(model); else this._placeholder();
    this.weapon = null; this.weaponId = null;
    if (this.role !== 'driver') this.setWeapon(opts.weapon === 'enemy' ? ENEMY_GUN_MODEL[opts.enemyGun] || 'rifle' : opts.weapon || 'pistol');
    this.aimYawL = 0; this.bodyYaw = 0; this.pitch = 0; this.crouch = 0; this.kick = 0; this.flinchT = 0; this.throwT = 0; this.steer = 0;
    this.deadT = -1; this.fallVel = V(); this.fallSpin = V(); this.detached = false; this.leave = null; this.y0 = 0; this.yGround = null;
    this.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = !o.isSkinnedMesh; } });
  }

  _setupRig(model) {
    this.model = model; this.body.add(model);
    this.bones = {};
    model.traverse((o) => { if (o.isBone || o.type === 'Bone' || /^(socket_|armor_t)/.test(o.name)) this.bones[o.name] = o; });
    // armour tiers on the hero gunner
    for (const t of [1, 2, 3]) { const a = model.getObjectByName('armor_t' + t); if (a) a.visible = this.opts.armorTier === t; }
    this.mixer = new THREE.AnimationMixer(model);
    let idx = clipIndex.get(this.clips);
    if (!idx) { idx = new Map(this.clips.map((c) => [c.name, c])); clipIndex.set(this.clips, idx); }
    this.clipIdx = idx;
    const act = (n, w = 0) => { const a = this._act(n); if (!a) return null; a.enabled = true; a.setEffectiveWeight(w); a.play(); return a; };
    if (this.role === 'driver') {
      this.aBase = act('idle_sit_drive', 1); this.aL = act('sit_lean_L', 0); this.aR = act('sit_lean_R', 0); this.aBrace = act('sit_brace', 0);
    } else {
      this.aCrouch = act('crouch_idle', 0);
      // finger/hand shape only from the weapon pose (first-person path)
      const pose = this._clip('pose_rifle');
      if (pose) {
        const hands = new THREE.AnimationClip('hands_rifle', pose.duration, pose.tracks.filter((t) => FINGER.test(t.name.split('.')[0])));
        this.aHands = this.mixer.clipAction(hands); this.aHands.setEffectiveWeight(1); this.aHands.play();
      }
      // sustained full-auto: additive against aim_rifle frame 0 (weight follows the trigger)
      const auto = this._clip('fire_rifle_auto'), aimR = this._clip('aim_rifle');
      if (auto && aimR) { this.aAuto = this.mixer.clipAction(additiveOf(auto, aimR)); this.aAuto.setEffectiveWeight(0); this.aAuto.play(); }
      this._setClass('rifle');
    }
    // random phase so a group of raiders doesn't breathe in sync
    this.mixer.update(Math.random() * 4);
    const B = this.bones;
    this.arm = {};
    for (const side of ['Right', 'Left']) {
      const u = B[side + 'Arm'], l = B[side + 'ForeArm'], h = B[side + 'Hand'];
      if (u && l && h) { u.getWorldPosition(_a); l.getWorldPosition(_b); h.getWorldPosition(_c); this.arm[side] = { u, l, h, lens: [_a.distanceTo(_b), _b.distanceTo(_c)], qu: new THREE.Quaternion(), ql: new THREE.Quaternion() }; }
    }
    this.spine = ['Spine', 'Spine1', 'Spine2'].map((n) => B[n]).filter(Boolean);
    this.head = B.Head || B.socket_head || model;
    // seated: the seat socket is the hip point, so drop the model so its Hips land there
    if (this.role === 'driver') { this.mixer.update(0); model.updateMatrixWorld(true); const hips = B.Hips; if (hips) { hips.getWorldPosition(_a); this.body.worldToLocal(_a); model.position.y -= _a.y; model.position.z -= _a.z * 0.5; } }
  }

  _clip(n) { return this.clipIdx ? this.clipIdx.get(n) || null : null; }
  /** Cached action for clip `n` (additive=true -> additive against its own frame 0). */
  _act(n, additive = false) {
    const key = additive ? n + '+' : n;
    let a = this.acts.get(key);
    if (a === undefined) {
      const c = this._clip(n);
      a = c && this.mixer ? this.mixer.clipAction(additive ? additiveOf(c) : c) : null;
      this.acts.set(key, a);
    }
    return a;
  }

  _setClass(cls) {
    if (cls === this.cls || !this.mixer) return;
    this.cls = cls;
    const base = this._act(IDLE_OF[cls]) || this._act('idle_stand'), aim = this._act('aim_' + cls);
    for (const a of [this.aBase, this.aAim]) if (a && a !== base && a !== aim) a.stop();
    this.aBase = base; this.aAim = aim;
    for (const a of [base, aim]) if (a && !a.isRunning()) { a.enabled = true; a.setEffectiveWeight(0); a.play(); }
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
    this._shadowOnlyOn = undefined;   // re-apply to the new weapon's meshes
    if (!this.gun.parent) this.body.add(this.gun);
    const st = this.weapon.sockets.stock; this.stockZ = st ? st.position.z : null;
    // grip_L in the weapon root's frame (for the left-hand mount during throws + the support-hand touch-up)
    this.gripL = new THREE.Vector3(); const gL = this.weapon.sockets.grip_L;
    if (gL) { this.weapon.root.updateMatrixWorld(true); gL.getWorldPosition(this.gripL); this.weapon.root.worldToLocal(this.gripL); }
    const cls = CLASS_OF(id), g = GRIP_L_OF[cls];
    this.gripDelta = new THREE.Vector3(this.gripL.x - g[0], this.gripL.y - g[1], this.gripL.z - g[2]);
    if (!gL || this.gripDelta.lengthSq() < 0.02 * 0.02) this.gripDelta = null;
    this._setClass(cls);
    this.mountAt = null; this._mount(this.bones && this.lastMode === 'clip' ? 'R' : 'gun');
  }

  /** Parent the weapon: 'gun' (procedural first-person frame), 'R' / 'L' (hand sockets; L at -grip_L so that hand holds the handguard). */
  _mount(where) {
    if (!this.weapon || this.mountAt === where) return;
    const r = this.weapon.root;
    if (where === 'gun' || !this.bones) { this.gun.add(r); r.position.set(0, 0, 0); r.quaternion.identity(); this.mountAt = 'gun'; return; }
    const s = this.bones['socket_hand_' + where]; if (!s) { this._mount('gun'); return; }
    s.add(r); r.quaternion.identity();
    if (where === 'L') r.position.copy(this.gripL).negate(); else r.position.set(0, 0, 0);
    this.mountAt = where;
  }

  fire(rate, mode, actionLen) {
    if (!this.weapon) return;
    this.weapon.fire(rate); if (mode === 'pump' || mode === 'bolt') this.weapon.action(actionLen || 0.6); this.kick = 1;
    this.fireRate = this.enemyRate ?? rate; this.sinceShot = 0; this.shots++;
    // clip layer (third person): single kicks for slow weapons, the auto loop takes over for fast rifle-class fire
    if (this.lastMode === 'clip' && this.alive && !(this.cls === 'rifle' && this.fireRate >= 5)) {
      const a = this._act('fire_' + this.cls, true);
      if (a) { a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.setEffectiveWeight(1); a.play(); }
    }
    if (this.ov && (this.ov.kind === 'taunt' || (this.ai && this.ov.kind === 'reload'))) this._endOv(0.1);
  }
  attach(carView, seat) { this.car = carView; this.seat = seat; this.root.position.set(seat[0], seat[1], seat[2]); this.root.rotation.order = 'YXZ'; }

  // ---- full-body one-shot overrides --------------------------------------------------------------------------------------
  _play(name, kind, { fin = 0.12, fout = 0.18, scale = 1, start = 0 } = {}) {
    const a = this._act(name); if (!a) return null;
    if (this.ov && this.ov.a !== a) this.ov.a.stop();
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.timeScale = scale; a.time = start; a.setEffectiveWeight(0); a.play();
    const len = (a.getClip().duration - start) / scale;
    this.ov = { a, name, kind, el: 0, len, fin: Math.min(fin, len * 0.3), fout: Math.min(fout, len * 0.4) };
    return this.ov;
  }
  _endOv(fout) { const o = this.ov; if (o) { o.len = Math.min(o.len, o.el + fout); o.fout = Math.max(1e-3, o.len - o.el); } }
  _ovWeight(dt) {
    const o = this.ov; if (!o) return 0;
    o.el += dt;
    if (o.el >= o.len) { o.a.stop(); this.ov = null; return 0; }
    const w = Math.min(1, o.el / o.fin) * Math.min(1, (o.len - o.el) / o.fout);
    o.a.setEffectiveWeight(w);
    return w;
  }

  update(dt, s) {
    if (this.deadT >= 0) { this._dead(dt, s); return; }
    if (!s.alive) { this.die({}); return; }
    this.lastSpeed = s.speed || 0;
    // scripted cameras (intro fly-by, finale orbit, death cam) see our crew from outside: never first person there
    const fp = !!(s.local && s.local.firstPerson) && !(s.local && inCinematic());
    // local first-person gunner: the viewmodel draws arms + gun; this body stays in the scene as an invisible shadow caster
    const useVm = fp && this.role !== 'driver' && this.hero && !!(s.local.camera && s.local.gunner);
    if (useVm && !this.vm) { this.vm = new ViewModel(); s.local.gunner.vm = this.vm; }
    this.useVm = useVm;
    this._setShadowOnly(useVm);
    if (this.role !== 'driver' && s.local) {   // clear sight lines: cut truck parts in the gunner's eye line (split on the first frame)
      if (!this._cutPrepared) { this._cutPrepared = true; prepareCutaway(this.car); }
      setCutaway(this.car, useVm);
    }
    this.body.visible = useVm || !(fp && s.local.scoped);
    // first person: collapse our own head (face, hair, eyes are skinned to it) so it never blocks the camera
    if (this.bones && this.bones.Head) { const k = fp && !useVm ? 1e-4 : 1; this.bones.Head.scale.setScalar(k); if (this.bones.Neck && this.role === 'driver') this.bones.Neck.scale.setScalar(fp ? 0.2 : 1); }
    if (this.seat && this.role !== 'driver') this.root.position.set(this.seat[0] + (s.local ? s.local.bedX : s.bedX || 0), this.seat[1], this.seat[2] + (s.local ? s.local.bedZ : s.bedZ || 0));
    if (this.role === 'driver') { this._driver(dt, s, fp); return; }
    // ---------------- gunner: aim is world space; convert to the vehicle frame
    const clipMode = !fp && !!this.bones;
    this.lastMode = clipMode ? 'clip' : 'fp';
    if (s.weaponId) this.setWeapon(s.weaponId);
    this._mount(clipMode ? this._handMount() : 'gun');
    _eul.setFromQuaternion(s.quat, 'YXZ');
    let yawL = s.aimYaw - _eul.y; yawL = Math.atan2(Math.sin(yawL), Math.cos(yawL));
    this.crouch += ((s.crouch ? 1 : 0) - this.crouch) * Math.min(1, dt * 10);
    this.sinceShot += dt;
    const wo = this._gunnerLayers(dt, s, clipMode);
    this._tick(dt, s.far);
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
      if (clipMode) { this.flinchT = 0; this._react(dt, s, 1); }   // clip hits + procedural whip / inertia sway (see flinch())
      else if (this.flinchT > 0) { this.flinchT -= dt; const k = Math.sin(Math.min(1, this.flinchT / 0.3) * Math.PI) * 0.35; if (this.spine[0]) this.spine[0].quaternion.premultiply(_q.setFromAxisAngle(_n.set(1, 0, 0), -k)); }
      this.model.updateMatrixWorld(true);
    }
    const cp = Math.cos(s.aimPitch);
    _d.set(Math.sin(s.aimYaw) * cp, Math.sin(s.aimPitch), Math.cos(s.aimYaw) * cp); // world aim dir
    if (clipMode) { if (!s.far) this._clipWeapon(s, wo); else if (this.nade) this.nade.visible = false; }
    else this._fpWeapon(dt, s, fp, useVm);
    if (this.weapon) {
      const ovReload = !!(this.ov && this.ov.kind === 'reload');
      if (s.reloading && !this.reloadStart) this.reloadStart = performance.now(); else if (!s.reloading) this.reloadStart = 0;
      const r01 = s.local ? (s.local.reloadLen ? s.local.reloadT / s.local.reloadLen : 0) : this.reloadStart ? Math.min(1, (performance.now() - this.reloadStart) / 2000) : ovReload ? clamp(this.ov.el / this.ov.len, 0, 1) : 0;
      this.weapon.update(dt, { trigger: s.fire, reloading: s.reloading || ovReload, reload01: r01 });
    }
    if (this.vm) {
      if (useVm) this.vm.update(dt, s, !s.local.scoped);
      else { this.vm.setVisible(false); if (s.local && s.local.gunner) s.local.gunner.fp = false; }
    }
  }

  /** Mixer update; far crews (> 40 m, s.far from world_view) tick at half rate (the pose holds a frame). */
  _tick(dt, far) {
    if (!this.mixer) return;
    this.mixAcc = (this.mixAcc || 0) + dt;
    if (far && !this.mixSkip) { this.mixSkip = true; return; }
    this.mixSkip = false;
    this.mixer.update(this.mixAcc); this.mixAcc = 0;
  }

  /** Where the weapon belongs this frame in the clip path (throws move it to the left hand). */
  _handMount() {
    const o = this.ov;
    if (o && o.kind === 'throw') { const t = o.a.time; return t >= THROW.left0 && t <= THROW.left1 ? 'L' : 'R'; }
    return 'R';
  }

  /** Mixer weights for the gunner (before mixer.update).  Returns the override weight. */
  _gunnerLayers(dt, s, clipMode) {
    if (!this.mixer) return 0;
    if (!clipMode) {
      // first person: the old setup (base idle + crouch + finger pose); the procedural IK owns the arms
      if (this.ov) { this.ov.a.stop(); this.ov = null; }
      if (this.nade) this.nade.visible = false;
      if (this.aBase) this.aBase.setEffectiveWeight(1 - this.crouch);
      if (this.aCrouch) this.aCrouch.setEffectiveWeight(this.crouch);
      if (this.aAim) this.aAim.setEffectiveWeight(0);
      if (this.aAuto) this.aAuto.setEffectiveWeight(0);
      if (this.aHands) this.aHands.setEffectiveWeight(1);
      this.wasReloading = !!s.reloading;
      return 0;
    }
    // events -> overrides
    if (s.reloading && !this.wasReloading) {
      const w = WEAPONS[this.weaponId], a = this._act('reload_' + this.cls);
      const len = (s.local && s.local.reloadLen) || (w && !w.reloadPerShell ? w.reload : 0);
      if (a) this._play('reload_' + this.cls, 'reload', { scale: len > 0.3 ? a.getClip().duration / len : 1, fin: 0.15, fout: 0.2 });
    }
    if (!s.reloading && this.wasReloading && this.ov && this.ov.kind === 'reload' && !this.ai) this._endOv(0.15);
    this.wasReloading = !!s.reloading;
    if (this.ai && !this.ov) {
      // expressive raiders: point / yell at you after a burst and every few seconds while you are close
      if (this.wasFire && !s.fire && Math.random() < 0.45) this.tauntDelay = rnd(0.2, 0.45);
      if (this.shots >= MAG_OF[this.cls] && !s.fire && this.sinceShot > 0.25) { this.shots = 0; this._play('reload_' + this.cls, 'reload', { fin: 0.15, fout: 0.2 }); }
      else if (this.tauntDelay >= 0 && (this.tauntDelay -= dt) < 0) { if (!s.fire && !s.ads) this._gesture(); }
      else if ((this.tauntT -= dt) <= 0) {
        this.tauntT = rnd(3, 6.5);
        if (!s.fire && !s.ads && s.player && this.root.getWorldPosition(_v1).distanceToSquared(s.player) < 38 * 38) this._gesture();
      }
    }
    this.wasFire = !!s.fire;
    if (this.ov && s.fire && this.ov.kind === 'taunt') this._endOv(0.1);
    const wo = this._ovWeight(dt);
    const rest = 1 - wo;
    const aimT = (s.ads || s.fire || this.sinceShot < 0.8) ? 1 : 0;
    this.aimK += (aimT - this.aimK) * Math.min(1, dt * (aimT ? 9 : 3));
    const autoT = s.fire && this.cls === 'rifle' && this.fireRate >= 5 && this.sinceShot < 0.3 ? 1 : 0;
    this.autoK += (autoT - this.autoK) * Math.min(1, dt * 14);
    const cr = this.crouch;
    if (this.aBase) this.aBase.setEffectiveWeight(rest * (1 - this.aimK) * (1 - cr));
    if (this.aAim) this.aAim.setEffectiveWeight(rest * this.aimK * (1 - cr));
    if (this.aCrouch) this.aCrouch.setEffectiveWeight(rest * cr);
    if (this.aAuto) { this.aAuto.setEffectiveWeight(this.autoK * rest * (1 - cr)); this.aAuto.timeScale = clamp(this.fireRate / 10, 0.5, 1.6); }
    if (this.aHands) this.aHands.setEffectiveWeight(0);
    return wo;
  }

  _gesture() { this._play(Math.random() < 0.6 ? 'shout' : 'taunt', 'taunt', { fin: 0.12, fout: 0.2, scale: rnd(1.05, 1.25) }); }

  /** Third-person gunner: muzzle onto the aim line (Spine2 correction), support hand onto the real weapon grip, grenade prop. */
  _clipWeapon(s, wo) {
    const B = this.bones, W = this.weapon;
    const o = this.ov, throwing = !!(o && o.kind === 'throw');
    if (this.nade) this.nade.visible = throwing && o.a.time >= THROW.prop0 && o.a.time < THROW.rel;
    if (!W) return;
    const aimW = this.aimK * (1 - wo) * (1 - this.crouch);
    const chest = B.Spine2;
    if (aimW > 0.02 && chest && this.mountAt === 'R') {
      _a.setFromMatrixColumn(W.root.matrixWorld, 2).normalize();
      const ang = _a.angleTo(_d);
      if (ang > 1e-3) {
        _q.setFromUnitVectors(_a, _d);
        _q3.copy(_qI.identity()).slerp(_q, aimW * Math.min(1, 0.7 / ang));
        chest.getWorldQuaternion(_q2); _q2.premultiply(_q3);
        chest.parent.getWorldQuaternion(_qp).invert(); chest.quaternion.copy(_qp.multiply(_q2));
        chest.updateMatrixWorld(true);
      }
    }
    // support hand: shift it along the weapon by (real grip_L - the class grip_L the clips were authored for)
    const lw = this.gripDelta && this.mountAt === 'R' && this.arm.Left ? (1 - wo) : 0;
    if (lw > 0.02) {
      const L = this.arm.Left;
      L.qu.copy(L.u.quaternion); L.ql.copy(L.l.quaternion);
      W.root.getWorldQuaternion(_q2);
      L.h.getWorldPosition(_t); _t.add(_v1.copy(this.gripDelta).applyQuaternion(_q2));
      L.l.getWorldPosition(_e); L.u.getWorldPosition(_v2); _e.sub(_v2).multiplyScalar(2).add(_v2);   // pole: keep the clip's elbow
      twoBoneIK(L.u, L.l, L.h, _t, _e, L.lens);
      if (lw < 0.999) { L.u.quaternion.slerpQuaternions(L.qu, L.u.quaternion, lw); L.l.quaternion.slerpQuaternions(L.ql, L.l.quaternion, lw); L.u.updateMatrixWorld(true); }
    }
  }

  /** First-person (local) gunner: the procedural gun frame on the aim line + two-bone IK onto its grips (unchanged behaviour). */
  _fpWeapon(dt, s, fp, useVm) {
    // ---------------- weapon on the aim line
    this.kick = Math.max(0, this.kick - dt * 10);
    const sh = this.arm && this.arm.Right ? this.arm.Right.u : this.head;
    sh.getWorldPosition(_p);
    const one = ONE_HANDED.has(this.weaponId), rpg = this.weaponId === 'rpg';
    // gun frame in world: looking along the aim, rolled level
    _m.lookAt(_c.set(0, 0, 0), _n.copy(_d).negate(), _up); _q2.setFromRotationMatrix(_m);
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
      if (this.arm.Right && gR) { gR.getWorldPosition(_t); const pole = _e.copy(_p).addScaledVector(_up, -0.6).addScaledVector(right, 0.35); twoBoneIK(this.arm.Right.u, this.arm.Right.l, this.arm.Right.h, _t, pole, this.arm.Right.lens); this._handTo(this.arm.Right.h, gR); }
      if (this.arm.Left && (gL || one)) {
        const reloadHand = s.reloading && W.mag_well;
        (reloadHand ? W.mag_well : gL || gR).getWorldPosition(_t);
        this.arm.Left.u.getWorldPosition(_b);
        const pole = _e.copy(_b).addScaledVector(_up, -0.6).addScaledVector(right, -0.3);
        twoBoneIK(this.arm.Left.u, this.arm.Left.l, this.arm.Left.h, _t, pole, this.arm.Left.lens);
        this._handTo(this.arm.Left.h, gL || gR);
      }
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

  // ---- procedural readability layer ----------------------------------------------------------------------------------------
  /** Upper-body inertia against the car's real accelerations (sway into / out of turns, lurch on braking and bumps, head kept
   *  level) + the hit whip (spring impulse: jolt, overshoot, settle).  Runs after the mixer, before the weapon / IK passes. */
  _react(dt, s, k) {
    const sp = this.spine; if (!sp.length || dt <= 0) return;
    if (s.vel && s.quat) {
      if (!this.pVel) this.pVel = new THREE.Vector3().copy(s.vel);
      _v1.copy(s.vel).sub(this.pVel).multiplyScalar(1 / Math.max(dt, 1e-3)); this.pVel.copy(s.vel);
      if (_v1.lengthSq() > 3600) _v1.setLength(60);                   // snapshot jumps / teleports
      _v1.applyQuaternion(_q.copy(s.quat).invert());                   // car frame: +X left, +Y up, +Z forward
      this.acc.lerp(_v1, 1 - Math.exp(-dt * 7));
    }
    const kk = (this.role === 'driver' ? 0.022 : 0.038) * k;
    this._swT.set(clamp(this.acc.x * kk, -0.45, 0.45), 0, clamp(-this.acc.z * kk * 0.8 + this.acc.y * 0.006, -0.35, 0.35));
    springStep(this.sway, this.swayV, this._swT, SWAY_W, SWAY_Z, dt);
    _v2.set(0, 0, 0); springStep(this.whip, this.whipV, _v2, WHIP_W, WHIP_Z, dt);
    // the car's roll / pitch axes seen from the body frame (the body is yawed inside the car-aligned root)
    const cy = Math.cos(this.bodyYaw), sy = Math.sin(this.bodyYaw);
    _az.set(-sy, 0, cy); _ax.set(cy, 0, sy); _ay.set(0, 1, 0);
    const roll = this.sway.x, pitch = this.sway.z, W = this.whip;
    for (let i = 0; i < sp.length; i++) {
      const b = sp[i], ws = i === 0 ? 0.4 : 0.3, wh = i === 0 ? 0.25 : i === 1 ? 0.35 : 0.4;
      turn(b, _az, roll * ws); turn(b, _ax, pitch * ws);
      _v1.set(1, 0, 0); turn(b, _v1, W.x * wh); _v1.set(0, 0, 1); turn(b, _v1, W.z * wh); turn(b, _ay, W.y * wh * 0.75);
    }
    const B = this.bones;
    turn(B.Neck, _az, -roll * 0.45); turn(B.Neck, _ax, -pitch * 0.45);   // head stays level (bracing)
    _v1.set(1, 0, 0); turn(B.Head, _v1, W.x * 0.55);                     // whiplash: the head lags the torso
    if (B.Hips && this.role !== 'driver') turn(B.Hips, _ay, W.y * 0.25); // the whole body is spun a little
  }

  /** Raider drivers: head (+ chest) toward the player's truck - locked on before an attack (intent ram / block), repeated
   *  looks when close, over the shoulder when you are behind. */
  _look(dt, s) {
    const P = s.player, H = this.bones.Head, N = this.bones.Neck;
    if (!P || !H || !N) return;
    H.getWorldPosition(_v1); _v2.copy(P).sub(_v1); const d = _v2.length();
    this.root.getWorldQuaternion(_q).invert(); _v2.applyQuaternion(_q);
    const yaw = Math.atan2(_v2.x, _v2.z), pitch = Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));
    let want = 0;
    if ((s.intent === 'ram' || s.intent === 'block') && d < 50) want = 1;
    else if (d < 34) {
      if ((this.lookT -= dt) <= 0) { this.looking = !this.looking; const behind = Math.abs(yaw) > 1.9; this.lookT = this.looking ? rnd(0.8, 1.6) : rnd(behind ? 1.0 : 1.4, behind ? 2.2 : 3.4); }
      want = this.looking ? 1 : 0;
    }
    this.lookW += (want - this.lookW) * Math.min(1, dt * 7);
    this.lookYaw += (clamp(yaw, -1.55, 1.55) - this.lookYaw) * Math.min(1, dt * 9);
    this.lookPitch += (clamp(pitch, -0.3, 0.35) - this.lookPitch) * Math.min(1, dt * 9);
    const w = this.lookW; if (w < 0.01) return;
    const yw = this.lookYaw * w;
    _ay.set(0, 1, 0); _v1.set(1, 0, 0);
    turn(this.spine[2], _ay, yw * 0.22); turn(N, _ay, yw * 0.33); turn(H, _ay, yw * 0.45);
    turn(H, _v1, -this.lookPitch * w * 0.7);
  }

  /** Steering-wheel angle (rad, + = left).  Heroes: the lead's 2.6 ratio on the road-wheel angle.  Raiders: a real-car-like
   *  ratio (the road-wheel angle is only a few degrees at speed) + constant little sawing corrections. */
  _wheelAngle(dt, s) {
    if (this.hero) return this.steer * 2.6;
    this.sawT += dt;
    const sp = clamp((s && s.speed || 0) / 15, 0, 1);
    const saw = (Math.sin(this.sawT * 6.3) * 0.6 + Math.sin(this.sawT * 2.9 + 1.3) * 0.4) * 0.12 * sp;
    return clamp(this.steer * RAIDER_WHEEL_RATIO, -1.7, 1.7) + saw;
  }

  // ---- driver ---------------------------------------------------------------------------------------------------------------
  _driver(dt, s, fp) {
    this.steer += ((s.steer || 0) - this.steer) * Math.min(1, dt * 8);
    const wheelA = this._wheelAngle(dt, s);
    // body lean with the wheel (raiders: from the exaggerated wheel angle so it reads)
    const k = this.hero ? Math.max(-1, Math.min(1, this.steer * 2.5)) : clamp(wheelA / 1.1, -1, 1);
    // occasional life: glances (heroes; raiders track you with _look), raider taunts out of an open cab
    if (this.mixer && !this.ov && this.braceK < 0.2 && !fp && (this.actT -= dt) <= 0) {
      this.actT = rnd(this.hero ? 8 : 4, this.hero ? 16 : 9);
      if (!this.hero && OPEN_CABS.has(this.car?.spec?.id) && s.player && Math.random() < 0.55) this._play('sit_shout', 'shout', { fin: 0.12, fout: 0.2 });
      else if (!s.player) this._play(Math.random() < 0.5 ? 'sit_glance_L' : 'sit_glance_R', 'glance', { fin: 0.12, fout: 0.2 });
    }
    this.shaken = Math.max(0, this.shaken - dt);
    const braceT = s.airborne || this.shaken > 0 ? 1 : 0;
    this.braceK += (braceT - this.braceK) * Math.min(1, dt * (braceT ? 8 : 3));
    if (this.ov && this.braceK > 0.5) this._endOv(0.12);
    const wo = this._ovWeight(dt);
    const rest = (1 - wo) * (1 - this.braceK);
    if (this.aL) { this.aL.setEffectiveWeight(rest * Math.max(0, k)); this.aR.setEffectiveWeight(rest * Math.max(0, -k)); this.aBase.setEffectiveWeight(rest * (1 - Math.abs(k) * 0.8)); }
    if (this.aBrace) this.aBrace.setEffectiveWeight(this.braceK * (1 - wo));
    this._tick(dt, s.far);
    if (!fp && !s.far && this.bones) { this._react(dt, s, 1); if (s.player && !(this.ov && this.ov.kind === 'shout')) this._look(dt, s); }
    // per-hand wheel-IK weight: the shout lets go with the left hand, a hit knocks the right hand off
    let wL = 1, wR = 1;
    if (this.ov && this.ov.kind === 'shout') { const t = this.ov.a.time; wL = 1 - smooth01(SHOUT_IK[0], SHOUT_IK[1], t) * (1 - smooth01(SHOUT_IK[2], SHOUT_IK[3], t)); }
    if (this.hitRT > 0) { this.hitRT -= dt; const t = 0.25 - this.hitRT; wR = 1 - smooth01(0.0, 0.05, t) * (1 - smooth01(0.12, 0.25, t)); }
    if (!s.far || this.driverShift === undefined) this._wheelIK(wL, wR, -wheelA);
    else if (this.wheelMesh) this.wheelMesh.rotation.z = -wheelA;
    if (this.flinchT > 0) { this.flinchT -= dt; }
  }

  /** Hands on the wheel rim (10 and 2 o'clock, rotated by the steering angle), blended with the animated arms by wL / wR. */
  _wheelIK(wL, wR, rot = -this.steer * 2.6) {
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
      // the wheel itself turns with the hands (trucks whose wheel is a separate node under the socket)
      if (this.wheelMesh === undefined) this.wheelMesh = wheel.getObjectByName('steering_wheel_mesh') || null;
      if (this.wheelMesh) this.wheelMesh.rotation.z = rot;
      for (const [side, base] of WHEEL_HANDS) {
        const w = side === 'Left' ? wL : wR;
        if (w <= 0.001) continue;
        const a = base + rot, R = 0.18;
        _t.set(Math.cos(a) * R, Math.sin(a) * R, 0).applyMatrix4(wheel.matrixWorld);
        const arm = this.arm[side]; arm.u.getWorldPosition(_b);
        arm.qu.copy(arm.u.quaternion); arm.ql.copy(arm.l.quaternion);
        const pole = _e.copy(_b).add(_c.set(side === 'Left' ? 0.4 : -0.4, -0.5, 0).applyQuaternion(this.root.getWorldQuaternion(_q)));
        twoBoneIK(arm.u, arm.l, arm.h, _t, pole, arm.lens);
        if (w < 0.999) { arm.u.quaternion.slerpQuaternions(arm.qu, arm.u.quaternion, w); arm.l.quaternion.slerpQuaternions(arm.ql, arm.l.quaternion, w); arm.u.updateMatrixWorld(true); }
      }
    }
  }

  // ---- reactions --------------------------------------------------------------------------------------------------------------
  /** Hit reaction: every hit is a visible jolt (procedural whip: bend away from the shot, spin for side hits, head snap) on top
   *  of the clip (additive light hit, exaggerated; the heavy stagger on bigger / head hits and at random). */
  flinch(e = {}) {
    this.flinchT = 0.3;
    if (!this.alive || !this.mixer || !this.bones) return;
    let dir = null;
    if (e.point) {
      this.body.worldToLocal(_v1.set(e.point[0], e.point[1], e.point[2]));
      const x = _v1.x, z = _v1.z - 0.04;
      dir = Math.abs(z) >= Math.abs(x) * 0.8 ? (z > 0 ? 'front' : 'back') : (x > 0 ? 'left' : 'right');
    }
    this.lastHitDir = dir;
    const d = dir || (Math.random() < 0.6 ? 'front' : Math.random() < 0.5 ? 'left' : 'right');
    const sc = clamp(0.9 + (e.dmg || 8) / 28, 0.9, 1.7) * (e.head ? 1.3 : 1) * (this.role === 'driver' ? 0.75 : 1);
    const side = Math.random() < 0.5 ? -1 : 1;
    // whip impulse (rad/s): body frame, x = pitch (+ forward), y = twist (+ left), z = roll (+ toward -X)
    this.whipV.x += (d === 'front' ? -10 : d === 'back' ? 9 : rnd(-3, 3)) * sc;
    this.whipV.z += (d === 'left' ? 8 : d === 'right' ? -8 : rnd(-3, 3)) * sc;
    this.whipV.y += (d === 'left' ? 9 : d === 'right' ? -9 : 7 * side) * sc;
    if (this.role === 'driver') {
      const a = this._act('sit_hit', true);
      if (a) { a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.setEffectiveWeight(1.6); a.play(); this.hitRT = 0.25; }
      return;
    }
    if (this.lastMode !== 'clip') { this.whip.set(0, 0, 0); this.whipV.set(0, 0, 0); return; }   // first person: the procedural flinch
    const now = performance.now() / 1000;
    const heavy = (e.dmg || 0) >= 10 || !!e.head || Math.random() < 0.35;
    if (heavy && !(this.ov && (this.ov.kind === 'throw' || this.ov.kind === 'hit')) && now - this.lastHeavy > 0.7) {
      this.lastHeavy = now; this._play('hit_' + d + '_heavy', 'hit', { fin: 0.03, fout: 0.22 });
    } else {
      const a = this._act('hit_' + d, true);
      if (a) { a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.setEffectiveWeight(1.8); a.play(); }
    }
    if (this.ov && this.ov.kind === 'taunt') this._endOv(0.08);
  }

  /** Crash jolt (world_view: 'crash' events, dv = impact speed change). */
  impact(dv) {
    if (!this.alive || !this.mixer) return;
    const s = clamp(dv / 8, 0.3, 1);
    this.whipV.x += clamp(dv, 0, 12) * (this.role === 'driver' ? 0.9 : 1.1);      // thrown forward
    this.whipV.y += rnd(-1, 1) * clamp(dv, 0, 12) * 0.5;
    if (this.role === 'driver') {
      this.shaken = Math.max(this.shaken, 0.35 + 0.1 * dv);
      const a = this._act('sit_impact', true);
      if (a) { a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.setEffectiveWeight(s * 1.3); a.play(); }
      return;
    }
    if (this.lastMode !== 'clip') { this.whip.set(0, 0, 0); this.whipV.set(0, 0, 0); return; }
    if (dv > 5 && !this.ov) this._play('hit_back_heavy', 'hit', { fin: 0.05, fout: 0.2 });      // lurches forward
    else { const a = this._act('hit_back', true); if (a) { a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; a.setEffectiveWeight(s * 1.5); a.play(); } }
  }

  /** A kill by this crew's car: taunt (third-person gunners only). */
  cheer() { if (this.alive && this.role !== 'driver' && this.lastMode === 'clip' && !this.ov) this._play(Math.random() < 0.5 ? 'taunt' : 'celebrate', 'taunt', { fin: 0.15, fout: 0.2 }); }

  throwGrenade() {
    if (this.lastMode === 'clip' && this.bones) {
      if (!this.nade && this.bones.socket_hand_R) {
        nadeGeo ??= new THREE.SphereGeometry(0.034, 10, 8).scale(1, 1, 1.3);
        nadeMat ??= new THREE.MeshStandardMaterial({ color: 0x33402a, roughness: 0.6, metalness: 0.2 });
        this.nade = new THREE.Mesh(nadeGeo, nadeMat); this.nade.castShadow = true; this.nade.visible = false; this.bones.socket_hand_R.add(this.nade);
      }
      this._play('throw_grenade', 'throw', { start: THROW.start, scale: THROW.scale, fin: 0.08, fout: 0.15 });
      return;
    }
    this.throwT = 0.7; const a = this._act('throw_grenade'); if (this.mixer && a) { a.reset(); a.setLoop(THREE.LoopOnce); a.setEffectiveWeight(0.8); a.play(); }
  }

  // ---- deaths -------------------------------------------------------------------------------------------------------------------
  die(e = {}) {
    if (this.deadT >= 0) return;
    this.alive = false; this.deadT = 0;
    if (this.vm) { this.vm.setVisible(false); this._setShadowOnly(false); this.useVm = false; }
    this.body.visible = true;
    if (this.bones) { this.bones.Head?.scale.setScalar(1); this.bones.Neck?.scale.setScalar(1); }     // the death camera sees us
    if (this.nade) this.nade.visible = false;
    if (!this.mixer) { if (this.role !== 'driver') this.root.visible = false; return; }
    this.ov = null;
    let name;
    if (this.role === 'driver') {
      const st = this._wheelAngle(0, null);
      name = Math.abs(st) > 0.15 && Math.random() < 0.75 ? (st > 0 ? 'death_sit_jerk_L' : 'death_sit_jerk_R')
        : ['death_sit_slump', 'death_sit_slump', 'death_sit_headback', Math.random() < 0.5 ? 'death_sit_jerk_L' : 'death_sit_jerk_R'][(Math.random() * 4) | 0];
      this.sitIK = SIT_DEATH_IK[name] || [0.1, 0.4];
      this.whipV.x -= 8; this.whipV.y += rnd(-4, 4);          // the shot snaps the head back before the slump
    } else {
      const moving = this.lastSpeed > 6, r = Math.random(), hd = this.lastHitDir;
      if (this.weapon) this.weapon.root.visible = false;
      // thrown clear: a real ballistic flight with a tumble, then the ground impact clips (the big, readable death)
      const canFly = this.car && this.bones.Hips && this._act('fall_flail') && this._act('land_back') && this._act('land_front');
      if (canFly && (e.cause === 'explosion' || (moving && r < 0.72))) { this._flyStart(e); return; }
      if (e.cause === 'explosion') name = 'death_blown_up';
      else if (this.car && RAIL_CARS.has(this.car.spec?.id) && Math.abs(this.bodyYaw) < 0.8 && r < 0.55) name = 'death_slump_rail';
      else if (e.head && r < 0.75) name = 'death_crumple';
      else if (hd === 'left') name = 'death_thrown_right';
      else if (hd === 'right') name = 'death_thrown_left';
      else name = moving ? 'death_thrown_back' : 'death_fall';
      if (!this._act(name)) name = 'death_fall';
      const win = LEAVES[name];
      if (win && this.car && (moving || name === 'death_blown_up' || /thrown/.test(name))) this._detach(win, name === 'death_blown_up');
    }
    this._playDeath(name, 0.1);
  }

  _playDeath(name, fade) {
    const a = this._act(name);
    if (!a) return null;
    for (const x of this.acts.values()) if (x && x !== a && x.isRunning()) x.fadeOut(fade);
    if (this.aHands) this.aHands.fadeOut(fade);
    if (this.aAuto) this.aAuto.fadeOut(fade);
    a.reset(); a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; a.setEffectiveWeight(1); a.fadeIn(fade); a.play();
    this.deathName = name;
    return a;
  }

  /** Leave the vehicle: world-space root, upright with the body's facing, keeps the vehicle's horizontal momentum. */
  _detach(win, blast) {
    const scene = this._scene(); if (!scene) return;
    this.body.getWorldDirection(_a);
    const yaw = Math.atan2(_a.x, _a.z);
    scene.attach(this.root);
    this.root.quaternion.setFromAxisAngle(_up, yaw); this.body.rotation.y = 0;
    const v = this.lastVel;
    this.fallVel.set(v ? v.x * 0.9 : 0, 0, v ? v.z * 0.9 : 0);
    if (blast) this.fallVel.x += rnd(-1.5, 1.5), this.fallVel.z += rnd(-1.5, 1.5);
    this.detached = true; this.leave = win; this.y0 = this.root.position.y; this.yGround = null;
  }
  _scene() { let o = this.root; while (o.parent) o = o.parent; return o.isScene ? o : null; }

  /** Thrown off the vehicle: launch the hips on a ballistic arc (vehicle momentum + a kick away from the shot / outward + up),
   *  flail in the air while the body tumbles about a horizontal axis, and arrive lying (back or face down) for land_*. */
  _flyStart(e) {
    const scene = this._scene(); if (!scene) return;
    const blast = e.cause === 'explosion';
    const H = new THREE.Vector3(); this.bones.Hips.getWorldPosition(H);
    (this.car.root || this.root).getWorldQuaternion(_q);
    _ax.set(1, 0, 0).applyQuaternion(_q); _az.set(0, 0, 1).applyQuaternion(_q);
    // push: away from the shot (body frame -> world), outward to a side of the car, a little backward
    const hd = this.lastHitDir, out = new THREE.Vector3();
    this.body.getWorldQuaternion(_q2);
    if (hd === 'front') out.set(0, 0, -1).applyQuaternion(_q2); else if (hd === 'back') out.set(0, 0, 1).applyQuaternion(_q2);
    else if (hd === 'left') out.set(-1, 0, 0).applyQuaternion(_q2); else if (hd === 'right') out.set(1, 0, 0).applyQuaternion(_q2);
    out.multiplyScalar(0.8).addScaledVector(_ax, (Math.random() < 0.5 ? -1 : 1) * 0.7).addScaledVector(_az, -0.35); out.y = 0;
    if (out.lengthSq() < 1e-4) out.copy(_ax);
    out.normalize();
    const lv = this.lastVel;
    const v = new THREE.Vector3(lv ? lv.x * 0.95 : 0, (lv ? lv.y * 0.5 : 0) + (blast ? rnd(6, 8) : rnd(3.4, 4.6)), lv ? lv.z * 0.95 : 0);
    v.addScaledVector(out, blast ? rnd(4, 6.5) : rnd(3, 4.5));
    const faceDown = !blast && Math.random() < 0.45;
    const yaw = Math.atan2(out.x, out.z) + (faceDown ? 0 : Math.PI);     // tumble axis = the root's X
    const g0 = this.groundY ? this.groundY(H.x, H.y, H.z) : null, ground = g0 ?? H.y - 1.4;
    const h = Math.max(0, H.y - (ground + 0.3)), T = (v.y + Math.sqrt(v.y * v.y + 2 * G * h)) / G;
    const A = (faceDown ? 1 : -1) * (Math.PI / 2 + (T > 1.0 ? 2 * Math.PI : 0));
    scene.attach(this.root); this.body.rotation.y = 0; this.body.updateMatrix();
    this.fly = { H, v, t: 0, T: Math.max(0.35, T), A, yaw, face: faceDown ? 'front' : 'back', ground, roll: rnd(-0.7, 0.7) };
    this.detached = true; this.leave = null;
    const a = this._playDeath('fall_flail', 0.08);
    if (a) { a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; a.time = rnd(0, 0.8); }
    this.deathName = 'fly';
    this._flyUpdate(0);
  }

  _flyUpdate(dt) {
    const f = this.fly, r = this.root;
    f.t += dt; f.v.y -= G * dt; f.H.addScaledVector(f.v, dt);
    const u = Math.min(1, f.t / f.T), e = 1 - (1 - u) * (1 - u);
    _yq.setFromAxisAngle(_up, f.yaw);
    r.quaternion.copy(_yq).multiply(_hq.setFromAxisAngle(_v2.set(1, 0, 0), f.A * e)).multiply(_hq.setFromAxisAngle(_v2.set(0, 0, 1), f.roll * Math.sin(Math.PI * u)));
    // pivot about the hips: the hips follow the ballistic path exactly
    _v1.copy(this.bones.Hips.position).add(this.model.position).applyQuaternion(r.quaternion);
    r.position.copy(f.H).sub(_v1);
    if (f.t > 0.12) {
      const gy = this.groundY ? this.groundY(f.H.x, f.H.y, f.H.z) : null;
      const gnd = gy ?? f.ground;
      if ((f.v.y < 0 && f.H.y <= gnd + 0.3) || f.t > f.T + 0.8) this._land(gnd);
    }
  }

  /** Ground impact: switch to land_back / land_front (lying, upright root), then bounce, spin and slide to a stop. */
  _land(gnd) {
    const f = this.fly; this.fly = null;
    this._playDeath('land_' + f.face, 0.06);
    this.root.quaternion.setFromAxisAngle(_up, f.yaw);
    this.root.position.set(f.H.x, gnd, f.H.z);
    const hs = Math.hypot(f.v.x, f.v.z);
    this.slide = { vx: f.v.x, vz: f.v.z, t: 0, hop: clamp(hs * 0.02 - f.v.y * 0.035, 0.1, 0.5), spin: hs > 5 ? (Math.random() < 0.5 ? -1 : 1) * Math.min(5, hs * 0.18) : 0, yaw: f.yaw, gnd, gT: 0 };
  }

  _slideUpdate(dt) {
    const sl = this.slide, r = this.root;
    sl.t += dt;
    const sp = Math.hypot(sl.vx, sl.vz);
    if (sp > 1e-3) { const k = Math.max(0, sp - 12 * dt) / sp; sl.vx *= k; sl.vz *= k; }
    r.position.x += sl.vx * dt; r.position.z += sl.vz * dt;
    sl.spin *= Math.exp(-dt * 1.8); sl.yaw += sl.spin * dt; r.quaternion.setFromAxisAngle(_up, sl.yaw);
    // a hop off the road right after the slam, then a small one
    const t = sl.t - 0.07; let hop = 0;
    if (t > 0 && t < 0.42) hop = sl.hop * Math.sin(Math.PI * t / 0.42);
    else if (t >= 0.42 && t < 0.66) hop = sl.hop * 0.3 * Math.sin(Math.PI * (t - 0.42) / 0.24);
    if ((sl.gT -= dt) <= 0 && sp > 0.2) { sl.gT = 0.1; const gy = this.groundY ? this.groundY(r.position.x, sl.gnd + 1.5, r.position.z) : null; if (gy !== null) sl.gnd = gy; }
    r.position.y = sl.gnd + hop;
  }

  _dead(dt, s) {
    this.deadT += dt;
    this.mixer?.update(dt);
    if (this.role === 'driver') {
      // the wheel keeps turning with the (driverless) car; the hands hold on, then let go
      if (s) this.steer += ((s.steer || 0) - this.steer) * Math.min(1, dt * 8);
      const w = this.sitIK ? 1 - smooth01(this.sitIK[0], this.sitIK[1], this.deadT) : 0;
      if (this.bones && s && !s.far) { _v2.set(0, 0, 0); springStep(this.whip, this.whipV, _v2, WHIP_W, WHIP_Z, dt); _v1.set(1, 0, 0); for (const b of this.spine) turn(b, _v1, this.whip.x * 0.33); turn(this.bones.Head, _v1, this.whip.x * 0.5); }
      this._wheelIK(w, w, -this._wheelAngle(dt, s));
      return;
    }
    if (!this.detached) return;
    if (this.deadT > 9) this.root.visible = false;
    if (this.fly) { this._flyUpdate(dt); return; }
    if (this.slide) { this._slideUpdate(dt); return; }
    const r = this.root, win = this.leave;
    r.position.x += this.fallVel.x * dt; r.position.z += this.fallVel.z * dt;
    if (this.deadT > win[1]) {                                     // sliding / tumbling to a stop on the ground
      const sp = Math.hypot(this.fallVel.x, this.fallVel.z);
      if (sp > 1e-3) this.fallVel.multiplyScalar(Math.max(0, sp - 18 * dt) / sp);
    }
    const gy = this.groundY ? this.groundY(r.position.x, Math.max(r.position.y, this.y0), r.position.z) : null;
    if (gy !== null) this.yGround = gy; else if (this.yGround === null) this.yGround = this.y0 - 1.0;
    const u = clamp((this.deadT - win[0]) / (win[1] - win[0]), 0, 1);
    r.position.y = this.y0 + (Math.min(this.yGround, this.y0) - this.y0) * u * u;
  }

  headWorld(out) { if (!this.head) return false; this.head.getWorldPosition(out); return true; }
  muzzleWorld(out) { if (this.vm && this.useVm) return this.vm.muzzleWorld(out); return this.weapon ? this.weapon.muzzleWorld(out) : false; }
  dispose() { this.root.removeFromParent(); this.mixer?.stopAllAction(); if (this.vm) this.vm.dispose(); }
}
