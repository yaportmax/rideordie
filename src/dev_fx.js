// FX test page:  /fx.html?demo=explosion&t=0.6&ui=0
//   demo=all|explosion|explosion2|explosion3|tanker|weapons|muzzle|impacts|drift|nitro|burn|smoke|rocket|grenade|crash|skid|offroad|perf|night
//        boss|bosscannon|bosspart|bossramp|bossmg|bossdeath|hazards|firelab (wreck + barrel + oil fire)|ownburn (the local truck on fire:
//        attached hood fire, &truck=<id>&v=<m/s>&smoke=1)|land (hard landing sparks)|scrape (contact sparks on the local truck)
//   post=lite: the old bloom+ACES preview instead of the game's Post pipeline (AgX grade, bloom, soft-particle depth)
//   t=<seconds>   pre-step the demo to that time (fixed 60 Hz), then freeze (deterministic screenshots)
//   q=0..3 quality   bloom=0 disables the HDR bloom preview   ui=0 hides buttons/HUD   s=<road s> time-of-day (look)   cam=x,y,z,tx,ty,tz   fov=55   surf=gravel|sand|...
//   Mouse: drag = orbit, wheel = zoom.  Keys: see buttons.
import * as THREE from 'three';
import { SkyRig } from './world/sky.js';
import { lookAt } from './world/look.js';
import { makeRoadMaterial } from './world/terrain_material.js';
import * as Assets from './core/assets.js';
import { CarView } from './view/car_view.js';
import { makeCarState } from './view/car_state.js';
import { VEHICLES } from './data/vehicles.js';
import { WEAPONS, WEAPON_ORDER } from './data/weapons.js';
import { Fx } from './view/fx.js';
import { BossView, BOSS_URL } from './view/boss_view.js';
import { BOSS_ID, PART_NAMES } from './data/boss.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode } from 'postprocessing';
import { Post } from './view/post.js';

const Q = new URLSearchParams(location.search);
const num = (k, d) => (Q.has(k) ? parseFloat(Q.get(k)) : d);
const demo = Q.get('demo') || 'all';
const quality = num('q', 2);
const useBloom = num('bloom', 1) > 0;
const showUi = num('ui', 1) > 0;

const renderer = new THREE.WebGLRenderer({ antialias: !useBloom, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(num('fov', 55), innerWidth / innerHeight, 0.15, 6000);
const look = lookAt(demo === 'night' || Q.has('night') ? 45500 : num('s', 3000));
const sky = new SkyRig(renderer, scene, { shadowSize: 2048, shadowExtent: 45 });
sky.setLook(look, true);

// ---------------------------------------------------------------------------------------------- ground + road strip
const tl = new THREE.TextureLoader();
const tex = (u, srgb, rep) => { const t = tl.load(u); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; if (rep) t.repeat.set(rep, rep); return t; };
const sandMat = new THREE.MeshStandardMaterial({ map: tex('/textures/sand/albedo.jpg', true, 260), roughness: 1, color: 0xd8c4a4 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), sandMat);
ground.position.set(0, -0.03, 100); ground.receiveShadow = true; scene.add(ground);
const roadMat = makeRoadMaterial({ albedo: tex('/textures/asphalt/albedo.jpg', true), normal: tex('/textures/asphalt/normal.jpg', false), arm: tex('/textures/asphalt/arm.jpg', false) });
{
  const z0 = -200, z1 = 500, hw = 7.6;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-hw, 0, z0, hw, 0, z0, -hw, 0, z1, hw, 0, z1], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([-hw, z0, hw, z0, -hw, z1, hw, z1], 2));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  const road = new THREE.Mesh(g, roadMat); road.receiveShadow = true; scene.add(road);
}

// ---------------------------------------------------------------------------------------------- post (HDR bloom preview like the game's Post)
let composer = null, post = null;
if (useBloom && Q.get('post') !== 'lite') {                 // the game's real pipeline (AgX grade, bloom, soft-particle depth)
  post = new Post(renderer, scene, camera, { quality: num('pq', 2) });
  post.setSize(innerWidth, innerHeight);
} else if (useBloom) {
  renderer.toneMapping = THREE.NoToneMapping;
  composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({ intensity: 0.8, luminanceThreshold: num('bt', 4), luminanceSmoothing: 0.6, mipmapBlur: true, radius: 0.7 });
  const tm = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
  composer.addPass(new EffectPass(camera, bloom, tm));
}

// ---------------------------------------------------------------------------------------------- fx
const fx = new Fx(scene, camera, { quality });
const urls = ['e_sedan', 'e_heavy', 'e_van', 'e_tanker'].map((n) => `/models/vehicles/${n}.glb`);
await Promise.all([Assets.preload(urls), fx.load()]);
if (post) fx.setDepthSource(post);

if (Q.has('prewarm')) {                                  // same as the game: compile against a HalfFloat target (post input) and the canvas
  const done = fx.prewarm(), rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  renderer.setRenderTarget(rt); await renderer.compileAsync(scene, camera); renderer.setRenderTarget(null); await renderer.compileAsync(scene, camera);
  rt.dispose(); done();
}
const carViews = new Map(), states = new Map();
let shakeAcc = 0;
const ctx = { carViews, states, playerId: 1, cameraPos: camera.position, shake: (a) => { shakeAcc = Math.max(shakeAcc, a); } };
const cars = [];
let nextId = 1;

