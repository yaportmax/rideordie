// Character QA viewer (superset of src/viewer.js lighting): deterministic clip times, look-at nodes, node hide/only, grids.
//  /tools/characters/qa.html?model=/models/characters/x.glb&anim=idle_stand&t=0.5&look=Head&dist=1.2&az=20&el=5&fov=30
//   times=0,0.4,0.8   grid of the SAME camera at several clip times (cols=3)
//   views=35:14,145:14,90:3,0:3,180:3   grid of several az:el at one time (with sheet=1 default set)
//   hide=armor_t2,armor_t3   only=armor_t1   (node names, comma separated; hide/only apply to nodes and their subtree)
//   look=Head|Hips|...  target = world position of that bone/node (else bbox centre); ty= override target y
//   wire=1  sun=28  sunaz=215  exp=0.9  bg=rrggbb  bones=1 (draw skeleton lines)   axes=1
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';

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

function setTime(t) { if (mixer && clip) { action.time = 0; mixer.setTime(t); } root.updateMatrixWorld(true); }
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

loader.load(modelUrl, (gltf) => {
  root = gltf.scene; scene.add(root);
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
    if (clip) { action = mixer.clipAction(clip); action.play(); }
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
