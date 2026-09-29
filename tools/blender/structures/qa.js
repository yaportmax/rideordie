// Structure QA viewer (own copy of src/viewer.js with big-model shadows, a road strip, scale refs, driver cams).
//  ?model=/models/structures/x.glb  &sheet=1 (multi view)  &views=q1,q2,side,front,rear,top,drive,drive2,back,far,low   &az= &el= &dist=
//  &road=0 (no road strip)  &gy=-12 (ground height)  &col=1 (show collision)  &ref=1 (truck+person refs)  &sun=25 &sunaz=215
//  &cam=x,y,z,tx,ty,tz  &fov=32  &haze=1  &wire=1  &tint=cc3311  &exp=0.9  &ground=0 (no ground)  &view=<name> (single named view)
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
scene.background = q.has('bg') ? new THREE.Color('#' + q.get('bg')) : scene.environment;
if (q.has('haze')) scene.fog = new THREE.Fog(0xd9b48a, 60, num('haze', 1) > 1 ? num('haze', 1) : 900);

const sun = new THREE.DirectionalLight(0xffe9c8, 3.6);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);

const gy = num('gy', 0);
const gcol = q.get('gcol') ? new THREE.Color('#' + q.get('gcol')) : new THREE.Color(0x3a3126);
if (num('ground', 1)) {
  const ground = new THREE.Mesh(new THREE.CircleGeometry(900, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: gcol, roughness: 1.0, metalness: 0, envMapIntensity: 0.4 }));
  ground.position.y = gy - 0.07; ground.receiveShadow = true; scene.add(ground);
}
if (num('road', 1)) {
  const rl = 600;
  const rg = new THREE.Mesh(new THREE.PlaneGeometry(14, rl).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3a3d, roughness: 0.92, envMapIntensity: 0.4 }));
  rg.position.set(0, -0.04, rl / 2 - 200); rg.receiveShadow = true; scene.add(rg);
  const lm = new THREE.MeshStandardMaterial({ color: 0xd9c04a, roughness: 0.8 });
  for (let z = -200; z < 400; z += 9) { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 4.5).rotateX(-Math.PI / 2), lm); d.position.set(0, -0.03, z + 2.25); d.receiveShadow = true; scene.add(d); }
  const wm = new THREE.MeshStandardMaterial({ color: 0xd8d4c8, roughness: 0.8 });
  for (const sx of [-6.6, 6.6]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.2, rl).rotateX(-Math.PI / 2), wm); e.position.set(sx, -0.03, rl / 2 - 200); e.receiveShadow = true; scene.add(e); }
}
if (q.has('ref')) {
  const truck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.9, 5.4), new THREE.MeshStandardMaterial({ color: 0x2f6fbf, roughness: 0.5, metalness: 0.3 }));
  truck.position.set(num('refx', 2.5), 0.95, num('refz', -6)); truck.castShadow = truck.receiveShadow = true; scene.add(truck);
  const man = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 1.28, 4, 8), new THREE.MeshStandardMaterial({ color: 0xe04030, roughness: 0.7 }));
  man.position.set(num('refx', 2.5) + 2.2, 0.89, num('refz', -6)); man.castShadow = true; scene.add(man);
}
if (q.has('grid')) { const g = new THREE.GridHelper(200, 200, 0xff4444, 0x555555); g.position.y = gy; scene.add(g); scene.add(new THREE.AxesHelper(5)); }

const cam = new THREE.PerspectiveCamera(num('fov', 32), innerWidth / innerHeight, 0.1, 3000);
const target = new THREE.Vector3();
const info = document.getElementById('info');

function place(az, el, dist, t = target, c = cam) {
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  c.position.set(t.x + dist * Math.sin(a) * Math.cos(e), t.y + dist * Math.sin(e), t.z + dist * Math.cos(a) * Math.cos(e));
  c.up.set(0, 1, 0); c.lookAt(t);
}

const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const modelUrl = q.get('model');
const report = { tris: 0, colTris: 0, nodes: [], materials: [], bbox: null };
window.__viewer = report;
let root = null;

function fitShadow(box) {
  const c = box.getCenter(new THREE.Vector3());
  sun.position.copy(c).addScaledVector(sunDir, 1000);
  sun.target.position.copy(c); sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();
  const sc = sun.shadow.camera;
  const m = new THREE.Matrix4().copy(sun.matrixWorld).invert();
  const b2 = new THREE.Box3();
  const ext = box.clone().expandByVector(new THREE.Vector3(2, 2, 2));
  for (let i = 0; i < 8; i++) {
    const p = new THREE.Vector3(i & 1 ? ext.max.x : ext.min.x, i & 2 ? ext.max.y : ext.min.y, i & 4 ? ext.max.z : ext.min.z);
    b2.expandByPoint(p.applyMatrix4(m));
  }
  Object.assign(sc, { left: b2.min.x, right: b2.max.x, bottom: b2.min.y, top: b2.max.y, near: Math.max(0.1, -b2.max.z - 200), far: -b2.min.z + 400 });
  sc.updateProjectionMatrix();
}