class DemoCar {
  constructor(specId, x, z, opts = {}) {
    this.id = opts.id ?? nextId++;
    this.spec = VEHICLES[specId]; this.x = x; this.z = z; this.yaw = opts.yaw ?? 0; this.t0 = 0;
    this.state = makeCarState(this.id, specId, opts.kind || 'enemy');
    this.view = new CarView(this.spec, { paint: opts.paint ?? 0x8f6a3d, paint2: 0x30302e });
    scene.add(this.view.root);
    this.restLen = this.state.ride.restLen; this.comY = this.state.ride.restComHeight;
    this.f = { drive: false, speed: 0, drift: false, boost: false, smoke: false, burn: false, flat: false, dir: 1, slide: false };
    this.wreck = null; this.roll = 0; this.pitch = 0; this.y = 0;
    this.eul = new THREE.Euler(0, 0, 0, 'YXZ');
    carViews.set(this.id, this.view); states.set(this.id, this.state);
    for (const o of ['grounded']) this.state[o].fill(1);
    this.step(0, 0);
    cars.push(this);
  }
  launch(vy, wx, wz, vx = 0, vzz = 0) { this.wreck = { vy, wx, wz, vx, vz: vzz }; this.f.drive = false; }
  step(dt, t) {
    const s = this.state, f = this.f, n = this.spec.wheels.length;
    let air = false;
    if (this.wreck) {
      const w = this.wreck;
      w.vy -= 9.81 * dt; this.y += w.vy * dt;
      this.x += w.vx * dt; this.z += w.vz * dt; this.roll += w.wz * dt; this.pitch += w.wx * dt;
      if (this.y <= 0) { this.y = 0; if (w.vy < -2.5) { w.vy = -w.vy * 0.28; w.wz *= 0.5; w.wx *= 0.5; } else { w.vy = 0; w.wz *= Math.pow(0.02, dt); w.wx *= Math.pow(0.02, dt); w.vx *= Math.pow(0.35, dt); w.vz *= Math.pow(0.35, dt); } }
      air = this.y > 0.05;
      s.vel.set(w.vx, w.vy, w.vz); s.speed = Math.hypot(w.vx, w.vz);
    } else if (f.drive) {
      const v = f.speed * f.dir;
      this.z += v * dt;
      if (this.z > 360 || this.z < -120) { this.z = f.dir > 0 ? -100 : 340; for (let i = 0; i < n; i++) fx.skid.end(this.id * 16 + i); }
      this.yaw = (f.dir > 0 ? 0 : Math.PI) + (f.drift ? 0.5 * Math.sin(t * 0.9 + this.id) : 0.02 * Math.sin(t * 0.5 + this.id));
      s.vel.set(0, 0, v); s.speed = Math.abs(v);
    } else { s.vel.set(0, 0, 0); s.speed = 0; }
    this.eul.set(this.pitch, this.yaw, this.roll, 'YXZ'); s.quat.setFromEuler(this.eul);
    s.pos.set(this.x, this.comY + this.y, this.z);
    s.steer = f.drift ? -0.5 * Math.cos(t * 0.9 + this.id) : 0.05 * Math.sin(t * 0.5);
    const spd = s.speed;
    for (let i = 0; i < n; i++) {
      s.L[i] = this.restLen + 0.025 * Math.sin(t * 7 + i * 1.7) * Math.min(1, spd / 30) + (air ? 0.12 : 0); s.grounded[i] = air ? 0 : 1;
      const rear = !this.spec.wheels[i].front;
      s.slip[i] = f.drift ? (rear ? 0.95 : 0.6) : (f.slide ? 0.7 : 0);
      s.flat[i] = f.flat && i === 3 ? 1 : 0;
    }
    s.smoking = f.smoke || f.burn; s.burning = f.burn; s.boosting = f.boost; s.drifting = f.drift; s.rpm01 = 0.3 + 0.6 * Math.min(1, spd / 42);
    s.airborne = air; s.exploded = !!this.exploded; s.dead = !!this.exploded; s.engineHp01 = f.burn ? 0.05 : f.smoke ? 0.3 : 1;
    this.view.update(s, dt);
  }
  surface() { const a = Math.abs(this.x); return Q.get('surf') || (a < 7 ? 'asphalt' : a < 9.5 ? 'gravel' : 'sand'); }
  remove() { this.view.dispose(); carViews.delete(this.id); states.delete(this.id); const i = cars.indexOf(this); if (i >= 0) cars.splice(i, 1); }
}

const fire = (e) => fx.handleEvent(e, ctx);
function explodeCar(c, size = 1) {
  const p = c.state.pos;
  c.exploded = true; c.f.drive = false;
  fire({ t: 'explode', id: c.id, pos: [p.x, p.y, p.z], size, cause: 'damage', spec: c.spec.id, vel: [c.state.vel.x, c.state.vel.y, c.state.vel.z] });
  c.launch(7 + 2 * size, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 4, 1.5, 3);
}
function shootFrom(wid, o, target, extra = {}) {
  const rays = [{ end: target, surface: 'dirt', normal: [0, 1, 0] }];
  if (wid === 'shotgun') for (let i = 0; i < 8; i++) rays.push({ end: [target[0] + (Math.random() - 0.5) * 6, target[1] + (Math.random() - 0.5) * 2, target[2] + (Math.random() - 0.5) * 6], surface: 'dirt', normal: [0, 1, 0] });
  if (wid === 'rpg') return fire({ t: 'shot', src: 'player', weapon: 'rpg', origin: o, dir: norm([target[0] - o[0], target[1] - o[1], target[2] - o[2]]), rocket: true });
  fire({ t: 'shot', src: 'player', weapon: wid, origin: o, rays, mode: WEAPONS[wid].mode, ...extra });
}
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// gun markers for the weapon demos
const gunMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.5, metalness: 0.7 });
function gunMarker(x, y, z, len = 0.7) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, len), gunMat); m.position.set(x, y, z + len / 2 - 0.15); m.castShadow = true; scene.add(m); return m; }


