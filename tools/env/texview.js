// Environment QA scene (not part of the game): terrain texture patch or a road composition under golden-hour light.
//   tools/env/texview.html?tex=sand&scale=4                       ground patch with one texture set (scale = metres per tile)
//   tools/env/texview.html?scene=road&terrain=sand&props=1        two-lane road + markings + roadside props
//   options: sun=14 (elevation) sunaz=200 exp=0.9 cam=2.5 (height) look=... fog=1
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
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const sunEl = num('sun', 14), sunAz = num('sunaz', 200);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sunEl), THREE.MathUtils.degToRad(sunAz));
const sky = new Sky(); sky.scale.setScalar(4500);
const u = sky.material.uniforms; u.turbidity.value = 7; u.rayleigh.value = 1.8; u.mieCoefficient.value = 0.008; u.mieDirectionalG.value = 0.85;
u.sunPosition.value.copy(sunDir);
const skyScene = new THREE.Scene(); skyScene.add(sky);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(skyScene, 0.0).texture;
scene.environmentIntensity = 0.6;
scene.background = scene.environment;
if (q.get('fog') !== '0') scene.fog = new THREE.FogExp2(0xd9b58a, num('fogd', 0.0032));

const sun = new THREE.DirectionalLight(0xffe0b0, 3.8);
sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const cam = new THREE.PerspectiveCamera(num('fov', 55), innerWidth / innerHeight, 0.1, 1500);
const texLoader = new THREE.TextureLoader();
const gltf = new GLTFLoader(); gltf.setMeshoptDecoder(MeshoptDecoder);
const maxAniso = renderer.capabilities.getMaxAnisotropy();

function tex(url, srgb, rx, ry) {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.repeat.set(rx, ry);
  return t;
}
function pbr(name, w, h, meters, opts = {}) {
  const rx = w / meters, ry = h / meters;
  const p = `/textures/${name}/`;
  const arm = tex(p + 'arm.jpg', false, rx, ry);
  return new THREE.MeshStandardMaterial({
    map: tex(p + 'albedo.jpg', true, rx, ry), normalMap: tex(p + 'normal.jpg', false, rx, ry),
    aoMap: arm, roughnessMap: arm, metalnessMap: arm, roughness: 1, metalness: 1, normalScale: new THREE.Vector2(1, 1), ...opts,
  });
}
function plane(w, h, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true;
  scene.add(m);
  return m;
}
const props = [];
function place(name, x, z, ry = 0, s = 1, y = 0) {
  props.push(new Promise((res) => gltf.load(`/models/props/${name}.glb`, (g) => {
    const o = g.scene; o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s);
    o.traverse(m => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    scene.add(o); res();
  }, undefined, () => { console.log('missing prop', name); res(); })));
}
const rnd = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();


function sprite(url, cols, rows, frame, x, y, z, size, additive = false, color = 0xffffff, opacity = 1) {
  const t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; t.repeat.set(1 / cols, 1 / rows);
  t.offset.set((frame % cols) / cols, 1 - (Math.floor(frame / cols) + 1) / rows);
  const m = new THREE.SpriteMaterial({ map: t, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: true });
  const sp = new THREE.Sprite(m); sp.position.set(x, y, z); sp.scale.set(size, size, 1); sp.center.set(0.5, additive && cols === 4 ? 0.03 : 0.5);
  scene.add(sp); return sp;
}
function buildFx() {
  // a burning barrel + smoke column + dust puffs + a muzzle flash, for judging the sprites in the lit scene
  const P = '/textures/particles/';
  for (let i = 0; i < 6; i++) sprite(P + 'smoke_sheet.png', 4, 4, (i % 4) + 4 * (i % 4), 6.2 + i * 0.9, 2.0 + i * 1.9, 30 + i * 1.2, 2.2 + i * 1.1, false, 0x585858, 0.85);
  sprite(P + 'fire_sheet.png', 4, 4, 5, 6.2, 0.9, 30, 2.2, true);
  sprite(P + 'fire_sheet.png', 4, 4, 11, 6.7, 0.7, 30.2, 1.5, true);
  for (let i = 0; i < 5; i++) sprite(P + 'dust_puff.png', 4, 4, (i % 4) + 4 * ((i + 1) % 4), -3 + i * 1.3, 0.7 + i * 0.1, 18 + i * 1.6, 2.8 + i * 0.5, false, 0xffffff, 0.75);
  sprite(P + 'muzzle_flash_sheet.png', 4, 2, 0, 1.0, 1.6, 12, 1.3, true);
  sprite(P + 'muzzle_flash_sheet.png', 4, 2, 3, -0.6, 1.4, 14, 1.6, true);
  sprite(P + 'spark.png', 1, 1, 0, 0.2, 1.0, 10, 0.5, true);
  sprite(P + 'blast_flash.png', 1, 1, 0, -6, 1.5, 40, 4, true);
  sprite(P + 'shockwave.png', 1, 1, 0, -6, 1.0, 40.2, 9, true, 0xffffff, 0.6);
}

