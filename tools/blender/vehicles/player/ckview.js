// Cockpit / gunner-view QA page for the player trucks (vehicle-art tool, not game code).
//   /tools/blender/vehicles/player/ckview.html?model=/models/vehicles/truck_t1.glb&t=1&views=drv,drvL,drvR,gun&tint=7f9f9c&tint2=8a4a3a
// views: drv drvL drvR drvU drvD drvW (wheel close) gun gunD gunB gunL ext extR dash (close dash)  cluster=1 draws the lead's gauge overlay stand-in.
// night=1 dark env; sun=deg sunaz=deg; cols=N grid columns. Sets window.__ready.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { Sky } from 'three/addons/objects/Sky.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = num('exp', 0.9);
document.body.appendChild(renderer.domElement);
const night = q.has('night');
const scene = new THREE.Scene();
const sunEl = num('sun', 28), sunAz = num('sunaz', 215);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunEl), THREE.MathUtils.degToRad(sunAz));
const sky = new Sky(); sky.scale.setScalar(4500);
const u = sky.material.uniforms; u.turbidity.value = 6; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.85;
u.sunPosition.value.copy(sunDir);
const skyScene = new THREE.Scene(); skyScene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(skyScene, 0.0).texture;
scene.environmentIntensity = night ? 0.04 : 0.75;
scene.background = night ? new THREE.Color(0x05070c) : scene.environment;
const sun = new THREE.DirectionalLight(night ? 0x8090b0 : 0xffe9c8, night ? 0.15 : 3.6);
sun.position.copy(sunDir).multiplyScalar(30); sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 80 });
sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.015; scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(80, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x8a7a64, roughness: 1.0, metalness: 0, envMapIntensity: 0.3 }));
ground.receiveShadow = true; scene.add(ground);
const road = new THREE.Mesh(new THREE.PlaneGeometry(9, 160).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.9 }));
road.position.y = 0.005; road.receiveShadow = true; scene.add(road);
for (let i = 0; i < 16; i++) { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xdddddd })); d.position.set(0, 0.01, 6 + i * 8); scene.add(d); }
// a few boxes ahead so the windshield view has depth cues
for (let i = 0; i < 8; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2 + (i % 3), 2 + (i * 7 % 5), 2), new THREE.MeshStandardMaterial({ color: 0x9a6a4a, roughness: 0.9 })); b.position.set((i % 2 ? 1 : -1) * (9 + i * 2), 1, 20 + i * 9); b.castShadow = true; scene.add(b); }

const EYES = { 1: [0.373, 1.41, 0.212], 2: [0.432, 1.502, 0.232], 3: [0.431, 1.525, 0.235], 4: [0.469, 1.584, 0.231] };
const tier = num('t', 1);
const eye = new THREE.Vector3(...(q.get('eye') ? q.get('eye').split(',').map(Number) : EYES[tier]));
const fov = num('fov', 80);
const info = document.getElementById('info');
const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
const report = { tris: 0, nodes: [], materials: [] }; window.__ck = report;

function camAt(pos, yawDeg, pitchDeg, f = fov) {
  const c = new THREE.PerspectiveCamera(f, 1, 0.03, 600);
  c.position.copy(pos);
  // truck faces +Z; yaw + = look left (+X); pitch + = up
  c.rotation.order = 'YXZ'; c.rotation.set(THREE.MathUtils.degToRad(pitchDeg), Math.PI + THREE.MathUtils.degToRad(yawDeg), 0);
  return c;
}
function views(root) {
  const find = (n) => { let o = null; root.traverse((x) => { if (!o && x.name === n) o = x; }); return o; };
  const sg = find('seat_gunner'); const gp = sg ? sg.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 1, -1.5);
  const geye = gp.clone().add(new THREE.Vector3(0, 1.66, 0.08));
  const bb = new THREE.Box3().setFromObject(root), ctr = bb.getCenter(new THREE.Vector3());
  const ext = (az, el, d) => { const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el); const c = new THREE.PerspectiveCamera(34, 1, 0.1, 600); c.position.set(ctr.x + d * Math.sin(a) * Math.cos(e), ctr.y + d * Math.sin(e), ctr.z + d * Math.cos(a) * Math.cos(e)); c.lookAt(ctr); return c; };
  const sw = find('steering_wheel'); const swp = sw ? sw.getWorldPosition(new THREE.Vector3()) : eye.clone();
  const V = {
    drv: () => camAt(eye, 0, -3.4),
    drvL: () => camAt(eye, 60, -8),
    drvR: () => camAt(eye, -55, -12),
    drvU: () => camAt(eye, 0, 32),
    drvD: () => camAt(eye, 0, -28),
    drvW: () => camAt(eye.clone().add(new THREE.Vector3(0, -0.05, 0.12)), 0, -35, 55),
    dash: () => { const c = new THREE.PerspectiveCamera(50, 1, 0.02, 100); c.position.copy(eye).add(new THREE.Vector3(-0.45, -0.1, 0.1)); c.lookAt(swp.clone().add(new THREE.Vector3(-0.3, 0.05, 0.2))); return c; },
    gun: () => camAt(geye, 0, -4, 70),
    gunD: () => camAt(geye, 0, -38, 75),
    gunB: () => camAt(geye, 180, -30, 75),
    gunL: () => camAt(geye, 70, -25, 75),
    lampF: () => { const h = find('light_head_L'); const p = h ? h.getWorldPosition(new THREE.Vector3()) : ctr; const c = new THREE.PerspectiveCamera(40, 1, 0.05, 600); c.position.copy(p).add(new THREE.Vector3(0.9, 0.35, 1.9)); c.lookAt(p.clone().add(new THREE.Vector3(-0.35, 0, 0))); return c; },
    lampR: () => { const h = find('light_tail_L'); const p = h ? h.getWorldPosition(new THREE.Vector3()) : ctr; const c = new THREE.PerspectiveCamera(40, 1, 0.05, 600); c.position.copy(p).add(new THREE.Vector3(0.7, 0.45, -1.8)); c.lookAt(p.clone().add(new THREE.Vector3(-0.35, 0, 0))); return c; },
    ext: () => ext(35, 16, 11), extR: () => ext(145, 16, 11), extS: () => ext(90, 4, 10), extT: () => ext(20, 55, 9),
  };
  return (q.get('views') || 'drv,drvL,drvR,drvU,gun,gunD').split(',').map((k) => [k, V[k] ? V[k]() : V.drv()]);
}