// ---------------------------------------------------------------------------------------------- boss (real BossView + GLB, lazily loaded)
let boss = null;
async function ensureBoss(z = 60) {
  if (boss) return boss;
  await Assets.preload([BOSS_URL]);
  const view = new BossView(null); scene.add(view.root);
  const st = { pos: new THREE.Vector3(0, 0.02, z), quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 0, 0), v: 0, alive: {}, dead: false, exploded: false, phase: 1 };
  for (const n of PART_NAMES) st.alive[n] = true;
  boss = { view, st, z, v: 0, decel: 0 };
  carViews.set(BOSS_ID, view);
  view.update(st, 0);
  return boss;
}
function stepBoss(dt) {
  if (!boss) return;
  if (boss.decel) boss.v = Math.max(0, boss.v - boss.decel * dt);
  boss.z += boss.v * dt; const st = boss.st;
  st.pos.set(0, 0.02, boss.z); st.vel.set(0, 0, boss.v); st.v = boss.v;
  boss.view.update(st, dt);
}
const bossW = (x, y, z) => [x, y + 0.02, (boss ? boss.z : 60) + z];           // boss model frame -> world (boss faces +Z at x=0)
function bossPart(name) {
  if (!boss) return;
  const b = { part_tank_L: [3.05, 4.1, -13.6], part_tank_R: [-3.05, 4.1, -13.6], part_turret_1: [0, 6, 1], part_turret_2: [0, 6, -4.4], part_pod_L: [3, 5.9, -2.7], part_pod_R: [-3, 5.9, -2.7], part_turret_main: [0, 5.5, -10.5], part_stack_L: [2.4, 5.9, 6.2], part_stack_R: [-2.4, 5.9, 6.2], part_plow: [0, 2, 15.3], part_engine: [0, 7, -16] }[name] || [3.7, 3.7, -0.3];
  boss.st.alive[name] = false;
  const pos = bossW(b[0], b[1], b[2]), explodes = /tank/.test(name), core = !/stack|plow|panel_armor_t|cab|roof/.test(name);
  fire({ t: 'bossPart', part: name, label: name, pos, explodes });
  if (explodes) fire({ t: 'boom', pos, radius: 16, kind: 'tank' }); else if (core) fire({ t: 'boom', pos, radius: 6, kind: 'part' });
}
function bossDeath(t0) {
  at(t0, () => { fire({ t: 'bossDying', pos: bossW(0, 0, 0) }); boss.decel = 7; });
  for (let k = 0; k < 12; k++) at(t0 + k / 3, () => fire({ t: 'explode', id: BOSS_ID, pos: bossW((Math.random() - 0.5) * 6, 2 + Math.random() * 5, (Math.random() - 0.5) * 32), size: 1.6, cause: 'boss', spec: 'boss', vel: [0, 0, boss.v] }));
  at(t0 + 4.2, () => { boss.st.exploded = true; fire({ t: 'explode', id: BOSS_ID, pos: bossW(0, 0, 0), size: 3.5, cause: 'boss', spec: 'boss', vel: [0, 0, 0] }); });
}
function bossMG() {
  const o = bossW(0, 4.7 + 1.3, -5.6);
  fire({ t: 'shot', src: BOSS_ID, weapon: 'enemy', heavy: true, origin: o, rays: [norm([0.55 + (Math.random() - 0.5) * 0.05, -0.08, -0.83])], speed: 220, pellets: 1 });
}
function followBoss(az, el, dist, h = 4, lead = 0) { camSetup = () => { if (!boss) return; orbit.target.set(0, h, boss.z + lead); orbit.az = az; orbit.el = el; orbit.dist = dist; }; }

// ---------------------------------------------------------------------------------------------- demos
let script = [], camSetup = null; const hooks = [];
const S = { t: 0 };
function at(t, fn) { script.push({ t, fn, done: false }); }
function setCam(px, py, pz, tx, ty, tz, fov) { orbit.target.set(tx, ty, tz); orbit.setFromPos(px, py, pz); if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); } }

const orbit = {
  target: new THREE.Vector3(0, 1.5, 30), az: 0, el: 0.2, dist: 20,
  setFromPos(x, y, z) { const dx = x - this.target.x, dy = y - this.target.y, dz = z - this.target.z; this.dist = Math.hypot(dx, dy, dz); this.az = Math.atan2(dx, dz); this.el = Math.asin(dy / this.dist); },
  apply() { const c = Math.cos(this.el); camera.position.set(this.target.x + Math.sin(this.az) * c * this.dist, this.target.y + Math.sin(this.el) * this.dist, this.target.z + Math.cos(this.az) * c * this.dist); camera.lookAt(this.target); },
};
let dragging = false, lx = 0, ly = 0;
addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('#ui')) return; dragging = true; lx = e.clientX; ly = e.clientY; });
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointermove', (e) => { if (!dragging) return; orbit.az -= (e.clientX - lx) * 0.005; orbit.el = Math.max(-0.2, Math.min(1.4, orbit.el + (e.clientY - ly) * 0.005)); lx = e.clientX; ly = e.clientY; });
addEventListener('wheel', (e) => { orbit.dist = Math.max(3, orbit.dist * (1 + Math.sign(e.deltaY) * 0.1)); });

