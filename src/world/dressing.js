// Dressing: everything that stands on the terrain (props, road furniture, road-feature structures, landmarks) + water + far scenery.
//
//   const dressing = new Dressing(scene, road, seed, { quality: 2, physicsHook });
//   await dressing.load(startS);                                   // manifests + assets for the biome around startS (rest streams in on demand)
//   streamer.onChunk = (c, rec) => dressing.onChunk(c, rec);       // TerrainStreamer callbacks
//   streamer.onChunkDrop = (c) => dressing.onChunkDrop(c);
//   each frame:  dressing.update(dt, camera.position, s, camera);  // camera (4th arg) is optional; it enables behind-the-camera culling
//   optional:    dressing.setShadowFocus(truckPos)                 // if SkyRig's shadow box follows the truck rather than the camera
//
// Modules: dressing/scatter.js (natural props, tables in dressing/types.js), dressing/furniture.js (rails, poles, lamps, signs), dressing/features.js
// (ramp/boost/roadblock/bridge/tunnel/overpass), dressing/landmarks.js (roadside set pieces, city skyline, coast/canyon/dam specials),
// dressing/pool.js (global InstancedMesh pool: LOD, distance/behind culling, shadow-caster selection), dressing/backdrop.js (far mountain rings), water.js.
// All placement is a pure function of (seed, chunk); quality only thins small scatter (never colliders).
//
// physicsHook(req): called when a chunk builds something the sim may want a collider/trigger for. req.type is one of
//   'ramp' | 'boost' | 'roadblock' | 'guardrail' | 'bridge' | 'tunnel' | 'overpass' | 'static' (landmark within 70 m of the road) | 'remove'.  Every request has a unique `id`; when the chunk that
//   owns it is dropped, physicsHook({type:'remove', id}) is called. Geometry is in WORLD coordinates: req.surface / req.collision = {pos:Float32Array, idx:Uint32Array}
//   (trimesh data), req.polyline = [[x,y,z]...] for guard rails, req.pos/req.yaw/req.frame for placement, plus feature fields (s0, s1, lane, gap...).
//   The sim decides when to actually create bodies (they can be created lazily when s is within a few hundred metres).
import * as THREE from 'three';
import { lookAt } from './look.js';
import { smoothstep } from '../core/util.js';
import { biomeAt } from '../data/biomes.js';
import { seaLevel } from './terrain_gen.js';
import { AssetKit, WIND } from './dressing/assets.js';
import { InstancePool } from './dressing/pool.js';
import { InstList, ChunkGround, CHUNK_LEN } from './dressing/util.js';
import { runScatter } from './dressing/scatter.js';
import { SCATTER } from './dressing/types.js';
import { registerProcedural } from './dressing/procedural.js';
import { buildFurniture } from './dressing/furniture.js';
import { Water } from './water.js';
import { Backdrop } from './dressing/backdrop.js';
import { buildFeatures, updateBoostAnim } from './dressing/features.js';
import { buildLandmarks, landmarkExclusions, landmarkAssets } from './dressing/landmarks.js';
import { FURNITURE_SPECS } from './dressing/furniture.js';
import { FEATURE_SPECS } from './dressing/features.js';
import { BIOMES } from '../data/biomes.js';

const QUALITY = [
  { far: 0.6, shadow: 0, budget: 2.0 },
  { far: 0.8, shadow: 70, budget: 2.5 },
  { far: 1.0, shadow: 120, budget: 3.0 },
  { far: 1.2, shadow: 170, budget: 3.5 },
];

class ChunkDress {
  constructor(dress, c) {
    this.dress = dress; this.c = c; this.s0 = c * CHUNK_LEN;
    this.lists = new Map(); this.extras = []; this.hooks = [];
    this.step = 0; this.done = new Set(); this.ground = null; this.seaY = -1e9; this.dirty = false; this.rec = null;
  }
  list(name) { let l = this.lists.get(name); if (!l) { l = new InstList(); this.lists.set(name, l); } return l; }
  addExtra(obj) { this.extras.push(obj); this.dress.extraGroup.add(obj); }
}

