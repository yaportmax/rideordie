// Post-processing test page.  /post.html?s=24000&fx=all&q=2&fly=50&boost=0.5&ui=0
//   fx=all | off | ao,bloom,mb,ca,vignette,grain,lines,smaa,grade,sharpen   (add "-name" to remove, e.g. fx=all,-mb)
//   q=0..3  scale=0.5..1  fly=<m/s auto drive>  speed=0..1  boost  damage  night  dof  hit  slowmo
//   spin=<deg/s camera yaw>  taa=1 (experimental temporal AA)  face=sun  yaw=<deg>  pitch=<deg>  back=<m>  h=<m>  fov=<deg>  props=0|1  ui=0  tm=agx  shock=1
// Uses the REAL world (terrain streamer + sky + road) + placeholder cars, tracers and fire so bloom / motion blur /
// readability of enemies and tracers can be judged. window.__bench(seconds) reports fps + GPU ms per pass.
import * as THREE from 'three';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { createRenderer } from './core/renderer.js';
import { Road } from './world/road.js';
import { TerrainStreamer } from './world/terrain.js';
import { loadGroundArrays, makeTerrainMaterial, makeRoadMaterial } from './world/terrain_material.js';
import { SkyRig } from './world/sky.js';
import { lookAt } from './world/look.js';
import { initPhysics } from './sim/physics.js';
import * as Assets from './core/assets.js';
import { Post } from './view/post.js';
import { GpuTimer } from './view/post/gpu_timer.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? parseFloat(q.get(k)) : d);
const str = (k, d) => (q.has(k) ? q.get(k) : d);
const seed = num('seed', 7);
const fxArg = str('fx', 'all');
const usePost = !(fxArg === 'off' || fxArg === 'none' || fxArg === '0');
const FEATS = ['ao', 'bloom', 'mb', 'ca', 'vignette', 'grain', 'lines', 'dof', 'smaa', 'grade', 'sharpen'];
const hud = document.getElementById('hud');

const renderer = createRenderer({ antialias: !usePost });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 66), innerWidth / innerHeight, 0.15, 9000);
scene.add(camera);
const sky = new SkyRig(renderer, scene);
const road = new Road(seed);