function follow(car, az, el, dist, h = 1.0, lead = 0) { camSetup = () => { orbit.target.set(car.x, h, car.z + lead); orbit.az = az; orbit.el = el; orbit.dist = dist; }; }
const DEMOS = {
  all() {
    setCam(-10, 2.6, 24, 0, 1.4, 42, 58);
    const a = new DemoCar('e_sedan', -3.5, 20, { paint: 0x8a3b2a }); a.f.drive = true; a.f.speed = 26; a.f.drift = true;
    const b = new DemoCar('e_van', 3.5, 50, { paint: 0x4a5a3a }); b.f.drive = true; b.f.speed = 22; b.f.smoke = true;
    const c = new DemoCar('e_sedan', 0, 10, { paint: 0x3d4a5f }); c.f.drive = true; c.f.speed = 31; c.f.boost = true;
  },
  explosion() { setCam(-9, 1.7, 22, 0, 3.6, 42, 56); const c = new DemoCar('e_sedan', 0, 42, { paint: 0x8a3b2a }); at(0.15, () => explodeCar(c, 1)); },
  explosion2() { setCam(-15, 3.2, 20, 0, 4.2, 42, 56); const c = new DemoCar('e_heavy', 0, 42, { paint: 0x59595a }); at(0.15, () => explodeCar(c, 1.8)); },
  explosion3() { setCam(-19, 3.6, 16, 0, 5, 42, 58); const c = new DemoCar('e_tanker', 0, 42, { paint: 0x8a7a4a }); at(0.15, () => explodeCar(c, 2.4)); },
  tanker() { DEMOS.explosion3(); },
  rocket() {
    setCam(-6, 2.4, 6, 4, 2.8, 50, 58);
    const c = new DemoCar('e_sedan', 3, 60, { paint: 0x6a2f2f }); c.f.drive = true; c.f.speed = 12; c.f.dir = 1;
    at(0.3, () => shootFrom('rpg', [-1.2, 2.2, 8], [3, 1, 50]));
    at(0.95, () => { const p = c.state.pos; fire({ t: 'boom', pos: [3, 0.6, c.z - 1], radius: 11, kind: 'rocket' }); fire({ t: 'explode', id: c.id, pos: [p.x, p.y, p.z], size: 1, cause: 'rocket', spec: c.spec.id, vel: [0, 0, 12] }); c.exploded = true; c.launch(9, 2, 3, 0, 8); });
  },
  grenade() {
    setCam(-6, 1.9, 12, 1, 1.2, 32, 56);
    at(0.1, () => fire({ t: 'grenadeThrow', origin: [-1.5, 1.8, 14], vel: [1.4, 5.5, 13] }));
    at(2.2, () => { const g = fx.grenades; fire({ t: 'boom', pos: [g.px[0], Math.max(0.2, g.py[0]), g.pz[0]], radius: 9.5, kind: 'grenade' }); });
  },
  weapons() {
    setCam(-4.6, 1.75, 1.8, 0.4, 1.3, 9.2, 62);
    WEAPON_ORDER.forEach((w, i) => { const x = 3.5 - i * 1.0, y = 1.3; gunMarker(x, y, 8, w === 'rpg' ? 1.0 : 0.7); at(0.1 + (i % 2) * 0.0, () => shootFrom(w, [x, y, 8.6], [x * 0.6 + 4, 0, 90])); });
  },
  muzzle() {
    setCam(1.5, 1.7, 5.4, 0, 1.35, 9.4, 50);
    gunMarker(0, 1.3, 8);
    at(0.05, () => shootFrom(Q.get('w') || 'rifle', [0, 1.3, 8.7], [0, 0, 80]));
  },
  shells() {
    const p = new DemoCar('e_sedan', 0, 20, { paint: 0x3d4a5f, kind: 'player', id: 1 }); p.f.drive = true; p.f.speed = 22;
    follow(p, 2.55, 0.22, 6.5, 1.5, 0);
    let nextShot = 0.2;
    hooks.push((dt, t) => {
      if (t < nextShot) return; nextShot = t + 0.085;
      const o = [p.x - 0.1, 1.55, p.z - 0.6];
      fire({ t: 'shot', src: 'player', weapon: Q.get('w') || 'rifle', origin: [o[0], o[1], o[2] + 1.2], rays: [{ end: [o[0], 0, o[2] + 90], surface: 'dirt', normal: [0, 1, 0] }], mode: 'auto' });
    });
  },
  boss() {
    boss.v = 22; followBoss(num('az', 2.75), num('el', 0.32), num('dist', 44), 4, -8);
    at(0.2, () => fire({ t: 'bossPhase', phase: 3, pos: bossW(0, 0, 0) }));
    at(0.3, () => fire({ t: 'bossFlame', side: 'L', on: true, pos: bossW(2.55, 4.1, -17.05) }));
    at(0.5, () => fire({ t: 'bossFlame', side: 'R', on: true, pos: bossW(-2.55, 4.1, -17.05) }));
  },
  bosscannon() {
    boss.v = 22; followBoss(num('az', 1.75), num('el', 0.2), num('dist', 38), 5, -8);
    at(0.2, () => fire({ t: 'bossCharge', pos: bossW(0, 5.5, -6.1) }));
    at(1.5, () => { const o = bossW(0, 5.51, -6.1); const d = norm([0.35, -0.08, -1]); fire({ t: 'shot', src: BOSS_ID, weapon: 'cannon', origin: o, dir: d, rocket: true, speed: 150, heavy: true }); fire({ t: 'bossCannon', pos: o }); });
  },
  bosspart() {
    boss.v = 22; followBoss(0.95, 0.18, 44, 4, -4);
    at(0.2, () => bossPart('part_tank_L'));
    at(0.7, () => bossPart('part_pod_L'));
    at(1.1, () => bossPart('panel_armor_t1_L1'));
    at(1.5, () => bossPart('part_stack_L'));
    for (let i = 0; i < 8; i++) at(0.3 + i * 0.12, () => fire({ t: 'bossDeflect', pos: bossW(3.45, 2.5 + Math.random() * 2, -7 + Math.random() * 12) }));
  },
  bossramp() { boss.v = 22; followBoss(2.4, 0.12, 30, 2, -18); at(0.2, () => fire({ t: 'bossRamp', pos: bossW(0, 3.02, -17) })); },
  bossmg() { boss.v = 0; followBoss(num('az', 1.9), num('el', 0.12), num('dist', 30), 5, -6); for (let i = 0; i < 14; i++) at(0.1 + i * 0.125, bossMG); at(0.1, () => fire({ t: 'bossVolley', pos: bossW(0, 0, 0) })); },
  bossdeath() { boss.v = 18; followBoss(0.85, 0.2, 90, 12, 10); bossDeath(0.2); },
  hazards() {
    setCam(-7.5, 3.2, 20, 0.5, 0.4, 38, 55);
    at(0.05, () => { fire({ t: 'mineDrop', pos: [-3, 0.1, 30] }); fire({ t: 'mineDrop', pos: [-1.2, 0.1, 33.5] }); });
    at(0.05, () => { fire({ t: 'mineDrop', pos: [2.2, 0.15, 31], enemy: true }); fire({ t: 'mineDrop', pos: [4.3, 0.15, 36], enemy: true }); });
    at(0.1, () => fire({ t: 'oil', pos: [-0.5, 0.6, 45], r: 5.5, dir: [0.1, 1] }));      // pos = car COM, like the sim
    const c = new DemoCar('e_sedan', 3, 10, { paint: 0x3d4a5f }); c.f.drive = true; c.f.speed = 26;
    at(0.6, () => fire({ t: 'boostPad', id: c.id, pos: [c.state.pos.x, c.state.pos.y, c.state.pos.z] }));
    at(Q.has('mineboom') ? 1.4 : 99, () => fire({ t: 'boom', pos: [-3, 0.2, 30], radius: 8, kind: 'mine' }));
  },
  tracers() {
    setCam(2.2, 1.9, 2.0, -0.5, 1.3, 30, 60);
    for (let i = 0; i < 10; i++) at(0.02 + i * 0.03, () => shootFrom(i < 5 ? 'rifle' : 'lmg', [0.4, 1.35, 5], [-0.5 + (Math.random() - 0.5) * 3, 0, 70 + Math.random() * 50]));
    at(0.05, () => shootFrom('sniper', [0.4, 1.4, 5], [-1, 0, 130]));
    at(0.1, () => shootFrom('shotgun', [0.6, 1.3, 5], [-1, 0, 55]));
    at(0.15, () => { const rays = []; for (let i = 0; i < 5; i++) rays.push(norm([0.03 + i * 0.004, 0.01 + i * 0.003, -1])); fire({ t: 'shot', src: 2, weapon: 'enemy', origin: [-1.5, 1.5, 60], rays, speed: 130, role: 'gunner', pellets: 5 }); });
  },
  impacts() {
    setCam(-3.5, 1.7, 5, 0, 0.6, 12, 50);
    const kinds = ['metal', 'dirt', 'glass', 'flesh', 'tire', 'rock', 'sand'];
    kinds.forEach((k, i) => at(0.05, () => fire({ t: 'hit', pos: [3 - i * 1.0, 0.05, 12], normal: [0, 1, 0], surface: k, carId: -1 })));
    at(0.05, () => { for (let i = 0; i < 6; i++) fire({ t: 'hit', pos: [3 - i * 1.0, 1.2, 14], normal: [0, 0.2, -1], surface: 'metal', carId: 1 }); });
  },
  drift() {
    setCam(-11, 2.2, 22, 0, 1.0, 40, 58);
    const a = new DemoCar('e_sedan', -1, 15, { paint: 0x8a3b2a }); a.f.drive = true; a.f.speed = 24; a.f.drift = true; follow(a, 2.6, 0.16, 11, 1.0);
  },
  skid() { setCam(-14, 6, 40, 0, 0, 55, 50); const a = new DemoCar('e_sedan', 0, 20, { paint: 0x8a3b2a }); a.f.drive = true; a.f.speed = 18; a.f.drift = true; follow(a, 2.4, 0.5, 12, 0.3, -6); },
  nitro() {
    setCam(-2.5, 1.2, 33, 0, 0.9, 44, 62);
    const a = new DemoCar('e_tanker', 1, 45, { paint: 0x8a7a4a }); a.f.drive = true; a.f.speed = 30; a.f.boost = true; follow(a, Math.PI * 0.85, 0.08, 8, 1.0);
  },
  burn() {
    setCam(-11, 3.2, 24, 0, 1.8, 42, 56);
    const c = new DemoCar('e_sedan', 0, 42, { paint: 0x8a3b2a }); at(0.05, () => explodeCar(c, 1));
  },
  smoke() { setCam(-8, 2.4, 22, 0, 1.5, 34, 56); const a = new DemoCar('e_sedan', -3, 30, { paint: 0x3d4a5f }); a.f.drive = true; a.f.speed = 16; a.f.smoke = true; const b = new DemoCar('e_van', 3, 42, { paint: 0x8a3b2a }); b.f.drive = true; b.f.speed = 15; b.f.burn = true; follow(a, 2.5, 0.18, 14, 1.4, 6); },
  crash() { setCam(-7, 1.7, 22, 0, 1.0, 36, 56); const c = new DemoCar('e_sedan', 0, 36, { paint: 0x3d4a5f }); at(0.1, () => fire({ t: 'crash', id: c.id, other: -1, dv: 8, speed: 30, pos: [0, 0.8, 36] })); at(0.6, () => fire({ t: 'tirePop', id: c.id, index: 2 })); },
  offroad() {
    setCam(-16, 2.6, 8, 21, 1.5, 40, 58);
    const a = new DemoCar('e_sedan', 18, 15, { paint: 0x8a3b2a }); a.f.drive = true; a.f.speed = 28; a.f.slide = true;
    const b = new DemoCar('e_van', 27, 60, { paint: 0x4a5a3a }); b.f.drive = true; b.f.speed = 30; follow(a, 2.7, 0.14, 13, 1.0);
  },
  night() {
    setCam(-10, 2.4, 22, 0, 2.4, 42, 56);
    const c = new DemoCar('e_sedan', 0, 42, { paint: 0x8a3b2a }); at(0.15, () => explodeCar(c, 1));
    at(0.05, () => shootFrom('lmg', [-3, 1.5, 28], [0, 0, 90]));
  },
  land() {                                              // a jump landing hard on asphalt: undercarriage sparks + dust
    const c = new DemoCar('e_sedan', 0, 10, { paint: 0x3d4a5f }); at(0.1, () => c.launch(7, 0, 0, 0, 22)); follow(c, 2.3, 0.12, 9, 0.8, 0);
  },
  scrape() {                                            // the local truck grinding along a rail: contact sparks on the hull side
    const p = new DemoCar('e_van', 0, 20, { paint: 0x8f6a3d, kind: 'player', id: 1 }); p.f.drive = true; p.f.speed = 24;
    hooks.push((dt, t) => { if (((t * 8) | 0) !== ((t - dt) * 8 | 0)) fire({ t: 'crash', id: 1, other: -1, dv: 3 + Math.random() * 3, speed: 24, pos: [p.state.pos.x, p.state.pos.y, p.state.pos.z] }); });
    follow(p, num('az', 2.2), 0.15, 9, 1.0, 0);
  },
  ownburn() {                                           // the local player's truck on fire (attached hood fire / smoke + cabin clip)
    const p = new DemoCar(Q.get('truck') || 'truck_t4', 0, 20, { paint: 0x8f6a3d, kind: 'player', id: 1 }); p.f.drive = true; p.f.speed = num('v', 25); p.f.burn = !Q.has('smoke'); p.f.smoke = true;
    follow(p, num('az', 2.4), num('el', 0.25), num('dist', 11), 1.4, 0);
  },
  firelab() {
    setCam(-9, 2.6, 18, 1, 1.6, 34, 55);
    const c = new DemoCar('e_sedan', -2.5, 34, { paint: 0x8a3b2a }); at(0.05, () => explodeCar(c, 1));
    at(0.05, () => { fire({ t: 'mineDrop', pos: [3.5, 0.15, 30], enemy: true }); fire({ t: 'oil', pos: [1.5, 0.6, 40], r: 4.5, dir: [0.2, 1] }); });
    at(0.3, () => fire({ t: 'boom', pos: [1.5, 0.3, 40], radius: 6, kind: 'grenade' }));
    const b = new DemoCar('e_van', 5.5, 10, { paint: 0x4a5a3a }); b.f.drive = true; b.f.speed = 14; b.f.burn = true;
  },
  perf() {
    setCam(-14, 4, 10, 0, 2, 50, 58);
    for (let i = 0; i < 10; i++) { const c = new DemoCar(i % 3 === 0 ? 'e_van' : 'e_sedan', -5 + (i % 3) * 5, 10 + i * 9, { paint: 0x8a3b2a }); c.f.drive = true; c.f.speed = 22 + i; c.f.smoke = true; c.f.drift = i % 2 === 0; c.f.boost = i % 4 === 1; }
    const t = new DemoCar('e_tanker', 0, 60, { paint: 0x8a7a4a }); at(0.5, () => explodeCar(t, 2.4));
  },
};
if (/^boss/.test(demo)) await ensureBoss();
(DEMOS[demo] || DEMOS.all)();
if (Q.get('cam')) { const c = Q.get('cam').split(',').map(Number); setCam(c[0], c[1], c[2], c[3], c[4], c[5]); }