export class Dressing {
  constructor(scene, road, seed, opts = {}) {
    this.scene = scene; this.road = road; this.seed = seed | 0; this.opts = opts;
    this.quality = Math.max(0, Math.min(3, opts.quality ?? 2));
    this.hook = opts.physicsHook || null;
    this.kit = new AssetKit(opts.modelBase || '/models/');
    for (const e of SCATTER) if (e.lodCells) { this.kit.lodPlan.set(e.id, e.lodCells); if (e.fallback) this.kit.lodPlan.set(e.fallback, e.lodCells); }
    this.pool = new InstancePool(scene, this.kit);
    this.pool.qf = QUALITY[this.quality].far;
    this.extraGroup = new THREE.Group(); this.extraGroup.name = 'dressing-extras'; scene.add(this.extraGroup);
    this.water = new Water(scene, road, {});
    this.backdrop = new Backdrop(scene);
    this.chunks = new Map();
    this.cam = new THREE.Vector3(); this.s = 0; this.fwd = { x: 0, z: 1 }; this.useFwd = false;
    this._lastRebuild = { x: 1e9, y: 0, z: 0, fx: 0, fz: 0, t: 0 };
    this._clock = 0; this._needRebuild = true; this._poolOk = true; this._loaded = false;
    this.ctx = {
      road, seed: this.seed, kit: this.kit, pool: this.pool, quality: this.quality, dress: this,
      hook: (req) => (this.hook ? this.hook(req) : undefined),
      exclusions: (a, b) => landmarkExclusions(this.ctx, a, b),
      tunnelsNear: (a, b) => road.featuresIn(a, b, 'tunnel'),
    };
    this.stats = { chunksBuilt: 0, jobMs: 0, rebuilds: 0, rebuildMs: 0, rebuildMax: 0, stepMax: [0, 0, 0, 0, 0, 0, 0, 0] };
  }

  /** Asset names a biome can use (scatter + furniture + road features + landmarks). */
  assetsFor(id) {
    const out = new Set([...Object.keys(FURNITURE_SPECS), ...Object.keys(FEATURE_SPECS), 'sign_gas', ...landmarkAssets(id)]);
    for (const e of SCATTER) {
      if (!(e.w[id] > 0) || !((BIOMES[id].scatter[e.key] ?? 0) > 0)) continue;
      out.add(e.id); if (e.fallback) out.add(e.fallback);
      if (e.lods && !e.lodCells) for (const l of e.lods) out.add(l.asset);
    }
    for (const n of ['guardrail_lod', 'jersey_lod', 'utility_pole_lod']) out.delete(n);
    return [...out];
  }
  /** Start loading the assets of the biome at s (not awaited unless you await it). */
  prefetch(s) {
    const b = biomeAt(s), ids = new Set([b.a, b.b]);
    const all = []; for (const id of ids) if (!this._fetched.has(id)) { this._fetched.add(id); all.push(...this.assetsFor(id)); }
    return this.kit.requestMany(all);
  }

  async load(startS = 0) {
    await this.kit.init();
    registerProcedural(this.kit);
    this._fetched = new Set();
    await Promise.all([this.prefetch(startS), this.prefetch(startS + 2500)]);
    this._loaded = true;
    return this;
  }

  // ------------------------------------------------------------------------------------------------ chunk callbacks
  onChunk(c, rec) {
    let ch = this.chunks.get(c);
    if (!ch) { ch = new ChunkDress(this, c); this.chunks.set(c, ch); }
    ch.rec = rec;
  }
  onChunkDrop(c) {
    const ch = this.chunks.get(c); if (!ch) return;
    for (const id of ch.hooks) this.ctx.hook({ type: 'remove', id });
    for (const o of ch.extras) { this.extraGroup.remove(o); o.traverse((x) => { if (x.geometry && x.userData.ownGeo) x.geometry.dispose(); }); }
    this.water.dropChunk(c);
    this.chunks.delete(c);
    this._needRebuild = true;
  }

