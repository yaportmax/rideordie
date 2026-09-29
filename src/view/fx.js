// FX: GPU-instanced particles, explosions, muzzle flashes, tracers, impacts, skid marks, wreck burn, debris, casings.
//
//   const fx = new Fx(scene, camera, { quality: 2 });  await fx.load();
//   per frame:  for (const e of events) fx.handleEvent(e, ctx);           // ctx = { carViews, states, playerId, cameraPos, shake(amount 0..1) }
//               for each car:  fx.updateCar(state, carView, dt, surfaceKind);
//               fx.update(dt);                                              // once, before rendering
//   optional:   fx.setGround((x, z) => groundY)   fx.setQuality(q)   fx.updateProjectiles([{k:1|2,x,y,z}], dt)   fx.wreck(state, carView)
//
// Files: fx/particles.js (GPU pool + shader), fx/atlas.js (sprite atlas), fx/recipes.js (explosion, muzzle, tracer, impact),
//        fx/carfx.js (per-car tyre smoke / dust / nitro / smoke / sparks), fx/skid.js (SkidMarks), fx/decals.js, fx/meshpool.js, fx/wreck.js,
//        fx/boss.js (THE LEVIATHAN: flamers, cannon, part fires, death + mushroom cloud), fx/hazards.js (mines, burning barrels, oil, boost pads).
import * as THREE from 'three';
import { buildAtlas, loadDecalTextures, SPR } from './fx/atlas.js';
import { ParticleSystem, PDesc, MODE, PF, makeParticleUniforms } from './fx/particles.js';
import { SkidMarks } from './fx/skid.js';
import { DecalPool } from './fx/decals.js';
import { MeshPool } from './fx/meshpool.js';
import { Rng, clamp01, smooth } from './fx/util.js';
import { CASING } from './fx/weapons.js';
import { WEAPONS } from '../data/weapons.js';
import * as R from './fx/recipes.js';
import { CarRec, updateCarFx, ownBurst } from './fx/carfx.js';
import { paintHexOf, patchPaint, makeWreckUniforms } from './fx/wreck.js';
import * as Assets from '../core/assets.js';
import { VEHICLES } from '../data/vehicles.js';
import { BossFx } from './fx/boss.js';
import { HazardFx } from './fx/hazards.js';
import { BOSS_ID } from '../data/boss.js';
import { ATMO, KEY } from '../world/atmosphere.js';
import { measureCabin } from './fx/cabin.js';

export { SkidMarks } from './fx/skid.js';

const PI2 = Math.PI * 2;
const QUALITY = [
  { capA: 900, capF: 800, qd: 0.38, far: 110, lodNear: 25, chunks: 28, skid: 1500, lights: false, blend: 0 },
  { capA: 1800, capF: 1500, qd: 0.65, far: 170, lodNear: 40, chunks: 56, skid: 3000, lights: true, blend: 1 },
  { capA: 3000, capF: 2600, qd: 1.0, far: 240, lodNear: 60, chunks: 96, skid: 6000, lights: true, blend: 1 },
  { capA: 4600, capF: 4000, qd: 1.35, far: 330, lodNear: 80, chunks: 150, skid: 9000, lights: true, blend: 1 },
];
const MAXQ = QUALITY[3];

const J = { NONE: 0, SMOKE: 1, POP: 2, WRECK: 3, ROCKET: 4 };
class Job { constructor() { this.type = 0; this.t = 0; this.dur = 0; this.x = 0; this.y = 0; this.z = 0; this.a = 0; this.b = 0; this.c = 0; this.acc = 0; this.acc2 = 0; this.acc3 = 0; this.acc4 = 0; this.cv = null; this.st = null; this.rec = null; this.vx = 0; this.vy = 0; this.vz = 0; } }

const _o3 = [0, 0, 0];
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _pv = new THREE.Matrix4(), _pv2 = new THREE.Matrix4(), _sph = new THREE.Sphere();
const _qi = new THREE.Quaternion(), _rv = new THREE.Vector3(), _c1 = new THREE.Color(), _c2 = new THREE.Color();

export class Fx {
  constructor(scene, camera, opts = { quality: 2 }) {
    this.scene = scene; this.camera = camera; this.opts = opts;
    this.q = Math.max(0, Math.min(3, opts.quality ?? 2)); this.cfg = QUALITY[this.q]; this.qd = this.cfg.qd; this.farDist = this.cfg.far; this.lodNear = this.cfg.lodNear;
    this.rng = new Rng(0x9e3779b1); this.p = new PDesc();
    this.time = 0; this.loaded = false; this.frame = 0;
    this.camPos = new THREE.Vector3(); this.frustum = new THREE.Frustum();
    this.groundFn = null; this.groundY0 = 0;
    this._shake = null; this.lastSlot = 0; this.lastBirth = 0; this.lastSlot2 = 0;
    this.recs = new Map(); this.jobs = []; for (let i = 0; i < 40; i++) this.jobs.push(new Job());
    this.tracked = []; for (let i = 0; i < 48; i++) this.tracked.push({ live: false, slot: 0, slot2: 0, birth: 0, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, sp: 0, t: 0 });
    this.trackHead = 0;
    this.stats = { live: 0, alpha: 0, fire: 0, cap: 0, chunks: 0, casings: 0, skidSegments: 0, jobs: 0, ms: 0, carMs: 0, lights: 0 };
    this._carMs = 0; this._lightT = 0; this._projSeen = false;
    this.pProj = []; for (let i = 0; i < 16; i++) this.pProj.push({ live: false, k: 0, x: 0, y: 0, z: 0, seen: false });
    this.rockets = []; this.grenadeSlots = [];
    this.pimp = []; for (let i = 0; i < 64; i++) this.pimp.push({ live: false, t: 0, s: 'metal', x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 });
    this.pimpHead = 0; this._views = null;
    this.playerId = 1; this._own = null;               // local player truck: { cv, st, rec } (attached frame + cabin clip)
    this._depthSrc = null;                             // Post (depthTexture getter) for soft particles
    this.ambGain = 1.0; this.keyGain = 1.0;            // look tuning for the normal-lit smoke / dust
    this.viewH = (typeof innerHeight !== 'undefined' ? innerHeight : 1080) * Math.min((typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1) || 1, 1.5);
    if (typeof addEventListener !== 'undefined') addEventListener('resize', () => { this.viewH = innerHeight * Math.min(devicePixelRatio || 1, 1.5); });
  }