// ---------------------------------------------------------------------------------------------- ui
const hud = document.getElementById('hud'), ui = document.getElementById('ui');
if (!showUi) { hud.style.display = 'none'; ui.style.display = 'none'; }
const spawnCar = (spec, x, z, o) => new DemoCar(spec, x, z, o);
function addBtn(group, label, fn) { let g = ui.querySelector(`[data-g="${group}"]`); if (!g) { g = document.createElement('div'); g.dataset.g = group; g.innerHTML = `<h4>${group}</h4>`; ui.appendChild(g); } const b = document.createElement('button'); b.textContent = label; b.onclick = () => fn(b); g.appendChild(b); return b; }
const aim = () => orbit.target;
function freshCar(spec, dz = 0, paint = 0x8a3b2a) { const t = aim(); return spawnCar(spec, 0, t.z + dz, { paint }); }
addBtn('explosions', 'car (1.0)', () => explodeCar(freshCar('e_sedan'), 1));
addBtn('explosions', 'heavy (1.8)', () => explodeCar(freshCar('e_heavy', 0, 0x59595a), 1.8));
addBtn('explosions', 'tanker (2.4)', () => explodeCar(freshCar('e_tanker', 0, 0x8a7a4a), 2.4));
addBtn('explosions', 'rocket boom', () => fire({ t: 'boom', pos: [aim().x, 0.3, aim().z], radius: 11, kind: 'rocket' }));
addBtn('explosions', 'grenade boom', () => fire({ t: 'boom', pos: [aim().x, 0.2, aim().z], radius: 9.5, kind: 'grenade' }));
addBtn('explosions', 'crash', () => fire({ t: 'crash', id: 2, other: -1, dv: 7, speed: 30, pos: [aim().x, 0.8, aim().z] }));
for (const w of WEAPON_ORDER) addBtn('weapons', w, () => { const t = aim(); shootFrom(w, [t.x, 1.4, t.z - 6], [t.x + (Math.random() - 0.5) * 4, 0, t.z + 70]); });
addBtn('enemy fire', 'enemy volley', () => { const t = aim(); const o = [t.x + 3, 1.4, t.z + 40]; const rays = []; for (let i = 0; i < 6; i++) rays.push(norm([-0.06 + Math.random() * 0.04, -0.02 + Math.random() * 0.02, -1])); fire({ t: 'shot', src: 2, weapon: 'enemy', origin: o, rays, speed: 130, role: 'gunner', pellets: 6 }); });
addBtn('enemy fire', 'whizz', () => { const c = camera.position; fire({ t: 'whizz', pos: [c.x + 1, c.y, c.z + 4], dist: 1 }); });
addBtn('enemy fire', 'rocket', () => { const t = aim(); shootFrom('rpg', [t.x - 1, 2.2, t.z - 20], [t.x, 1, t.z + 40]); });
addBtn('enemy fire', 'grenade', () => { const t = aim(); fire({ t: 'grenadeThrow', origin: [t.x - 1, 2, t.z - 14], vel: [1.2, 6.5, 14] }); });
for (const s of ['metal', 'dirt', 'glass', 'flesh', 'tire', 'rock', 'sand']) addBtn('impacts', s, () => { const t = aim(); fire({ t: 'hit', pos: [t.x, s === 'metal' || s === 'glass' ? 1.2 : 0.05, t.z], normal: s === 'metal' || s === 'glass' ? [0, 0.2, -1] : [0, 1, 0], surface: s, carId: s === 'metal' ? 1 : -1 }); });
addBtn('cars', 'drive', () => { const c = freshCar('e_sedan', -20, 0x3d4a5f); c.f.drive = true; c.f.speed = 26; });
addBtn('cars', 'drift', () => { const c = freshCar('e_sedan', -20); c.f.drive = true; c.f.speed = 24; c.f.drift = true; });
addBtn('cars', 'nitro', () => { const c = freshCar('e_van', -20, 0x4a5a3a); c.f.drive = true; c.f.speed = 32; c.f.boost = true; });
addBtn('cars', 'smoking', () => { const c = freshCar('e_sedan', -20, 0x3d4a5f); c.f.drive = true; c.f.speed = 18; c.f.smoke = true; });
addBtn('cars', 'burning', () => { const c = freshCar('e_sedan', -20); c.f.drive = true; c.f.speed = 18; c.f.burn = true; });
addBtn('cars', 'flat tyre', () => { const c = freshCar('e_sedan', -20); c.f.drive = true; c.f.speed = 20; c.f.flat = true; });
addBtn('cars', 'tyre pop', () => { const c = cars[cars.length - 1]; if (c) fire({ t: 'tirePop', id: c.id, index: 2 }); });
addBtn('cars', 'clear cars', () => { while (cars.length) cars[0].remove(); });
addBtn('cars', 'clear fx', () => fx.clear());
const withBoss = (fn) => () => { ensureBoss(aim().z + 30).then((b) => { if (!b.v && !b.decel) b.v = 20; if (!camSetup) followBoss(0.9, 0.16, 44, 4, -4); fn(); }); };
addBtn('boss', 'spawn', withBoss(() => {}));
addBtn('boss', 'flame L', withBoss(() => fire({ t: 'bossFlame', side: 'L', on: true, pos: bossW(2.55, 4.1, -17.05) })));
addBtn('boss', 'flame R', withBoss(() => fire({ t: 'bossFlame', side: 'R', on: true, pos: bossW(-2.55, 4.1, -17.05) })));
addBtn('boss', 'flames off', withBoss(() => { fire({ t: 'bossFlame', side: 'L', on: false }); fire({ t: 'bossFlame', side: 'R', on: false }); }));
addBtn('boss', 'charge+cannon', withBoss(() => { fire({ t: 'bossCharge', pos: bossW(0, 5.5, -6.1) }); setTimeout(() => { const o = bossW(0, 5.51, -6.1); fire({ t: 'shot', src: BOSS_ID, weapon: 'cannon', origin: o, dir: norm([0.35, -0.08, -1]), rocket: true, speed: 150, heavy: true }); fire({ t: 'bossCannon', pos: o }); }, 1300); }));
const partCycle = ['part_tank_L', 'part_pod_R', 'part_turret_1', 'panel_armor_t1_L1', 'part_stack_R', 'part_turret_main', 'part_tank_R', 'part_plow'];
let partI = 0;
addBtn('boss', 'destroy part', withBoss(() => bossPart(partCycle[partI++ % partCycle.length])));
addBtn('boss', 'deflect', withBoss(() => { for (let i = 0; i < 4; i++) fire({ t: 'bossDeflect', pos: bossW(3.45, 3 + Math.random() * 1.5, -6 + Math.random() * 10) }); }));
addBtn('boss', 'volley', withBoss(() => fire({ t: 'bossVolley', pos: bossW(0, 0, 0) })));
addBtn('boss', 'turret MG', withBoss(() => { for (let i = 0; i < 10; i++) setTimeout(bossMG, i * 120); }));
addBtn('boss', 'ramp', withBoss(() => fire({ t: 'bossRamp', pos: bossW(0, 3.02, -17) })));
addBtn('boss', 'phase 3', withBoss(() => fire({ t: 'bossPhase', phase: 3, pos: bossW(0, 0, 0) })));
addBtn('boss', 'death', withBoss(() => { script = script.filter((x) => !x.done); bossDeath(simT + 0.05); }));
addBtn('hazards', 'mine', () => { const t = aim(); fire({ t: 'mineDrop', pos: [t.x - 2 + Math.random() * 4, 0.1, t.z + Math.random() * 4] }); });
addBtn('hazards', 'barrel', () => { const t = aim(); fire({ t: 'mineDrop', pos: [t.x - 2 + Math.random() * 4, 0.15, t.z + Math.random() * 4], enemy: true }); });
addBtn('hazards', 'mine boom', () => { const it = fx.haz.items.find((o) => o.live); if (it) fire({ t: 'boom', pos: [it.pool.px[it.slot], it.pool.py[it.slot], it.pool.pz[it.slot]], radius: 8, kind: 'mine' }); });
addBtn('hazards', 'oil', () => { const t = aim(); fire({ t: 'oil', pos: [t.x, 0.6, t.z + 6], r: 5.5, dir: [0, 1] }); });
addBtn('hazards', 'boost pad', () => { const c = freshCar('e_sedan', -20, 0x3d4a5f); c.f.drive = true; c.f.speed = 28; setTimeout(() => fire({ t: 'boostPad', id: c.id, pos: [c.state.pos.x, c.state.pos.y, c.state.pos.z] }), 500); });
addBtn('hazards', 'unflip', () => { const c = cars[cars.length - 1]; if (c) fire({ t: 'unflip', id: c.id }); });
addBtn('hazards', 'medkit', () => { const c = cars[cars.length - 1]; if (c) fire({ t: 'medkit', id: c.id }); });

