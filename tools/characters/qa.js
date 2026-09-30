// Character QA viewer (superset of src/viewer.js lighting): deterministic clip times, look-at nodes, node hide/only, grids.
//  /tools/characters/qa.html?model=/models/characters/x.glb&anim=idle_stand&t=0.5&look=Head&dist=1.2&az=20&el=5&fov=30
//   times=0,0.4,0.8   grid of the SAME camera at several clip times (cols=3)
//   views=35:14,145:14,90:3,0:3,180:3   grid of several az:el at one time (with sheet=1 default set)
//   hide=armor_t2,armor_t3   only=armor_t1   (node names, comma separated; hide/only apply to nodes and their subtree)
//   look=Head|Hips|...  target = world position of that bone/node (else bbox centre); ty= override target y
//   wire=1  sun=28  sunaz=215  exp=0.9  bg=rrggbb  bones=1 (draw skeleton lines)   axes=1
//   weapon=rifle      attach /models/weapons/<id>.glb to socket_hand_R (grip_R = socket, identity) - the runtime contract
//   wl=0.08-1.18      weapon parented to socket_hand_L (at -grip_L) inside that clip-time window (throws)
//   lik=1             + two-bone IK of the left arm onto the weapon's grip_L (what the runtime would add on top)
//   vehicle=e_technical&seat=gunner|driver   load a vehicle at the origin and put the character on that seat socket
//                     (gunner: feet on seat_gunner; driver: hip point on seat_driver, root 0.56 m below). vyaw= vehicle yaw deg
//   labels=1          print the clip time in every grid cell
//   crew=1            apply the in-game character material upgrade (src/view/crew_material.js: micro detail + skin wrap)
//   rail=0.95:0.30    draw a horizontal rail (height:z in front of the character, metres) for death_slump_rail
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { patchCrewMaterials } from '/src/view/crew_material.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = num('exp', 0.9);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sunEl = num('sun', 28), sunAz = num('sunaz', 215);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunEl), THREE.MathUtils.degToRad(sunAz));
const sky = new Sky(); sky.scale.setScalar(4500);
const u = sky.material.uniforms; u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.85;
u.sunPosition.value.copy(sunDir);
const skyScene = new THREE.Scene(); skyScene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(skyScene, 0.0).texture;
scene.environmentIntensity = 0.75;
if (q.has('bg')) scene.background = new THREE.Color('#' + q.get('bg')); else scene.background = scene.environment;

const sun = new THREE.DirectionalLight(0xffe9c8, 3.6);
sun.position.copy(sunDir).multiplyScalar(30);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 80 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 1.0, metalness: 0, envMapIntensity: 0.25 }));
ground.receiveShadow = true; scene.add(ground);
if (q.has('axes')) { scene.add(new THREE.GridHelper(4, 8, 0xff4444, 0x555555)); scene.add(new THREE.AxesHelper(1)); }

const cam = new THREE.PerspectiveCamera(num('fov', 30), innerWidth / innerHeight, 0.02, 500);
const target = new THREE.Vector3();
const info = document.getElementById('info');
let mixer = null, root = null, clip = null, action = null;

function place(az, el, dist, t, c) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  c.position.set(t.x + dist * Math.sin(a) * Math.cos(e), t.y + dist * Math.sin(e), t.z + dist * Math.cos(a) * Math.cos(e));
  c.up.set(0, 1, 0); c.lookAt(t);
}
const report = { tris: 0, materials: [], clips: [], bbox: null, bones: [] };
window.__viewer = report;
const loader = new GLTFLoader();
const modelUrl = q.get('model');
const csv = (k) => (q.get(k) ? q.get(k).split(',') : []);

function weaponHand(t) {
  if (!weaponRoot || !q.has('wl')) return;
  const [a, b] = q.get('wl').split('-').map(Number);
  const left = t >= a && t <= b;
  const s = root.getObjectByName(left ? 'socket_hand_L' : 'socket_hand_R');
  if (weaponRoot.parent !== s) s.add(weaponRoot);
  const g = weaponRoot.getObjectByName('grip_L');
  if (left && g) weaponRoot.position.copy(g.position).negate(); else weaponRoot.position.set(0, 0, 0);
  weaponRoot.quaternion.identity();
}
function setTime(t) { if (mixer && clip) { action.reset(); action.play(); mixer.setTime(Math.min(t, clip.duration - 1e-4)); } weaponHand(t); root.updateMatrixWorld(true); postPose(); root.updateMatrixWorld(true); }
function findNode(name) { let r = null; root.traverse(o => { if (o.name === name && !r) r = o; }); return r; }