  // ------------------------------------------------------------------------------------------------ jobs
  /** stages: 0 ground grid, 1 furniture, 2 road features, 3 landmarks, 4 far scatter tier, 5 mid tier, 6 near tier. A chunk is done when step >= want. */
  _wantStep(ch) {
    const dist = Math.abs(ch.s0 + CHUNK_LEN / 2 - this.s);
    return dist < 340 ? 7 : dist < 1000 ? 6 : 5;
  }
  _runStep(ch) {
    const ctx = this.ctx;
    switch (ch.step) {
      case 0: {
        const road = this.road;
        if (!ch.ground) {
          road.extendTo(ch.s0 + CHUNK_LEN + 600);
          const bridges = road.features.filter((f) => f.type === 'bridge' && f.s1 > ch.s0 - 300 && f.s0 < ch.s0 + CHUNK_LEN + 300);
          ch.ground = new ChunkGround(road, this.seed, ch.c, bridges);
          ch.ground.fromTerrainMesh(ch.rec);
        }
        if (!ch.ground.build(22)) break;              // ~1.5 ms slices
        const bio = biomeAt(ch.s0 + CHUNK_LEN / 2);
        ch.seaY = bio.a === 'coast' || bio.b === 'coast' ? seaLevel(road, 'coast') : bio.a === 'dam' || bio.b === 'dam' ? seaLevel(road, 'dam') : -1e9;
        if (ch.seaY > -1e8) this.water.buildChunk(ch, bio.a === 'dam' || bio.b === 'dam' ? 'dam' : 'coast');
        ch.step = 1; break;
      }
      case 1: if (buildFurniture(ctx, ch)) ch.step = 2; break;
      case 2: if (buildFeatures(ctx, ch, this._deadline)) ch.step = 3; break;
      case 3: if (buildLandmarks(ctx, ch)) ch.step = 4; break;
      case 4: if (runScatter(ctx, ch, 1, this._deadline)) ch.step = 5; break;
      case 5: if (runScatter(ctx, ch, 2, this._deadline)) ch.step = 6; break;
      case 6: if (runScatter(ctx, ch, 3, this._deadline)) ch.step = 7; break;
      default: break;
    }
  }
  _pending() {
    let n = 0;
    for (const ch of this.chunks.values()) if (ch.rec && ch.step < this._wantStep(ch)) n++;
    return n;
  }
  _jobs(budgetMs) {
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      let best = null, bd = 1e18;
      const now = performance.now();
      for (const ch of this.chunks.values()) {
        if (!ch.rec || ch.step >= this._wantStep(ch) || (ch._blockedUntil || 0) > now) continue;
        const d = Math.abs(ch.s0 + CHUNK_LEN / 2 - this.s);
        if (d < bd) { bd = d; best = ch; }
      }
      if (!best) break;
      const before = best.step, ts = performance.now();
      best._more = false; this._deadline = t0 + budgetMs;
      this._runStep(best);
      const tsd = performance.now() - ts; if (tsd > this.stats.stepMax[before]) this.stats.stepMax[before] = tsd;
      if (best.step === before && !best._more && !(before === 0 && best.ground && !best.ground.done)) best._blockedUntil = performance.now() + 40; // waiting for assets to load
      else this.stats.chunksBuilt++;
    }
    this.stats.jobMs = performance.now() - t0;
  }

  /** True when no chunk has pending work and the pool reflects the current chunk lists. */
  get idle() {
    if (!this._loaded || this._needRebuild || !this._poolOk) return false;
    return this.chunks.size > 0 && this._pending() === 0;
  }

  // ------------------------------------------------------------------------------------------------ per frame
  update(dt, cameraPos, s, camera) {
    if (!this._loaded) return;
    this.cam.copy(cameraPos); this.s = s;
    WIND.uTime.value += dt; this._clock += dt;
    this.water.update(dt, this.cam, s); this.backdrop.update(dt, this.cam, s, this.road); updateBoostAnim(dt);
    if ((this._pf = (this._pf || 0) + dt) > 1) { this._pf = 0; this.prefetch(s + 3000); }
    // night lighting (lamp lenses, light pools, beams)
    const nk = smoothstep(0.12, 0.6, lookAt(s).night);
    for (const g of this.pool.glow) g.m[g.prop] = g.m.name === 'light_amber' ? Math.max(g.base, g.base * (0.6 + 1.2 * nk)) : g.base * nk;
    if (this.kit.nightMats) for (const g of this.kit.nightMats) g.m[g.prop] = g.base * nk;
    this._jobs(QUALITY[this.quality].budget * (this.chunks.size > 6 && this._warm ? 1 : 3));
    this._warm = true;
    for (const ch of this.chunks.values()) if (ch.dirty) { ch.dirty = false; this._needRebuild = true; }
    // fwd for behind-culling
    let fx = 0, fz = 1, useFwd = false;
    if (camera) { const d = camera.getWorldDirection(_v); const l = Math.hypot(d.x, d.z); if (l > 0.05) { fx = d.x / l; fz = d.z / l; useFwd = true; } }
    this.useFwd = useFwd;
    const L = this._lastRebuild;
    const moved = Math.hypot(this.cam.x - L.x, this.cam.z - L.z) + Math.abs(this.cam.y - L.y) * 0.5;
    const turned = useFwd ? fx * L.fx + fz * L.fz < 0.966 : false;
    if ((this._needRebuild && this._clock - L.t > 0.2) || moved > 10 || turned || this._clock - L.t > 0.5) {
      const t0 = performance.now();
      this._poolOk = this.pool.rebuild(this.chunks.values(), this.cam, useFwd ? { x: fx, z: fz } : NO_FWD, this._shadowInfo(s));
      this.stats.rebuilds++; this.stats.rebuildMs = performance.now() - t0; if (this.stats.rebuildMs > this.stats.rebuildMax) this.stats.rebuildMax = this.stats.rebuildMs;
      L.x = this.cam.x; L.y = this.cam.y; L.z = this.cam.z; L.fx = fx; L.fz = fz; L.t = this._clock;
      this._needRebuild = !this._poolOk;
    }
  }

  /** Where the sun shadow map is centred (default: the camera). Call each frame with the truck position if the shadow rig follows the truck. */
  setShadowFocus(v) { this._shadowFocus = v; }
  _shadowInfo(s) {
    const q = QUALITY[this.quality], look = lookAt(s);
    const on = q.shadow > 0 && look.sun > -2;
    const f = this._shadowFocus || this.cam, D2R = Math.PI / 180, el = look.sun * D2R, az = look.az * D2R;
    const o = this._sh || (this._sh = {});
    o.on = on; o.fx = f.x; o.fy = f.y; o.fz = f.z;
    o.lx = Math.sin(az) * Math.cos(el); o.ly = Math.sin(el); o.lz = Math.cos(az) * Math.cos(el);
    o.rad = (this.opts.shadowExtent ?? 55) * 1.42 * (q.shadow / 120 > 0.8 ? 1 : 0.8); o.depth = 200;
    return o;
  }

  dispose() {
    for (const [c] of [...this.chunks]) this.onChunkDrop(c);
    this.pool.dispose(); this.kit.dispose(); this.water.dispose(); this.backdrop.dispose();
    this.scene.remove(this.extraGroup);
  }
}

const _v = new THREE.Vector3();
const NO_FWD = { x: 0, z: 0 };
