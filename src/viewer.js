// In-engine model viewer + QA tool.  /viewer.html?model=/models/x.glb&az=35&el=12&dist=8
//   sheet=1        6-view contact sheet (3/4 front, 3/4 rear, side, front, rear, top)
//   tint=cc2200    tints materials named "paint*"      wire=1  wireframe      sun=25  sun elevation (deg)
//   anim=name      plays a clip                        spin=1  turntable      bg=1a1a1a  flat background
//   grid=1         meter grid + axes                   fov=35
// Sets window.__ready and window.__viewer = {tris, nodes, materials, bbox, clips}.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
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
scene.backgroundBlurriness = 0.0;

const sun = new THREE.DirectionalLight(0xffe9c8, 3.6);
sun.position.copy(sunDir).multiplyScalar(30);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 80 });
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.02;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 1.0, metalness: 0, envMapIntensity: 0.25 }));
ground.receiveShadow = true; scene.add(ground);
if (q.has('grid')) { scene.add(new THREE.GridHelper(20, 20, 0xff4444, 0x555555)); scene.add(new THREE.AxesHelper(3)); }

const cam = new THREE.PerspectiveCamera(num('fov', 32), innerWidth / innerHeight, 0.05, 500);
const target = new THREE.Vector3();
let mixer = null, root = null;
const info = document.getElementById('info');

function place(az, el, dist, t = target, c = cam) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  // az 0 = looking at the FRONT (+Z side) of the model from +Z
  c.position.set(t.x + dist * Math.sin(a) * Math.cos(e), t.y + dist * Math.sin(e), t.z + dist * Math.cos(a) * Math.cos(e));
  c.lookAt(t);
}

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const modelUrl = q.get('model');
const report = { tris: 0, nodes: [], materials: [], clips: [], bbox: null };
window.__viewer = report;

function finish() {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  report.bbox = { min: box.min.toArray().map(v => +v.toFixed(3)), max: box.max.toArray().map(v => +v.toFixed(3)), size: size.toArray().map(v => +v.toFixed(3)) };
  target.copy(ctr);
  const dist = num('dist', Math.max(size.x, size.y, size.z) * 1.9 + 1);
  if (!q.has('sheet')) place(num('az', 35), num('el', 14), dist);
  info.textContent = `${modelUrl}\ntris ${report.tris}  size ${report.bbox.size.join(' x ')}\nmats ${report.materials.join(', ')}`;
  window.__ready = true;
  const t0 = performance.now();
  renderer.setAnimationLoop(() => {
    const t = (performance.now() - t0) / 1000;
    if (mixer) mixer.update(1 / 60);
    if (q.has('spin')) place(num('az', 35) + t * 25, num('el', 14), dist);
    if (q.has('sheet')) renderSheet(dist); else renderer.render(scene, cam);
  });
}

function renderSheet(dist) {
  const views = [[35, 16], [145, 16], [90, 3], [0, 3], [180, 3], [0, 88]];
  const W = innerWidth, H = innerHeight, cols = 3, rows = 2, w = W / cols, h = H / rows;
  renderer.setScissorTest(true);
  const c2 = cam.clone(); c2.aspect = w / h; c2.updateProjectionMatrix();
  views.forEach(([az, el], i) => {
    const x = (i % cols) * w, y = H - (Math.floor(i / cols) + 1) * h;
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
    place(az, el, dist, target, c2); if (el > 80) c2.up.set(0, 0, -1); else c2.up.set(0, 1, 0); c2.lookAt(target);
    renderer.render(scene, c2);
  });
  renderer.setScissorTest(false);
}

if (!modelUrl) { info.textContent = 'no ?model='; window.__ready = true; renderer.render(scene, cam); }
else loader.load(modelUrl, (gltf) => {
  root = gltf.scene; scene.add(root); window.__root = root;
  const tint = q.get('tint') ? new THREE.Color('#' + q.get('tint')) : null;
  const mats = new Set();
  root.traverse((o) => {
    const p = []; let n = o; while (n && n !== root) { p.unshift(n.name); n = n.parent; }
    report.nodes.push({ path: p.join('/'), type: o.type, pos: o.position.toArray().map(v => +v.toFixed(3)), vis: o.visible });
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const idx = o.geometry.index; report.tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
      for (const m of [].concat(o.material)) {
        mats.add(m.name);
        if (tint && /^paint/.test(m.name)) m.color.copy(tint);
        if (q.has('wire')) m.wireframe = true;
      }
    }
  });
  report.tris = Math.round(report.tris); report.materials = [...mats];
  report.clips = gltf.animations.map(a => `${a.name}:${a.duration.toFixed(2)}s`);
  if (gltf.animations.length) { mixer = new THREE.AnimationMixer(root); const c = q.get('anim') ? gltf.animations.find(a => a.name === q.get('anim')) : null; if (c) mixer.clipAction(c).play(); }
  finish();
}, undefined, (e) => { info.textContent = 'LOAD FAIL ' + e; console.error(e); window.__ready = true; });
