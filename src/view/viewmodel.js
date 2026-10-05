// ViewModel: the local gunner's first-person arms + weapon (AAA-style FP rig).
//
// Rendering: drawn in the normal scene pass, but every viewmodel material is patched to use its own projection (fixed viewmodel
// FOV, near 1 cm) and to write depth into a thin band in FRONT of the whole world (window depth < BAND). So the gun never clips into
// the cab / roll cage / world, never hits the camera near plane and keeps its size when the world FOV zooms (speed, boost, ADS).
// The root is parented to the camera (no lag); everything below is procedural in camera space (x right, y up, -z forward):
//   look sway (lags the aim) + turn tilt, truck suspension / cornering inertia (spring driven by the eye's acceleration), road buzz,
//   breathing, bed walking bob, per-weapon recoil springs, ADS blend (sight socket exactly on the view axis), weapon swap,
//   reload choreography (mag out / in, rack, pump per shell, bolt, crane, belt box, rocket), grenade throw, own muzzle flash.
// Arms: the dedicated first-person arms asset (FP_ARMS_URL) when present, else the hero gunner's arms cut out of hero_gunner.glb
//   (forearms replaced by fitted sleeve tubes); analytic two-bone IK with clavicle assist and wrist-twist sharing; hands are placed
//   exactly on the weapon's grip sockets through the hand sockets (socket_hand_R/L); finger shapes from the pose_* clips.
// Debug: window.__vmDbg = {noGun, noArms, inspect:{pos, yaw, noIK}, view:{rot:[pitch,yaw], c, d}} (tuning captures, shots/gunfeel).
// FX alignment: world-space effects (tracers, smoke, casings) start from `muzzleWorld()` / `ejectWorld()`, the APPARENT positions
//   (the world point that the main camera projects to the same pixel as the viewmodel muzzle).
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { WeaponView } from './weapon_view.js';
import { splitIslands, canCutViewmodelMesh } from './fp_cutaway.js';
import { ownClonedSkeletons, disposeOwnedSkeletons, disposeOwnedSkeletonsIn } from './owned_skeletons.js';
import { REFLEX_GUNS, sanitizeOpticId } from '../data/weapon_optics.js';
import { configureReflexProjection } from './reflex_optic.js';
import { weaponVisualKey } from '../data/weapon_visual_config.js';
import { prepareLocalSkinning } from './local_skinning.js';

export const FP_ARMS_URL = '/models/characters/fp_arms.glb';
/** Set by driver_arms.js (avoids a circular import): builds the driver arms' warm-up object. */
let DriverArmsWarm = null;
export function registerDriverArmsWarm(fn) { DriverArmsWarm = fn; }
/** True while a scripted camera owns the view (run.cinematic, intro fly-by, finale orbit, death cam): no viewmodel, no gunner HUD. */
export function inCinematic() {
  const R = typeof window !== 'undefined' ? window.__run : null;
  return !!(R && (R.cinematic || R.introOutside || (R.finaleT > 0 && !R.finaleDone) || R.deathCamT > 0));
}
const SHELL_HULL = new THREE.MeshStandardMaterial({ color: 0x9a1c12, roughness: 0.55, metalness: 0.0 });
const SHELL_BRASS = new THREE.MeshStandardMaterial({ color: 0xc89a40, roughness: 0.3, metalness: 0.9 });
let FP_GLB = null, FP_TRIED = false;
/** Start loading the dedicated first-person arms early (null when the file does not exist yet). */
function fpArmsLoad() { if (!FP_TRIED) { FP_TRIED = true; Assets.loadGLB(FP_ARMS_URL).then((g) => { FP_GLB = g || null; }).catch(() => {}); } return Assets.loadGLB(FP_ARMS_URL); }

const DEG = Math.PI / 180;
const RLOAD = 0.55;                              // RPG reload: the rocket is lined up this fraction of its 420 mm travel out of the mouth
export const BAND = 0.008;                       // viewmodel window depth range [0, BAND]
const VM_NEAR = 0.012, VM_FAR = 6;
/** Shared uniforms of every viewmodel material. */
export const VMU = { vmProj: { value: new THREE.Matrix4() }, wrapCol: { value: new THREE.Color(0.030, 0.032, 0.022) }, wrapDetail: { value: 0.0 } };
const VM_GLSL = `\n  gl_Position = vmProj * mvPosition;\n  gl_Position.z = (gl_Position.z + gl_Position.w) * ${BAND.toFixed(4)} - gl_Position.w;\n`;
const vmCache = new Map();
/** Up close the weapon receivers / sleeves are seen at grazing angles: 8x anisotropic filtering on every viewmodel texture. */
function sharpen(mat) {
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
    const t = mat[k];
    if (t && t.anisotropy < 8) { t.anisotropy = 8; t.needsUpdate = true; }
  }
}
/** Clone + patch a scene material for the viewmodel pass (cached per source material). */
export function vmMaterial(src) {
  let m = vmCache.get(src);
  if (m) return m;
  sharpen(src);
  m = src.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.vmProj = VMU.vmProj;
    sh.vertexShader = 'uniform mat4 vmProj;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>' + VM_GLSL);
  };
  m.customProgramCacheKey = () => 'rod_viewmodel_1';
  vmCache.set(src, m);
  return m;
}

/** See-through optic glass for the viewmodel (the scene glass is nearly opaque at eye-relief distance). */
const lensCache = new Map();
function vmLensMaterial(src) {
  let m = lensCache.get(src);
  if (m) return m;
  const base = src.clone();
  base.transparent = true; base.opacity = 0.14; base.depthWrite = false; base.roughness = 0.04; base.metalness = 0; base.color = new THREE.Color(0.55, 0.7, 0.8); base.envMapIntensity = 1.4;
  m = vmMaterial(base);
  lensCache.set(src, m);
  return m;
}

/** Arms: viewmodel patch + tactical sleeves over the forearm-wrap patchwork (procedural fabric in rest-pose object space, so it
 *  neither swims nor shows UV seams) and slightly softer skin. `sleeve` vertex attribute: 1 on arm/forearm vertices, 0 on hands. */
let ARMS_MAT = null;
function armsMaterial(src) {
  if (ARMS_MAT) return ARMS_MAT;
  sharpen(src);
  const m = src.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.vmProj = VMU.vmProj; sh.uniforms.wrapCol = VMU.wrapCol; sh.uniforms.wrapDetail = VMU.wrapDetail;
    sh.vertexShader = 'uniform mat4 vmProj;\nattribute float sleeve;\nvarying float vSleeve;\nvarying vec3 vRest;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSleeve = sleeve; vRest = position;')
      .replace('#include <project_vertex>', '#include <project_vertex>' + VM_GLSL);
    sh.fragmentShader = 'uniform vec3 wrapCol;\nuniform float wrapDetail;\nvarying float vSleeve;\nvarying vec3 vRest;\n' + SLEEVE_NOISE + sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\n' + SLEEVE_ALBEDO)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.86, sleeveK);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 0.0, sleeveK);');
  };
  m.customProgramCacheKey = () => 'rod_viewmodel_arms_1';
  ARMS_MAT = m;
  return m;
}
const SLEEVE_NOISE = /* glsl */`
float vmHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vmNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(vmHash(i), vmHash(i + vec3(1, 0, 0)), f.x), mix(vmHash(i + vec3(0, 1, 0)), vmHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(vmHash(i + vec3(0, 0, 1)), vmHash(i + vec3(1, 0, 1)), f.x), mix(vmHash(i + vec3(0, 1, 1)), vmHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float sleeveK = 0.0;
`;
const SLEEVE_ALBEDO = /* glsl */`
  sleeveK = smoothstep(0.35, 0.65, vSleeve);
  if (sleeveK > 0.001) {
    // sleeve (ARM_STYLE 'sleeve': upper arm) or wrap tape ('wrap': the tiny atlas islands that read as a coarse checker up close):
    // soft tonal variation of a blurred mip + procedural folds / grime in rest-pose object space (no swimming, no seams)
    vec3 soft = textureLod(map, vMapUv, 4.0).rgb;
    float lum = dot(soft, vec3(0.3, 0.59, 0.11)) / 0.18;
    float folds = vmNoise(vRest * 90.0) * 0.55 + vmNoise(vRest * 220.0) * 0.3 + vmNoise(vRest * 25.0) * 0.4;
    float grime = vmNoise(vRest * 40.0 + 7.0);
    vec3 cloth = wrapCol * mix(1.0, clamp(lum, 0.5, 1.6), wrapDetail) * (0.7 + 0.45 * folds) * (0.85 + 0.25 * grime);
    diffuseColor.rgb = mix(diffuseColor.rgb, cloth, sleeveK);
  }
`;

// ------------------------------------------------------------------------------------------------ per-weapon tuning
// hip: grip_R position in camera space (m); hipRot: [pitch, yaw, roll] deg; relief: distance of the sight socket in front of the eye
// when aiming; fov: viewmodel vertical FOV [hip, ads]; rec: [kick back m, climb deg, yaw deg, roll deg]; lRot/rRot: extra hand
// rotation on the grip sockets (deg, socket axes); sh: shoulder-centre offset (camera space); blade: torso yaw (rad).
export const TUNE = {
  pistol: { hip: [0.11, -0.175, -0.40], hipRot: [1, 3, -3], relief: 0.40, fov: [62, 52], pose: 'pose_pistol', support: [0.011, 0.0213, -0.0018, -32, 0, 90], rec: [0.05, 9, 2, 4], reload: 'pistol', blade: -0.25, sh: [0.0, -0.235, 0.02], lRot: [0, 0, 0], rRot: [0, 0, 0] },
  revolver: { hip: [0.11, -0.18, -0.41], hipRot: [1, 3, -3], relief: 0.42, fov: [62, 52], adsRot: [Math.atan2(.0012, .2071) / DEG, 0, 0], adsSight: [0, .10015857, -.06], pose: 'pose_revolver', poseAlt: 'pose_pistol', support: [0.0273, -0.0317, 0.0447, 28.7, 22.3, 76.3], rec: [0.075, 16, 3, 6], reload: 'revolver', blade: -0.25, sh: [0.0, -0.235, 0.02], lRot: [0, 0, 0], rRot: [0, 0, 0] },
  smg: { hip: [0.16, -0.25, -0.33], hipRot: [0, 2.5, -3], relief: 0.15, fov: [62, 52], adsRot: [-Math.atan2(.0045, .353) / DEG, 0, 0], adsSight: [0, .10585269, -.15], adsCut: [[-0.06, -0.2, -0.4, 0.06, 0.2, -0.085]], magAnchor: { off: [0.016, -0.09, 0.002], rot: [-90, 0, 90] }, pose: 'pose_smg', rec: [0.022, 2.3, 1.2, 2.0], reload: 'mag', blade: -0.42, sh: [0.02, -0.24, 0.04] },
  // The rear aperture sits 11.5 mm above the front fibre. Follow that sight line,
  // including its height behind the receiver, rather than levelling the barrel.
  shotgun: { hip: [0.165, -0.26, -0.31], hipRot: [0, 2, -3], relief: 0.11, fov: [62, 58], adsRot: [Math.atan2(0.0115, 0.6485) / DEG, 0, 0], adsSight: [0, 0.09227, -0.12], adsCut: [[-0.025, -0.08, -0.33, 0.025, 0.0825, 0.002]], pose: 'pose_shotgun', rec: [0.09, 11, 2, 4], reload: 'shotgun', blade: -0.45, sh: [0.02, -0.24, 0.04] },
  rifle: { hip: [0.165, -0.27, -0.34], hipRot: [0, 2, -3], relief: 0.07, fov: [62, 50], pose: 'pose_rifle', rackR: true, rec: [0.032, 3.0, 1.0, 2.0], reload: 'mag', blade: -0.45, sh: [0.02, -0.24, 0.04], reticle: 0.14 },
  lmg: { hip: [0.17, -0.28, -0.32], hipRot: [0, 2, -3], relief: 0.10, fov: [62, 54], adsRot: [Math.atan2(.006, .6125) / DEG, 0, 0], adsSight: [0, .14756245, -.17], pose: 'pose_lmg', rec: [0.032, 2.7, 1.4, 2.6], reload: 'lmg', blade: -0.45, sh: [0.02, -0.245, 0.04] },
  sniper: { hip: [0.165, -0.27, -0.31], hipRot: [0, 2, -3], relief: 0.02, fov: [62, 50], pose: 'pose_sniper', rec: [0.10, 9, 1.5, 4], reload: 'mag', bolt: true, blade: -0.45, sh: [0.02, -0.24, 0.04] },
  rpg: { hip: [0.16, -0.24, -0.28], hipRot: [0, 2, -2], relief: 0.02, fov: [62, 50], pose: 'pose_launcher', rec: [0.10, 6, 1.5, 3], reload: 'rpg', blade: -0.45, sh: [0.02, -0.24, 0.04] },
};
// hand orientations for non-grip anchors (virtual socket Euler XYZ, deg, gun-model axes)
export const ANCH = {
  mag: { off: [0.03, -0.075, 0.0], rot: [90, 0, 90] },
  pistolMag: { off: [0.0, -0.10, -0.01], rot: [0, 0, 0] },
  charge: { off: [0.0, 0.0, 0.02], rot: [0, 0, 90] },
  chargeR: { off: [-0.02, 0.0, 0.0], rot: [0, 0, -90] },
  slide: { off: [0.0, 0.01, -0.025], rot: [0, 0, 90] },
  cover: { off: [0.0, 0.03, 0.08], rot: [0, 0, 180] },
  port: { off: [0.0, -0.03, 0.0], rot: [0, 0, 60] },
  cyl: { off: [0.03, 0.0, -0.02], rot: [0, 0, 90] },
  rocket: { off: [0.0, 0.0, -0.12], rot: [0, 0, 0] },       // hand round the motor section, 12 cm behind the rocket's origin
  rocketLoad: { off: [0.0, 0.09, 0.625 + 0.42 * 0.55 - 0.12], rot: [0, 0, 0] },   // the same grip, rocket lined up ~23 cm out of the mouth
  pocket: { off: [0.10, -0.42, -0.05], rot: [40, 0, 40] },
  // The bolt node is its hinge on the bore axis; the grasp is on the knob.
  bolt: { off: [-0.063, -0.026, -0.004], rot: [0, 0, 0] },
  grenade: { off: [0, 0, 0], rot: [0, 0, 0] },
};