async function buildRoad() {
  const terrain = q.get('terrain') || 'sand';
  const tm = num('tscale', 5);
  plane(1200, 1200, pbr(terrain, 1200, 1200, tm), 0, 0, 500);
  const lane = 3.7, len = 500;
  // shoulders + road
  plane(2.6, len, pbr('gravel', 2.6, len, 3), lane + 1.5, 0.003, len / 2 - 20);
  plane(2.6, len, pbr('gravel', 2.6, len, 3), -lane - 1.5, 0.003, len / 2 - 20);
  plane(lane, len, pbr('asphalt_worn', lane, len, lane), lane / 2, 0.006, len / 2 - 20);
  plane(lane, len, pbr('asphalt_worn', lane, len, lane), -lane / 2, 0.006, len / 2 - 20);
  // markings from the atlas
  const mk = await (await fetch('/textures/road_markings/markings.json')).json();
  const atlas = texLoader.load('/textures/road_markings/markings.png');
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = maxAniso; atlas.generateMipmaps = true;
  const mat = new THREE.MeshStandardMaterial({ map: atlas, transparent: true, roughness: 0.85, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pos = [], uv = [], idx = [];
  function quad(item, cx, cz, w = null, h = null) {
    const it = mk.items[item]; const [w0, h0] = it.size_m; w = w || w0; h = h || h0;
    const [u0, v0, u1, v1] = it.uv; const b = pos.length / 3; const y = 0.012;
    // forward = +Z ; image up = forward
    pos.push(cx - w / 2, y, cz - h / 2, cx + w / 2, y, cz - h / 2, cx + w / 2, y, cz + h / 2, cx - w / 2, y, cz + h / 2);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const variants = ['a', 'b', 'c'];
  for (let z = -20; z < len - 20; z += 6) {
    const k = variants[Math.floor(rnd() * 3)];
    quad('edge_white_' + k, lane - 0.3, z + 3);
    quad('edge_white_' + variants[Math.floor(rnd() * 3)], -lane + 0.3, z + 3);
    quad('double_yellow_' + k, 0, z + 3);
  }
  // lane dashes (single lane each side is not needed for 2 lanes) - use them on a virtual 3rd lane line for the test
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const dec = new THREE.Mesh(geo, mat); dec.receiveShadow = true; scene.add(dec);
  if (q.get('props') !== '0') {
    for (let z = 5; z < 240; z += 4) place('jersey_barrier', -lane - 4.6, z + 1.83 * 0, 0);
    for (let z = 10; z < 140; z += 4) place('guardrail_4m', lane + 4.8, z, 0);
    for (let i = 0; i < 6; i++) place('road_cone', -1.2 + (i % 2) * 0.5, 22 + i * 3.0, rnd() * 6);
    place('barrel', 6.2, 30, 0); place('barrel_explosive', 6.8, 31.2, 0.6); place('tire_stack', -7.6, 48, 0.4); place('crate_stack', 7.5, 60, 0.3);
    place('sign_warning', 6.2, 40, Math.PI); place('sign_speed', -6.6, 26, 0); place('utility_pole', 9, 90, 0); place('utility_pole', 9, 110, 0); place('street_lamp', -8.0, 70, Math.PI / 2);
    place('skeleton_car_frame', -13, 34, 1.2);
    const scenery = q.get('scenery') || 'desert';
    if (scenery === 'pines') {
      for (let i = 0; i < 150; i++) {
        const side = rnd() < 0.5 ? -1 : 1, z = 8 + rnd() * 260, x = side * (10 + rnd() * 70);
        const r = rnd(), far = z > 150 || Math.abs(x) > 50;
        const t = 'abc'[Math.floor(rnd() * 3)];
        if (r < 0.62) place(far ? 'pine_' + t + '_lod' : 'pine_' + t, x, z, rnd() * 6, 0.85 + rnd() * 0.45);
        else if (r < 0.72) place('rock_0' + (1 + Math.floor(rnd() * 6)), x, z, rnd() * 6);
        else if (r < 0.82) place('fern', x, z, rnd() * 6, 1.3);
        else if (r < 0.9) place('shrub_green_bush', x, z, rnd() * 6);
        else place('dead_tree_' + 'abc'[Math.floor(rnd() * 3)], x, z, rnd() * 6);
      }
      for (let i = 0; i < 40; i++) place('pine_' + 'abc'[i % 3] + '_billboard', (rnd() < 0.5 ? -1 : 1) * (20 + rnd() * 120), 200 + rnd() * 200, rnd() * 3, 1.0);
    } else if (scenery === 'coast') {
      for (let i = 0; i < 70; i++) {
        const side = rnd() < 0.5 ? -1 : 1, z = 8 + rnd() * 240, x = side * (9 + rnd() * 45);
        const r = rnd();
        if (r < 0.3) place('palm_coast', x, z, rnd() * 6, 0.85 + rnd() * 0.3);
        else if (r < 0.5) place('shrub_green_bush', x, z, rnd() * 6);
        else if (r < 0.62) place('fern', x, z, rnd() * 6, 1.4);
        else if (r < 0.8) place('rock_0' + (1 + Math.floor(rnd() * 6)), x, z, rnd() * 6);
        else place('grass_tuft_green', x, z, rnd() * 6, 1.6);
      }
      const cl = plane(300, 60, pbr(q.get('cliff') || 'cliff', 300, 60, num('cscale', 8)), -60, 30, 130); cl.rotation.set(0, Math.PI / 2, 0); cl.position.set(-40, 30, 130);
    } else {
      for (let i = 0; i < 60; i++) {
        const side = rnd() < 0.5 ? -1 : 1, z = 8 + rnd() * 230, x = side * (9 + rnd() * 40);
        const r = rnd();
        if (r < 0.28) place('rock_0' + (1 + Math.floor(rnd() * 5)), x, z, rnd() * 6);
        else if (r < 0.42) place('shrub_desert_scrub', x, z, rnd() * 6);
        else if (r < 0.52) place('shrub_dry_bush', x, z, rnd() * 6);
        else if (r < 0.62) place('cactus_saguaro', x, z, rnd() * 6);
        else if (r < 0.70) place('cactus_barrel', x, z, rnd() * 6);
        else if (r < 0.80) place('dead_tree_' + 'abc'[Math.floor(rnd() * 3)], x, z, rnd() * 6);
        else if (r < 0.9) place('grass_tuft', x, z, rnd() * 6, 1.4);
        else place('boulder_0' + (1 + Math.floor(rnd() * 3)), x + side * 10, z, rnd() * 6);
      }
      place('canyon_pillar_a', -55, 150, 0); place('canyon_pillar_b', 80, 260, 1); place('boulder_03', 30, 190, 0.5);
    }
  }
  if (q.get('fx') === '1') buildFx();
  await Promise.all(props);
  cam.position.set(num('camx', 1.6), num('cam', 2.6), num('camz', -6)); cam.lookAt(num('lookx', 0), num('looky', 1.6), num('lookz', 60));
}

async function buildPatch() {
  const name = q.get('tex') || 'sand';
  const s = num('scale', 4);
  plane(300, 300, pbr(name, 300, 300, s), 0, 0, 100);
  cam.position.set(0, num('cam', 1.7), 0); cam.lookAt(0, num('looky', 0.6), 20);
}

const mode = q.get('scene') || 'patch';
sun.position.copy(sunDir).multiplyScalar(80).add(new THREE.Vector3(0, 0, 25));
sun.target.position.set(0, 0, 25);
(mode === 'road' ? buildRoad() : buildPatch()).then(() => {
  window.__ready = true;
  renderer.setAnimationLoop(() => renderer.render(scene, cam));
});