  async load() {
    const atlas = await buildAtlas();
    const dec = await loadDecalTextures();
    this.atlas = atlas;
    this.U = makeParticleUniforms(atlas);
    this.pa = new ParticleSystem(this.scene, { cap: MAXQ.capA, uniforms: this.U, order: 90, name: 'smoke' });
    this.pf = new ParticleSystem(this.scene, { cap: MAXQ.capF, uniforms: this.U, order: 91, name: 'fire', strip: true });
    // per-camera uniforms right before the (first) particle draw: soft-particle depth, attached frame, cabin clip
    this.pa.mesh.onBeforeRender = (renderer, scene, camera) => this._beforeRender(renderer, camera);
    this.skid = new SkidMarks(this.scene, { maxSegs: this.cfg.skid, minStep: 0.6, texture: dec.skid, uniforms: this.U, order: 55 });
    this.timeU = { value: 0 };
    this.decScorch = dec.scorch ? new DecalPool(this.scene, { texture: dec.scorch, cap: 24, cols: 2, rows: 2, uniforms: this.U, time: this.timeU, tint: [1, 1, 1], order: 58 }) : null;
    this.decHoles = dec.holes ? new DecalPool(this.scene, { texture: dec.holes, cap: 96, cols: 2, rows: 2, uniforms: this.U, time: this.timeU, tint: [1, 1, 1], order: 59 }) : null;
    // 3D meshes: debris chunks / plates / casings / grenades
    const chunkGeo = new THREE.IcosahedronGeometry(1, 0);
    const plateGeo = new THREE.BoxGeometry(1, 1, 1);
    const debrisMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0.35, flatShading: true });
    const cg = new THREE.CylinderGeometry(1, 1, 1, 8);
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.9, emissive: 0x160c00 });
    this.chunks = new MeshPool(this.scene, chunkGeo, debrisMat, { cap: MAXQ.chunks, restitution: 0.4, friction: 0.55, radius: 0.55, fadeTime: 0.6, drag: 0.08 });
    this.plates = new MeshPool(this.scene, plateGeo, debrisMat, { cap: 40, restitution: 0.3, friction: 0.5, radius: 0.35, fadeTime: 0.6, drag: 0.35 });
    this.casings = new MeshPool(this.scene, cg, brassMat, { cap: 64, restitution: 0.42, friction: 0.5, radius: 0.5, fadeTime: 0.3, drag: 0.6 });
    this.grenades = new MeshPool(this.scene, new THREE.SphereGeometry(1, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.3 }), { cap: 8, restitution: 0.35, friction: 0.6, radius: 1, fadeTime: 0.05, drag: 0.02 });
    this.chunks.onBounce = (pool, i, x, y, z, imp) => this._chunkBounce(pool, i, x, y, z, imp);
    this.plates.onBounce = this.chunks.onBounce;
    this.chunks.onTrail = (pool, i, x, y, z, k) => this._chunkTrail(x, y, z, k, pool.age[i]); this.plates.onTrail = this.chunks.onTrail;
    this.chunks.trailEvery = this.plates.trailEvery = 0.022;
    this.grenades.onBounce = (pool, i, x, y, z, imp) => this._grenadeBounce(x, y, z, imp);
    for (const m of [this.chunks, this.plates, this.casings, this.grenades]) m.groundFn = null;
    // pooled point lights (always in the scene at intensity 0 so materials never recompile)
    this.lights = [];
    if (this.cfg.lights) for (let i = 0; i < 2; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 60, 2); l.castShadow = false; this.scene.add(l);
      this.lights.push({ light: l, mode: 0, t: 0, dur: 1, I0: 0, I: 0, key: 0, stamp: 0 });
    }
    this.boss = new BossFx(this);
    this.haz = new HazardFx(this);
    await this.haz.load(this.scene, this.U);
    this.setQuality(this.q);
    this._syncLighting(true);
    this.loaded = true;
    return this;
  }

  // ------------------------------------------------------------------------------------------------ config
  setQuality(q) {
    this.q = Math.max(0, Math.min(3, q | 0)); this.cfg = QUALITY[this.q]; this.qd = this.cfg.qd; this.farDist = this.cfg.far; this.lodNear = this.cfg.lodNear;
    if (!this.pa) return;
    this.pa.setCap(this.cfg.capA); this.pf.setCap(this.cfg.capF); this.pa.head = 0; this.pf.head = 0;
    this.U.uFrameBlend.value = this.cfg.blend;
    this.stats.cap = this.cfg.capA + this.cfg.capF;
  }
  /** Ground height query used by debris / casings / sparks: (x,z) -> y. Without it, effects use the height they spawn at. */
  setGround(fn) { this.groundFn = fn; for (const m of [this.chunks, this.plates, this.grenades]) if (m) m.groundFn = fn; if (this.haz) this.haz.setGround(fn); }
  groundAt(x, z, fb) { return this.groundFn ? this.groundFn(x, z) : fb; }
  setWind(x, y, z) { this.U.uWind.value.set(x, y, z); }
  /** Manual sun/ambient tint for smoke & dust; normally auto-detected from the scene lights. */
  setLight(r, g, b) { this._manualLight = true; this.U.uLight.value.set(r, g, b); }

  // ------------------------------------------------------------------------------------------------ helpers used by recipes
  inView(pos, radius) { _sph.center.copy(pos); _sph.radius = radius; return this.frustum.intersectsSphere(_sph); }
  /** Cheap distance gate for small effects. */
  near(x, y, z, maxD) { const dx = x - this.camPos.x, dy = y - this.camPos.y, dz = z - this.camPos.z; return dx * dx + dy * dy + dz * dz < maxD * maxD; }
  dist(x, y, z) { const dx = x - this.camPos.x, dy = y - this.camPos.y, dz = z - this.camPos.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  /** Request camera shake (0..1) from a world event at `pos`; falls off with distance to the camera. */
  shakeReq(pos, amount, range) {
    if (!this._shake) return;
    const d = this.dist(pos.x, pos.y, pos.z), t = clamp01((d - range * 0.12) / (range * 0.88)), f = (1 - t) * (1 - t);
    const a = Math.min(1, amount * f);
    if (a > 0.02) this._shake(a);
  }

  flashLight(x, y, z, r, g, b, I0, dist, dur, S) {
    if (!this.lights.length) return;
    let slot = null, weakest = 1e9;
    for (const s of this.lights) { const e = s.mode === 0 ? -1 : s.I; if (e < weakest) { weakest = e; slot = s; } }
    const d2 = (x - this.camPos.x) ** 2 + (y - this.camPos.y) ** 2 + (z - this.camPos.z) ** 2;
    const I = I0 / (1 + d2 / 40000);
    if (!slot || I < weakest) return;
    slot.mode = 1; slot.t = 0; slot.dur = dur; slot.I0 = I; slot.I = I; slot.key = 0;
    slot.light.position.set(x, y, z); slot.light.color.setRGB(r, g, b); slot.light.distance = dist;
  }
  glowLight(x, y, z, r, g, b, I, dist, key) {
    if (!this.lights.length) return;
    let slot = null;
    for (const s of this.lights) if (s.mode === 2 && s.key === key) slot = s;
    if (!slot) { let weakest = 1e9; for (const s of this.lights) { const e = s.mode === 0 ? -1 : s.I; if (e < weakest) { weakest = e; slot = s; } } if (!slot || (slot.mode !== 0 && I < slot.I)) return; }
    slot.mode = 2; slot.key = key; slot.stamp = this.time; slot.I = I; slot.light.position.set(x, y, z); slot.light.color.setRGB(r, g, b); slot.light.distance = dist;
  }

  // ------------------------------------------------------------------------------------------------ jobs
  _job(type) { for (const j of this.jobs) if (j.type === 0) { j.type = type; j.t = 0; j.acc = j.acc2 = j.acc3 = j.acc4 = 0; j.cv = j.st = j.rec = null; return j; } return null; }
  startSmokeColumn(x, y, z, S, gy) { const j = this._job(J.SMOKE); if (!j) return; j.x = x; j.y = y; j.z = z; j.a = S; j.b = gy; j.dur = 3.5 + 2.5 * S; j.c = (16 + 12 * S) * Math.max(0.5, this.qd); }
  startPop(x, y, z, S, gy, delay) { const j = this._job(J.POP); if (!j) return; j.x = x; j.y = y; j.z = z; j.a = S; j.b = gy; j.dur = delay; }

  _runJobs(dt) {
    const rng = this.rng;
    let active = 0;
    for (const j of this.jobs) {
      if (j.type === 0) continue;
      active++;
      j.t += dt;
      switch (j.type) {
        case J.SMOKE: {
          // the explosion's lingering column: dark lit billows rising off the blast, fire-lit for the first seconds, then
          // leaning with the wind; the rate tapers so the column thins out instead of stopping
          const S = j.a, sS = Math.sqrt(S), k = clamp01(j.t / j.dur);
          j.acc += (j.c / j.dur) * 2 * (1 - k) * dt; let n = 0;
          while (j.acc >= 1 && n < 4) {
            j.acc -= 1; n++;
            if (!this.near(j.x, j.y, j.z, this.farDist * 1.6)) continue;
            const c = rng.range(0.05, 0.08);
            R.puff(this, j.x + rng.sym(0.8 * S), j.y + rng.range(0.5, 2.0) * sS, j.z + rng.sym(0.8 * S), rng.sym(1.0), rng.range(4, 8) * sS * (1 - 0.4 * k), rng.sym(1.0),
              1.8 * sS, rng.range(6.5, 10) * sS, rng.range(6, 9.5), c, c * 0.96, c * 0.92, 0.9, 1.0, 0.9, j.b, 1.4 * (1 - smooth(0.5, 3.5, j.t)));
          }
          if (j.t >= j.dur) j.type = 0;
          break;
        }
        case J.POP:
          if (j.t >= j.dur) { R.miniPop(this, j.x, j.y, j.z, j.a, j.b); j.type = 0; }
          break;
        case J.WRECK: this._wreckJob(j, dt); break;
        default: j.type = 0;
      }
    }
    this.stats.jobs = active;
  }

  // ------------------------------------------------------------------------------------------------ wreck
  /** Char the car and attach a ~14 s burning column. Idempotent. */
  wreck(state, cv) {
    let rec = this.recs.get(state.id);
    if (!rec || rec.cv !== cv) rec = this._rec(state, cv);
    if (rec.wrecked) return;
    rec.wrecked = true;
    // lights out for good (the game re-applies setLights every frame)
    for (const m of cv.taillights || []) m.emissiveIntensity = 0;
    for (const m of cv.headlights || []) m.emissiveIntensity = 0;
    cv.setLights = () => {};
    const j = this._job(J.WRECK); if (!j) return;
    j.cv = cv; j.st = state; j.rec = rec; j.dur = 14; j.a = 0.6 + 0.4 * Math.min(2, state.spec.length / 5.2);
  }

  _wreckJob(j, dt) {
    const cv = j.cv, st = j.st, rec = j.rec, t = j.t, rng = this.rng;
    const u = rec.wreckU;
    u.uChar.value = smooth(0, 1.6, t); u.uWTime.value = t; u.uGlow.value = 0.1 + 0.9 * (1 - smooth(3, 17, t));
    if (!cv.root.parent || t > 26) { u.uGlow.value = 0.06; j.type = 0; return; }
    const root = cv.root, q = root.quaternion, P = root.position, spec = st.spec;
    const dx = P.x - this.camPos.x, dy = P.y - this.camPos.y, dz = P.z - this.camPos.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fade = 1 - smooth(10.5, 15, t);
    if (fade <= 0.001 && t > 15) return;
    const burn = fade * (0.55 + 0.45 * (1 - smooth(4, 12, t)));                 // it burns down: fewer, smaller tongues
    // glow light (one pooled light, flickering)
    if (fade > 0 && d < 80) this.glowLight(P.x, P.y + 1.2, P.z, 1.0, 0.5, 0.18, (80 + 45 * Math.sin(t * 13) * Math.sin(t * 7.3)) * fade, 28, rec.id + 1000);
    if (d > this.farDist * 1.3 || !this.inView(P, 30)) return;
    const lod = (1 - smooth(this.lodNear, this.farDist * 1.3, d)) * this.qd;
    const vel = st.vel, W = spec.width, L = spec.length, H = spec.height, sW = Math.sqrt(W / 1.9);
    // flame tongues licking out of the whole body (engine bay, cab, fuel tank) - they lean with the wind / the wreck's slide
    const nf = this._acc(j, 'acc', 24 * lod * burn, dt);
    for (let k = 0; k < nf; k++) {
      const zone = rng.next(), zz = zone < 0.45 ? rng.range(0.1, 0.42) : zone < 0.75 ? rng.range(-0.15, 0.15) : rng.range(-0.42, -0.1);
      _v.set(rng.sym(W * 0.3), H * rng.range(0.45, 0.8), zz * L).applyQuaternion(q).add(P);
      const w = rng.range(0.55, 1.5) * sW * (0.6 + 0.4 * burn);
      R.flame(this, _v.x, _v.y, _v.z, vel.x * 0.6 + rng.sym(0.4), vel.y * 0.3 + rng.range(0.4, 1.4), vel.z * 0.6 + rng.sym(0.4), w, w * rng.range(1.3, 2.6), rng.range(0.5, 1.0), rng.range(0.85, 1.2), 3.2, 0, 1.0, 1.3);
    }
    // rolling fire bodies: the hot mass the tongues lick out of
    const nb = this._acc(j, 'acc4', 8 * lod * burn, dt);
    for (let k = 0; k < nb; k++) {
      _v.set(rng.sym(W * 0.25), H * rng.range(0.45, 0.75), rng.sym(L * 0.33)).applyQuaternion(q).add(P);
      const s = rng.range(1.0, 1.6) * sW * (0.6 + 0.4 * burn);
      R.fireBody(this, _v.x, _v.y, _v.z, vel.x * 0.6 + rng.sym(0.4), vel.y * 0.3 + rng.range(0.8, 2.0), vel.z * 0.6 + rng.sym(0.4), s * 0.6, s * 1.5, rng.range(0.6, 1.0), 1.0);
    }
    // heat bloom at the seat of the fire (keeps the core reading hot between tongues)
    if (rng.next() < dt * 10 * burn) { _v.set(rng.sym(W * 0.2), H * 0.6, rng.sym(L * 0.25)).applyQuaternion(q).add(P); R.glow(this, _v.x, _v.y, _v.z, L * 0.45, 0.22, 1.1, 0.45, 0.12, true, 1.1); }
    // thick black smoke, fire-lit underneath while the fire is big, drifting off with the wind
    const ns = this._acc(j, 'acc2', 11 * lod * (0.3 + 0.7 * fade), dt);
    for (let k = 0; k < ns; k++) {
      _v.set(rng.sym(W * 0.28), H * rng.range(0.75, 1.05), rng.sym(L * 0.3)).applyQuaternion(q).add(P);
      const c = rng.range(0.045, 0.075);
      R.puff(this, _v.x, _v.y, _v.z, vel.x * 0.55 + rng.sym(0.8), rng.range(3.5, 6.5), vel.z * 0.55 + rng.sym(0.8), 1.2 * j.a, rng.range(6, 9) * j.a, rng.range(5.5, 8.5), c, c * 0.95, c * 0.9, 0.92, 1.1, 0.9, -1e4, 1.6 * burn);
    }
    const ne = this._acc(j, 'acc3', 6 * lod * burn, dt);
    for (let k = 0; k < ne; k++) { _v.set(rng.sym(W * 0.3), H * 0.7, rng.sym(L * 0.3)).applyQuaternion(q).add(P); R.ember(this, _v.x, _v.y, _v.z, vel.x * 0.5 + rng.sym(2), rng.range(3, 8), vel.z * 0.5 + rng.sym(2), rng.range(1.2, 2.6), 0.18, 0.9); }
  }
  _acc(j, key, r, dt) { let a = j[key] + r * dt; let n = 0; while (a >= 1 && n < 4) { a -= 1; n++; } j[key] = a > 1 ? 1 : a; return n; }

  _rec(state, cv) {
    let rec = this.recs.get(state.id);
    if (rec && rec.cv === cv) return rec;
    rec = new CarRec(state, cv); this.recs.set(state.id, rec); return rec;
  }

  // ------------------------------------------------------------------------------------------------ per-car
  updateCar(state, carView, dt, surface = 'asphalt') {
    if (!this.loaded || !state.spec || !state.spec.wheels || !carView.wheelNodes) return;
    const t0 = performance.now();
    const rec = this._rec(state, carView);
    rec.local = state.id === this.playerId;
    if (rec.local) this._setOwn(state, carView, rec);
    updateCarFx(this, rec, state, carView, Math.min(dt, 0.05), surface);
    this._carMs += performance.now() - t0;
  }

  // ------------------------------------------------------------------------------------------------ 3D debris
  debrisBurst(x, y, z, S, gy, paint) {
    const r = this.rng, sS = Math.sqrt(S);
    const n = Math.round((18 * S + 8) * this.qd);
    const cols = [paint, paint, 0x171614, 0x171614, 0x231f1b, 0x231f1b, 0x2a1a12, 0x4a2410, 0x3c3e40, 0x302c28];
    let trails = Math.round((3 + 2 * S) * Math.max(0.5, this.qd));
    for (let i = 0; i < n; i++) {
      const az = r.next() * PI2, sp = r.range(5, 24) * sS, vy = r.range(6, 22) * sS;
      const plate = r.next() < 0.6;
      const size = r.range(0.06, 0.22) * sS;
      const pool = plate ? this.plates : this.chunks;
      const hex = cols[r.int(cols.length)];
      const trail = trails > 0 && size > 0.1 * sS; if (trail) trails--;          // a few bigger burning pieces trail fire + smoke
      const slot = plate
        ? pool.spawn(x + r.sym(0.8), y + 0.4, z + r.sym(0.8), Math.cos(az) * sp, vy, Math.sin(az) * sp, size * r.range(1.6, 3.2), size * 0.08, size * r.range(1.0, 2.2), r.sym(16), r.sym(16), r.sym(16), r.range(4.5, 7), hex, trail)
        : pool.spawn(x + r.sym(0.8), y + 0.4, z + r.sym(0.8), Math.cos(az) * sp, vy, Math.sin(az) * sp, size * r.range(0.6, 1.2), size * r.range(0.4, 0.9), size * r.range(0.6, 1.2), r.sym(14), r.sym(14), r.sym(14), r.range(4.5, 7), hex, trail);
      pool.gy[slot] = gy;
    }
  }
  _chunkBounce(pool, i, x, y, z, imp) {
    if (imp < 3 || !this.near(x, y, z, 120)) return;
    const r = this.rng, size = pool.sc[i * 3] * 2.2 + 0.4;
    R.dust(this, x, y, z, r.sym(1), r.range(0.4, 1.4), r.sym(1), size * 0.4, size * 1.6, r.range(0.7, 1.2), 0.6, 0.5, 0.38, 0.4, y - 0.05, 2, 0.1);
    if (imp > 6 && r.next() < 0.5) for (let k = 0; k < 3; k++) R.spark(this, x, y + 0.05, z, r.sym(4), r.range(1, 5), r.sym(4), r.range(0.2, 0.5), y - 0.02, 0.6, 0.03);
  }
  _chunkTrail(x, y, z, k, age) {
    if (!this.near(x, y, z, 160)) return;
    const r = this.rng, hot = age < 2.2 ? 1 - age / 2.2 : 0;
    R.puff(this, x, y, z, r.sym(0.3), r.range(0.2, 0.7), r.sym(0.3), 0.4, r.range(0.9, 1.4), r.range(0.9, 1.4), 0.07, 0.066, 0.063, 0.3 * k, 0.5, 0.25, -1e4, 0.8 * hot);
    if (hot > 0) {
      if (r.next() < 0.25) R.flame(this, x, y - 0.05, z, r.sym(0.3), r.range(0.3, 1), r.sym(0.3), 0.25 + 0.2 * hot, (0.25 + 0.2 * hot) * 2.2, 0.25, 1.2, 2.5, 0, 1.5, 1.2);
      R.glow(this, x, y, z, 0.55 + 0.35 * hot, 0.09, 2.2, 0.95, 0.22, false, 1.0);
    }
  }
  _grenadeBounce(x, y, z, imp) {
    const r = this.rng;
    if (imp < 1.5) return;
    for (let i = 0; i < 4; i++) R.spark(this, x, y + 0.05, z, r.sym(3), r.range(1, 4), r.sym(3), r.range(0.15, 0.35), y - 0.03, 0.7, 0.03);
    R.dust(this, x, y, z, 0, 0.4, 0, 0.1, 0.6, 0.5, 0.6, 0.52, 0.4, 0.35, y - 0.05);
  }

  // ------------------------------------------------------------------------------------------------ lighting sync
  _syncLighting(force) {
    let r = 0, g = 0, b = 0, hemi = null;
    for (const o of this.scene.children) {
      if (!o.isLight || o.visible === false) continue;
      if (o.isDirectionalLight) { const k = o.intensity * 0.3; r += o.color.r * k; g += o.color.g * k; b += o.color.b * k; if (o.intensity > 0.05 && o.target) this.U.uSunDir.value.copy(o.position).sub(o.target.position).normalize(); }
      else if (o.isHemisphereLight) { hemi = o; const k = o.intensity * 0.55; r += (o.color.r * 0.72 + o.groundColor.r * 0.28) * k; g += (o.color.g * 0.72 + o.groundColor.g * 0.28) * k; b += (o.color.b * 0.72 + o.groundColor.b * 0.28) * k; }
      else if (o.isAmbientLight) { r += o.color.r * o.intensity * 0.5; g += o.color.g * o.intensity * 0.5; b += o.color.b * o.intensity * 0.5; }
    }
    if (r + g + b < 0.05) { r = g = b = 0.7; }
    const Y = 0.3 * r + 0.59 * g + 0.11 * b, k = Math.pow(Math.min(1, Y), 1.5) / Math.max(Y, 0.02);   // night scenes are much darker than their raw light sum
    r *= k; g *= k; b *= k;
    if (!this._manualLight) {
      const U = this.U.uLight.value;
      U.set(Math.min(1.25, Math.max(0.05, r)), Math.min(1.25, Math.max(0.05, g)), Math.min(1.25, Math.max(0.05, b)));
    }
    // normal-lit sheets: hemisphere ambient (sky above / ground below) + an estimate of the sky IBL every lit material gets
    const envI = this.scene.environmentIntensity ?? 1, zen = ATMO.uAtmZen.value, hor = ATMO.uAtmHor.value;
    const hI = hemi ? hemi.intensity / Math.PI : 0.1;
    const sc = hemi ? hemi.color : _c1.setRGB(0.6, 0.65, 0.75), gc = hemi ? hemi.groundColor : _c2.setRGB(0.4, 0.35, 0.3);
    const night = 1 - (ATMO.uAtmSun.value.w || 0);
    const fl = [0.07 * night, 0.085 * night, 0.13 * night];
    const sky = this.U.uSkyCol.value, gnd = this.U.uGndCol.value;
    sky.set(sc.r * hI + envI * (0.35 * zen.x + 0.45 * hor.x), sc.g * hI + envI * (0.35 * zen.y + 0.45 * hor.y), sc.b * hI + envI * (0.35 * zen.z + 0.45 * hor.z)).multiplyScalar(this.ambGain);
    gnd.set(gc.r * hI + envI * 0.25 * hor.x, gc.g * hI + envI * 0.25 * hor.y, gc.b * hI + envI * 0.25 * hor.z).multiplyScalar(this.ambGain);
    sky.set(Math.max(sky.x, fl[0] * 1.4), Math.max(sky.y, fl[1] * 1.4), Math.max(sky.z, fl[2] * 1.4)); gnd.set(Math.max(gnd.x, fl[0]), Math.max(gnd.y, fl[1]), Math.max(gnd.z, fl[2]));
    const fog = this.scene.fog;
    if (fog && fog.isFogExp2) { this.U.uFogD.value = fog.density; this.U.uFogCol.value.copy(fog.color); }
    else if (fog && fog.isFog) { this.U.uFogD.value = 1.6 / Math.max(1, fog.far); this.U.uFogCol.value.copy(fog.color); }
    else this.U.uFogD.value = 0;
    void force;
  }

  // ------------------------------------------------------------------------------------------------ depth / own truck
  /** Soft particles: `src.depthTexture` (Post: last frame's scene depth, never bound as a render target while we sample it). */
  setDepthSource(src) { this._depthSrc = src || null; }

  /** The local player's truck: attached-frame particles (hood fire/smoke) + the cabin clip volume. */
  _setOwn(st, cv, rec) {
    const o = this._own;
    if (o && o.cv === cv) { o.st = st; o.rec = rec; return; }
    if (!rec.cab) { try { rec.cab = measureCabin(cv); } catch (e) { console.warn('fx: cabin measure failed', e); rec.cab = null; } }
    this._own = { cv, st, rec };
  }

  _beforeRender(renderer, camera) {
    const U = this.U;
    // soft particles: only for the main camera pass (the mirror pass renders a different view into its own target)
    const src = this._depthSrc, dt = src && camera === this.camera && this.q > 0 ? src.depthTexture : null;
    if (dt) {
      const rt = renderer.getRenderTarget();
      const w = rt ? rt.width : (dt.image && dt.image.width) || 1, h = rt ? rt.height : (dt.image && dt.image.height) || 1;
      U.uDepth.value = dt; U.uSoftOn.value = 1; U.uDepthInfo.value.set(1 / w, 1 / h, camera.near, camera.far);
    } else { U.uSoftOn.value = 0; }
    U.uFovK.value = 2 * Math.tan(((camera.fov || 60) * Math.PI) / 360);
    // attached frame + cabin clip (current transforms: the scene graph was just updated for this render)
    const o = this._own, cab = o && o.rec && o.rec.cab;
    if (o && cab && o.cv.root.parent && !o.st.exploded) {
      const root = o.cv.root;
      U.uFrame.value.copy(root.matrixWorld);
      U.uCabInv.value.copy(root.matrixWorld).invert();
      _qi.copy(root.quaternion).invert();
      const v = o.st.vel, w = U.uWind.value;
      U.uFrameAir.value.set(w.x * 0.5 - v.x, -v.y * 0.3, w.z * 0.5 - v.z).applyQuaternion(_qi);
      U.uFrameUp.value.set(0, 1, 0).applyQuaternion(_qi);
      U.uCabMin.value.set(cab.min.x, cab.min.y, cab.min.z, 1); U.uCabMax.value.set(cab.max.x, cab.max.y, cab.max.z, 1);
      U.uCabPlane.value.copy(cab.plane);
    } else U.uCabMin.value.w = 0;
  }

  // ------------------------------------------------------------------------------------------------ main update
  update(dt) {
    if (!this.loaded) return;
    const t0 = performance.now();
    dt = Math.min(dt, 0.05);
    this.time += dt; this.frame++;
    const cam = this.camera;
    cam.updateMatrixWorld(); cam.getWorldPosition(this.camPos);
    _pv2.copy(cam.matrixWorld).invert(); _pv.multiplyMatrices(cam.projectionMatrix, _pv2); this.frustum.setFromProjectionMatrix(_pv);
    this._lightT -= dt; if (this._lightT <= 0) { this._lightT = 0.4; this._syncLighting(); }
    this.U.uTime.value = this.time; this.timeU.value = this.time;
    { const kc = KEY.uKeyCol.value, g = this.keyGain / Math.PI; this.U.uKeyCol.value.set(kc.r * g, kc.g * g, kc.b * g); }
    if (this._own && (!this._own.cv.root.parent || !this.recs.has(this._own.st.id))) this._own = null;
    this.U.uPix.value = (2 * Math.tan((cam.fov || 60) * Math.PI / 360)) / this.viewH;
    this._runJobs(dt);
    this.boss.update(dt);
    this.haz.update(dt);
    this._updateRockets(dt);
    this._updateTracked(dt);
    this._updateImpacts();
    this.chunks.update(dt); this.plates.update(dt); this.casings.update(dt); this.grenades.update(dt);
    // lights
    let lit = 0;
    for (const s of this.lights) {
      if (s.mode === 1) { s.t += dt; s.I = s.I0 * Math.exp(-5 * s.t / s.dur) ; if (s.t > s.dur * 1.4 || s.I < 1) { s.mode = 0; s.I = 0; } }
      else if (s.mode === 2 && this.time - s.stamp > 0.25) { s.mode = 0; s.I = 0; }
      s.light.intensity = s.mode === 0 ? 0 : s.I; if (s.mode) lit++;
    }
    this.pa.update(this.time); this.pf.update(this.time); this.skid.update(this.time);
    const st = this.stats;
    st.alpha = this.pa.live; st.fire = this.pf.live; st.live = st.alpha + st.fire; st.chunks = this.chunks.alive + this.plates.alive; st.casings = this.casings.alive;
    st.skidSegments = this.skid.hw; st.lights = lit;
    st.carMs = st.carMs * 0.9 + this._carMs * 0.1; this._carMs = 0;
    st.ms = st.ms * 0.9 + (performance.now() - t0) * 0.1;
  }

  // ------------------------------------------------------------------------------------------------ events
  handleEvent(evt, ctx = {}) {
    if (!this.loaded) return;
    this._shake = ctx.shake || this._shake;
    if (ctx.carViews) this._views = ctx.carViews;
    if (ctx.playerId !== undefined) this.playerId = ctx.playerId;
    const cp = ctx.cameraPos; if (cp) this.camPos.copy(cp);
    const rng = this.rng;
    switch (evt.t) {
      case 'shot': this._shot(evt, ctx); break;
      case 'hit': {
        const p = evt.pos, n = evt.normal || [0, 1, 0];
        if (!this.near(p[0], p[1], p[2], 170)) break;
        R.impact(this, evt.surface || 'metal', p[0], p[1], p[2], n[0], n[1], n[2], this.groundAt(p[0], p[2], p[1] - 0.3));
        if (evt.enemy) this._killBulletNear(p[0], p[1], p[2]);
        break;
      }
      case 'whizz': {
        const p = evt.pos;
        const cx = this.camera.position; _v.set(p[0] - cx.x, p[1] - cx.y, p[2] - cx.z);
        _v2.set(rng.sym(1), rng.sym(0.3), 1).normalize();
        R.whizz(this, p[0], p[1], p[2], _v2.x, _v2.y, _v2.z);
        break;
      }
      case 'crash': {
        const p = evt.pos; if (!this.near(p[0], p[1], p[2], 200)) break;
        const cst = ctx.states && ctx.states.get(evt.id), ccv = ctx.carViews && ctx.carViews.get(evt.id);
        let vx = 0, vy = 0, vz = 0;
        if (cst && ccv && cst.spec) {
          // sparks where the hulls meet (toward the other car; for walls / rails the side the car is being pushed off),
          // not at the centre of mass (for our own truck that would be inside the cab)
          const root = ccv.root, os = evt.other >= 0 && ctx.states.get(evt.other);
          _qi.copy(root.quaternion).invert();
          const hw = cst.spec.width * 0.5, hl = cst.spec.length * 0.5;
          if (os) _v2.copy(os.pos).sub(cst.pos).applyQuaternion(_qi);
          else { _v2.copy(cst.vel).applyQuaternion(_qi); if (Math.abs(_v2.x) > 1.5) _v2.set(-Math.sign(_v2.x), 0, rng.sym(0.6)); else _v2.set(rng.sym(0.5), 0, 1); }
          _v2.y = 0; const sx = Math.abs(_v2.x) > 1e-3 ? hw / Math.abs(_v2.x) : 1e9, sz = Math.abs(_v2.z) > 1e-3 ? hl / Math.abs(_v2.z) : 1e9;
          _v2.multiplyScalar(Math.min(sx, sz)); _v2.y = cst.spec.height * 0.3;                          // root origin = ground level
          _v.copy(_v2).applyQuaternion(root.quaternion).add(root.position);
          vx = cst.vel.x; vy = cst.vel.y; vz = cst.vel.z;
        } else _v.set(p[0], p[1] - 0.2, p[2]);
        const gy = this.groundAt(_v.x, _v.z, _v.y - 0.7);
        R.crash(this, _v.x, _v.y, _v.z, evt.dv, evt.speed, gy, vx, vy, vz);
        _v.set(p[0], p[1], p[2]);
        this.shakeReq(_v, Math.min(0.75, evt.dv * 0.06) * (evt.id === ctx.playerId ? 1.4 : 1), 60);
        break;
      }
      case 'explode': {
        if (evt.spec === 'boss' || evt.id === BOSS_ID) { this.boss.explode(evt); break; }
        const p = evt.pos, cv = ctx.carViews && ctx.carViews.get(evt.id), st = ctx.states && ctx.states.get(evt.id);
        const S = evt.size || 1;
        const gy = this.groundAt(p[0], p[2], cv ? cv.root.position.y : p[1] - 0.8);
        R.explosion(this, p[0], p[1], p[2], S, { ground: gy, paint: cv ? paintHexOf(cv) : 0x6d4a30 });
        this.haz.igniteNear(p[0], p[2], 3 * S);
        _v.set(p[0], p[1], p[2]); this.shakeReq(_v, 0.95 * Math.pow(S, 0.7), 120 * Math.pow(S, 0.6));
        if (cv && st) this.wreck(st, cv);
        break;
      }
      case 'boom': {
        const p = evt.pos, kind = evt.kind || 'rocket';
        const gy = this.groundAt(p[0], p[2], p[1] - 0.2);
        R.boom(this, p[0], p[1], p[2], evt.radius || 10, kind, gy);
        this.haz.igniteNear(p[0], p[2], 2);
        const big = kind === 'tank' ? 1.0 : Math.min(0.9, 0.45 + (evt.radius || 10) * 0.03);
        _v.set(p[0], p[1], p[2]); this.shakeReq(_v, big, kind === 'tank' ? 140 : 90);
        this._killProjectileNear(p[0], p[1], p[2]);
        if (kind === 'mine') this.haz.removeNear(p[0], p[1], p[2]);
        break;
      }
      case 'tirePop': {
        const rec = this.recs.get(evt.id), cv = ctx.carViews && ctx.carViews.get(evt.id), st = ctx.states && ctx.states.get(evt.id);
        if (!cv || !st) break;
        const i = evt.index | 0; const node = rec && rec.nodes[i];
        if (node) { _v.copy(node.position); if (rec.pm[i]) _v.applyMatrix4(rec.pm[i]); _v.applyQuaternion(cv.root.quaternion).add(cv.root.position); } else _v.copy(cv.root.position);
        if (!this.near(_v.x, _v.y, _v.z, 160)) break;
        R.tirePop(this, _v.x, _v.y, _v.z, st.vel.x, st.vel.y, st.vel.z, this.groundAt(_v.x, _v.z, _v.y - 0.4));
        break;
      }
      case 'engineDead': case 'smoke': case 'fire': case 'fuelLeak': this._damagePop(evt, ctx); break;
      case 'grenadeThrow': this._grenadeThrow(evt, ctx); break;
      case 'bossSpawn': case 'bossPhase': case 'bossFlame': case 'bossCharge': case 'bossCannon': case 'bossPart':
      case 'bossDeflect': case 'bossVolley': case 'bossRamp': case 'bossDying': this.boss.handleEvent(evt, ctx); break;
      case 'mineDrop': this.haz.mineDrop(evt); break;
      case 'oil': case 'oilSlick': if (evt.pos) this.haz.oilSlick(evt); break;
      case 'boostPad': this.haz.boostPad(evt, ctx); break;
      case 'unflip': this.haz.unflip(evt, ctx); break;
      case 'medkit': this.haz.medkit(evt, ctx); break;
      case 'crewHit': {
        if (!evt.point || !this.near(evt.point[0], evt.point[1], evt.point[2], 90)) break;
        R.dust(this, evt.point[0], evt.point[1], evt.point[2], rng.sym(0.6), rng.range(0.3, 1), rng.sym(0.6), 0.15, 0.7, 0.5, 0.6, 0.5, 0.42, 0.4, -1e4, 2.5, 0);
        break;
      }
      case 'remove': {
        const rec = this.recs.get(evt.id);
        if (rec) { for (let i = 0; i < rec.nW; i++) this.skid.end(rec.id * 16 + i); this.recs.delete(evt.id); }
        break;
      }
      default: break;
    }
  }

  _damagePop(evt, ctx) {
    const cv = ctx.carViews && ctx.carViews.get(evt.id), st = ctx.states && ctx.states.get(evt.id);
    if (!cv || !st) return;
    const rec = this._rec(st, cv);
    if (st.id === this.playerId && rec.cab) { ownBurst(this, rec, st, evt.t); return; }
    rec.toWorld(rec.sock.engine, _v);
    if (!this.near(_v.x, _v.y, _v.z, 200)) return;
    const r = this.rng, vel = st.vel;
    const n = evt.t === 'fire' ? 6 : 5;
    for (let i = 0; i < n; i++) R.puff(this, _v.x + r.sym(0.3), _v.y, _v.z + r.sym(0.3), vel.x * 0.8 + r.sym(1), r.range(2, 4), vel.z * 0.8 + r.sym(1), 0.5, r.range(2.4, 3.6), r.range(1.4, 2.2), evt.t === 'engineDead' ? 0.06 : 0.14, evt.t === 'engineDead' ? 0.06 : 0.13, evt.t === 'engineDead' ? 0.06 : 0.13, 0.8, 0.9, 0.5);
    if (evt.t === 'fire') R.glow(this, _v.x, _v.y + 0.2, _v.z, 1.8, 0.15, 3, 1.6, 0.5, true, 1.4);
    if (evt.t === 'engineDead') for (let i = 0; i < 8 * this.qd; i++) R.spark(this, _v.x, _v.y, _v.z, vel.x * 0.5 + r.sym(6), r.range(2, 8), vel.z * 0.5 + r.sym(6), r.range(0.3, 0.7), _v.y - 0.8, 0.8, 0.035);
  }

  _shot(evt, ctx) {
    let o = evt.origin; if (!o) return;
    const wid = evt.weapon, player = evt.src === 'player';
    const boss = evt.src === BOSS_ID;
    if (boss) { this.boss.view = this.boss._findView(); this.boss.root = this.boss.view ? this.boss.view.root : null; }
    const sst = boss ? null : ctx.states && ctx.states.get(player ? ctx.playerId : evt.src);
    const sv = boss ? this.boss.vel : sst ? sst.vel : null;
    const vx = sv ? sv.x : 0, vy = sv ? sv.y : 0, vz = sv ? sv.z : 0;
    const rays = evt.rays;
    let dx, dy, dz;
    if (evt.dir) { dx = evt.dir[0]; dy = evt.dir[1]; dz = evt.dir[2]; }
    else if (rays && rays.length) { const r0 = rays[0]; if (Array.isArray(r0)) { dx = r0[0]; dy = r0[1]; dz = r0[2]; } else if (r0 && r0.end) { dx = r0.end[0] - o[0]; dy = r0.end[1] - o[1]; dz = r0.end[2] - o[2]; } }
    if (dx === undefined) { dx = 0; dy = 0; dz = 1; }
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    if (wid === 'cannon') { this.boss.cannonBlast(o[0], o[1], o[2], dx, dy, dz); if (evt.rocket) this._launchRocket(o, dx, dy, dz, evt.speed || 150); return; }
    if (boss && evt.heavy) { _o3[0] = o[0] + dx * 2.2; _o3[1] = o[1] + dy * 2.2; _o3[2] = o[2] + dz * 2.2; o = _o3; }   // boss MG origin is the turret pivot: barrel tip (don't mutate the event)
    const d = this.dist(o[0], o[1], o[2]);
    if (d > (player ? 400 : boss ? 450 : 300)) return;
    const gy = this.groundAt(o[0], o[2], o[1] - 1.6);
    const fp = player && !evt.remote ? (evt.fp | 0) : 0;   // local first-person shooter (2 = scoped): the viewmodel draws its own flash
    R.muzzle(this, evt.heavy && wid === 'enemy' ? 'heavy' : wid, o[0], o[1], o[2], dx, dy, dz, vx, vy, vz, gy, fp);
    if (evt.rocket) { this._launchRocket(o, dx, dy, dz, evt.speed || (WEAPONS.rpg.rocket && WEAPONS.rpg.rocket.speed) || 85); return; }
    if (player) {
      if (rays) for (let i = 0; i < rays.length; i++) {
        const ry = rays[i], e = ry && ry.end; if (!e) continue;
        R.tracerHit(this, wid, o[0], o[1], o[2], e[0], e[1], e[2]);
        if (ry.surface) this._queueImpact(ry, Math.hypot(e[0] - o[0], e[1] - o[1], e[2] - o[2]) / 620);   // the sim emits no 'hit' for hitscan rays
      }
      this._eject(wid, o, dx, dy, dz, ctx, fp ? evt : null);
    } else if (rays) {
      const sp = evt.speed || 120;
      for (let i = 0; i < rays.length; i++) {
        const r0 = rays[i]; if (!Array.isArray(r0)) continue;
        R.tracerBullet(this, o[0], o[1], o[2], r0[0], r0[1], r0[2], sp, 0, 0, 0, !!evt.heavy);
        const tr = this.tracked[this.trackHead]; this.trackHead = (this.trackHead + 1) % this.tracked.length;
        tr.live = true; tr.slot = this.lastSlot; tr.slot2 = this.lastSlot2; tr.birth = this.lastBirth; tr.x = o[0]; tr.y = o[1]; tr.z = o[2]; tr.dx = r0[0]; tr.dy = r0[1]; tr.dz = r0[2]; tr.sp = sp; tr.t = 0;
      }
    }
  }

  _queueImpact(ry, delay) {
    const it = this.pimp[this.pimpHead]; this.pimpHead = (this.pimpHead + 1) % this.pimp.length;
    const e = ry.end, n = ry.normal;
    it.live = true; it.t = this.time + delay; it.s = ry.surface; it.x = e[0]; it.y = e[1]; it.z = e[2];
    if (n) { it.nx = n[0]; it.ny = n[1]; it.nz = n[2]; } else { const l = this.dist(e[0], e[1], e[2]) || 1; it.nx = (this.camPos.x - e[0]) / l; it.ny = (this.camPos.y - e[1]) / l; it.nz = (this.camPos.z - e[2]) / l; }
  }
  _updateImpacts() {
    for (const it of this.pimp) {
      if (!it.live || this.time < it.t) continue;
      it.live = false;
      if (this.near(it.x, it.y, it.z, 170)) R.impact(this, it.s, it.x, it.y, it.z, it.nx, it.ny, it.nz, this.groundAt(it.x, it.z, it.y - 0.3));
    }
  }

  /** Enemy bullets die on impact: hide the tracer whose flight path passes closest to the reported hit. */
  _killBulletNear(x, y, z) {
    let best = null, bd = 7;
    for (const tr of this.tracked) {
      if (!tr.live) continue;
      const px = tr.x + tr.dx * tr.sp * tr.t, py = tr.y + tr.dy * tr.sp * tr.t, pz = tr.z + tr.dz * tr.sp * tr.t;
      const d = Math.hypot(px - x, py - y, pz - z);
      if (d < bd) { bd = d; best = tr; }
    }
    if (best) { this.pf.kill(best.slot, best.birth); this.pf.kill(best.slot2, best.birth); best.live = false; }
  }
  _updateTracked(dt) { for (const tr of this.tracked) if (tr.live) { tr.t += dt; if (tr.t > 1.8) tr.live = false; } }

  _eject(wid, o, dx, dy, dz, ctx, fpEvt = null) {
    const cfg = R.muzzleCfg(wid);
    if (!cfg || cfg.casing < 0) return;
    const cv = ctx.carViews && ctx.carViews.get(ctx.playerId);
    if (!cv) return;
    const r = this.rng, c = CASING[cfg.casing];
    if (!this.near(o[0], o[1], o[2], 60)) return;
    // right of the gun (-X for +Z-facing), in the car's local frame (casings ride the truck bed)
    const root = cv.root; _q.copy(root.quaternion).invert();
    const seat = cv.spec.seats && cv.spec.seats.gunner; const floorY = seat ? seat[1] : 0.9;
    const ax = r.sym(30), ay = r.sym(30), az = r.sym(40);
    if (fpEvt && fpEvt.ej) {
      // first person: out of the viewmodel's ejection port, up-right and a little back toward the shooter, tumbling
      const e = fpEvt.ej, ed = fpEvt.ejd;
      _v.set(e[0] - root.position.x, e[1] - root.position.y, e[2] - root.position.z).applyQuaternion(_q);
      _v2.set(ed[0], ed[1], ed[2]).applyQuaternion(_q);
      const sp = r.range(2.4, 3.6), up = r.range(1.8, 2.8), back = r.range(0.3, 0.9);
      _v3.set(dx, 0, dz).applyQuaternion(_q);                                                  // gun forward (truck frame)
      return this.casings.spawn(_v.x, _v.y, _v.z, _v2.x * sp - _v3.x * back, up + _v2.y * sp * 0.5, _v2.z * sp - _v3.z * back,
        c.rad * 0.5, c.len * 0.5, c.rad * 0.5, ax * 1.6, ay, az * 1.6, 1.4, c.hex, false, root, floorY);   // real size up close
    }
    _v.set(o[0] - root.position.x, o[1] - root.position.y, o[2] - root.position.z).applyQuaternion(_q);
    _v2.set(dx, dy, dz).applyQuaternion(_q);
    let rx = _v2.z, rz = -_v2.x; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;         // horizontal right = cross(dir, up)
    const sp = r.range(1.6, 3.2), up = r.range(1.6, 2.8), back = r.range(-0.3, 0.5);
    const i = this.casings.spawn(_v.x - _v2.x * 0.45 + rx * 0.06, _v.y - 0.02, _v.z - _v2.z * 0.45 + rz * 0.06,
      rx * sp + _v2.x * back, up, rz * sp + _v2.z * back, c.rad, c.len, c.rad, ax, ay, az, 1.5, c.hex, false, root, floorY);
    return i;
  }

  // ------------------------------------------------------------------------------------------------ rockets + grenades
  _launchRocket(o, dx, dy, dz, speed) {
    if (this._projSeen) return;                                     // real projectile positions are being fed by updateProjectiles()
    for (const rk of this.rockets) if (!rk.live) {
      rk.live = true; rk.x = o[0] + dx * 0.6; rk.y = o[1] + dy * 0.6; rk.z = o[2] + dz * 0.6; rk.dx = dx; rk.dy = dy; rk.dz = dz; rk.target = speed; rk.sp = 25; rk.t = 0; return;
    }
    this.rockets.push({ live: true, x: o[0] + dx * 0.6, y: o[1] + dy * 0.6, z: o[2] + dz * 0.6, dx, dy, dz, target: speed, sp: 25, t: 0 });
  }
  _updateRockets(dt) {
    for (const rk of this.rockets) {
      if (!rk.live) continue;
      rk.t += dt; rk.sp = Math.min(rk.target, rk.sp + dt * rk.target * 1.6);
      const step = rk.sp * dt, x0 = rk.x, y0 = rk.y, z0 = rk.z;
      rk.x += rk.dx * step; rk.y += rk.dy * step; rk.z += rk.dz * step;
      this.rocketTrail(x0, y0, z0, rk.x, rk.y, rk.z, rk.dx, rk.dy, rk.dz);
      if (rk.t > 4 || rk.y < this.groundAt(rk.x, rk.z, -1e4) - 0.5) rk.live = false;
    }
  }
  /** Smoke trail + exhaust flame for a rocket that moved (x0,y0,z0) -> (x1,y1,z1) this frame. */
  rocketTrail(x0, y0, z0, x1, y1, z1, dx, dy, dz) {
    if (!this.near(x1, y1, z1, 500)) return;
    const r = this.rng, len = Math.hypot(x1 - x0, y1 - y0, z1 - z0), n = Math.max(1, Math.round(len / 0.9));
    for (let i = 1; i <= n; i++) {
      const f = i / n, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f, z = z0 + (z1 - z0) * f;
      R.puff(this, x, y, z, r.sym(0.5), r.range(0.1, 0.6), r.sym(0.5), 0.35, r.range(2.0, 3.0), r.range(1.6, 2.4), 0.82, 0.8, 0.77, 0.55, 0.15, 0.5);
      if (i === n) {
        const p = this.p.reset(); p.pos(x, y, z).vel(dx * 6, dy * 6, dz * 6); p.mode = MODE.FLAME; p.spr = SPR.FIRE; p.f0 = r.int(32); p.nPlay = 32; p.fps = 40; p.len = 2.6; p.size(0.55, 0.3);
        p.life = 0.06; p.col(2.6, 1.7, 0.9, 1); p.add0 = p.add1 = 1; p.fin = 0.05; p.fout = 0.5; this.pf.emit(p);
        const gk = Math.min(1, this.dist(x, y, z) / 10);           // right after launch the glow is next to the shooter's eye: keep it small
        R.glow(this, x, y, z, 1.4 * (0.25 + 0.75 * gk), 0.05, 6 * gk + 1.5, 3.2 * gk + 0.8, 1.2 * gk + 0.3, false, 1.2);
        if (r.next() < 0.5) R.spark(this, x, y, z, -dx * r.range(8, 20) + r.sym(3), -dy * 10 + r.sym(3), -dz * r.range(8, 20) + r.sym(3), r.range(0.2, 0.5), y - 30, 0.9, 0.04);
      }
    }
  }
  _grenadeThrow(evt, ctx) {
    const o = evt.origin, v = evt.vel; if (!o || !v) return;
    if (this._projSeen) return;                                     // the real grenade is drawn from updateProjectiles() (no double)
    const i = this.grenades.spawn(o[0], o[1], o[2], v[0], v[1], v[2], 0.11, 0.11, 0.11, 6, 4, 5, 2.6, 0x38452f, false);
    this.grenades.gy[i] = this.groundAt(o[0], o[2], o[1] - 1.4);
  }
  _killProjectileNear(x, y, z) {
    for (const rk of this.rockets) if (rk.live && Math.hypot(rk.x - x, rk.y - y, rk.z - z) < 30) rk.live = false;
    const g = this.grenades;
    for (let i = 0; i < g.hw; i++) if (g.age[i] < g.life[i] && Math.hypot(g.px[i] - x, g.py[i] - y, g.pz[i] - z) < 6) { g.kill(i); break; }
  }
  /** Optional: feed the sim's real rocket/grenade positions each frame ([{k:1 rocket | 2 grenade, x,y,z}]); replaces the event-driven visuals. */
  updateProjectiles(list, dt) {
    if (!this.loaded) return;
    this._projSeen = true;
    for (const rk of this.rockets) rk.live = false;
    for (const q of this.pProj) q.seen = false;
    for (let i = 0; i < list.length; i++) {
      const it = list[i]; let best = null, bd = it.k === 1 ? 14 : 3;
      for (const q of this.pProj) { if (!q.live || q.seen || q.k !== it.k) continue; const d = Math.hypot(q.x - it.x, q.y - it.y, q.z - it.z); if (d < bd) { bd = d; best = q; } }
      if (!best) { for (const q of this.pProj) if (!q.live) { best = q; break; } if (best) { best.live = true; best.k = it.k; best.x = it.x; best.y = it.y; best.z = it.z; } }
      if (!best) continue;
      best.seen = true;
      if (it.k === 1) {
        const dx = it.x - best.x, dy = it.y - best.y, dz = it.z - best.z, l = Math.hypot(dx, dy, dz);
        if (l > 0.01) this.rocketTrail(best.x, best.y, best.z, it.x, it.y, it.z, dx / l, dy / l, dz / l);
      }
      best.x = it.x; best.y = it.y; best.z = it.z;
    }
    for (const q of this.pProj) if (!q.seen) q.live = false;
  }

  // ------------------------------------------------------------------------------------------------ shader prewarm
  /**
   * Call right before renderer.compileAsync(scene, camera) at run start; call the returned fn (or prewarmDone()) after.
   * Every FX pool/decal/mesh material already lives in the scene from load(); what is missing are the wreck-charred
   * `paint*` variants of each (pre-loaded) vehicle GLB, which the first explosion of each car type would otherwise compile
   * mid-run. Hidden meshes built from the real paint geometry + patched material clones are added at y = -5000, plus every
   * other mesh of each pre-loaded vehicle / boss GLB as-is (so a car type's first spawn doesn't compile mid-run either).
   * Their materials are deliberately NOT disposed afterwards so the compiled programs stay cached.
   */
  prewarm() {
    if (!this.loaded) return () => {};
    this.prewarmDone();
    const g = new THREE.Group(); g.name = 'fx_prewarm'; g.position.set(0, -5000, 0);
    const u = makeWreckUniforms();
    for (const id of [...Object.keys(VEHICLES), 'boss_warrig']) {
      const url = `/models/vehicles/${id}.glb`;
      const root = Assets.has(url) ? Assets.clone(url) : null;
      if (!root) continue;
      const seen = new Map();
      root.traverse((o) => {
        if (!o.isMesh) return;
        const mats = [].concat(o.material);
        if (!mats.some((m) => m && /^paint/.test(m.name)) || id === 'boss_warrig') {          // base materials as-is: first spawn of a car type won't compile either
          const mesh = new THREE.Mesh(o.geometry, o.material); mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; g.add(mesh);
          return;
        }
        const pm = mats.map((m) => {
          if (!m || !/^paint/.test(m.name)) return m;
          let c = seen.get(m);
          if (!c) { c = m.clone(); c.userData = {}; patchPaint(c, u); seen.set(m, c); }        // clone first: GLB-cache materials are shared
          return c;
        });
        const mesh = new THREE.Mesh(o.geometry, Array.isArray(o.material) ? pm : pm[0]);
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
        g.add(mesh);
      });
    }
    g.updateMatrixWorld(true);
    this.scene.add(g); this._warm = g;
    return () => this.prewarmDone();
  }
  prewarmDone() { if (this._warm) { this._warm.removeFromParent(); this._warm = null; } }

  // ------------------------------------------------------------------------------------------------ cleanup
  clear() { this.pa.clear(); this.pf.clear(); this.skid.clear(); for (const j of this.jobs) j.type = 0; this.boss.clear(); this.haz.clear(); for (const it of this.pimp) it.live = false; }
  dispose() {
    for (const o of [this.pa, this.pf, this.skid, this.decScorch, this.decHoles, this.chunks, this.plates, this.casings, this.grenades, this.haz]) o && o.dispose();
    for (const s of this.lights) { s.light.removeFromParent(); }
    this.atlas && this.atlas.texture.dispose();
    this.loaded = false;
  }
}