// ------------------------------------------------------------------------------------------------ small math helpers
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
// reload timeline helpers (module state instead of per-frame closures): _RR = normalised reload time of the current frame
let _RR = 0;
const seg = (a, b) => sstep(a, b, _RR);
/** Ease-out with a small overshoot (snappy moves that settle). */
const backOut = (x) => { if (x <= 0) return 0; if (x >= 1) return 1; const c1 = 1.4, c3 = c1 + 1, y = x - 1; return 1 + c3 * y * y * y + c1 * y * y; };
function tween(lh, t0, t1, a, b, arc = 0.04) { if (_RR >= t0) { lh.a = a; lh.b = b; lh.w = sstep(t0, t1, _RR); lh.arc = arc; } }
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1), _sc = new THREE.Vector3(), _mi = new THREE.Matrix4(), _mr = new THREE.Matrix4();
const Q_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);   // gun +Z forward -> camera -Z

/** Damped spring on N channels (semi-implicit Euler, sub-stepped). freq Hz, zeta damping ratio. */
class Spring {
  constructor(n, freq, zeta) { this.x = new Float32Array(n); this.v = new Float32Array(n); this.set(freq, zeta); }
  set(freq, zeta) { this.w = freq * 2 * Math.PI; this.z = zeta; }
  /** target: array (or null = 0) */
  step(dt, target) {
    const n = this.x.length, w = this.w, k = w * w, c = 2 * this.z * w;
    let steps = Math.ceil(dt / (1 / 240)); const h = dt / steps;
    while (steps-- > 0) for (let i = 0; i < n; i++) { const tg = target ? target[i] : 0; this.v[i] += (k * (tg - this.x[i]) - c * this.v[i]) * h; this.x[i] += this.v[i] * h; }
  }
  /** add a velocity impulse sized so the peak displacement is ~d (from rest) */
  kick(i, d) { this.v[i] += d * this.w * 1.45; }
}

export function aimBone(bone, from, to) {
  bone.getWorldPosition(_p);
  _d.copy(from).sub(_p).normalize(); _t.copy(to).sub(_p).normalize();
  if (_d.lengthSq() < 1e-8 || _t.lengthSq() < 1e-8) return;
  _q.setFromUnitVectors(_d, _t);
  bone.getWorldQuaternion(_q2); _q2.premultiply(_q);
  bone.parent.getWorldQuaternion(_qp).invert();
  bone.quaternion.copy(_qp.multiply(_q2));
  bone.updateMatrixWorld(true);
}
const _ia = new THREE.Vector3(), _ib = new THREE.Vector3(), _ic = new THREE.Vector3(), _it = new THREE.Vector3(), _ie = new THREE.Vector3(), _iu = new THREE.Vector3(), _ip = new THREE.Vector3(), _iw = new THREE.Vector3();
export function twoBoneIK(upper, lower, end, target, pole, la, lb) {
  upper.getWorldPosition(_ia);
  _it.copy(target).sub(_ia); let d = _it.length();
  d = Math.min(Math.max(d, Math.abs(la - lb) + 1e-3), la + lb - 1e-3);
  _it.normalize();
  const cosA = (la * la + d * d - lb * lb) / (2 * la * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _ip.copy(pole).sub(_ia);
  _iu.copy(_ip).addScaledVector(_it, -_ip.dot(_it));
  if (_iu.lengthSq() < 1e-8) _iu.set(0, -1, 0); _iu.normalize();
  _ie.copy(_ia).addScaledVector(_it, la * cosA).addScaledVector(_iu, la * sinA);
  lower.getWorldPosition(_ib); aimBone(upper, _ib, _ie);
  end.getWorldPosition(_ic); _iw.copy(_ia).addScaledVector(_it, d);
  aimBone(lower, _ic, _iw);
}

// ------------------------------------------------------------------------------------------------ arms geometry (cut once)
let ARMS_GEO = null;
const ARM_BONE = /^(Left|Right)(Arm|ForeArm|Hand)/;
const MOUNTED_ARMS_GEOMETRY = new WeakMap();
/** Deck-mounted weapons use the real scene projection. Share the crew's driven
 * skeleton while drawing only its arms, so the camera cannot see the torso or
 * shoulders through the sight and no second, camera-parented gun is needed. */
export function createMountedFirstPersonArms(body) {
  if (!body?.isSkinnedMesh || !body.geometry?.index || !body.skeleton) return null;
  let geometry = MOUNTED_ARMS_GEOMETRY.get(body.geometry);
  if (!geometry) {
    const source = body.geometry, names = body.skeleton.bones.map(bone => bone.name);
    const skinIndex = source.attributes.skinIndex, skinWeight = source.attributes.skinWeight;
    if (!skinIndex || !skinWeight) return null;
    const armWeight = new Float32Array(skinIndex.count), indices = [];
    for (let i = 0; i < skinIndex.count; i++) for (let k = 0; k < 4; k++) {
      if (ARM_BONE.test(names[skinIndex.getComponent(i, k)] || '')) armWeight[i] += skinWeight.getComponent(i, k);
    }
    const original = source.index.array;
    for (let i = 0; i < original.length; i += 3) {
      const a = original[i], b = original[i + 1], c = original[i + 2];
      if (Math.min(armWeight[a], armWeight[b], armWeight[c]) >= .8) indices.push(a, b, c);
    }
    geometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
    geometry.setIndex(indices); geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    MOUNTED_ARMS_GEOMETRY.set(source, geometry);
  }
  const arms = new THREE.SkinnedMesh(geometry, body.userData.mat0 || body.material);
  arms.name = 'mounted_fp_arms'; arms.userData.fpArms = true;
  arms.position.copy(body.position); arms.quaternion.copy(body.quaternion); arms.scale.copy(body.scale);
  arms.frustumCulled = false; arms.castShadow = false; arms.receiveShadow = true; arms.visible = false;
  body.parent?.add(arms); arms.bind(body.skeleton, body.bindMatrix); return arms;
}
/** 'wrap': real forearms (tattoos), the wrap shells drawn as clean dark tape; 'sleeve': fitted fabric tubes over the forearms. */
export const ARM_STYLE = { v: 'sleeve' };
const WRAP_UV = (u, v) => (u < 0.19 && v > 0.74 && v < 0.88) || (u > 0.93 && v > 0.3 && v < 0.38) || (u < 0.07 && v < 0.32);
/** Triangles skinned (almost) only to the arm chains; the forearm wrap shells are dropped (their tiny atlas islands look pixelated
 *  at first-person distance) so the tattooed forearms show. */
function armsGeometry(body) {
  if (ARMS_GEO) return ARMS_GEO;
  const g = body.geometry, names = body.skeleton.bones.map((b) => b.name);
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, uv = g.attributes.uv, idx = g.index.array;
  const armW = new Float32Array(si.count), foreW = new Float32Array(si.count);
  for (let i = 0; i < si.count; i++) {
    let w = 0, f = 0;
    for (let k = 0; k < 4; k++) { const n = names[si.getComponent(i, k)], x = sw.getComponent(i, k); if (ARM_BONE.test(n)) w += x; if (/ForeArm$/.test(n)) f += x; }
    armW[i] = w; foreW[i] = f;
  }
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (Math.min(armW[a], armW[b], armW[c]) < 0.8) continue;
    if (ARM_STYLE.v === 'sleeve' && (foreW[a] + foreW[b] + foreW[c]) / 3 > 0.5) continue;       // forearm (skin + wrap shells): replaced by the sleeve tube
    out.push(a, b, c);
  }
  void uv;
  const geo = new THREE.BufferGeometry();
  for (const k of Object.keys(g.attributes)) geo.setAttribute(k, g.attributes[k]);
  // sleeve mask: skinned to the upper arm / forearm (not the hand or fingers)
  const sleeve = new Float32Array(si.count), SLV = /^(Left|Right)(Arm|ForeArm)$/;
  for (let i = 0; i < si.count; i++) {
    if (ARM_STYLE.v === 'wrap') { sleeve[i] = WRAP_UV(uv.getX(i), uv.getY(i)) ? 1 : 0; continue; }
    let w = 0; for (let k = 0; k < 4; k++) if (SLV.test(names[si.getComponent(i, k)])) w += sw.getComponent(i, k); sleeve[i] = w;
  }
  geo.setAttribute('sleeve', new THREE.BufferAttribute(sleeve, 1));
  geo.setIndex(out);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  ARMS_GEO = geo;
  return geo;
}

/** Smooth sleeve tube fitted to the forearm skin: elliptical rings measured from the forearm vertices (rest pose, forearm bone
 *  frame = model axes), +5 mm cloth offset, a slight cuff flare at the wrist. Built in the forearm bone's local space. */