const VIEWS = { q1: [35, 16], q2: [145, 16], side: [90, 3], front: [0, 3], rear: [180, 3], top: [0, 88], low: [20, 1], q3: [-35, 16], q4: [-145, 16], sideL: [-90, 3] };
function setView(name, dist, c, t) {
  const fixed = (px, py, pz, tx, ty, tz, fov) => { c.position.set(px, py, pz); c.up.set(0, 1, 0); c.lookAt(tx, ty, tz); c.fov = fov; c.updateProjectionMatrix(); };
  if (name === 'drive') return fixed(0, 2.6, num('dz', -16), 0, num('dy', 3.5), num('dz', -16) + 40, 62);
  if (name === 'drive2') return fixed(0, 2.6, num('dz2', 20), 0, 3.5, num('dz2', 20) + 40, 62);
  if (name === 'back') return fixed(0, 2.6, num('bz', 40), 0, 3.5, num('bz', 40) - 40, 62);
  if (name === 'far') return fixed(num('fx', 0), 5, num('fz', -300), t.x, t.y * 0.8, t.z, 25);
  c.fov = num('fov', 32); c.updateProjectionMatrix();
  const [az, el] = VIEWS[name] || [35, 16];
  place(az, el, dist, t, c);
}

function finish() {
  const box = new THREE.Box3();
  root.traverse(o => { if (o.isMesh && o.name !== 'collision') box.expandByObject(o); });
  const size = box.getSize(new THREE.Vector3()), ctr = box.getCenter(new THREE.Vector3());
  report.bbox = { min: box.min.toArray().map(v => +v.toFixed(2)), max: box.max.toArray().map(v => +v.toFixed(2)), size: size.toArray().map(v => +v.toFixed(2)) };
  target.copy(ctr);
  fitShadow(box.clone().union(new THREE.Box3(new THREE.Vector3(-30, gy, -30), new THREE.Vector3(30, gy + 2, 30))));
  const dist = num('dist', Math.max(size.x, size.y, size.z) * 1.8 + 1);
  const views = (q.get('views') || 'q1,q2,side,front,rear,top').split(',');
  const one = !q.has('sheet');
  if (one) {
    if (q.has('cam')) { const a = q.get('cam').split(',').map(Number); cam.position.set(a[0], a[1], a[2]); cam.up.set(0, 1, 0); cam.lookAt(a[3], a[4], a[5]); }
    else if (q.has('view')) setView(q.get('view'), dist, cam, target);
    else place(num('az', 35), num('el', 14), dist);
  }
  info.textContent = `${modelUrl}\ntris ${report.tris} col ${report.colTris}  size ${report.bbox.size.join(' x ')}\nmats ${report.materials.join(', ')}`;
  window.__ready = true;
  renderer.setAnimationLoop(() => {
    if (!one) renderSheet(dist, views); else renderer.render(scene, cam);
  });
}

function renderSheet(dist, views) {
  const W = innerWidth, H = innerHeight;
  const n = views.length, cols = n <= 3 ? n : n <= 4 ? 2 : 3, rows = Math.ceil(n / cols), w = W / cols, h = H / rows;
  renderer.setScissorTest(true);
  const c2 = cam.clone(); c2.aspect = w / h; c2.updateProjectionMatrix();
  views.forEach((v, i) => {
    const x = (i % cols) * w, y = H - (Math.floor(i / cols) + 1) * h;
    renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h);
    setView(v, dist, c2, target);
    if (v === 'top') { c2.up.set(0, 0, -1); c2.lookAt(target); }
    c2.aspect = w / h; c2.updateProjectionMatrix();
    renderer.render(scene, c2);
  });
  renderer.setScissorTest(false);
}

if (!modelUrl) { info.textContent = 'no ?model='; window.__ready = true; renderer.render(scene, cam); }
else loader.load(modelUrl, (gltf) => {
  root = gltf.scene; scene.add(root);
  const tint = q.get('tint') ? new THREE.Color('#' + q.get('tint')) : null;
  const mats = new Set();
  root.traverse((o) => {
    const p = []; let n = o; while (n && n !== root) { p.unshift(n.name); n = n.parent; }
    report.nodes.push({ path: p.join('/'), type: o.type, pos: o.position.toArray().map(v => +v.toFixed(3)) });
    if (o.isMesh) {
      const idx = o.geometry.index; const t = (idx ? idx.count : o.geometry.attributes.position.count) / 3;
      if (o.name === 'collision') {
        report.colTris += t;
        if (q.has('col')) { o.material = new THREE.MeshBasicMaterial({ color: 0xff2255, transparent: true, opacity: 0.35, depthWrite: false }); }
        else o.visible = false;
        return;
      }
      o.castShadow = true; o.receiveShadow = true;
      report.tris += t;
      for (const m of [].concat(o.material)) {
        mats.add(m.name);
        if (tint && /^paint/.test(m.name)) m.color.copy(tint);
        if (q.has('wire')) m.wireframe = true;
      }
    }
  });
  report.tris = Math.round(report.tris); report.colTris = Math.round(report.colTris); report.materials = [...mats];
  finish();
}, undefined, (e) => { info.textContent = 'LOAD FAIL ' + e; console.error(e); window.__ready = true; });