function updateTarget() {
  const box = new THREE.Box3().setFromObject(root);
  const ctr = box.getCenter(new THREE.Vector3());
  target.copy(ctr);
  if (q.has('look')) { const n = findNode(q.get('look')); if (n) n.getWorldPosition(target); }
  if (q.has('ty')) target.y = num('ty', target.y);
  if (q.has('tx')) target.x = num('tx', target.x);
  if (q.has('tz')) target.z = num('tz', target.z);
  return box;
}

const _ia = new THREE.Vector3(), _ib = new THREE.Vector3(), _ic = new THREE.Vector3(), _it = new THREE.Vector3(), _ie = new THREE.Vector3(), _iu = new THREE.Vector3(), _ip = new THREE.Vector3(), _iw = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _p1 = new THREE.Vector3();
function aimBone(bone, from, to) {
  bone.getWorldPosition(_p1); _d1.copy(from).sub(_p1).normalize(); _d2.copy(to).sub(_p1).normalize();
  _q1.setFromUnitVectors(_d1, _d2); bone.getWorldQuaternion(_q2); _q2.premultiply(_q1);
  bone.parent.getWorldQuaternion(_q3).invert(); bone.quaternion.copy(_q3.multiply(_q2)); bone.updateMatrixWorld(true);
}
function twoBoneIK(upper, lower, end, target, pole, la, lb) {
  upper.getWorldPosition(_ia); _it.copy(target).sub(_ia); let d = _it.length();
  d = Math.min(Math.max(d, Math.abs(la - lb) + 1e-3), la + lb - 1e-3); _it.normalize();
  const cosA = (la * la + d * d - lb * lb) / (2 * la * d), sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  _ip.copy(pole).sub(_ia); _iu.copy(_ip).addScaledVector(_it, -_ip.dot(_it)); if (_iu.lengthSq() < 1e-8) _iu.set(0, -1, 0); _iu.normalize();
  _ie.copy(_ia).addScaledVector(_it, la * cosA).addScaledVector(_iu, la * sinA);
  lower.getWorldPosition(_ib); aimBone(upper, _ib, _ie);
  end.getWorldPosition(_ic); _iw.copy(_ia).addScaledVector(_it, d); aimBone(lower, _ic, _iw);
}
let weaponRoot = null, likArm = null;
function postPose() {
  if (!likArm || !weaponRoot) return;
  root.updateMatrixWorld(true);
  const g = weaponRoot.getObjectByName('grip_L'); if (!g) return;
  const t = g.getWorldPosition(new THREE.Vector3());
  const { u, l, h, la, lb } = likArm;
  const pole = u.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0.5, -0.6, -0.3).applyQuaternion(root.getObjectByName('Spine2').getWorldQuaternion(new THREE.Quaternion())));
  twoBoneIK(u, l, h, t, pole, la, lb);
}

