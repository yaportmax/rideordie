// TitleScene: the live key-art behind the title menu. Dusk on the desert highway: the player's truck (current truck, paint and
// primary weapon) tears down the road with raiders on its tail, the gunner firing back, dust plumes backlit by a low sun.
// Nothing really moves forward: the vehicles hold station while the road, the ground and the roadside props stream past.
import * as THREE from 'three';
import * as Assets from '../core/assets.js';
import { CarView } from '../view/car_view.js';
import { sanitizeVisualLevels, visualKey } from '../view/car_upgrade_plan.js';
import { makeCarState } from '../view/car_state.js';
import { CrewView } from '../view/crew_view.js';
import { sanitizeOpticId, weaponOpticKey } from '../data/weapon_optics.js';
import { VEHICLES } from '../data/vehicles.js';
import { PuffSystem, Tracers, MuzzleFlash, fxTex } from './menu_fx.js';
import { warmScene, warmGroup } from './menu_post.js';

const V = 24;                          // apparent road speed (m/s)
const WRAP = 12;                       // ground/road texture period (m): the scroll wraps here
const SUN_DIR = new THREE.Vector3(0.34, 0.085, -1).normalize();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

const SKY_VERT = /* glsl */`varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`;
const SKY_FRAG = /* glsl */`
uniform vec3 uSun; uniform float uTime; uniform float uHot;
varying vec3 vDir;
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p *= 2.03; a *= 0.5; } return s; }
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float sd = max(dot(d, uSun), 0.0);
  vec3 zen = vec3(0.045, 0.05, 0.13), mid = vec3(0.30, 0.12, 0.16), hor = vec3(1.05, 0.42, 0.16), horFar = vec3(0.55, 0.22, 0.2);
  vec3 h = mix(horFar, hor, pow(sd, 3.0));
  vec3 c = mix(h, mid, smoothstep(0.0, 0.16, y));
  c = mix(c, zen, smoothstep(0.1, 0.6, y));
  c += vec3(1.3, 0.55, 0.18) * pow(sd, 28.0) * 0.7 + vec3(1.0, 0.5, 0.2) * pow(sd, 6.0) * 0.18;
  // thin stratus bands lit from below near the sun
  vec2 cp = vec2(atan(d.x, -d.z) * 3.0, y * 26.0);
  float cl = smoothstep(0.52, 0.8, fbm(cp * vec2(1.0, 1.0) + vec2(uTime * 0.004, 0.0))) * smoothstep(0.015, 0.06, y) * (1.0 - smoothstep(0.1, 0.28, y));
  vec3 clc = mix(vec3(0.16, 0.07, 0.09), vec3(1.6, 0.65, 0.25), pow(sd, 5.0));
  c = mix(c, clc, cl * 0.85);
  // sun disc
  float disc = smoothstep(0.99955, 0.99975, sd);
  c += vec3(14.0, 8.0, 3.2) * disc;
  // below the horizon: haze colour (hidden by the ground anyway)
  c = mix(c, h * 0.6, smoothstep(0.0, -0.05, y));
  gl_FragColor = vec4(c * uHot, 1.0);
}`;

/** Dusk sky dome material (gradient, sun disc + glow, thin stratus near the horizon). Also used through the garage door. */
export function makeSkyMaterial(sunDir, o = {}) {
  return new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: sunDir.clone().normalize() }, uTime: { value: 0 }, uHot: { value: o.hot ?? 1 } } });
}

/**
 * Distant mesa ridges: a ring strip whose height profile is a sum of flat-topped, steep-sided buttes + low hills, vertex-coloured
 * from a hazy base to a darker top. Reads as silhouettes against the dusk sky from any angle (the low-poly mesa GLBs look blocky here).
 */