const SLEEVE_GEO = {};
function sleeveGeometry(body, side) {
  if (SLEEVE_GEO[side]) return SLEEVE_GEO[side];
  const g = body.geometry, names = body.skeleton.bones.map((b) => b.name);
  const bones = body.skeleton.bones, fi = names.indexOf(side + 'ForeArm'), hi = names.indexOf(side + 'Hand');
  const O = new THREE.Vector3(), H = new THREE.Vector3();
  // rest positions from the inverse bind matrices (bone world at bind = inverse(boneInverse))
  O.setFromMatrixPosition(new THREE.Matrix4().copy(body.skeleton.boneInverses[fi]).invert());
  H.setFromMatrixPosition(new THREE.Matrix4().copy(body.skeleton.boneInverses[hi]).invert());
  const A = H.clone().sub(O), L = A.length(); A.normalize();
  const U = new THREE.Vector3().crossVectors(A, new THREE.Vector3(0, 0, 1)).normalize(), Vv = new THREE.Vector3().crossVectors(A, U).normalize();
  const NB = 10, ru = new Float32Array(NB).fill(0.02), rv = new Float32Array(NB).fill(0.02);
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position, p = new THREE.Vector3();
  for (let i = 0; i < si.count; i++) {
    let f = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === fi) f += sw.getComponent(i, k);
    if (f < 0.5) continue;
    p.fromBufferAttribute(pos, i).applyMatrix4(body.bindMatrix).sub(O);
    const t = p.dot(A) / L; if (t < -0.05 || t > 1.02) continue;
    const b = clamp(Math.floor(t * NB), 0, NB - 1);
    ru[b] = Math.max(ru[b], Math.abs(p.dot(U))); rv[b] = Math.max(rv[b], Math.abs(p.dot(Vv)));
  }
  // smooth the profile (max of neighbours, then blur) and taper to the wrist
  const su = [], sv = [];
  for (let b = 0; b < NB; b++) { const a = Math.max(0, b - 1), c = Math.min(NB - 1, b + 1); su.push((ru[a] + 2 * ru[b] + ru[c]) / 4); sv.push((rv[a] + 2 * rv[b] + rv[c]) / 4); }
  const RINGS = 14, SEG = 28, verts = [], norms = [], uvs = [], idx = [];
  const t0 = -0.06, t1 = 0.93;
  for (let r = 0; r <= RINGS; r++) {
    const f = r / RINGS, t = t0 + (t1 - t0) * f, bf = clamp(t * NB - 0.5, 0, NB - 1.001), b0 = Math.floor(bf), w = bf - b0;
    const cuff = 1 + 0.12 * sstep(0.8, 1.0, f) - 0.05 * sstep(0.0, 0.12, f) * 0;
    const au = (su[b0] * (1 - w) + su[b0 + 1] * w) * 0.8 + 0.004, av = (sv[b0] * (1 - w) + sv[b0 + 1] * w) * 0.8 + 0.004;
    for (let s = 0; s <= SEG; s++) {
      const ang = (s / SEG) * Math.PI * 2, cu = Math.cos(ang), cv = Math.sin(ang);
      p.copy(A).multiplyScalar(t * L).addScaledVector(U, cu * au * cuff).addScaledVector(Vv, cv * av * cuff);
      verts.push(p.x, p.y, p.z);
      const n = new THREE.Vector3().addScaledVector(U, cu / au).addScaledVector(Vv, cv / av).normalize();
      norms.push(n.x, n.y, n.z); uvs.push(s / SEG, f);
    }
  }
  for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s, b = a + SEG + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  SLEEVE_GEO[side] = geo;
  return geo;
}
let SLEEVE_MAT = null;
/** Tactical sleeve fabric (procedural: weave, folds bunched toward the cuff, grime), viewmodel projection. */
function sleeveMaterial() {
  if (SLEEVE_MAT) return SLEEVE_MAT;
  const m = new THREE.MeshStandardMaterial({ color: 0x33352b, roughness: 0.9, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.vmProj = VMU.vmProj;
    sh.vertexShader = 'uniform mat4 vmProj;\nvarying vec3 vLoc;\nvarying vec2 vSuv;\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLoc = position; vSuv = uv;')
      .replace('#include <project_vertex>', '#include <project_vertex>' + VM_GLSL);
    sh.fragmentShader = 'varying vec3 vLoc;\nvarying vec2 vSuv;\n' + SLEEVE_NOISE + sh.fragmentShader
      .replace('#include <map_fragment>', `#include <map_fragment>
  {
    float folds = vmNoise(vec3(vSuv.x * 6.0, vSuv.y * 9.0, 0.0)) * 0.55 + vmNoise(vec3(vSuv.x * 14.0, vSuv.y * 22.0, 3.0)) * 0.3;
    float bunch = smoothstep(0.55, 1.0, vSuv.y) * (0.5 + 0.5 * sin(vSuv.y * 70.0 + folds * 5.0));
    float weave = 0.5 + 0.5 * sin(vSuv.x * 900.0) * sin(vSuv.y * 700.0);
    float grime = vmNoise(vLoc * 40.0);
    diffuseColor.rgb *= (0.78 + 0.34 * folds) * (0.96 + 0.06 * weave) * (0.88 + 0.2 * grime) * (1.0 - 0.22 * bunch);
    sleeveK = bunch;
  }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {   // fabric bump (folds + cuff bunching), three's perturbNormalArb
    float h0 = vmNoise(vec3(vSuv.x * 6.0, vSuv.y * 9.0, 0.0)) * 0.8 + vmNoise(vec3(vSuv.x * 14.0, vSuv.y * 22.0, 3.0)) * 0.35 + 0.5 * sin(vSuv.y * 70.0) * smoothstep(0.55, 1.0, vSuv.y);
    vec2 dH = vec2(dFdx(h0), dFdy(h0)) * 0.7;
    vec3 sX = normalize(dFdx(-vViewPosition)), sY = normalize(dFdy(-vViewPosition));
    vec3 R1 = cross(sY, normal), R2 = cross(normal, sX);
    float fDet = dot(sX, R1) * faceDirection;
    normal = normalize(abs(fDet) * normal - sign(fDet) * (dH.x * R1 + dH.y * R2));
  }`);
  };
  m.customProgramCacheKey = () => 'rod_viewmodel_sleeve_1';
  SLEEVE_MAT = m;
  return m;
}

// ------------------------------------------------------------------------------------------------ muzzle flash (own, viewmodel space)
const FLASH_VS = /* glsl */`
uniform mat4 vmProj; uniform float uSize; uniform float uRot; uniform float uLen; uniform float uCone; uniform vec4 uCell;
varying vec2 vUv;
void main() {
  vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 p;
  if (uCone > 0.5) {
    vec3 ax = normalize(mat3(modelViewMatrix) * vec3(0.0, 0.0, 1.0));
    vec3 side = cross(ax, normalize(-c.xyz)); float sl = length(side); side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    p = c.xyz + ax * (uv.x * uLen) + side * ((uv.y - 0.5) * uSize);
  } else {
    float cs = cos(uRot), sn = sin(uRot); vec2 q = position.xy * uSize;
    p = c.xyz + vec3(q.x * cs - q.y * sn, q.x * sn + q.y * cs, 0.0);
  }
  vUv = uCell.xy + uv * uCell.zw;
  gl_Position = vmProj * vec4(p, 1.0);
  gl_Position.z = (gl_Position.z + gl_Position.w) * ${BAND.toFixed(4)} - gl_Position.w;
}`;
const FLASH_FS = /* glsl */`
uniform sampler2D map; uniform vec3 uCol; uniform float uI;
varying vec2 vUv;
void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(uCol * t.rgb * t.a * uI, 1.0); }`;
let FLASH_TEX = null;
const ANCHOR_NODE = { chargeR: 'charging_handle', charge: 'charging_handle', slide: 'slide', cover: 'feed_cover', tray: 'belt', rocket: 'rocket', bolt: 'bolt_handle' };
const FLASH_SIZE = { pistol: 0.8, revolver: 1.3, smg: 0.75, shotgun: 1.6, rifle: 1.0, lmg: 1.15, sniper: 1.6, rpg: 1.8 };
const REACH_ANCHORS = new Set(['pocket', 'cover', 'charge', 'slide', 'port', 'cyl', 'tray']);
const FLASH_CELLS = [[0, 0.5], [0.25, 0.5], [0.5, 0.5], [0.5, 0]];   // star cells of muzzle_flash_sheet.png (u, v of the cell)
function flashTexture() {
  if (!FLASH_TEX) {
    FLASH_TEX = new THREE.TextureLoader().load('/textures/particles/muzzle_flash_sheet.png');
    FLASH_TEX.colorSpace = THREE.SRGBColorSpace; FLASH_TEX.anisotropy = 4;
  }
  return FLASH_TEX;
}
function flashMaterial(cone) {
  return new THREE.ShaderMaterial({
    // Flash and firearm share the VM depth band: opaque receiver/sight parts
    // must occlude a flash behind them, while non-writing glass stays clear.
    vertexShader: FLASH_VS, fragmentShader: FLASH_FS, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    uniforms: { vmProj: VMU.vmProj, map: { value: flashTexture() }, uSize: { value: 0.2 }, uRot: { value: 0 }, uLen: { value: 0.3 }, uCone: { value: cone ? 1 : 0 }, uCell: { value: new THREE.Vector4(0, 0.5, 0.25, 0.5) }, uCol: { value: new THREE.Color(1, 0.75, 0.4) }, uI: { value: 0 } },
  });
}
// reticle for the rifle's prism sight (red chevron + dot, always on the optical axis)
const RET_FS = /* glsl */`
uniform float uI; varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0; float r = length(p);
  float dot_ = smoothstep(0.16, 0.10, r);
  float ring = smoothstep(0.08, 0.0, abs(r - 0.78)) * 0.9;
  float chev = smoothstep(0.07, 0.0, abs(abs(p.x) * 0.9 + p.y + 0.18)) * step(p.y, -0.18) * step(-0.62, p.y);
  float a = max(dot_, max(ring * 0.55, chev));
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(4.0, 0.25, 0.12) * a * uI, 1.0);
}`;
function reticleMaterial() {
  return new THREE.ShaderMaterial({ vertexShader: FLASH_VS.replace('uniform mat4 vmProj;', 'uniform mat4 vmProj;'), fragmentShader: RET_FS, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { vmProj: VMU.vmProj, uSize: { value: 0.01 }, uRot: { value: 0 }, uLen: { value: 0 }, uCone: { value: 0 }, uCell: { value: new THREE.Vector4(0, 0, 1, 1) }, uI: { value: 0 } } });
}