if (q.has('rail')) {
  const [rh, rz] = q.get('rail').split(':').map(Number);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 12).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.8, roughness: 0.4 }));
  bar.position.set(0, rh, rz); bar.castShadow = true; scene.add(bar);
  for (const x of [-0.75, 0.75]) { const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, rh, 8), bar.material); post.position.set(x, rh / 2, rz); scene.add(post); }
}
loader.load(modelUrl, async (gltf) => {
  root = gltf.scene; scene.add(root);
  if (q.has('crew')) patchCrewMaterials(root);
  if (q.has('vehicle')) {
    const vg = await loader.loadAsync('/models/vehicles/' + q.get('vehicle') + '.glb');
    const veh = vg.scene; veh.rotation.y = THREE.MathUtils.degToRad(num('vyaw', 0)); scene.add(veh);
    veh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    veh.updateMatrixWorld(true);
    const seat = q.get('seat') || 'gunner';
    const s = veh.getObjectByName('seat_' + seat);
    if (s) { s.getWorldPosition(root.position); if (seat === 'driver') root.position.y -= 0.56; root.rotation.y = veh.rotation.y; }
  }
  if (q.has('weapon')) {
    const wg = await loader.loadAsync('/models/weapons/' + q.get('weapon') + '.glb');
    weaponRoot = wg.scene; weaponRoot.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const sock = root.getObjectByName('socket_hand_R'); if (sock) sock.add(weaponRoot);
    if (q.has('lik')) {
      const u = root.getObjectByName('LeftArm'), l = root.getObjectByName('LeftForeArm'), h = root.getObjectByName('LeftHand');
      root.updateMatrixWorld(true);
      const a = u.getWorldPosition(new THREE.Vector3()), b = l.getWorldPosition(new THREE.Vector3()), c = h.getWorldPosition(new THREE.Vector3());
      likArm = { u, l, h, la: a.distanceTo(b), lb: b.distanceTo(c) };
    }
  }
  const only = csv('only'), hide = csv('hide');
  const mats = new Set();
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      const idx = o.geometry.index; report.tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
      for (const m of [].concat(o.material)) { mats.add(m.name); if (q.has('wire')) m.wireframe = true; }
    }
    if (o.isBone) report.bones.push(o.name);
  });
  // visibility: glTF has no hidden flag; parent game hides armor_t* by name/extras -> mimic with hide/only
  root.traverse((o) => { if (o.userData && o.userData.hidden && !q.has('showhidden') && !only.includes(o.name)) o.visible = false; });
  if (only.length) root.traverse((o) => { if (o.isMesh) { let n = o, ok = false; while (n) { if (only.includes(n.name)) ok = true; n = n.parent; } o.visible = ok; } });
  for (const h of hide) root.traverse((o) => { if (o.name === h) o.visible = false; });
  report.tris = 0;
  root.traverse((o) => { if (o.isMesh) { let n = o, vis = true; while (n) { if (!n.visible) vis = false; n = n.parent; } if (vis) { const idx = o.geometry.index; report.tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3; } } });
  report.tris = Math.round(report.tris); report.materials = [...mats];
  report.clips = gltf.animations.map(a => `${a.name}:${a.duration.toFixed(2)}s`);
  if (gltf.animations.length && q.has('anim')) {
    mixer = new THREE.AnimationMixer(root);
    clip = gltf.animations.find(a => a.name === q.get('anim'));
    if (clip) { action = mixer.clipAction(clip); action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play(); }
  }
  if (q.has('bones')) {
    const sk = []; root.traverse(o => { if (o.isSkinnedMesh) sk.push(o); });
    if (sk.length) { const h = new THREE.SkeletonHelper(sk[0].skeleton.bones[0]); h.material.linewidth = 2; h.material.depthTest = false; scene.add(h); }
  }
  setTime(num('t', 0));
  const box = updateTarget();
  report.bbox = { min: box.min.toArray().map(v => +v.toFixed(3)), max: box.max.toArray().map(v => +v.toFixed(3)) };
  info.textContent = `${modelUrl}\ntris ${report.tris}\nclips ${report.clips.join(' ')}`;
  if (q.has('noinfo')) info.textContent = '';
  const H = box.max.y - box.min.y;
  const dist = num('dist', H * 2.2);
  const views = q.has('views') ? q.get('views').split(',').map(s => s.split(':').map(Number)) : (q.has('sheet') ? [[35, 14], [145, 14], [90, 3], [0, 3], [180, 3], [0, 88]] : null);
  const times = q.has('times') ? q.get('times').split(',').map(Number) : null;
  const items = [];
  if (times) for (const t of times) items.push({ t, az: num('az', 35), el: num('el', 14) });
  else if (views) for (const v of views) items.push({ t: num('t', 0), az: v[0], el: v[1] });
  else items.push({ t: num('t', 0), az: num('az', 35), el: num('el', 14) });
  const cols = num('cols', items.length <= 1 ? 1 : (items.length <= 3 ? items.length : (items.length === 4 ? 2 : 3)));
  const rows = Math.ceil(items.length / cols);
  if (q.has('labels')) items.forEach((it, i) => {
    const d = document.createElement('div'); d.textContent = it.t.toFixed(2) + 's';
    d.style.cssText = `position:fixed;color:#fff;font:bold 13px monospace;text-shadow:0 0 3px #000;left:${(i % cols) * innerWidth / cols + 6}px;top:${Math.floor(i / cols) * innerHeight / rows + 4}px`;
    document.body.appendChild(d);
  });
  window.__ready = true;
  renderer.setAnimationLoop(() => {
    const W = innerWidth, Hh = innerHeight, w = W / cols, h = Hh / rows;
    renderer.setScissorTest(items.length > 1);
    const c2 = cam.clone(); c2.aspect = w / h; c2.updateProjectionMatrix();
    items.forEach((it, i) => {
      const x = (i % cols) * w, y = Hh - (Math.floor(i / cols) + 1) * h;
      renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
      setTime(it.t);
      if (q.has('look')) { const n = findNode(q.get('look')); if (n) n.getWorldPosition(target); if (q.has('ty')) target.y = num('ty', target.y); }
      place(it.az, it.el, dist, target, c2);
      if (it.el > 80) { c2.up.set(0, 0, -1); c2.lookAt(target); }
      renderer.render(scene, c2);
    });
  });
}, undefined, (e) => { info.textContent = 'LOAD FAIL ' + e; console.error(e); window.__ready = true; });