export function makeRidges({ radius = 900, seed = 3, count = 26, hMin = 30, hMax = 140, top = 0x3a1e24, base = 0x7a4640, arc = [0, Math.PI * 2] } = {}) {
  const rnd = mulberry(seed), N = 900;
  const buttes = Array.from({ length: count }, () => ({ a: arc[0] + rnd() * (arc[1] - arc[0]), w: 0.02 + rnd() * 0.09, h: hMin + rnd() * (hMax - hMin), s: 0.25 + rnd() * 0.3 }));
  const height = (a) => {
    let h = 8 + Math.sin(a * 7 + seed) * 5 + Math.sin(a * 23 + seed * 2) * 3;
    for (const b of buttes) {
      let d = Math.abs(Math.atan2(Math.sin(a - b.a), Math.cos(a - b.a))) / b.w;       // 0 at the centre, 1 at the rim edge
      const edge = Math.min(1, Math.max(0, (1 + b.s - d) / b.s));                        // steep sides, flat top
      h = Math.max(h, b.h * edge * edge * (3 - 2 * edge) + (edge > 0.99 ? Math.sin(a * 90) * 1.5 : 0));
    }
    return h;
  };
  const pos = [], col = [], idx = [];
  const cTop = new THREE.Color(top), cBase = new THREE.Color(base), c = new THREE.Color();
  for (let i = 0; i <= N; i++) {
    const a = arc[0] + (i / N) * (arc[1] - arc[0]), h = height(a), x = Math.sin(a) * radius, z = -Math.cos(a) * radius;
    pos.push(x, h, z, x, -40, z);
    c.copy(cBase).lerp(cTop, Math.min(1, h / (hMax * 0.8)) * 0.85); col.push(c.r, c.g, c.b, cBase.r, cBase.g, cBase.b);
    if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide }));
  m.frustumCulled = false; m.renderOrder = -5;
  return m;
}