await initPhysics();
const arrays = await loadGroundArrays();
const loader = new THREE.TextureLoader();
const tex = (n, srgb) => { const t = loader.load(`/textures/asphalt/${n}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
const terrainMat = makeTerrainMaterial(arrays);
const roadMat = makeRoadMaterial({ albedo: tex('albedo', true), normal: tex('normal', false), arm: tex('arm', false) });
const streamer = new TerrainStreamer({ scene, world: null, seed, terrainMat, roadMat, workers: 3 });

// ------------------------------------------------------------------ placeholder cars / tracers / fire
const CAR_URLS = { player: ['/models/vehicles/truck_t1.glb', '/models/vehicles/_t2.glb'], sedan: '/models/vehicles/e_sedan.glb', van: '/models/vehicles/e_van.glb', heavy: '/models/vehicles/e_heavy.glb' };
async function loadCar(urls) {
  for (const u of [].concat(urls)) { const m = await Assets.instantiate(u); if (m) { m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return m; } }
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 4.6), new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.6, metalness: 0.3 }));
  body.position.y = 0.9; body.castShadow = true; g.add(body);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.8), new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.2, metalness: 0.6 }));
  cab.position.set(0, 1.6, 0.5); g.add(cab);
  return g;
}
const showProps = str('props', '1') !== '0';
const player = new THREE.Group();
const enemies = [];
scene.add(player);
{
  const m = await loadCar(CAR_URLS.player); player.add(m);
  // dark tail lights (HDR emissive so they bloom)
  for (const x of [-0.75, 0.75]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.15, 0.08) }));
    l.position.set(x, 0.95, -2.42); player.add(l);
  }
  if (showProps) {
    const defs = [['sedan', 30, -3.4], ['van', 47, 3.2], ['heavy', 74, 0.4], ['sedan', 15, 4.4]];
    for (const [k, ds, d] of defs) {
      const c = await loadCar(CAR_URLS[k]);
      const g = new THREE.Group(); g.add(c); scene.add(g);
      for (const x of [-0.7, 0.7]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.05), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.1) }));
        l.position.set(x, 0.95, -2.45); g.add(l);
      }
      enemies.push({ g, ds, d });
    }
  }
}
// fire + explosion glow sprites (additive, HDR)
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); const gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,210,140,0.75)'); gr.addColorStop(0.6, 'rgba(255,120,30,0.25)'); gr.addColorStop(1, 'rgba(255,60,0,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glowTex = glowTexture();
const fire = new THREE.Group();
for (let i = 0; i < 9; i++) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(3.2, 1.6, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.position.set((Math.random() - 0.5) * 1.2, 1.9 + Math.random() * 1.6, (Math.random() - 0.5) * 1.6); s.scale.setScalar(1.6 + Math.random() * 1.8); s.userData.ph = Math.random() * 6;
  fire.add(s);
}
if (showProps) scene.add(fire);
// tracers: thin additive streaks flying from the player's gun toward the enemies
const tracers = [];
const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 5.2, 1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
if (showProps) for (let i = 0; i < 7; i++) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 7), tracerMat); m.userData = { t: i / 7, side: (i % 3 - 1) * 0.55, up: 1.4 + (i % 2) * 0.35 };
  scene.add(m); tracers.push(m);
}

// ------------------------------------------------------------------ post
let post = null;
if (usePost) {
  post = new Post(renderer, scene, camera, { quality: num('q', 2), resolutionScale: num('scale', 1), tonemap: str('tm', 'aces'), hdr: q.get('ldr') !== '1' });
  post.setSize(innerWidth, innerHeight);
  if (q.get('taa') === '1') post.taa = true;
  if (fxArg !== 'all') {
    const on = new Set(); let neg = false;
    for (const tok of fxArg.split(',')) { if (tok === 'all') FEATS.forEach((f) => on.add(f)); else if (tok.startsWith('-')) on.delete(tok.slice(1)); else on.add(tok); neg = neg || tok.startsWith('-'); }
    const f = {}; for (const k of FEATS) f[k] = on.has(k);
    post.setFeatures(f);
  }
}

// ------------------------------------------------------------------ state
let s = num('s', 24000);
const fly = num('fly', 0);
const P = {
  speed01: num('speed', Math.min(1, fly / 55)), boost: num('boost', 0), damage01: num('damage', 0), night01: num('night', -1),
  dof: num('dof', 0), hitFlash: 0, slowmo: num('slowmo', 0), fov: num('fov', 66), back: num('back', 9.5), h: num('h', 3.3), pitch: num('pitch', -6), yaw: num('yaw', 0),
  s, fly, spin: num('spin', 0), face: str('face', '') === 'sun',
};
const tmp = {}, tmp2 = {};
const D2R = Math.PI / 180;
let frames = 0, t0 = performance.now(), fpsAcc = 0, fpsN = 0, cpuMs = 0;
const bench = { timer: new GpuTimer(renderer), on: false };
let simTime = 0, hitAt = num('hit', 0);
let shockCount = 0;

function updateWorld(dt) {
  simTime += dt;
  P.s += P.fly * dt; s = P.s;
  const look = lookAt(s);
  sky.setLook(look, frames === 0);
  streamer.update(s);
  const sm = road.sample(s, tmp);
  const py = road.surfaceY(sm, 0);
  player.position.set(sm.x, py, sm.z); player.rotation.y = sm.th;
  for (const e of enemies) {
    const es = road.sample(s + e.ds, tmp2);
    e.g.position.set(es.x + es.nx * e.d, road.surfaceY(es, e.d), es.z + es.nz * e.d); e.g.rotation.y = es.th;
  }
  if (enemies[2]) fire.position.copy(enemies[2].g.position);
  fire.children.forEach((sp) => { const k = 0.85 + 0.25 * Math.sin(simTime * 17 + sp.userData.ph); sp.material.color.setRGB(3.2 * k, 1.6 * k, 0.5 * k); });
  const tsp = P.fly > 0 ? 260 : 0;
  for (const t of tracers) {
    if (tsp) t.userData.t = (t.userData.t + dt * 1.6) % 1;
    const a = t.userData.t;
    const ps = s + 2 + a * 60;
    const tp = road.sample(ps, tmp2);
    t.position.set(tp.x + tp.nx * (t.userData.side * (1 - a)), py + t.userData.up + a * 0.4, tp.z + tp.nz * (t.userData.side * (1 - a)));
    t.rotation.y = tp.th;
  }
  // chase camera
  const back = P.back, hh = P.h;
  const cb = road.sample(s - back, tmp);
  const fovK = P.fov + P.boost * 9;
  if (Math.abs(camera.fov - fovK) > 1e-3) { camera.fov = fovK; camera.updateProjectionMatrix(); }
  camera.position.set(cb.x, road.surfaceY(cb, 0) + hh, cb.z);
  P.yaw += P.spin * dt;
  let yaw = P.yaw * D2R;
  if (P.face) yaw = (look.az * D2R) - sm.th;
  const th = sm.th + yaw, pitch = P.pitch * D2R;
  camera.lookAt(camera.position.x + Math.sin(th) * 50, camera.position.y + Math.tan(pitch) * 50, camera.position.z + Math.cos(th) * 50);
  sky.update(dt, camera, player.position);
  return look;
}

let benchFrame = null;
function frame() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - t0) / 1000); t0 = now;
  const look = updateWorld(dt);
  const c0 = performance.now();
  if (bench.on) { bench.timer.poll(); bench.timer.begin('frame'); }
  if (post) {
    const night = P.night01 >= 0 ? P.night01 : look.night;
    if (hitAt > 0 && frames % 90 === 5) post.hit(hitAt);
    post.setParams({ speed01: P.speed01, boost: P.boost, damage01: P.damage01, night01: night, dof: P.dof, slowmo: P.slowmo, focusObject: player, anchor: player });
    post.render(dt);
  } else {
    renderer.render(scene, camera);
  }
  if (bench.on) bench.timer.end();
  cpuMs += performance.now() - c0;
  frames++; fpsAcc += dt; fpsN++;
  if (benchFrame) benchFrame();
  if (fpsAcc > 0.5) {
    const info = post ? post.stats : renderer.info.render;
    hud.textContent = `s=${s.toFixed(0)}  q=${post ? post.quality : '-'}  fps=${(fpsN / fpsAcc).toFixed(0)}  cpu=${(cpuMs / fpsN).toFixed(2)}ms  calls=${info.calls} tris=${info.triangles}` + (post && post.timings ? '\n' + [...post.timings].map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' ') : '');
    fpsAcc = 0; fpsN = 0; cpuMs = 0;
  }
  if (q.has('shock') && post && window.__ready && ++shockCount === 12) post.shockwave(enemies[0]?.g.position ?? player.position, num('shock', 1));
  const ready = streamer.ready >= 3 && streamer.pending.size === 0 && streamer.chunks.size > 8;
  if (ready && frames > 25) window.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (post) post.setSize(innerWidth, innerHeight); else renderer.setSize(innerWidth, innerHeight); });
camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();

// ------------------------------------------------------------------ GUI
if (str('ui', '1') !== '0' && post) {
  const gui = new GUI({ title: 'Post', width: 300 });
  const st = { quality: post.quality, resScale: post.resolutionScale, tonemap: post.cfg.tonemap };
  gui.add(st, 'quality', { low: 0, medium: 1, high: 2, ultra: 3 }).onChange((v) => post.setQuality(+v));
  gui.add(st, 'resScale', 0.5, 1, 0.05).onChange((v) => post.setResolutionScale(v));
  gui.add(st, 'tonemap', ['aces', 'agx']).onChange((v) => { post.cfg.tonemap = v; });
  gui.add(post, 'taa');
  const fx = gui.addFolder('effects'); for (const k of FEATS) fx.add(post.feat, k);
  const pf = gui.addFolder('params');
  pf.add(P, 'speed01', 0, 1, 0.01); pf.add(P, 'boost', 0, 1, 0.01); pf.add(P, 'damage01', 0, 1, 0.01); pf.add(P, 'night01', -1, 1, 0.01);
  pf.add(P, 'dof', 0, 1, 0.01); pf.add(P, 'slowmo', 0, 1, 0.01); pf.add(P, 'fly', 0, 80, 1); pf.add(P, 'spin', -300, 300, 1);
  pf.add({ hit: () => post.hit(1) }, 'hit'); pf.add({ shock: () => post.shockwave(enemies[0]?.g.position ?? player.position, 1) }, 'shock');
  const cam = gui.addFolder('camera'); cam.add(P, 'fov', 40, 100, 1); cam.add(P, 'back', 3, 20, 0.1); cam.add(P, 'h', 1, 8, 0.1); cam.add(P, 'pitch', -30, 30, 0.5); cam.add(P, 'yaw', -180, 180, 1); cam.add(P, 'face');
  const C = post.cfg;
  const b = gui.addFolder('bloom'); b.add(C.bloom, 'intensity', 0, 2, 0.01); b.add(C.bloom, 'threshold', 0.2, 4, 0.01); b.add(C.bloom, 'knee', 0.01, 2, 0.01); b.add(C.bloom, 'radius', 0.2, 1, 0.01); b.add(C.bloom, 'clamp', 2, 100, 0.5); b.add(C.bloom, 'skyMul', 1, 40, 0.1);
  const a = gui.addFolder('ao'); a.add(C.ao, 'radius', 0.2, 8, 0.05); a.add(C.ao, 'intensity', 0.5, 10, 0.05); a.add(C.ao, 'falloff', 0.1, 5, 0.05);
  const m = gui.addFolder('motion blur'); m.add(C.mb, 'strength', 0, 3, 0.01); m.add(C.mb, 'maxFrac', 0.005, 0.1, 0.001); m.add(C.mb, 'carMask', 0, 1, 0.01); m.add(C.mb, 'nearZ0', 1, 30, 0.5); m.add(C.mb, 'nearZ1', 5, 120, 1); m.add(C.mb, 'nearMin', 0, 1, 0.01);
  const ca = gui.addFolder('chromatic'); ca.add(C.ca, 'base', 0, 0.02, 0.0002); ca.add(C.ca, 'speed', 0, 0.03, 0.0005); ca.add(C.ca, 'boost', 0, 0.03, 0.0005); ca.add(C.ca, 'hit', 0, 0.05, 0.0005);
  const v = gui.addFolder('vignette/grain'); v.add(C.vignette, 'base', 0, 1, 0.01); v.add(C.vignette, 'speed', 0, 1, 0.01); v.add(C.vignette, 'boost', 0, 1, 0.01); v.add(C, 'grain', 0, 0.15, 0.001); v.add(C, 'lines', 0, 2, 0.01); v.add(C, 'sharpen', 0, 1, 0.01);
  const g = gui.addFolder('grade'); g.add(C, 'exposure', 0.3, 2.5, 0.01); g.add(C.grade, 'contrast', 0, 1, 0.01); g.add(C.grade, 'saturation', 0, 2, 0.01);
  for (const k of ['shadowTint', 'highTint', 'lift', 'gamma', 'gain', 'nightMul']) { const f = g.addFolder(k); ['r', 'g', 'b'].forEach((n, i) => f.add(C.grade[k], i, k === 'shadowTint' || k === 'lift' ? -0.1 : 0.4, k === 'shadowTint' || k === 'lift' ? 0.1 : 2, 0.001).name(n)); f.close(); }
  const d = gui.addFolder('dof'); d.add(C.dof, 'bokeh', 0, 40, 0.5); d.add(C.dof, 'focus', 1, 60, 0.1); d.add(C.dof, 'range', 0, 10, 0.1); d.add(C.dof, 'near', 0, 1, 0.01);
  gui.close(); fx.open(); pf.open();
}

// ------------------------------------------------------------------ bench / probes
/** Measures wall-clock fps and GPU ms for the current config over `seconds`. */
async function measure(seconds, withPasses) {
  if (post) post.profile(!!withPasses);
  bench.on = !withPasses; bench.timer.reset();
  await new Promise((r) => { let n = 0; benchFrame = () => { if (++n > 40) { benchFrame = null; r(); } }; });
  bench.timer.reset(); if (post && post.timer) post.timer.reset();
  const t = performance.now(); let n = 0, cpu = 0;
  await new Promise((r) => { benchFrame = () => { n++; if (performance.now() - t > seconds * 1000) { benchFrame = null; r(); } }; });
  const wall = (performance.now() - t) / n;
  const out = { frames: n, wallMs: +wall.toFixed(2), fps: +(1000 / wall).toFixed(1) };
  if (withPasses) { out.passes = {}; if (post && post.timer) for (const [k, v] of post.timer.ms) out.passes[k] = +v.toFixed(3); post.profile(false); }
  else { const g = bench.timer.ms.get('frame'); out.gpuMs = g === undefined ? null : +g.toFixed(2); }
  bench.on = false;
  out.calls = post ? post.stats.calls : renderer.info.render.calls; out.tris = post ? post.stats.triangles : renderer.info.render.triangles;
  return out;
}
window.__bench = async (seconds = 3, opts = {}) => {
  const res = {};
  const setup = opts.setup || {};
  Object.assign(P, setup);
  res.timerSupported = bench.timer.supported;
  res.size = [renderer.domElement.width, renderer.domElement.height];
  if (post) {
    if (opts.q !== undefined) post.setQuality(opts.q);
    if (opts.scale !== undefined) post.setResolutionScale(opts.scale);
    if (opts.feat) post.setFeatures(opts.feat);
    res.quality = post.quality; res.internal = [post.internalSize.x, post.internalSize.y];
    res.total = await measure(seconds, false);
    res.perPass = (await measure(seconds, true)).passes;
  } else { res.total = await measure(seconds, false); }
  return res;
};
window.__setBaseline = (on) => { if (post) post.enabled = !on; };
window.__post = post; window.__P = P; window.__renderer = renderer; window.__scene = scene; window.__camera = camera; window.__streamer = streamer;