// ------------------------------------------------------------------------------------------------ the rig
export class ViewModel {
  constructor() {
    this.root = new THREE.Group(); this.root.name = 'viewmodel';
    // Only these per-instance allocations are released with this VM. Asset,
    // projection-material and cut/sleeve geometry caches outlive individual VMs.
    this._ownedGeometries = new Set(); this._ownedMaterials = new Set();
    this.guns = new Map(); this.gun = null; this.id = null; this.shownId = null;
    this.t = 0; this.visible = false;
    this.pos = new THREE.Vector3(); this.quat = new THREE.Quaternion();           // final gun transform (camera space)
    this.recP = new Spring(3, 11, 0.42); this.recR = new Spring(3, 8.5, 0.45);   // recoil: position, rotation (pitch, yaw, roll)
    this.swayS = new Spring(5, 5.5, 0.62);                                       // look sway: x, y, pitch, yaw, roll
    this.inert = new Spring(4, 4.0, 0.55);                                       // truck inertia: x, y, z, pitch
    this.jolt = new Spring(2, 9, 0.5);                                           // mag slap / pump jolts: y, pitch
    this.prevQ = new THREE.Quaternion(); this.hasPrev = false; this.angV = new THREE.Vector3();
    this.prevEye = new THREE.Vector3(); this.prevEyeV = new THREE.Vector3(); this.eyeA = new THREE.Vector3(); this.hasEye = 0;
    this.lastShots = -1; this.flashT = 1; this.flashLen = 0.05;
    this.walkPh = 0; this.prevBed = new THREE.Vector3(); this.crouchPrev = 0;
    this.muzzleCam = new THREE.Vector3(0.1, -0.1, -0.8); this.ejectCam = new THREE.Vector3(0.1, -0.08, -0.4); this.ejectDirCam = new THREE.Vector3(1, 0.3, 0);
    this.k = 1; this.fov = 56;
    this.reloadPrev = false; this.pumpAfter = 0; this.shellCycle = 0; this._fired = new Set(); this._relOn = false; this._dry = false;
    this.magDrop = null;
    // dedicated first-person arms (preloaded at boot) -> else the arms cut from hero_gunner, swapped when fp_arms arrives
    if (Assets.has(FP_ARMS_URL)) this._buildArms(Assets.clone(FP_ARMS_URL), Assets.getAnimations(FP_ARMS_URL));
    else { fpArmsLoad(); if (FP_GLB && this._fpFrom(FP_GLB)) { /* dedicated arms */ } else { this._buildArms(); this._tryFpArms(); } }
    // muzzle flash quads
    const quad = new THREE.PlaneGeometry(1, 1);
    this._ownedGeometries.add(quad);
    this.flashStar = new THREE.Mesh(quad, flashMaterial(false)); this.flashCone = new THREE.Mesh(quad, flashMaterial(true));
    this.flashStar2 = new THREE.Mesh(quad, flashMaterial(false));
    for (const f of [this.flashStar, this.flashCone, this.flashStar2]) { f.frustumCulled = false; f.renderOrder = 998; f.visible = false; }
    this.reticle = new THREE.Mesh(quad, reticleMaterial()); this.reticle.frustumCulled = false; this.reticle.renderOrder = 999; this.reticle.visible = false;
    for (const mesh of [this.flashStar, this.flashCone, this.flashStar2, this.reticle]) this._ownedMaterials.add(mesh.material);
    // 12 ga shell held in the left hand while loading the shotgun (red hull + brass head), axis along the hand socket's +Z
    this.shell = new THREE.Group(); this.shell.visible = false;
    const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.0106, 0.0106, 0.058, 14).rotateX(Math.PI / 2), vmMaterial(SHELL_HULL));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0112, 0.0112, 0.014, 14).rotateX(Math.PI / 2), vmMaterial(SHELL_BRASS));
    hull.position.z = 0.012; head.position.z = -0.024;
    for (const m of [hull, head]) { this._ownedGeometries.add(m.geometry); m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; this.shell.add(m); }
    this.root.visible = false;
  }

  /** Arms rig: a dedicated first-person arms GLB when available (FP_ARMS_URL, same bone / socket / pose-clip contract as the
   *  characters), otherwise the arms cut out of hero_gunner.glb. */
  _buildArms(fpModel = null, fpClips = null) {
    const url = '/models/characters/hero_gunner.glb';
    const model = fpModel || Assets.clone(url);
    this.rigged = !!model;
    if (!model) return;
    if (this.bodyG) { this.bodyG.removeFromParent(); this.mixer?.stopAllAction(); disposeOwnedSkeletons(this.model); }
    let arms = null, body = null;
    if (fpModel) {
      model.traverse((o) => { if (o.isMesh) { o.material = vmMaterial(o.material); o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; if (o.isSkinnedMesh && !arms) arms = o; } });
      if (!arms) { this.rigged = false; ownClonedSkeletons(model); disposeOwnedSkeletons(model); return; }
      // The camera travels tens of kilometres during later levels/marathon.
      // Cancel its world translation before the bone palette is cast to float,
      // keeping adjacent skin/cuff vertices together. Install after vmMaterial
      // so the native viewmodel projection and depth band stay in the chain,
      // and before ownership records any palette split on a fresh clone.
      prepareLocalSkinning(model);
    } else {
      // The fallback removes the full body's sibling meshes. Capture every
      // original skeleton first so their palettes still have an owner.
      ownClonedSkeletons(model);
      model.traverse((o) => { if (o.isSkinnedMesh && o.name === 'body') body = o; });
      if (!body) { this.rigged = false; ownClonedSkeletons(model); disposeOwnedSkeletons(model); return; }
      arms = new THREE.SkinnedMesh(armsGeometry(body), armsMaterial(body.material));
      arms.name = 'vm_arms'; arms.frustumCulled = false; arms.castShadow = false; arms.receiveShadow = true;
      body.parent.add(arms); arms.bind(body.skeleton, body.bindMatrix);
      const drop = []; model.traverse((o) => { if (o.isMesh && o !== arms) drop.push(o); }); for (const o of drop) o.removeFromParent();
    }
    ownClonedSkeletons(model);
    this.model = model; this.arms = arms; this.dedicatedArms = !!fpModel;
    this.bodyG = new THREE.Group(); this.bodyG.add(model); this.root.add(this.bodyG);
    const B = this.B = {}; model.traverse((o) => { if (o.isBone || /^socket_/.test(o.name)) B[o.name] = o; });
    model.updateMatrixWorld(true);
    this.side = {};
    for (const s of ['Right', 'Left']) {
      const u = B[s + 'Arm'], l = B[s + 'ForeArm'], h = B[s + 'Hand'], c = B[s + 'Shoulder'], so = B['socket_hand_' + s[0]];
      u.getWorldPosition(_v); l.getWorldPosition(_v2); h.getWorldPosition(_v3);
      this.side[s] = { u, l, h, c, so, la: _v.distanceTo(_v2), lb: _v2.distanceTo(_v3), sp: so.position.clone(), sq: so.quaternion.clone(), sqi: so.quaternion.clone().invert(), twistAx: h.position.clone().normalize() };
      if (ARM_STYLE.v === 'sleeve' && body) {
        const tube = new THREE.Mesh(sleeveGeometry(body, s), sleeveMaterial());      // forearm sleeve (the skin + wrap shells are cut out)
        tube.name = 'vm_sleeve_' + s; tube.frustumCulled = false; tube.castShadow = false; tube.receiveShadow = true; l.add(tube);
      }
    }
    B.RightArm.getWorldPosition(_v); B.LeftArm.getWorldPosition(_v2);
    this.shMid = _v.clone().add(_v2).multiplyScalar(0.5);                                   // model-space shoulder centre (rest)
    this.armBones = []; for (const s of ['Right', 'Left']) for (const n of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) this.armBones.push(B[s + n]);
    // finger poses (pose clips, finger tracks only)
    this.mixer = new THREE.AnimationMixer(model);
    this.poses = {};    // pose name -> {L, R} finger-only actions (per hand, so the support hand can open while the gun hand grips)
    const FING = /Hand(Thumb|Index|Middle|Ring|Pinky)\d/;
    for (const c of fpClips || Assets.getAnimations(url)) {
      if (!/^pose_/.test(c.name)) continue;
      const mk = (side) => {
        const tr = c.tracks.filter((t) => { const b = t.name.split('.')[0]; return FING.test(b) && b.startsWith(side); });
        if (!tr.length) return null;
        const a = this.mixer.clipAction(new THREE.AnimationClip(c.name + '_' + side, c.duration, tr)); a.play(); a.setEffectiveWeight(0); return a;
      };
      this.poses[c.name] = { L: mk('Left'), R: mk('Right') };
    }
    this._poseKey = null;
  }

  /** Finger poses: the weapon's grip pose on both hands; the support hand opens (pose_open) while it reaches for mags, handles... */
  _setPoses(T, openL) {
    const P = this.poses; if (!P) return;
    const pose = P[T.pose] ? T.pose : P[T.poseAlt] ? T.poseAlt : 'pose_rifle';
    const open = P.pose_open ? openL : 0;
    const key = pose + '|' + open.toFixed(2);
    if (key === this._poseKey) return;
    this._poseKey = key;
    for (const [n, h] of Object.entries(P)) {
      if (h.R) h.R.setEffectiveWeight(n === pose ? 1 : 0);
      if (h.L) h.L.setEffectiveWeight(n === pose ? 1 - open : n === 'pose_open' ? open : 0);
    }
  }

  /** Swap in the dedicated first-person arms asset once it has loaded (no-op when the file does not exist). */
  _tryFpArms() { fpArmsLoad().then((g) => { if (g && !this.disposed) this._fpFrom(g); }).catch(() => {}); }
  _fpFrom(g) {
    const m = SkeletonUtils.clone(g.scene);
    const need = ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'socket_hand_R', 'socket_hand_L'];
    if (need.some((n) => !m.getObjectByName(n))) { console.warn('fp_arms.glb: missing bones/sockets, keeping the cut arms'); ownClonedSkeletons(m); disposeOwnedSkeletons(m); return false; }
    this._buildArms(m, g.animations);
    return true;
  }

  /** Viewmodel copy of a weapon (patched materials, own mechanics). */
  _gunFor(id, opticId = 'standard', levels = {}, attachments = [], key = weaponVisualKey(id, opticId, levels, attachments)) {
    // A deck-mounted gun has moving world sockets and must never be copied into
    // the projected hand-held rig, including loadout prewarming on camera attach.
    if (id === 'minigun') return null;
    opticId = sanitizeOpticId(id, opticId);

    let g = this.guns.get(key);
    if (g) return g;
    const w = new WeaponView(id, { opticId, levels, attachments });
    ownClonedSkeletons(w.model);
    w.lenses = [];
    w.root.traverse((o) => {
      if (!o.isMesh) return;
      if (o === w.optic?.reticle) { o.castShadow = false; o.receiveShadow = false; return; }
      const lens = /glass|lens/.test(o.material.name || '');
      o.material = lens ? vmLensMaterial(o.material) : vmMaterial(o.material);
      if (lens) { w.lenses.push(o); o.renderOrder = 5; }
      o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false;
    });
    configureReflexProjection(w.optic, VMU.vmProj, BAND);
    w.root.visible = false; this.root.add(w.root);
    // static socket transforms in weapon-root space
    // The first prebuilt loadout can attach to an already moving camera. Refresh
    // ancestors before capturing the inverse used by every authored socket.
    w.root.updateWorldMatrix(true, true); _m.copy(w.root.matrixWorld).invert();
    w.loc = {};
    for (const [n, s] of Object.entries(w.sockets)) { s.updateWorldMatrix(true, false); const mm = new THREE.Matrix4().multiplyMatrices(_m, s.matrixWorld); w.loc[n] = { p: new THREE.Vector3().setFromMatrixPosition(mm), q: new THREE.Quaternion().setFromRotationMatrix(mm) }; }
    w.tune = w.optic ? { ...TUNE[id], adsSight: w.loc.optic_sight.p.toArray(), adsRot: [0, 0, 0],
      relief: w.optic.mount.relief, fov: [TUNE[id].fov[0], w.optic.mount.adsFov ?? 52], reticle: null } : w.factorySight ?
      { ...TUNE[id], ...w.factorySight.tune, adsSight: w.loc.factory_sight.p.toArray(),
        fov: [TUNE[id].fov[0], w.factorySight.tune.adsFov], reticle: null } : TUNE[id];
    // Parts hidden while aiming: the shoulder stock passes through the eye at
    // iron-sight eye relief. Include static body children and express weapon-root
    // cut boxes in each mesh's geometry space; moving mechanics keep their parts.
    const cut = TUNE[id] && TUNE[id].adsCut;
    w.adsCut = [];
    if (cut) {
      const toMesh = new THREE.Matrix4(), bounds = new THREE.Box3();
      w.root.traverse((o) => {
        if (!canCutViewmodelMesh(o)) return;
        for (let p = o; p && p !== w.model; p = p.parent) {
          if (/^(slide|bolt|pump|mag|trigger|hammer|cylinder|crane|charging_handle|feed_cover|belt|rocket|bolt_handle)$/.test(p.name)) return;
        }
        toMesh.copy(o.matrixWorld).invert().multiply(w.root.matrixWorld);
        const boxes = cut.map((b) => {
          bounds.min.set(b[0], b[1], b[2]); bounds.max.set(b[3], b[4], b[5]); bounds.applyMatrix4(toMesh);
          return [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z];
        });
        const s = splitIslands(o, boxes); if (s) w.adsCut.push({ mesh: o, ...s, on: false });
      });
    }
    // Compose the optical bore with the existing eye/stock cutaway. Geometry is
    // immutable and cached; hip fire, reload and external models keep the full asset.
    for (const entry of w.adsCut) entry.mesh.geometry = entry.keep;
    try {
      for (const entry of w.prepareSightBores(w.optic || w.factorySight ? [] : undefined)) {
        const existing = w.adsCut.find(c => c.mesh === entry.mesh);
        if (existing) existing.keep = entry.keep;
        else w.adsCut.push(entry);
      }
    } finally { for (const entry of w.adsCut) entry.mesh.geometry = entry.full; }
    this.guns.set(key, w);
    return w;
  }

  /** Warm-up object: every viewmodel program (arms, gun atlas + glass, flash, reticle) at y = -5000 for Game.prewarm. */
  static warmObject(registerCleanup, retainMaterials) {
    const vm = new ViewModel();
    registerCleanup?.(() => {
      // Disposing the last warm material would release its compiled programs.
      // Transfer only these exact allocations to Game's bounded boot owner.
      if (retainMaterials) { for (const material of vm._ownedMaterials) retainMaterials.add(material); vm._ownedMaterials.clear(); }
      vm.dispose(retainMaterials); disposeOwnedSkeletonsIn(vm.root);
    });
    for (const id of Object.keys(TUNE)) { const g = vm._gunFor(id); g.root.visible = true; }
    // Temporary boot exemplars upload all mounted geometry variants. Run VMs
    // still construct only their selected three weapon/optic pairs.
    for (const id of REFLEX_GUNS) {
      const reflex = vm._gunFor(id, 'wide_reflex'); reflex.root.visible = true;
      if (reflex.optic) reflex.optic.reticle.visible = true;
    }
    for (const id of ['rifle', 'sniper']) {
      const scoped = vm._gunFor(id, 'combat_3x'); scoped.root.visible = true;
      if (scoped.optic) scoped.optic.reticle.visible = true;
    }
    // Two boot exemplars cover the bare PBR laser/polymer/rubber/metal material
    // programs. Do not prewarm the Cartesian set of every paid loadout.
    const modified = vm._gunFor('smg', 'standard', { dmg: 3, mag: 3, rel: 3, hnd: 3 }, ['extended_mag', 'laser', 'foregrip', 'stock']);
    modified.root.visible = true;
    for (const f of [vm.flashStar, vm.flashCone, vm.reticle]) { f.visible = true; vm.root.add(f); }
    vm.shell.visible = true; vm.root.add(vm.shell);
    // the thrown grenade / fired rocket meshes (WorldView: plain MeshStandardMaterial, default shadow flags) share this program
    const grenade = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0x33402a, roughness: 0.6 }));
    vm._ownedGeometries.add(grenade.geometry); vm._ownedMaterials.add(grenade.material); vm.root.add(grenade);
    vm.root.add(DriverArmsWarm ? DriverArmsWarm() : new THREE.Group());   // the cockpit driver's leather-sleeve arms program
    vm.root.visible = true; vm.root.position.set(0, -5000, 0);
    return vm.root;
  }

  setVisible(v) { this.visible = v; this.root.visible = v; }
  dispose(retainMaterials = null) {
    if (this.disposed) return; this.disposed = true;
    this.root.removeFromParent(); this.mixer?.stopAllAction();
    disposeOwnedSkeletons(this.model);
    for (const gun of this.guns.values()) { disposeOwnedSkeletons(gun.model); gun.dispose(retainMaterials); }
    for (const geometry of this._ownedGeometries) geometry.dispose();
    for (const material of this._ownedMaterials) material.dispose();
    this._ownedGeometries.clear(); this._ownedMaterials.clear();
  }

  /**
   * s: CrewView state (aimYaw, quat, vel, local{camera, gunner, adsK, eye, scoped, crouch, ...}); show: draw this frame.
   */
  update(dt, s, show) {
    const L = s.local, cam = L.camera, G = L.gunner;
    if (!cam || !G) return;
    if (G.weaponId === 'minigun') { this.setVisible(false); return; }
    if (this.root.parent !== cam) { cam.add(this.root); for (const id of G.slots) this._gunFor(id, G.optics?.[id], G.levels?.[id], G.attachments?.[id], G.visualKeys?.[id]); }   // build only the equipped loadout up front (no hitch on swap)
    this.setVisible(show); this.scopedNow = !!L.scoped;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const id = G.weaponId, W = G.weapon;
    // ---------------------------------------------------------------- weapon swap (lower old, raise new)
    if (this.id === null) { this.id = id; this.prevId = id; }
    if (id !== this.id) { this.prevId = this.id; this.id = id; }
    const sw = G.swapT > 0 ? G.swapT / 0.42 : 0;                     // 1 -> 0
    const showId = sw > 0.5 && this.prevId ? this.prevId : id;
    const opticId = sanitizeOpticId(showId, G.optics?.[showId] || (showId === id ? W.opticId : 'standard'));
    const showKey = G.visualKeys?.[showId] || weaponVisualKey(showId, opticId, G.levels?.[showId], G.attachments?.[showId]);
    const lower = sw > 0.5 ? (1 - sw) * 2 : sw * 2;                  // 0..1..0
    if (showKey !== this.shownKey) {
      if (this.gun) this.gun.root.visible = false;
      this.gun = this._gunFor(showId, opticId, G.levels?.[showId], G.attachments?.[showId], showKey); this.shownId = showId; this.shownKey = showKey; this.T = this.gun.tune || TUNE.rifle;
      for (const f of [this.flashStar, this.flashCone, this.flashStar2]) this.gun.sockets.muzzle ? this.gun.sockets.muzzle.add(f) : null;
      if (this.T.reticle && this.gun.sockets.sight) this.gun.sockets.sight.add(this.reticle); else this.reticle.removeFromParent();
      this.reticle.position.set(0, 0, this.T.reticle || 0.1);
    }
    const gun = this.gun, T = this.T, cur = showId === id;
    const dbg = window.__vmDbg;
    gun.root.visible = !(dbg && dbg.noGun);
    if (this.arms) this.arms.visible = !(dbg && dbg.noArms);
    // ---------------------------------------------------------------- inputs: look rate, eye acceleration, bed walking
    cam.updateMatrixWorld();
    if (this.hasPrev) {
      _q.copy(this.prevQ).invert().multiply(cam.quaternion);          // rotation since last frame, camera space
      _e.setFromQuaternion(_q, 'YXZ');
      const k = 1 / Math.max(dt, 1e-3);
      this.angV.set(clamp(_e.x * k, -12, 12), clamp(_e.y * k, -12, 12), clamp(_e.z * k, -12, 12));
    }
    this.prevQ.copy(cam.quaternion); this.hasPrev = true;
    if (L.eye) {
      if (this.hasEye > 0) { _v.copy(L.eye).sub(this.prevEye).multiplyScalar(1 / Math.max(dt, 1e-3)); if (this.hasEye > 1) { _v2.copy(_v).sub(this.prevEyeV).multiplyScalar(1 / Math.max(dt, 1e-3)); _v2.applyQuaternion(_q.copy(cam.quaternion).invert()); _v2.clampLength(0, 25); this.eyeA.lerp(_v2, 1 - Math.exp(-dt * 14)); } this.prevEyeV.copy(_v); }
      this.prevEye.copy(L.eye); this.hasEye = Math.min(2, this.hasEye + 1);
    }
    const speed = s.vel ? Math.hypot(s.vel.x, s.vel.z) : 0, spd01 = clamp(speed / 55, 0, 1);
    // ---------------------------------------------------------------- ADS
    const ads = sstep(0, 1, clamp(L.adsK || 0, 0, 1)) * (cur ? 1 : 0);
    this.adsBlend = ads;
    const adsE = ads;
    // ---------------------------------------------------------------- recoil impulses
    if (this.lastShots < 0) this.lastShots = G.shots;
    if (G.shots !== this.lastShots) {
      const n = Math.min(3, G.shots - this.lastShots); this.lastShots = G.shots;
      for (let i = 0; i < n; i++) this._kick(T, ads, W);
    }
    // ---------------------------------------------------------------- springs
    const av = this.angV, sa = 1 - ads * 0.82;
    const swayT = this._swT || (this._swT = new Float32Array(5));
    swayT[0] = clamp(av.y * 0.0045, -0.03, 0.03) * sa; swayT[1] = clamp(-av.x * 0.0045, -0.03, 0.03) * sa; swayT[2] = clamp(-av.x * 0.028, -0.07, 0.07) * sa; swayT[3] = clamp(-av.y * 0.028, -0.07, 0.07) * sa; swayT[4] = clamp(av.y * 0.035, -0.1, 0.1) * sa;
    this.swayS.step(dt, swayT);
    const a = this.eyeA, ia = 0.0011 * (1 - ads * 0.6);
    const inT = this._inT || (this._inT = new Float32Array(4));
    inT[0] = clamp(-a.x * ia, -0.02, 0.02); inT[1] = clamp(-a.y * ia, -0.025, 0.025); inT[2] = clamp(-a.z * ia * 0.6, -0.02, 0.02); inT[3] = clamp(-a.y * 0.0009, -0.03, 0.03) * (1 - ads * 0.6);
    this.inert.step(dt, inT);
    this.recP.step(dt, null); this.recR.step(dt, null); this.jolt.step(dt, null);
    // bed walking
    _v.set(G.pos.x, 0, G.pos.z); const walk = _v.distanceTo(this.prevBed) / Math.max(dt, 1e-3); this.prevBed.copy(_v);
    this.walkAmt = damp(this.walkAmt || 0, clamp(walk / 1.6, 0, 1), 8, dt); this.walkPh += dt * 9 * (0.4 + this.walkAmt);
    // crouch dip
    const cr = G.crouch || 0; const dc = cr - this.crouchPrev; this.crouchPrev = cr; if (Math.abs(dc) > 1e-4) this.jolt.v[0] -= dc * 0.35;
    // ---------------------------------------------------------------- base pose: hip -> ADS
    const hip = T.hip, hr = T.hipRot;
    const pHip = _v.set(hip[0], hip[1], hip[2]);
    const qHip = _q.setFromEuler(_e.set(hr[0] * DEG, hr[1] * DEG, hr[2] * DEG, 'YXZ')).multiply(Q_FLIP);
    const sl = T.adsSight ? _v3.fromArray(T.adsSight) : gun.loc.sight ? gun.loc.sight.p : _v3.set(0, 0.1, -0.1);
    const qAds = _q3.copy(Q_FLIP);
    if (T.adsRot) qAds.premultiply(_q2.setFromEuler(_e.set(T.adsRot[0] * DEG, T.adsRot[1] * DEG, T.adsRot[2] * DEG, 'YXZ')));
    const pAds = _v2.set(0, 0, -T.relief).sub(_t.copy(sl).applyQuaternion(qAds));
    this.pos.lerpVectors(pHip, pAds, adsE);
    this.quat.slerpQuaternions(qHip, qAds, adsE);
    // ADS travel arc: dip + roll mid-transition
    const mid = Math.sin(Math.PI * clamp(L.adsK || 0, 0, 1)) * (cur ? 1 : 0);
    let px = 0, py = -mid * 0.012, pz = 0, rx = 0, ry = 0, rz = -mid * 5 * DEG;
    // idle breathing + road buzz + walking
    const br = 1 - ads * 0.75;
    py += Math.sin(this.t * 1.5) * 0.0022 * br; rx += Math.sin(this.t * 1.5 - 0.7) * 0.004 * br; px += Math.sin(this.t * 0.75) * 0.0012 * br;
    const bz = spd01 * spd01 * (1 - ads * 0.7);
    py += (Math.sin(this.t * 71) * 0.5 + Math.sin(this.t * 47.3 + 1) * 0.35 + Math.sin(this.t * 113.7) * 0.25) * 0.0009 * bz;
    rz += Math.sin(this.t * 53.1 + 2) * 0.0015 * bz;
    const wk = this.walkAmt * (1 - ads * 0.7);
    px += Math.sin(this.walkPh) * 0.008 * wk; py += -Math.abs(Math.cos(this.walkPh)) * 0.009 * wk; rz += Math.sin(this.walkPh) * 0.02 * wk;
    // sway + inertia + recoil + jolts
    const S = this.swayS.x, I = this.inert.x, RP = this.recP.x, RR = this.recR.x, J = this.jolt.x;
    px += S[0] + I[0] + RP[0]; py += S[1] + I[1] + RP[1] + J[0]; pz += I[2] + RP[2];
    rx += S[2] + I[3] + RR[0] + J[1]; ry += S[3] + RR[1]; rz += S[4] + RR[2];
    // swap: drop the gun below the screen and roll it away
    if (lower > 0) { const e = lower * lower * (3 - 2 * lower); py -= e * 0.28; pz += e * 0.06; rx -= e * 0.6; rz -= e * 0.35; }
    // grenade throw: gun ducks down-right while the left hand throws
    const thr = G.throwing > 0 ? 1 - G.throwing / 0.62 : 0;
    if (thr > 0) { const e = sstep(0, 0.12, thr) * (1 - sstep(0.45, 0.85, thr)); py -= e * 0.2; px += e * 0.06; rx -= e * 0.55; rz -= e * 0.45; }
    // reload choreography (gun offsets + parts + left/right hand anchors)
    const R = this._reload(dt, G, W, T, cur);
    px += R.p[0]; py += R.p[1]; pz += R.p[2]; rx += R.r[0] * DEG; ry += R.r[1] * DEG; rz += R.r[2] * DEG;
    // bolt / pump action after a shot
    const act = this._action(G, W, T);
    rx += act.rx; rz += act.rz; py += act.py;
    // compose: offsets in camera space around the grip
    this.pos.x += px; this.pos.y += py; this.pos.z += pz;
    _q2.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
    this.quat.premultiply(_q2);
    gun.root.position.copy(this.pos); gun.root.quaternion.copy(this.quat);
    gun.root.updateMatrixWorld(true);
    // parts
    const parts = R.parts; if (act.pump !== undefined) parts.pump = act.pump; if (act.bolt !== undefined) parts.bolt = act.bolt;
    parts.rocketVisible = parts.rocketVisible !== false && !(W.mode === 'launcher' && G.magNow <= 0 && !G.reloading);
    if (showId !== id) { parts.rocketVisible = true; }
    const gs = this._gs || (this._gs = { trigger: false, parts: null });
    gs.trigger = G.trigger && G.magNow > 0 && cur; gs.parts = parts;
    gun.update(dt, gs);
    // mag carried away to / brought back from the "pocket"; rocket brought up from below
    if (parts.magOff > 0 && gun.nodes.mag) gun.nodes.mag.position.lerp(_v.fromArray(ANCH.pocket.off), parts.magOff * 0.85);
    gun.root.updateMatrixWorld(true);
    // ---------------------------------------------------------------- viewmodel projection
    const fov = T.fov[0] + (T.fov[1] - T.fov[0]) * adsE;
    this.fov = fov;
    const top = VM_NEAR * Math.tan(fov * DEG / 2), right = top * cam.aspect;
    VMU.vmProj.value.makePerspective(-right, right, top, -top, VM_NEAR, VM_FAR);
    this.k = Math.tan(cam.fov * DEG / 2) / Math.tan(fov * DEG / 2);
    // ---------------------------------------------------------------- arms
    if (this.rigged) this._arms(dt, gun, T, R, act, ads, thr);
    // ---------------------------------------------------------------- muzzle flash + reticle
    this._flash(dt, W, ads);
    for (const l of gun.lenses) l.material.opacity = l === gun.optic?.glass ? .035 * (1 - .45 * ads) : 0.14 * (1 - 0.75 * ads);
    for (const c of gun.adsCut) { const on = ads > 0.55; if (on !== c.on) { c.on = on; c.mesh.geometry = on ? c.keep : c.full; } }
    this.reticle.visible = !!T.reticle && cur && show && ads > 0.35;
    this.reticle.material.uniforms.uI.value = sstep(0.35, 0.9, ads);
    this.reticle.material.uniforms.uSize.value = 0.0065;
    if (gun.optic) {
      gun.optic.reticle.visible = cur && show && ads > .35;
      gun.optic.reticle.material.uniforms.uI.value = sstep(.35, .9, ads);
    }
    // apparent muzzle / eject (camera space) for world FX
    if (gun.loc.muzzle) this.muzzleCam.copy(gun.loc.muzzle.p).applyQuaternion(this.quat).add(this.pos);
    if (gun.loc.eject) { this.ejectCam.copy(gun.loc.eject.p).applyQuaternion(this.quat).add(this.pos); this.ejectDirCam.set(1, 0, 0).applyQuaternion(gun.loc.eject.q).applyQuaternion(this.quat); }
    this.cam = cam; this.eye = L.eye;
    G.fp = true; G.vmShown = show;              // fp: first-person rig active (also while scoped); vmShown: arms + gun drawn
    // debug orbit: look at the rig from another angle (view.rot deg around view.c, pushed view.d in front of the camera)
    if (dbg && dbg.view) {
      const V = dbg.view, c = _v.fromArray(V.c || [0.05, -0.15, -0.3]);
      this.root.quaternion.setFromEuler(_e.set((V.rot[0] || 0) * DEG, (V.rot[1] || 0) * DEG, 0, 'YXZ'));
      this.root.position.copy(c).applyQuaternion(this.root.quaternion).negate().add(_v2.set(0, 0, -(V.d || 0.9)));
    } else { this.root.position.set(0, 0, 0); this.root.quaternion.identity(); }
  }

  _kick(T, ads, W) {
    const r = T.rec, m = W.recoilMul ?? 1, ap = 1 - ads * 0.6, ar = 1 - ads * 0.72;
    const rnd = () => Math.random() * 2 - 1;
    this.recP.kick(2, r[0] * ap * m * (0.9 + Math.random() * 0.2));
    this.recP.kick(1, r[0] * 0.18 * ap * m);
    this.recP.kick(0, rnd() * r[0] * 0.12 * ap);
    this.recR.kick(0, r[1] * DEG * ar * m * (0.85 + Math.random() * 0.3));
    this.recR.kick(1, rnd() * r[2] * DEG * ar * m);
    this.recR.kick(2, rnd() * r[3] * DEG * ar * m);
    this.flashT = 0; this.flashLen = W.mode === 'auto' ? 0.045 : W.id === 'shotgun' || W.id === 'sniper' ? 0.075 : 0.06;
    this.flashRot = Math.random() * Math.PI * 2; this.flashPick = Math.random();
    if (this.gun && W.mode !== 'bolt' && W.mode !== 'pump') this.gun.fire(W.rate || W.rpm / 60);
  }

  /** A deferred shot changes flash/mechanical timers now, and springs on the next pose update. */
  notifyShot(G) {
    if (this.disposed || !this.gun || this.shownId !== G.weaponId || this.lastShots < 0 || G.shots <= this.lastShots) return;
    const n = Math.min(3, G.shots - this.lastShots); this.lastShots = G.shots;
    for (let i = 0; i < n; i++) this._kick(this.T, this.adsBlend || 0, G.weapon);
    this._flash(0, G.weapon, this.adsBlend || 0);
  }

  /** Pump (shotgun) / bolt (sniper) cycling after a shot: returns gun offsets + part params. */
  _action(G, W, T) {
    const o = this._act || (this._act = { rx: 0, rz: 0, py: 0 }); o.rx = o.rz = o.py = 0; o.pump = o.bolt = o.boltHand = undefined;
    if (W.mode === 'pump' && G.pumpT > 0 && W.pumpTime) {
      const k = 1 - G.pumpT / W.pumpTime;                 // 0 -> 1
      const pump = sstep(0.12, 0.45, k) * (1 - sstep(0.55, 0.9, k));
      o.pump = pump; o.rx = pump * 3 * DEG; o.py = -pump * 0.008; o.rz = pump * 2 * DEG;
      if (!this.pumping) { this.pumping = true; this.gun.fire(8); }
    } else this.pumping = false;
    if (W.mode === 'bolt' && G.boltT > 0 && W.boltTime) {
      const k = 1 - G.boltT / W.boltTime;
      o.bolt = k < 0.12 ? 0 : k < 0.3 ? (k - 0.12) / 0.18 : k < 0.45 ? 1 + (k - 0.3) / 0.15 : k < 0.62 ? 2 + (k - 0.45) / 0.17 : k < 0.8 ? 3 + (k - 0.62) / 0.18 : 4;
      if (o.bolt >= 4) o.bolt = 0;
      const e = sstep(0, 0.15, k) * (1 - sstep(0.8, 1, k));
      o.rz = -e * 10 * DEG; o.rx = e * 4 * DEG; o.py = -e * 0.02; o.boltHand = e;
    }
    return o;
  }

  /** Reload choreography. Returns {p:[x,y,z], r:[deg], parts, lh:{a, b, w}} (left-hand anchor blend). */
  _reload(dt, G, W, T, cur) {
    const R = this._R || (this._R = { p: [0, 0, 0], r: [0, 0, 0], parts: {}, lh: { a: 'grip', b: 'grip', w: 0, arc: 0 }, rh: null });
    R.p[0] = R.p[1] = R.p[2] = 0; R.r[0] = R.r[1] = R.r[2] = 0; const P = R.parts;
    P.mag = P.magVisible = P.magOff = P.rack = P.cover = P.crane = P.rocket = P.rocketVisible = P.rocketOff = P.pump = P.bolt = P.shell = undefined;
    R.lh.a = 'grip'; R.lh.b = 'grip'; R.lh.w = 0; R.lh.arc = 0; R.rh = null; R.rhA = 'bolt'; R.rocketHand = false; R.hideMag = false; R.showShell = false;
    const kind = T.reload, rel = cur && G.reloading;
    if (this._reloadId !== this.shownId) {
      this._reloadId = this.shownId; this.reloadPrev = false; this._relOn = false;
      this.pumpAfter = 0; this._shotExitT = undefined; this._shotTilt = 0; this._shR = undefined; this.relAmt = 0;
    }
    // shotgun: a pump when the reload finishes (chambers a round)
    if (kind === 'shotgun') {
      if (this.reloadPrev && !rel && cur) {
        this.pumpAfter = 0.45; this._shotExitT = 0;
        // Preserve the last contact in weapon space, including a partly
        // inserted shell, so finishing or cancelling does not teleport a hand.
        const a = this._shotExitAnchor || (this._shotExitAnchor = { p: new THREE.Vector3(), q: new THREE.Quaternion() });
        if (this._aL && this.gun) {
          _q3.copy(this.gun.root.quaternion).invert();
          a.p.copy(this._aL.p).sub(this.gun.root.position).applyQuaternion(_q3);
          a.q.copy(_q3).multiply(this._aL.q);
        } else {
          const grip = this.gun?.loc.grip_L || this.gun?.loc.grip_R;
          if (grip) { a.p.copy(grip.p); a.q.copy(grip.q); }
        }
      }
      this.reloadPrev = rel;
      if (this.pumpAfter > 0) { this.pumpAfter -= dt; const k = 1 - this.pumpAfter / 0.45; P.pump = sstep(0.05, 0.4, k) * (1 - sstep(0.5, 0.95, k)); R.r[0] += P.pump * 3; }
    } else { this.reloadPrev = rel; this._shotExitT = undefined; this._shotTilt = 0; }
    if (!rel) {
      this.relAmt = damp(this.relAmt || 0, 0, 10, dt); this._relOn = false;
      if (kind === 'shotgun' && cur && this._shotExitT !== undefined) {
        this._shotExitT += dt;
        const out = sstep(0, 0.24, this._shotExitT), tilt = (this._shotTilt || 0) * (1 - out);
        R.r[2] = -tilt * 34; R.r[0] += tilt * 12; R.r[1] = -tilt * 6;
        R.p[0] = -tilt * 0.07; R.p[1] = tilt * 0.08; R.p[2] = tilt * 0.02;
        R.lh.a = 'shotExit'; R.lh.b = 'grip'; R.lh.w = out;
        if (out >= 1) this._shotExitT = undefined;
      }
      return R;
    }
    const r = clamp(G.reloadT / Math.max(0.05, W.reload), 0, 1);
    _RR = r;
    // reload start: remember whether the gun ran dry (pistol slide lock) and re-arm the contact jolts
    if (!this._relOn || r < (this._relR ?? 0) - 0.2) {
      if (!this._relOn && kind === 'shotgun') { this._shotFirstShell = true; this._shotExitT = undefined; this._shR = undefined; }
      this._relOn = true; this._fired.clear(); this._dry = G.magNow <= 0;
    }
    this._relR = r;
    const lh = R.lh;
    // snappy timing: fast moves (6-8 % of the reload each) with contact jolts, the gun comes back to ready before the reload ends
    const tin = backOut(seg(0.0, 0.07)), tout = seg(0.86, 0.95);
    const tilt = tin * (1 - tout);
    switch (kind) {
      case 'mag': {                      // rifle / smg / sniper
        R.r[0] = tilt * 16; R.r[1] = -tilt * 10; R.r[2] = -tilt * 30; R.p[0] = -tilt * 0.08; R.p[1] = tilt * 0.10; R.p[2] = tilt * 0.03;
        // mag: release + yank 0.08-0.15, away 0.15-0.23 (hidden 0.22-0.31), new one up 0.31-0.42, seat 0.44-0.48, tap 0.5
        const out = seg(0.08, 0.15), away = seg(0.15, 0.23), back = 1 - seg(0.31, 0.42), ins = seg(0.44, 0.48);
        P.mag = r < 0.27 ? out * 1.25 : 1.25 * (1 - ins) * (r < 0.42 ? 1 : 0.35 + 0.65 * (1 - seg(0.42, 0.44)));
        P.magOff = r < 0.27 ? away : back;
        P.magVisible = !(r > 0.22 && r < 0.31);
        tween(lh, 0.02, 0.08, 'grip', 'mag'); if (r > 0.08) { lh.a = 'mag'; lh.b = 'mag'; lh.w = 0; }
        this._contact(r, 0.08, 0.008); this._contact(r, 0.46, 0.016); this._contact(r, 0.5, 0.006);
        if (T.bolt) {                   // sniper: work the bolt with the right hand after the new mag
          if (r > 0.5) tween(lh, 0.5, 0.6, 'mag', 'grip');
          const b = seg(0.56, 0.61) + seg(0.61, 0.66) + seg(0.66, 0.71) + seg(0.71, 0.76);
          P.bolt = b >= 4 ? 0 : b; R.rh = r > 0.52 && r < 0.84 ? sstep(0.52, 0.56, r) * (1 - sstep(0.78, 0.84, r)) : 0;
          this._contact(r, 0.66, 0.01);
        } else if (T.rackR) {           // AK-style handle on the right: the gun hand racks it, the support hand is back on the guard
          if (r > 0.5) tween(lh, 0.5, 0.58, 'mag', 'grip', 0.03);
          R.rh = sstep(0.54, 0.6, r) * (1 - sstep(0.72, 0.78, r)); R.rhA = 'chargeR';
          P.rack = sstep(0.62, 0.67, r) * (1 - sstep(0.68, 0.7, r));
          this._contact(r, 0.69, 0.014);
        } else {
          if (r > 0.5) tween(lh, 0.52, 0.6, 'mag', 'charge', 0.05);
          P.rack = sstep(0.62, 0.67, r) * (1 - sstep(0.68, 0.7, r));
          this._contact(r, 0.69, 0.014);
          if (r > 0.7) tween(lh, 0.71, 0.8, 'charge', 'grip', 0.03);
        }
        break;
      }
      case 'pistol': {                   // thumb the release (mag drops), fresh mag from the belt, slap, slide release
        R.r[0] = tilt * 22; R.r[1] = -tilt * 8; R.r[2] = -tilt * 26; R.p[0] = -tilt * 0.07; R.p[1] = tilt * 0.08; R.p[2] = tilt * 0.1;
        const drop = seg(0.06, 0.2); P.mag = r < 0.3 ? drop * drop * 3.2 : 1.3 * (1 - seg(0.44, 0.52));
        P.magOff = r < 0.3 ? 0 : 1 - seg(0.3, 0.44); P.magVisible = !(r > 0.2 && r < 0.32);
        tween(lh, 0.04, 0.18, 'grip', 'pocket', 0.02);
        if (r > 0.28) { lh.a = 'pocket'; lh.b = 'pistolMag'; lh.w = seg(0.3, 0.44); lh.arc = 0.04; }
        if (r > 0.5) tween(lh, 0.54, 0.64, 'pistolMag', 'grip', 0.03);
        this._contact(r, 0.5, 0.014);
        // slide: locked back while dry, slams home on the release (thumb) at 0.66
        const locked = this._dry ? 1 - sstep(0.66, 0.69, r) : 0; P.rack = locked;
        if (this._dry) this._contact(r, 0.68, 0.016);
        break;
      }
      case 'lmg': {                      // cover up, box out, box in, belt on the tray, cover slam, charge
        const LP = T.relPose || [-0.06, 0.08, 0.03, 12, -10, -26];
        R.p[0] = tilt * LP[0]; R.p[1] = tilt * LP[1]; R.p[2] = tilt * LP[2]; R.r[0] = tilt * LP[3]; R.r[1] = tilt * LP[4]; R.r[2] = tilt * LP[5];
        P.cover = backOut(seg(0.05, 0.1)) * (1 - seg(0.64, 0.68)) * 0.42;    // cracked open (fully open it stands up in front of the eye)
        const out = seg(0.14, 0.2); P.mag = r < 0.3 ? out * 1.5 : 1.5 * (1 - seg(0.42, 0.47));
        P.magOff = r < 0.3 ? seg(0.2, 0.28) : 1 - seg(0.32, 0.42); P.magVisible = !(r > 0.27 && r < 0.33);
        tween(lh, 0.0, 0.05, 'grip', 'cover');
        if (r > 0.1) tween(lh, 0.1, 0.14, 'cover', 'mag');
        if (r > 0.48) tween(lh, 0.48, 0.53, 'mag', 'tray');
        if (r > 0.53 && r < 0.6) { const k = (r - 0.53) / 0.07; lh.arc = 0; R.p[0] += Math.sin(k * Math.PI * 3) * 0.004; }   // belt tugs
        if (r > 0.58) tween(lh, 0.58, 0.63, 'tray', 'cover');
        if (r > 0.68) tween(lh, 0.68, 0.73, 'cover', 'charge');
        P.rack = sstep(0.74, 0.77, r) * (1 - sstep(0.78, 0.8, r));
        if (r > 0.8) tween(lh, 0.8, 0.87, 'charge', 'grip');
        this._contact(r, 0.07, 0.008); this._contact(r, 0.14, 0.01); this._contact(r, 0.45, 0.018); this._contact(r, 0.66, 0.02); this._contact(r, 0.79, 0.014);
        break;
      }
      case 'shotgun': {                  // per shell: reloadT runs 0..W.reload for every shell
        const t2 = sstep(0, 0.3, (this.relAmt = damp(this.relAmt || 0, 1, 8, dt)));
        this._shotTilt = t2;
        R.r[2] = -t2 * 34; R.r[0] = t2 * 12; R.r[1] = -t2 * 6; R.p[0] = -t2 * 0.07; R.p[1] = t2 * 0.08; R.p[2] = t2 * 0.02;
        // hand: pocket (0..0.35) -> port (0.35..0.75) -> push (0.75..0.9) -> back
        lh.a = 'pocket'; lh.b = 'port'; lh.w = sstep(0.25, 0.7, r) * (1 - sstep(0.9, 1.0, r)); lh.arc = 0.03;
        if (r < (this._shR ?? 0) - 0.3) this._shotFirstShell = false;
        if (this._shotFirstShell && r < 0.25) { lh.a = 'grip'; lh.b = 'pocket'; lh.w = sstep(0, 0.25, r); lh.arc = 0.02; }
        P.shell = sstep(0.7, 0.88, r);
        if (r < (this._shR ?? 0) - 0.3) this._joltAt = null;   // next shell
        this._shR = r;
        if (r > 0.82 && r < 0.95) this._jolt(r, 0.86, 0.006);
        R.showShell = lh.w > 0.15 && r < 0.9;
        break;
      }
      case 'revolver': {
        const up = seg(0.06, 0.2) * (1 - seg(0.82, 0.95));
        R.r[0] = up * 55; R.r[2] = -up * 20; R.p[0] = -up * 0.06; R.p[1] = up * 0.06; R.p[2] = up * 0.07;
        P.crane = seg(0.04, 0.14) * (1 - seg(0.78, 0.84));
        tween(lh, 0.02, 0.1, 'grip', 'cyl');
        if (r > 0.18) tween(lh, 0.2, 0.34, 'cyl', 'pocket', 0.03);
        if (r > 0.4) tween(lh, 0.4, 0.56, 'pocket', 'cyl', 0.03);
        if (r > 0.66) tween(lh, 0.68, 0.84, 'cyl', 'grip', 0.03);
        if (r > 0.78 && r < 0.9) this._jolt(r, 0.83, 0.01);
        break;
      }
      case 'rpg': {
        // the loader tips the mouth down and back toward himself so the left hand can reach it
        const low = backOut(seg(0.0, 0.12)) * (1 - seg(0.84, 0.96));
        // Bring the mouth toward the support shoulder. Keeping the launcher
        // nearly forward puts the loading grip over 20 cm beyond arm reach.
        const RP = T.relPose || [0.03, 0.14, 0.15, -26, 46, 4];
        R.p[0] = low * RP[0]; R.p[1] = low * RP[1]; R.p[2] = low * RP[2]; R.r[0] = low * RP[3]; R.r[1] = low * RP[4]; R.r[2] = low * RP[5];
        // fresh rocket from the pack (it rides in the closed left hand), lined up at the mouth, pushed home, hand back on the grip
        P.rocket = (r < 0.5 ? 1 : 1 - seg(0.52, 0.78)) * RLOAD; P.rocketVisible = r > 0.26;
        R.rocketHand = r > 0.26 && r < 0.5;
        tween(lh, 0.04, 0.18, 'grip', 'pocket', 0.02);
        if (r > 0.26) tween(lh, 0.28, 0.48, 'pocket', 'rocketLoad', 0.05);
        if (r > 0.48) { lh.a = 'rocket'; lh.b = 'rocket'; lh.w = 0; }
        if (r > 0.8) tween(lh, 0.8, 0.9, 'rocket', 'grip', 0.03);
        this._contact(r, 0.78, 0.016);
        break;
      }
      default: break;
    }
    if (kind !== 'shotgun') this.relAmt = 1;
    return R;
  }
  /** Contact jolt: fires once per reload when r enters [at, at + 0.06]. */
  _contact(r, at, amt) { if (r >= at && r < at + 0.06 && !this._fired.has(at)) { this._fired.add(at); this.jolt.kick(0, amt); this.jolt.kick(1, amt * 3); } }
  _jolt(r, at, amt) { if (this._joltAt !== at && r >= at) { this._joltAt = at; this.jolt.kick(0, amt); this.jolt.kick(1, amt * 3); } }

  // ---------------------------------------------------------------- hand anchors (virtual grip socket in weapon space)
  _anchor(name, gun, out) {
    // out: {p: Vector3 camera space, q: Quaternion camera space}
    const W = gun, root = W.root, A = ANCH[name];
    const P = out.p, Q = out.q;
    if (name === 'shotExit' && this._shotExitAnchor) {
      P.copy(this._shotExitAnchor.p); Q.copy(this._shotExitAnchor.q);
    } else if (name === 'support') {        // pistols: the support hand wraps the gun hand (relation from the hero's two-handed pose_pistol)
      const s = W.loc.grip_R, S = this.T.support;     // [x, y, z (m, grip_R frame), rx, ry, rz (deg, XYZ)]
      P.set(S[0], S[1], S[2]).applyQuaternion(s.q).add(s.p); Q.copy(s.q).multiply(_q3.setFromEuler(_e.set(S[3] * DEG, S[4] * DEG, S[5] * DEG)));
    } else if (name === 'grip') {    // live socket (the shotgun's grip_L rides the pump)
      const s = W.sockets.grip_L || W.sockets.grip_R;
      s.getWorldPosition(P); root.worldToLocal(P);
      s.getWorldQuaternion(Q); Q.premultiply(root.getWorldQuaternion(_q3).invert());
    }
    else if (name === 'mag' || name === 'pistolMag') {
      const n = W.nodes.mag; if (n) { P.copy(n.position); if (n.parent !== W.model) { n.getWorldPosition(P); root.worldToLocal(P); } } else P.copy(W.loc.mag_well ? W.loc.mag_well.p : _v.set(0, 0, 0.1));
      // An upright SMG magazine needs a side grasp with the wrist behind it and
      // fingers facing forward. The generic opposite pitch presents the palm to
      // the eye and crosses the wrist over the gun hand during magazine handling.
      const a = name === 'mag' && this.T.magAnchor ? this.T.magAnchor : A;
      Q.setFromEuler(_e.set(a.rot[0] * DEG, a.rot[1] * DEG, a.rot[2] * DEG)); P.add(_v.fromArray(a.off));
    } else if (name === 'charge' || name === 'chargeR' || name === 'slide' || name === 'cover' || name === 'tray' || name === 'rocket' || name === 'bolt') {
      const nodeName = ANCHOR_NODE[name];
      const n = W.nodes[nodeName] || W.nodes.bolt || W.nodes.body;
      if (n) {
        n.getWorldPosition(P); root.worldToLocal(P);
        n.getWorldQuaternion(Q); Q.premultiply(root.getWorldQuaternion(_q3).invert());
      } else { P.set(0, 0.1, 0); Q.identity(); }
      // Grasp offsets are in the moving part's frame. A cover or bolt handle
      // rotates about its hinge, so both the contact and wrist must follow it.
      const a = ANCH[name] || ANCH.charge; P.add(_v.fromArray(a.off).applyQuaternion(Q));
      Q.multiply(_q3.setFromEuler(_e.set(a.rot[0] * DEG, a.rot[1] * DEG, a.rot[2] * DEG)));
    } else if (name === 'rocketLoad') {
      P.fromArray(A.off); Q.identity();
    } else if (name === 'port' || name === 'cyl') {
      const s = W.loc.mag_well; if (s) P.copy(s.p); else P.set(0, 0, 0.15);
      Q.identity();
      if (name === 'cyl' && W.nodes.crane) {
        const sk = W.sockets.mag_well;
        if (sk) { sk.getWorldPosition(P); root.worldToLocal(P); sk.getWorldQuaternion(Q); Q.premultiply(root.getWorldQuaternion(_q3).invert()); }
      }
      P.add(_v.fromArray(A.off).applyQuaternion(Q));
      Q.multiply(_q3.setFromEuler(_e.set(A.rot[0] * DEG, A.rot[1] * DEG, A.rot[2] * DEG)));
    } else {       // pocket and others: fixed point in weapon space
      P.fromArray(A.off); Q.setFromEuler(_e.set(A.rot[0] * DEG, A.rot[1] * DEG, A.rot[2] * DEG));
    }
    // weapon space -> camera space
    P.applyQuaternion(root.quaternion).add(root.position); Q.premultiply(root.quaternion);
    return out;
  }

  _arms(dt, gun, T, R, act, ads, thr) {
    const B = this.B;
    for (const b of this.armBones) b.quaternion.identity();
    const lh = R.lh;
    let openL = lh.a !== lh.b ? Math.sin(Math.PI * lh.w) * 0.9 : 0;
    openL = Math.max(openL, 0.55 * ((REACH_ANCHORS.has(lh.a) ? 1 - lh.w : 0) + (REACH_ANCHORS.has(lh.b) ? lh.w : 0)));
    if (R.rocketHand || lh.a === 'rocket') openL = 0;              // holding the rocket: fist closed round it
    if (thr > 0) openL = Math.max(openL, sstep(0.0, 0.1, thr) * (1 - sstep(0.6, 0.9, thr)));
    this._setPoses(T, openL);
    this.mixer.update(0);
    // torso: shoulders under/behind the eye, bladed; follows a bit of the gun's recoil / reload motion
    const sh = T.sh;
    this.bodyG.quaternion.setFromAxisAngle(_v.set(0, 1, 0), Math.PI + T.blade);
    _v.set(sh[0], sh[1], sh[2]);
    _v.x += (this.pos.x - T.hip[0]) * 0.25 * (1 - ads); _v.y += (this.pos.y - T.hip[1]) * 0.3; _v.z += (this.pos.z - T.hip[2]) * 0.2 + this.recP.x[2] * 0.6;
    this.bodyG.position.copy(_v).sub(_v2.copy(this.shMid).applyQuaternion(this.bodyG.quaternion));
    const dbg = window.__vmDbg;
    if (dbg && dbg.inspect) { this.bodyG.quaternion.setFromAxisAngle(_v.set(0, 1, 0), dbg.inspect.yaw || 0); this.bodyG.position.fromArray(dbg.inspect.pos || [0, -1.45, -1.1]); this.bodyG.updateMatrixWorld(true); if (dbg.inspect.noIK) return; }
    this.bodyG.updateMatrixWorld(true);
    const rootInv = _m.copy(this.root.matrixWorld);
    // right hand: grip_R (or the bolt handle during a bolt cycle)
    const aR = this._aR || (this._aR = { p: new THREE.Vector3(), q: new THREE.Quaternion() });
    const gr = gun.loc.grip_R; aR.p.copy(gr.p).applyQuaternion(gun.root.quaternion).add(gun.root.position); aR.q.copy(gun.root.quaternion).multiply(gr.q);
    if (T.rRot) aR.q.multiply(_q.setFromEuler(_e.set(T.rRot[0] * DEG, T.rRot[1] * DEG, T.rRot[2] * DEG)));
    const bw = Math.max(act.boltHand || 0, R.rh || 0);
    if (bw > 0.001) { const aB = this._aB || (this._aB = { p: new THREE.Vector3(), q: new THREE.Quaternion() }); this._anchor(R.rh ? R.rhA || 'bolt' : 'bolt', gun, aB); aR.p.lerp(aB.p, bw); aR.q.slerp(aB.q, bw); }
    this._handTo('Right', aR, rootInv);
    // left hand
    const aL = this._aL || (this._aL = { p: new THREE.Vector3(), q: new THREE.Quaternion() });
    const aT = this._aT || (this._aT = { p: new THREE.Vector3(), q: new THREE.Quaternion() });
    // The FP asset's fingers and weapon sockets are fitted together. The legacy hero
    // support transform rotates its palm over the slide and blocks the iron sights.
    if (T.support && !this.dedicatedArms) { if (R.lh.a === 'grip') R.lh.a = 'support'; if (R.lh.b === 'grip') R.lh.b = 'support'; }
    this._anchor(R.lh.a, gun, aL);
    // Cup the lower grip rather than the slide. Keep this offset on the resting
    // pistol grip only so magazine and slide-racking anchors keep their reach.
    if (this.dedicatedArms && this.id === 'pistol' && R.lh.a === 'grip') {
      aL.p.x -= 0.035; aL.p.y -= 0.085;
    }
    if (R.lh.a === 'grip' && T.lRot) aL.q.multiply(_q.setFromEuler(_e.set(T.lRot[0] * DEG, T.lRot[1] * DEG, T.lRot[2] * DEG)));
    if (R.lh.w > 0 && R.lh.b !== R.lh.a) {
      this._anchor(R.lh.b, gun, aT);
      if (this.dedicatedArms && this.id === 'pistol' && R.lh.b === 'grip') {
        aT.p.x -= 0.035; aT.p.y -= 0.085;
      }
      if (R.lh.b === 'grip' && T.lRot) aT.q.multiply(_q.setFromEuler(_e.set(T.lRot[0] * DEG, T.lRot[1] * DEG, T.lRot[2] * DEG)));
      const w = R.lh.w; aL.p.lerp(aT.p, w); aL.q.slerp(aT.q, w); aL.p.y += Math.sin(Math.PI * w) * (R.lh.arc || 0);
    }
    if (thr > 0) {         // grenade (released on the key press): the left arm follows through - flick forward-up, then drop away
      const e = sstep(0.0, 0.08, thr) * (1 - sstep(0.5, 0.8, thr)), f = sstep(0.0, 0.22, thr), dn = sstep(0.28, 0.6, thr);
      aL.p.lerp(_v.set(-0.12 + f * 0.04, -0.16 + Math.sin(f * Math.PI) * 0.12 - dn * 0.3, -0.32 - f * 0.22), e);
    }
    this._handTo('Left', aL, rootInv);
    if (R.rocketHand && gun.nodes.rocket) this._rocketInHand(gun);
    const so = this.B.socket_hand_L;
    if (so && this.shell.parent !== so) { so.add(this.shell); this.shell.position.set(0.0, 0.0, 0.035); }
    this.shell.visible = !!R.showShell;
  }

  /** The loading rocket rides in the left hand: its node follows the hand socket (motor section in the fist, nose forward). */
  _rocketInHand(gun) {
    const n = gun.nodes.rocket, so = this.B.socket_hand_L; if (!so || !n.parent) return;
    so.updateWorldMatrix(true, false);
    _mr.makeTranslation(0, 0, -ANCH.rocket.off[2]).premultiply(so.matrixWorld);
    n.parent.updateWorldMatrix(true, false);
    _mr.premultiply(_mi.copy(n.parent.matrixWorld).invert());
    _mr.decompose(n.position, n.quaternion, _sc);
    n.updateMatrixWorld(true);
  }

  /** Two-bone IK the arm so the hand's grip socket lands on the anchor (camera-space transform). */
  _handTo(side, A, rootM) {
    const S = this.side[side], H = this._hs || (this._hs = { hq: new THREE.Quaternion(), hp: new THREE.Vector3(), wp: new THREE.Vector3(), wq: new THREE.Quaternion(), rq: new THREE.Quaternion(), sh: new THREE.Vector3(), to: new THREE.Vector3(), pole: new THREE.Vector3(), lq: new THREE.Quaternion(), tw: new THREE.Quaternion(), id: new THREE.Quaternion() });
    // hand target (camera space): H = A * inv(socketLocal)
    H.hq.copy(A.q).multiply(S.sqi);
    H.hp.copy(S.sp).applyQuaternion(H.hq).negate().add(A.p);
    // to world
    H.wp.copy(H.hp).applyMatrix4(rootM);
    this.root.getWorldQuaternion(H.rq);
    H.wq.copy(H.rq).multiply(H.hq);
    // clavicle assist when out of reach
    S.u.getWorldPosition(H.sh);
    const reach = S.la + S.lb, dist = H.sh.distanceTo(H.wp);
    if (dist > reach * 0.96 && S.c) { const need = Math.min(0.09, dist - reach * 0.96); H.to.copy(H.wp).sub(H.sh).normalize().multiplyScalar(need).add(H.sh); aimBone(S.c, H.sh, H.to); }
    // pole: elbows down and out
    S.u.getWorldPosition(H.sh);
    H.pole.set(side === 'Right' ? 0.55 : -0.5, -0.9, 0.25).applyQuaternion(H.rq).add(H.sh);
    twoBoneIK(S.u, S.l, S.h, H.wp, H.pole, S.la, S.lb);
    // hand rotation (+ share the wrist twist with the forearm to avoid candy-wrapping)
    S.l.getWorldQuaternion(H.lq);
    H.lq.invert().multiply(H.wq);                                       // hand local rotation wanted
    const ax = S.twistAx, lq = H.lq, dp = lq.x * ax.x + lq.y * ax.y + lq.z * ax.z;
    H.tw.set(ax.x * dp, ax.y * dp, ax.z * dp, lq.w).normalize();
    H.tw.slerpQuaternions(H.id, H.tw, 0.5);
    S.l.quaternion.multiply(H.tw); S.l.updateMatrixWorld(true);
    S.l.getWorldQuaternion(H.lq);
    S.h.quaternion.copy(H.lq.invert().multiply(H.wq)); S.h.updateMatrixWorld(true);
  }

  _flash(dt, W, ads) {
    this.flashT += dt / Math.max(0.02, this.flashLen);
    const on = this.flashT < 1 && this.visible && W.mode !== 'launcher';
    const st = this.flashStar, co = this.flashCone, s2 = this.flashStar2;
    st.visible = co.visible = s2.visible = on;
    if (W.mode === 'launcher' && this.flashT < 1 && this.visible) { st.visible = true; }
    if (!st.visible) return;
    const k = Math.max(0, 1 - this.flashT), e = k * k;
    const big = FLASH_SIZE[W.id] || 1;
    const c = FLASH_CELLS[(this.flashPick * FLASH_CELLS.length) | 0];
    const u = st.material.uniforms; u.uCell.value.set(c[0], c[1], 0.25, 0.5); u.uSize.value = 0.13 * big * (0.9 + 0.3 * (1 - k)) * (1 - ads * 0.45); u.uRot.value = this.flashRot; u.uI.value = 7 * e * (1 - ads * 0.65);
    const u2 = s2.material.uniforms; u2.uCell.value.set(0.5, 0, 0.25, 0.5); u2.uSize.value = 0.34 * big * (1 - ads * 0.4); u2.uRot.value = -this.flashRot; u2.uI.value = 1.6 * e * (1 - ads * 0.7);
    const uc = co.material.uniforms; uc.uCell.value.set(this.flashPick > 0.5 ? 0 : 0.25, 0, 0.25, 0.5); uc.uLen.value = 0.34 * big; uc.uSize.value = 0.12 * big; uc.uI.value = 5 * e * (1 - ads * 0.5);
    st.position.set(0, 0, 0.02); s2.position.set(0, 0, 0.05); co.position.set(0, 0, -0.01);
  }

  // ---------------------------------------------------------------- world-space hooks for FX (apparent positions)
  _apparent(pc, out) {
    const cam = this.cam; if (!cam) return false;
    // The camera can move/change FOV after the VM pose update. Use its current
    // transform and projection, so a world FX origin lands on the rendered barrel.
    cam.updateWorldMatrix(true, false);
    const k = VMU.vmProj.value.elements[5] / cam.projectionMatrix.elements[5];
    out.set(pc.x * k, pc.y * k, pc.z).applyMatrix4(cam.matrixWorld);
    return true;
  }
  muzzleWorld(out) { return this._apparent(this.muzzleCam, out); }
  laserWorld(out) {
    const emitter = this.gun?.sockets.laser_emitter;
    if (!emitter || !this.cam) return false;
    emitter.getWorldPosition(_v); this.cam.worldToLocal(_v); return this._apparent(_v, out);
  }
  ejectWorld(out, dirOut) { if (dirOut && this.cam) dirOut.copy(this.ejectDirCam).applyQuaternion(this.cam.getWorldQuaternion(_q)); return this._apparent(this.ejectCam, out); }
}