// ---------------------------------------------------------------------------------------------- loop
let simT = 0, paused = false, frames = 0, last = performance.now();
const perf = { fxMs: 0, frameMs: 0, n: 0 };
function stepSim(dt) {
  simT += dt; S.t = simT;
  if (camSetup) camSetup();
  orbit.apply(); camera.updateMatrixWorld();
  for (const s of script) if (!s.done && simT >= s.t) { s.done = true; s.fn(); }
  for (const h of hooks) h(dt, simT);
  stepBoss(dt);
  for (const c of cars.slice()) c.step(dt, simT);
  if (camSetup) camSetup();
  const t0 = performance.now();
  for (const c of cars) fx.updateCar(c.state, c.view, dt, c.surface());
  if (!Q.has('nofx')) fx.update(dt);
  perf.fxMs += performance.now() - t0; perf.n++;
}
const tFreeze = Q.has('t') ? parseFloat(Q.get('t')) : null;
if (tFreeze !== null) { while (simT < tFreeze - 1e-6) stepSim(1 / 60); paused = true; }

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!paused) stepSim(dt);
  if (camSetup && paused) camSetup();
  orbit.apply();
  shakeAcc *= Math.pow(0.03, dt);
  if (shakeAcc > 0.01) { const a = shakeAcc * shakeAcc * 0.5; camera.position.x += Math.sin(now * 0.07) * a; camera.position.y += Math.sin(now * 0.09 + 2) * a; camera.lookAt(orbit.target); }
  sky.update(dt, camera, orbit.target);
  const tr = performance.now();
  if (post) { post.setLook(look, sky.sunDir); post.setParams({ night01: look.night || 0 }); post.render(dt); } else if (composer) composer.render(dt); else renderer.render(scene, camera);
  if (Q.has('gpu')) renderer.getContext().finish();
  perf.frameMs = perf.frameMs * 0.9 + (performance.now() - tr) * 0.1;
  frames++;
  if (showUi && frames % 6 === 0) {
    const st = fx.stats;
    hud.textContent = `FX  live ${st.live}  (smoke ${st.alpha} / fire ${st.fire})  cap ${st.cap}\nchunks ${st.chunks}  casings ${st.casings}  skid segs ${st.skidSegments}  lights ${st.lights}  jobs ${st.jobs}\nfx cpu ${st.ms.toFixed(2)} ms (cars ${st.carMs.toFixed(2)})  render cpu ${perf.frameMs.toFixed(1)} ms  ${(1000 / Math.max(1, (now - (frame._l || now)) || 16)).toFixed(0)} fps\ncalls ${renderer.info.render.calls}  tris ${renderer.info.render.triangles}  t=${simT.toFixed(2)}  q${quality}`;
  }
  frame._l = now;
  if (frames === 4) window.__ready = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (composer) composer.setSize(innerWidth, innerHeight); if (post) post.setSize(innerWidth, innerHeight); });
addEventListener('keydown', (e) => { if (e.key === ' ') paused = !paused; if (e.key === 'e') explodeCar(freshCar('e_sedan'), 1); });
window.__fx = { fx, scene, camera, renderer, cars, perf, sim: () => simT, explodeNew: (spec = 'e_van') => explodeCar(freshCar(spec), 1) };
