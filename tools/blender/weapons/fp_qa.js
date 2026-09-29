// First-person viewmodel QA: runs the game's real ViewModel (arms IK, sockets, pose clips, weapon mechanics) with a fake gunner
// state, then renders it either from the game eye (fp=1) or from a free orbit camera around a point in CAMERA space.
//   /tools/blender/weapons/fp_qa.html?gun=rifle&az=150&el=15&dist=0.35&t=0.16,-0.27,-0.34&fov=40
//   gun=<id>  fp=1 (game view)  ads=0..1  reload=0..1 (reload progress)  pump=0..1  bolt=0..1  sun=elev  sunaz=deg
//   hide=gun|arms   bg=333333 (flat background)   exp=0.9
// Sets window.__ready.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import * as Assets from '/src/core/assets.js';
import { ViewModel, VMU, FP_ARMS_URL } from '/src/view/viewmodel.js';
import { weaponStats } from '/src/data/weapons.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
const gun = q.get('gun') || 'rifle';
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 0.9);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sunEl = num('sun', 32), sunAz = num('sunaz', 200);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunEl), THREE.MathUtils.degToRad(sunAz));
const sky = new Sky(); sky.scale.setScalar(4500);
const u = sky.material.uniforms; u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.85;
u.sunPosition.value.copy(sunDir);
const skyScene = new THREE.Scene(); skyScene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(skyScene, 0.0).texture;
scene.environmentIntensity = num('env', 0.75);
scene.background = q.has('bg') ? new THREE.Color('#' + q.get('bg')) : scene.environment;
const sun = new THREE.DirectionalLight(0xffe9c8, num('sunI', 3.4));
sun.position.copy(sunDir).multiplyScalar(30); scene.add(sun);

// the "game camera" (eye at the origin, looking down -Z)
const gameCam = new THREE.PerspectiveCamera(num('gfov', 70), innerWidth / innerHeight, 0.05, 2000);
scene.add(gameCam);
const cam = new THREE.PerspectiveCamera(num('fov', 40), innerWidth / innerHeight, 0.01, 50);

const urls = [FP_ARMS_URL, '/models/characters/hero_gunner.glb', ...['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'rpg'].map((g) => `/models/weapons/${g}.glb`)];
await Assets.preload(urls);
await Assets.loadGLB(FP_ARMS_URL);
await new Promise((r) => setTimeout(r, 50));
const vm = new ViewModel(); window.__vm = vm;
await new Promise((r) => setTimeout(r, 50));

const W = weaponStats(gun);
const G = { slots: [gun], cur: 0, weaponId: gun, weapon: W, swapT: 0, shots: 0, pos: new THREE.Vector3(), crouch: 0, throwing: 0, reloading: false, reloadT: 0,
  magNow: W.mag, trigger: false, pumpT: 0, boltT: 0 };
if (q.has('reload')) { G.reloading = true; G.reloadT = num('reload', 0) * W.reload; }
if (q.has('pump') && W.pumpTime) G.pumpT = (1 - num('pump', 0)) * W.pumpTime;
if (q.has('bolt') && W.boltTime) G.boltT = (1 - num('bolt', 0)) * W.boltTime;
const s = { local: { camera: gameCam, gunner: G, adsK: num('ads', 0), eye: new THREE.Vector3() }, vel: { x: 0, z: 0 } };
window.__vmDbg = null;
try { for (let i = 0; i < 90; i++) vm.update(1 / 60, s, true); } catch (e) { console.error("vm.update", e); window.__ready = true; }   // settle springs
if (q.get('hide') === 'gun' && vm.gun) vm.gun.root.visible = false;
if (q.get('hide') === 'arms' && vm.model) vm.model.visible = false;
gameCam.updateMatrixWorld(true);

const fp = q.has('fp');
const tgt = new THREE.Vector3(...(q.get('t') || '0.16,-0.25,-0.40').split(',').map(Number));
const az = THREE.MathUtils.degToRad(num('az', 150)), el = THREE.MathUtils.degToRad(num('el', 15)), dist = num('dist', 0.45);
// orbit in camera space (az 0 = looking from the +Z side, i.e. from behind the eye toward -Z)
cam.position.set(tgt.x + dist * Math.sin(az) * Math.cos(el), tgt.y + dist * Math.sin(el), tgt.z + dist * Math.cos(az) * Math.cos(el));
cam.lookAt(tgt);
cam.updateMatrixWorld(true);
const info = document.getElementById('info');
info.textContent = `fp_qa ${gun} ${fp ? 'FP' : 'orbit'} arms=${vm.model ? vm.model.name || 'model' : 'none'}`;
function frame() {
  const c = fp ? gameCam : cam;
  if (!fp) { cam.updateProjectionMatrix(); }
  renderer.render(scene, c);
  if (!fp) VMU.vmProj.value.copy(cam.projectionMatrix);
}
// the viewmodel shaders take their projection from VMU.vmProj; the depth band hack still works for a single rig
if (!fp) VMU.vmProj.value.copy(cam.projectionMatrix);
frame(); frame();
window.__ready = true;
renderer.setAnimationLoop(() => { if (!fp) VMU.vmProj.value.copy(cam.projectionMatrix); renderer.render(scene, fp ? gameCam : cam); });