loader.load(q.get('model'), (gltf) => {
  const root = gltf.scene; scene.add(root);
  const tint = q.get('tint') ? new THREE.Color('#' + q.get('tint')) : null, tint2 = q.get('tint2') ? new THREE.Color('#' + q.get('tint2')) : null;
  const mats = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const idx = o.geometry.index; report.tris += (idx ? idx.count : o.geometry.attributes.position.count) / 3;
    for (const m of [].concat(o.material)) {
      mats.add(m.name);
      if (tint && m.name === 'paint') m.color.copy(tint);
      if (tint2 && m.name === 'paint2') m.color.copy(tint2);
      // the game's load-time tweaks (src/core/assets.js) + the cockpit's own-glass treatment (src/view/cockpit.js)
      if (m.name === 'chrome' && !m.__t) { m.__t = 1; m.color.multiplyScalar(0.3); m.roughness = Math.max(m.roughness, 0.38); m.envMapIntensity = 0.7; }
      if (m.name === 'glass' && !m.__t) { m.__t = 1; m.transparent = true; m.depthWrite = false; m.opacity = q.has('outside') ? 0.22 : 0.05; m.envMapIntensity = q.has('outside') ? 0.45 : 0.12; m.color.setRGB(0.85, 0.88, 0.9).multiplyScalar(0.5); }
      if (night && /^light_/.test(m.name)) m.emissiveIntensity = m.name === 'light_head' ? 4 : 1.4;
    }
  });
  report.tris = Math.round(report.tris); report.materials = [...mats];
  root.traverse((o) => report.nodes.push(o.name));
  if (!q.has('visor')) root.traverse((o) => { if (o.name === 'panel_armor_windshield') o.visible = false; });   // the runtime hides it in first person
  if (q.has('cluster')) {
    // stand-in for the lead's live gauge cluster (src/view/cockpit.js _cluster): 0.30 x 0.1125 face + dark hood box
    let sw = null; root.traverse((o) => { if (!sw && o.name === 'steering_wheel') sw = o; });
    if (sw) {
      const wp = sw.getWorldPosition(new THREE.Vector3()), qq = sw.getWorldQuaternion(new THREE.Quaternion());
      const col = new THREE.Vector3(0, 0, 1).applyQuaternion(qq);
      const p = wp.clone().addScaledVector(col, 0.2).add(new THREE.Vector3(0, 0.075, 0));
      const g = new THREE.Group();
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.1125), new THREE.MeshBasicMaterial({ color: 0x3a4550 }));
      const hood = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.1425, 0.05), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 })); hood.position.z = -0.03;
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.07), hood.material); brow.position.set(0, 0.1125 / 2 + 0.02, 0.005);
      g.add(face, hood, brow); g.position.copy(p); g.lookAt(eye); scene.add(g);
    }
  }
  const list = views(root);
  const cols = num('cols', Math.min(3, list.length)), rows = Math.ceil(list.length / cols);
  const W = innerWidth, H = innerHeight, w = W / cols, h = H / rows;
  for (const [, c] of list) { c.aspect = w / h; c.updateProjectionMatrix(); }
  info.textContent = `${q.get('model')}  tris ${report.tris}\n` + list.map(([k]) => k).join(' ');
  window.__ready = true;
  renderer.setAnimationLoop(() => {
    renderer.setScissorTest(true);
    list.forEach(([, c], i) => {
      const x = (i % cols) * w, y = H - (Math.floor(i / cols) + 1) * h;
      renderer.setViewport(x, y, w, h); renderer.setScissor(x, y, w, h); renderer.render(scene, c);
    });
    renderer.setScissorTest(false);
  });
}, undefined, (e) => { info.textContent = 'LOAD FAIL ' + e; window.__ready = true; });