function tex(set, n, srgb, repX, repY) {
  const t = new THREE.TextureLoader().load(`/textures/${set}/${n}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repX, repY); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8;
  return t;
}

const PROPS = ['cactus_saguaro', 'cactus_prickly_pear', 'cactus_barrel', 'shrub_desert_scrub', 'shrub_dry_bush', 'rock_05', 'rock_06', 'rock_03', 'boulder_01', 'boulder_02', 'boulder_03', 'dead_tree_a', 'dead_tree_c', 'utility_pole', 'sign_speed', 'sign_warning', 'mile_marker', 'skeleton_car_frame'];
const STRUCTS = [];

export class TitleScene {
  constructor(renderer) {
    this.renderer = renderer;
    const s = this.scene = new THREE.Scene();
    s.fog = new THREE.FogExp2(0x7a4640, 0.0019);
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.2, 4000);
    this.t = 0; this.ready = false; this.shotT = 0.4; this.shot = 0; this.cutFade = 0;
    // sky + environment
    const skyMat = makeSkyMaterial(SUN_DIR);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), skyMat); this.sky.renderOrder = -10; this.sky.frustumCulled = false; s.add(this.sky);
    s.add(makeRidges({ radius: 1250, seed: 5, count: 30, hMin: 60, hMax: 190, top: 0x4a2830, base: 0x8a4a40 }), makeRidges({ radius: 820, seed: 11, count: 14, hMin: 25, hMax: 90, top: 0x2a1418, base: 0x7a4038 }));
    const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
    const gnd = new THREE.Mesh(new THREE.CircleGeometry(100, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x3a2014 })); gnd.position.y = -2; envScene.add(gnd);
    const pm = new THREE.PMREMGenerator(renderer);
    s.environment = pm.fromScene(envScene, 0.02, 0.1, 500).texture; s.environmentIntensity = 0.55; pm.dispose();
    // lights: low sun (backlight for the chasers, long shadows toward the camera), dusk sky fill, warm bounce
    const sun = this.sun = new THREE.DirectionalLight(0xffa25a, 4.2);
    sun.position.copy(SUN_DIR).multiplyScalar(90); sun.target.position.set(0, 0, -14);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    const sc = sun.shadow.camera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 10; sc.far = 220;
    s.add(sun, sun.target);
    s.add(new THREE.HemisphereLight(0x7a78c8, 0x5a3424, 1.0));
    const bounce = new THREE.DirectionalLight(0xffb898, 1.1); bounce.position.set(-0.5, 0.35, 1).multiplyScalar(50); s.add(bounce);
    // ground + road (in a scroll group that wraps every WRAP metres)
    this.scroll = new THREE.Group(); s.add(this.scroll);
    const L = 1800;
    const sandMat = new THREE.MeshStandardMaterial({ map: tex('sand', 'albedo', true, L / 6, L / 6), normalMap: tex('sand', 'normal', false, L / 6, L / 6), roughness: 1, color: 0xd9a27a, envMapIntensity: 0.3 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(L, L).rotateX(-Math.PI / 2), sandMat); ground.receiveShadow = true; ground.position.y = -0.02; this.scroll.add(ground);
    const shoulder = new THREE.MeshStandardMaterial({ map: tex('gravel', 'albedo', true, 1.2, L / 3), normalMap: tex('gravel', 'normal', false, 1.2, L / 3), roughness: 1, color: 0xc49a7a });
    for (const x of [-6.2, 6.2]) { const m = new THREE.Mesh(new THREE.PlaneGeometry(3.4, L).rotateX(-Math.PI / 2), shoulder); m.position.set(x, -0.005, 0); m.receiveShadow = true; this.scroll.add(m); }
    this.roadMat = this._roadMaterial(L);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(9, L).rotateX(-Math.PI / 2), this.roadMat); road.receiveShadow = true; this.scroll.add(road);
    // fx
    this.dust = new PuffSystem(520, { tex: 'dust_puff' });
    this.dust.setLight(SUN_DIR, new THREE.Color(1.5, 0.75, 0.36), new THREE.Color(0.34, 0.25, 0.25));
    this.dust.mat.uniforms.uFwd.value = 0.9;
    this.dust.mat.uniforms.uTint.value.set(1.0, 0.86, 0.72);
    this.dust.wind.set(0, 0, -V * 0.8);
    s.add(this.dust.mesh);
    this.tracers = new Tracers(64); s.add(this.tracers.mesh);
    this.etracers = new Tracers(32, new THREE.Color(9, 2.6, 1.0)); s.add(this.etracers.mesh);
    this.flash = new MuzzleFlash(0.6); s.add(this.flash.sprite);
    this.eflash = [new MuzzleFlash(0.5), new MuzzleFlash(0.5)]; for (const f of this.eflash) s.add(f.sprite);
    this.gunLight = new THREE.PointLight(0xffb060, 0, 9, 2); s.add(this.gunLight);
    this.sparks = Array.from({ length: 6 }, () => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex('spark'), color: new THREE.Color(6, 3.5, 1.5), blending: THREE.AdditiveBlending, depthWrite: false })); sp.visible = false; sp.userData.t = 0; s.add(sp); return sp; });
    this.cars = []; this.props = []; this.heroId = null;
    this._shots();
  }

  _roadMaterial(L) {
    const m = new THREE.MeshStandardMaterial({ map: tex('asphalt', 'albedo', true, 1.5, L / 6), normalMap: tex('asphalt', 'normal', false, 1.5, L / 6), roughnessMap: tex('asphalt', 'arm', false, 1.5, L / 6), roughness: 1, color: 0xb8a89a, envMapIntensity: 0.6 });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vRoad;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRoad = vec2((uv.x - 0.5) * 9.0, uv.y * ' + L.toFixed(1) + ');');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec2 vRoad;
float rh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float paint(vec2 r) {
  float x = r.x, z = r.y;
  float wear = 0.65 + 0.35 * rh(floor(vec2(x * 8.0, z * 3.0)));
  float edge = (1.0 - smoothstep(0.14, 0.17, abs(abs(x) - 4.2))) * wear;
  float dash = (1.0 - smoothstep(0.14, 0.17, abs(x))) * step(mod(z, 12.0), 3.0) * wear;
  return max(edge, dash);
}`).replace('#include <map_fragment>', `#include <map_fragment>
{ float pm = paint(vRoad); vec3 pc = abs(vRoad.x) < 1.0 ? vec3(0.85, 0.62, 0.16) : vec3(0.82, 0.8, 0.74); diffuseColor.rgb = mix(diffuseColor.rgb, pc, pm * 0.9);
  float dusty = smoothstep(3.2, 4.6, abs(vRoad.x)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.45, 0.34), dusty * 0.55); }`);
    };
    return m;
  }

  _shots() {
    // camera shots, in the hero truck's frame (+Z forward, +X left side of the truck). The menu covers the left of the screen:
    // subjects are kept right of centre via a view offset.
    this.shots = [
      { name: 'hero', dur: 10, pos: [-1.2, 0.9, 9.5], look: [1.6, 1.7, -14], fov: 34, drift: [0.7, 0.12, -1.8], shift: 0.14 },
      { name: 'front', dur: 8, pos: [3.8, 0.6, 5.0], look: [-1.5, 1.6, -3], fov: 38, drift: [0.5, 0.15, 1.4], shift: 0.18 },
      { name: 'gunner', dur: 8, pos: [-3.0, 3.0, 5.5], look: [2.5, 1.2, -20], fov: 36, drift: [1.0, -0.3, -0.9], shift: 0.12 },
      { name: 'return', dur: 8, pos: [6.5, 0.8, 2.5], look: [-0.5, 1.2, -6], fov: 34, drift: [-0.4, 0.1, -1.6], shift: 0.3 },
    ];
  }

  /** Core set (vehicles are preloaded at boot) is usable at once; roadside props + far landmarks stream in and are
   *  compiled off-scene before they are added, so they never hitch the chase. */
  async load() {
    const urls = [...PROPS.map((p) => `/models/props/${p}.glb`), ...STRUCTS.map((p) => `/models/structures/${p}.glb`)];
    this.propsLoaded = Assets.preload(urls).then(async () => {
      const g = new THREE.Group();
      this._buildProps(g);
      if (this.post) await warmGroup(this.renderer, g, this.camera, this.scene, this.post);
      this.scene.add(g); (window.__menuLog || (window.__menuLog = [])).push([+(performance.now() / 1000).toFixed(2), 'titleProps']);
    });
    this.ready = true;
  }

  _buildProps(root) {
    const put = (id, x, z, rot = Math.random() * 6.28, sc = 1, shadow = false) => {
      const kind = id.startsWith('mesa') || id.startsWith('hoodoo') ? 'structures' : 'props';
      const m = Assets.clone(`/models/${kind}/${id}.glb`); if (!m) return null;
      m.position.set(x, 0, z); m.rotation.y = rot; m.scale.setScalar(sc);
      m.traverse((o) => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = true; } });
      root.add(m); return m;
    };
    // roadside props that stream past (recycled)
    const rnd = mulberry(7);
    const span = 520, z0 = -420;
    for (let i = 0; i < 13; i++) { const m = put('utility_pole', 10.5, z0 + i * 40, Math.PI / 2, 1, true); if (m) this.props.push({ m, span }); }
    const kinds = ['cactus_saguaro', 'cactus_saguaro', 'cactus_prickly_pear', 'cactus_barrel', 'shrub_desert_scrub', 'shrub_desert_scrub', 'shrub_dry_bush', 'shrub_dry_bush', 'rock_05', 'rock_06', 'rock_03', 'boulder_01', 'boulder_02', 'boulder_03', 'dead_tree_a', 'dead_tree_c'];
    for (let i = 0; i < 64; i++) {
      const side = rnd() < 0.5 ? -1 : 1, x = side * (9 + Math.pow(rnd(), 1.6) * 90);
      const k = kinds[(rnd() * kinds.length) | 0];
      const m = put(k, x, z0 + rnd() * span, rnd() * 6.28, 0.8 + rnd() * 0.6, Math.abs(x) < 30);
      if (m) this.props.push({ m, span });
    }
    for (const [k, x, z] of [['sign_speed', -5.6, -60], ['sign_warning', 5.8, -250], ['mile_marker', -5.2, -140], ['skeleton_car_frame', -16, -330]]) { const m = put(k, x, z, k === 'skeleton_car_frame' ? 0.7 : Math.PI, 1, true); if (m) this.props.push({ m, span }); }
  }

  /** Current chassis, owned modifiers and crew equipment in the title chase. */
  setHero(truckId, paint, weapon, loadout = {}) {
    const upgradeLevels = sanitizeVisualLevels(loadout.upgradeLevels), armorTier = loadout.armorTier || 0;
    const opticId = sanitizeOpticId(weapon || 'pistol', loadout.opticId);
    const key = `${truckId}:${paint}:${weaponOpticKey(weapon || 'pistol', opticId)}:${armorTier}:${visualKey(upgradeLevels)}`;
    if (key === this.heroKey) return;
    this.heroKey = key;
    for (const c of this.cars) { c.view.dispose(); for (const cr of c.crew) cr.dispose(); }
    this.cars = [];
    const spec = VEHICLES[truckId] || VEHICLES.player_sedan_t1;
    const heroGun = weapon || 'pistol';
    this.hero = this._car(spec, { paint, upgradeLevels, x: 1.85, z: 0, weave: 0.45, wf: 0.31, crew: { gunner: 'hero_gunner', driver: 'hero_driver', weapon: heroGun, opticId, armorTier }, sand: 0.25 });
    this._car(VEHICLES.e_technical, { paint: 0x6a2a1c, x: -2.2, z: -14, weave: 1.4, wf: 0.43, ph: 1.2, crew: { gunner: 'raider_a', driver: 'raider_driver', enemyGun: 'smg' }, sand: 0.4 });
    this._car(VEHICLES.e_buggy, { paint: 0x3a3a34, x: 7.2, z: -24, weave: 1.8, wf: 0.37, ph: 2.6, crew: { gunner: 'raider_b', driver: 'raider_driver', enemyGun: 'rifle' }, sand: 1 });
    // the two far chasers: far LOD body, no crew, no shadow (silhouettes in the dust; keeps the menu cheap)
    this._car(VEHICLES.e_muscle, { paint: 0x1c1c1c, x: -7.8, z: -35, weave: 2.2, wf: 0.29, ph: 4.1, crew: {}, sand: 1, far: true });
    this._car(VEHICLES.e_sedan, { paint: 0x5a4a30, x: 3.0, z: -52, weave: 2.4, wf: 0.25, ph: 0.4, crew: {}, sand: 0.7, far: true });
    for (const c of this.cars) c.view.update(c.st, 0);
    this.fireT = 0.6; this.burst = 0; this.target = 1;
  }

  _car(spec, o) {
    const view = new CarView(spec, { paint: o.paint, paint2: 0x2a2826, lod: !!o.far, upgradeLevels: o.upgradeLevels });
    if (o.far) { view.setLod(true); view.root.traverse((m) => { if (m.isMesh) m.castShadow = false; }); }
    const st = makeCarState(this.cars.length, spec.id, spec.kind);
    for (let i = 0; i < st.L.length; i++) st.L[i] = st.ride.restLen;
    const c = { spec, view, st, crew: [], gunner: null, x0: o.x, z0: o.z, weave: o.weave, wf: o.wf, ph: o.ph || 0, sand: o.sand, yaw: 0, vx: 0, ax: 0, bump: Math.random() * 10, emit: 0 };
    this.scene.add(view.root);
    if (o.crew.gunner && spec.seats.gunner) {
      const g = new CrewView(o.crew.gunner, o.crew.enemyGun ? { role: 'gunner', weapon: 'enemy', enemyGun: o.crew.enemyGun } : { role: 'gunner', weapon: o.crew.weapon, opticId: o.crew.opticId, armorTier: o.crew.armorTier || 0 });
      view.root.add(g.root); g.attach(view, spec.seats.gunner); c.crew.push(g); c.gunner = g;
    }
    if (o.crew.driver && spec.seats.driver) { const d = new CrewView(o.crew.driver, { role: 'driver' }); view.root.add(d.root); d.attach(view, spec.seats.driver); c.crew.push(d); }
    view.setLights?.(false, 1);
    this.cars.push(c);
    return c;
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  update(dt) {
    if (!this.hero) return;
    this.t += dt;
    const t = this.t;
    this.sky.material.uniforms.uTime.value = t;
    // ground scroll (wraps on the texture / dash period)
    this.scroll.position.z = -((t * V) % WRAP);
    for (const p of this.props) { p.m.position.z -= V * dt; if (p.m.position.z < -440) p.m.position.z += p.span; }
    // vehicles
    for (const c of this.cars) this._drive(c, dt);
    this._guns(dt);
    this.dust.update(dt);
    this.tracers.update(dt); this.etracers.update(dt);
    this.flash.update(dt); for (const f of this.eflash) f.update(dt);
    this.gunLight.intensity = Math.max(0, this.gunLight.intensity - dt * 900);
    for (const sp of this.sparks) if (sp.visible) { sp.userData.t -= dt; sp.position.z -= V * dt * 0.2; if (sp.userData.t <= 0) sp.visible = false; }
    this._camera(dt);
  }

  _drive(c, dt) {
    const t = this.t, st = c.st;
    const x = c.x0 + Math.sin(t * c.wf * 2 * Math.PI * 0.35 + c.ph) * c.weave + Math.sin(t * 0.9 + c.ph * 3) * c.weave * 0.25;
    const vx = (x - (c.x ?? x)) / Math.max(dt, 1e-4); c.x = x;
    c.ax += ((vx - c.vx) / Math.max(dt, 1e-4) - c.ax) * Math.min(1, dt * 4); c.vx = vx;
    const yaw = Math.atan2(vx, V);
    c.yaw += (yaw - c.yaw) * Math.min(1, dt * 6);
    c.bump += dt * (c.sand > 0.6 ? 1.6 : 1);
    const b = c.bump;
    const roll = -c.ax * 0.012 + Math.sin(b * 7.1) * 0.006 * (0.4 + c.sand);
    const pitch = Math.sin(b * 5.3) * 0.006 * (0.4 + c.sand) + Math.sin(b * 11.7) * 0.003;
    st.pos.set(x, st.ride.restComHeight + Math.sin(b * 9.3) * 0.015 * (0.3 + c.sand), c.z0);
    st.quat.setFromEuler(_e.set(pitch, c.yaw, roll, 'YXZ'));
    st.vel.set(Math.sin(c.yaw) * V, 0, Math.cos(c.yaw) * V);
    st.steer = Math.max(-0.35, Math.min(0.35, c.ax * 0.06));
    for (let i = 0; i < st.L.length; i++) st.L[i] = st.ride.restLen + Math.sin(b * (8 + i * 1.7) + i) * 0.025 * (0.3 + c.sand);
    c.view.update(st, dt);
    // crews
    const quat = st.quat;
    for (const cr of c.crew) {
      if (cr.role === 'driver') { cr.update(dt, { alive: true, quat, vel: st.vel, steer: st.steer * 2 }); continue; }
      const tgt = c === this.hero ? this.cars[this.target]?.view.root.position || _v.set(0, 0, -20) : this.hero.view.root.position;
      cr.headWorld(_v2);
      _v.copy(tgt); _v.y += c === this.hero ? 1.0 : 1.3; _v.sub(_v2);
      const aimYaw = Math.atan2(_v.x, _v.z) + Math.sin(this.t * 1.7 + c.ph) * 0.04;
      const aimPitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
      cr.update(dt, { alive: true, aimYaw, aimPitch, fire: !!c.firing, crouch: false, reloading: false, quat, vel: st.vel, steer: 0 });
    }
    // dust from the rear wheels
    const rate = 6 + 30 * c.sand;
    c.emit += dt * rate;
    while (c.emit >= 1) {
      c.emit -= 1;
      const w = c.spec.wheels[2 + ((Math.random() * 2) | 0)] || c.spec.wheels[0];
      _v.set(w.x * 1.05, 0.25, w.z - 0.3).applyQuaternion(quat).add(c.view.root.position);
      _v2.set((Math.random() - 0.5) * 2.4, 0.6 + Math.random() * 1.6, -V * (0.25 + Math.random() * 0.2));
      this.dust.emit(_v, _v2, { size: 0.8 + c.sand * 0.8, grow: 3.2 + c.sand * 2.6, life: 1.5 + c.sand * 1.4, alpha: 0.14 + c.sand * 0.26, drag: 1.1, rise: 0.55 });
    }
  }

  _guns(dt) {
    const hero = this.hero; if (!hero?.gunner) return;
    // hero gunner: bursts at alternating raiders
    this.fireT -= dt;
    if (this.fireT <= 0) {
      if (this.burst <= 0) { this.burst = 4 + ((Math.random() * 6) | 0); this.target = 1 + ((Math.random() * 2.2) | 0); this.pauseAfter = 0.5 + Math.random() * 0.9; }
      this._shoot(hero, this.cars[this.target], this.tracers, this.flash, true);
      this.burst--;
      this.fireT = this.burst > 0 ? 0.09 + Math.random() * 0.03 : this.pauseAfter;
    }
    hero.firing = this.burst > 0;
    // raider gunners: slower, less accurate
    this.cars.forEach((c, i) => {
      if (c === hero || !c.gunner) return;
      c.fireT = (c.fireT ?? 1 + i) - dt;
      if (c.fireT <= 0) {
        c.burst = (c.burst ?? 0) > 0 ? c.burst - 1 : 3 + ((Math.random() * 3) | 0);
        this._shoot(c, hero, this.etracers, this.eflash[i % 2], false);
        c.fireT = c.burst > 0 ? 0.12 : 1.4 + Math.random() * 1.6;
      }
      c.firing = c.burst > 0;
    });
  }

  _shoot(from, to, tracers, flash, hero) {
    if (!from.gunner || !to) return;
    const g = from.gunner;
    if (!g.muzzleWorld(_v)) return;
    g.fire(10, 'auto');
    flash.flash(_v);
    if (hero) { this.gunLight.position.copy(_v); this.gunLight.intensity = 60; }
    _v2.copy(to.view.root.position); _v2.y += 0.6 + Math.random() * 0.8;
    const spread = hero ? 1.6 : 3.2;
    _v2.x += (Math.random() - 0.5) * spread; _v2.z += (Math.random() - 0.5) * spread;
    const dir = _v2.clone().sub(_v).normalize();
    tracers.fire(_v, _v.clone().addScaledVector(dir, 120), 420, 6);
    if (Math.random() < 0.45) { const sp = this.sparks.find((x) => !x.visible); if (sp) { sp.position.copy(_v2); sp.scale.setScalar(0.5 + Math.random() * 0.6); sp.visible = true; sp.userData.t = 0.06; } }
  }

  _camera(dt) {
    const sh = this.shots[this.shot];
    this.shotT += dt;
    if (this.shotT > sh.dur && !this.lockShot) { this.shotT = 0; this.shot = (this.shot + 1) % this.shots.length; this.onCut?.(); }
    const s = this.shots[this.shot], k = this.shotT / s.dur;
    const sm = (a, b, x) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
    this.cutFade = this.lockShot ? 0 : Math.max(sm(s.dur - 0.32, s.dur, this.shotT), 1 - sm(0, 0.32, this.shotT)) * 0.92;
    const h = this.hero.view.root.position;
    const e = k - 0.5;
    const cam = this.camera;
    cam.position.set(h.x * 0.6 + s.pos[0] + s.drift[0] * e, s.pos[1] + s.drift[1] * e, h.z + s.pos[2] + s.drift[2] * e);
    // handheld: tiny low-frequency sway + road buzz
    const t = this.t;
    cam.position.x += Math.sin(t * 0.7) * 0.05 + Math.sin(t * 13.1) * 0.004;
    cam.position.y += Math.sin(t * 0.9) * 0.04 + Math.sin(t * 17.3) * 0.004;
    _v.set(h.x * 0.4 + s.look[0], s.look[1], h.z + s.look[2]);
    cam.lookAt(_v);
    if (cam.fov !== s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
    // keep the action right of the menu column
    const w = innerWidth, hh = innerHeight;
    cam.setViewOffset(w, hh, -w * s.shift, 0, w, hh);
  }

  /** Programs + textures uploaded before the first visible frame. */
  async warm(post) { this.post = post; await warmScene(this.renderer, this.scene, this.camera, post); }
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
