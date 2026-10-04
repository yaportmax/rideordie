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
import { contextualRoad, roadBiomeAt } from './biome_context.js';
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
import { buildCity } from './dressing/city.js';
import { CITY_U, registerSetAssets } from './dressing/city_mat.js';
import { SetPieces } from './dressing/setpieces.js';
import { buildDamRoad } from './dressing/damroad.js';
import { buildGalleries } from './dressing/gallery.js';
import { buildRocks } from './dressing/rocks.js';
import { buildMoments, wreckNear } from './dressing/moments.js';
import { createSetMaterials, warmSetMaterials } from './dressing/warm.js';
import { registerDrivingSigns } from './dressing/driving.js';
import { STAGE_DRIVING } from './driving_plan.js';
import { registerCampaignThemeAssets, buildCampaignThemes } from './dressing/campaign_themes.js';

const QUALITY = [
  { far: 0.6, shadow: 0, budget: 2.0 },
  { far: 0.8, shadow: 70, budget: 2.5 },
  { far: 1.0, shadow: 120, budget: 3.0 },
  { far: 1.2, shadow: 170, budget: 3.5 },
];

// Long features still belong to the chunk containing their end. Their entry
// can be several chunks away, so work priority must use the whole span.
const spanDistance = (s, f) => Math.max(f.s0 - s, 0, s - f.s1);
const tunnelId = f => `tunnel:${Math.round(f.s0 * 10)}`;
const featureTag = f => `feat:${f.type}:${Math.round(f.s0 * 10)}`;
export const START_TUNNEL_BEHIND = 40, START_TUNNEL_AHEAD = 160;
function tunnelAssets(road, f) {
  const b = roadBiomeAt(road, (f.s0 + f.s1) / 2), id = b.w > 0.5 ? b.b : b.a;
  return !f.rock ? ['tunnel_portal_concrete', 'tunnel_exit_concrete', 'tunnel_mid_10m']
    : id === 'canyon' || id === 'desert' ? ['tunnel_portal_rock', 'tunnel_exit', 'tunnel_mid_10m']
      : ['tunnel_portal_rock_grey', 'tunnel_exit_grey', 'tunnel_mid_10m'];
}
const validCollision = mesh => !!(mesh?.pos?.length >= 9 && mesh?.idx?.length >= 3);

class ChunkDress {
  constructor(dress, c) {
    this.dress = dress; this.c = c; this.s0 = c * CHUNK_LEN;
    this.lists = new Map(); this.extras = []; this.hooks = []; this.tunnels = new Map();
    this.step = 0; this.done = new Set(); this.ground = null; this.seaY = -1e9; this.dirty = false; this.rec = null;
  }
  list(name) { let l = this.lists.get(name); if (!l) { l = new InstList(); this.lists.set(name, l); } return l; }
  addExtra(obj) {
    this.extras.push(obj); this.dress.extraGroup.add(obj);
    const w = this.dress.pool.warmer;
    if (w && obj.visible) { obj.visible = false; const meshes = []; obj.traverse((o) => { if (o.isMesh) meshes.push(o); }); w(meshes.length ? meshes : [obj]).then(() => { if (this.dress._disposed || this.dress.chunks.get(this.c) !== this) return; obj.userData.ready = true; obj.visible = !obj.userData.far; }); }
    else obj.userData.ready = true;
  }
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
    this.sets = new SetPieces(this);
    this.cam = new THREE.Vector3(); this.s = 0; this.fwd = { x: 0, z: 1 }; this.useFwd = false;
    this._lastRebuild = { x: 1e9, y: 0, z: 0, fx: 0, fz: 0, t: 0 };
    this._clock = 0; this._needRebuild = true; this._poolOk = true; this._loaded = false;
    this.ctx = {
      road, seed: this.seed, kit: this.kit, pool: this.pool, quality: this.quality, dress: this,
      hook: req => this._structureHook(req),
      exclusions: (a, b) => landmarkExclusions(this.ctx, a, b),
      tunnelsNear: (a, b) => road.featuresIn(a, b, 'tunnel'),
      wreckNear: (s, d) => wreckNear(this.ctx, s, d),
    };
    this.stats = { chunksBuilt: 0, jobMs: 0, rebuilds: 0, rebuildMs: 0, rebuildMax: 0, stepMax: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  }

  _structureHook(req) {
    const result = this.hook ? this.hook(req) : undefined;
    if (req.type === 'tunnel') {
      const ch = this.chunks.get(Math.floor(req.s1 / CHUNK_LEN));
      // buildTunnel emits the hook immediately after adding its hill cap.
      if (ch) ch.tunnels.set(req.id, { feature: req, assets: tunnelAssets(this.road, req), cap: ch.extras.at(-1), renderReady: false });
    }
    return result;
  }

  _tunnelRenderReady(tunnel) {
    if (!tunnel.cap?.userData.ready) return false;
    for (const name of tunnel.assets) {
      const spec = this.pool.specOf(name);
      if (!spec) return false;
      const lods = spec.lods || [{ asset: name }];
      for (const lod of lods) {
        const entry = this.pool.entries.get(lod.asset);
        if (!entry?.sets?.length || entry.sets.some(set => !set.meshes?.length || set.warm === false)) return false;
      }
    }
    return true;
  }

  /** Only a tunnel in the first driving corridor can hold startup. Scatter,
   * landmarks and the rest of the streaming window do not belong to this gate. */
  tunnelReadiness(s, hasCollider) {
    const tunnels = this.road.featuresIn(s - START_TUNNEL_BEHIND, s + START_TUNNEL_AHEAD, 'tunnel');
    const ids = []; let pending = null;
    for (const f of tunnels) {
      const id = tunnelId(f); ids.push(id);
      const assets = tunnelAssets(this.road, f);
      for (const name of assets) {
        const state = this.kit.state(name);
        if (state === 'missing') return { state: 'failed', reason: 'missing-tunnel-asset', asset: name, id, ids };
        if (state === 'ready' && (!this.kit.get(name)?.parts?.length || !validCollision(this.kit.get(name)?.collision))) return { state: 'failed', reason: 'invalid-tunnel-asset', asset: name, id, ids };
        if (state === 'idle') this.kit.request(name);
      }
      const ch = this.chunks.get(Math.floor(f.s1 / CHUNK_LEN));
      if (!this._loaded || !ch?.rec || !ch.done.has(featureTag(f))) { pending ||= { state: 'pending', reason: 'tunnel-build', id, ids }; continue; }
      const tunnel = ch.tunnels.get(id);
      // Missing assets are deliberately skipped by the general dressing
      // builder. A completed step alone is therefore not physical readiness.
      if (!tunnel || !ch.hooks.includes(id) || !validCollision(tunnel.feature.collision)) return { state: 'failed', reason: 'tunnel-not-built', id, ids };
      if (typeof hasCollider !== 'function' || !hasCollider(id)) return { state: 'failed', reason: 'tunnel-collider', id, ids };
      if (!tunnel.renderReady || !this._tunnelRenderReady(tunnel)) pending ||= { state: 'pending', reason: 'tunnel-warm', id, ids };
    }
    return pending || { state: 'ready', ids };
  }

  /** Asset names a biome can use (scatter + furniture + road features + landmarks). */
  assetsFor(id) {
    const out = new Set([...Object.keys(FURNITURE_SPECS), ...Object.keys(FEATURE_SPECS), 'sign_gas', ...landmarkAssets(id)]);
    const driving = STAGE_DRIVING[id];
    if (driving?.asset) out.add(driving.asset);
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
    const b = roadBiomeAt(this.road, s), ids = new Set([b.a, b.b]);
    const all = []; for (const id of ids) if (!this._fetched.has(id)) { this._fetched.add(id); all.push(...this.assetsFor(id)); }
    return this.kit.requestMany(all);
  }

  async load(startS = 0) {
    this.road.ensureDrivingBranches(); // bounded pure plan belongs to loading, never a scatter retry
    await this.kit.init();
    registerProcedural(this.kit);
    registerDrivingSigns(this.kit);
    createSetMaterials();                         // paint the neon / banner canvases now (loading screen), not mid-drive
    registerSetAssets(this.kit);
    registerCampaignThemeAssets(this.kit, this.pool);
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
    this._structurePriorityCache?.owners.delete(c);
    this._needRebuild = true;
  }

  // ------------------------------------------------------------------------------------------------ jobs
  /** stages: 0 ground grid, 1 furniture, 2 road features, 3 landmarks, 4 procedural sets (city), 5 far scatter tier, 6 mid tier, 7 near tier. A chunk is done when step >= want. */
  _wantStep(ch) {
    const dist = Math.abs(ch.s0 + CHUNK_LEN / 2 - this.s);
    return dist < 340 ? 8 : dist < 1000 ? 7 : 6;
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
        const bio = roadBiomeAt(road, ch.s0 + CHUNK_LEN / 2);
        ch.seaY = bio.a === 'coast' || bio.b === 'coast' ? seaLevel(road, 'coast') : bio.a === 'dam' || bio.b === 'dam' ? seaLevel(road, 'dam') : -1e9;
        if (ch.seaY > -1e8) this.water.buildChunk(ch, bio.a === 'dam' || bio.b === 'dam' ? 'dam' : 'coast');
        ch.step = 1; break;
      }
      case 1: if (buildFurniture(ctx, ch)) ch.step = 2; break;
      case 2: if (buildFeatures(ctx, ch, this._deadline)) ch.step = 3; break;
      case 3: if (buildLandmarks(ctx, ch)) ch.step = 4; break;
      case 4: if (buildCity(ctx, ch) && buildDamRoad(ctx, ch) && buildGalleries(ctx, ch) && buildRocks(ctx, ch) && buildMoments(ctx, ch) && (!contextualRoad(ctx.road) || buildCampaignThemes(ctx, ch))) ch.step = 5; break;
      case 5: if (runScatter(ctx, ch, 1, this._deadline)) ch.step = 6; break;
      case 6: if (runScatter(ctx, ch, 2, this._deadline)) ch.step = 7; break;
      case 7: if (runScatter(ctx, ch, 3, this._deadline)) ch.step = 8; break;
      default: break;
    }
  }
  _pending() {
    let n = 0;
    for (const ch of this.chunks.values()) if (ch.rec && ch.step < this._wantStep(ch)) n++;
    return n;
  }
  // Road appends immutable feature records. Retain only unfinished, live chunk
  // owners: idle frames do not revisit the complete history. A new owner (also
  // after reversing) needs one historical reindex because records are not
  // globally sorted. Appends scan only the new suffix; replacement or shrink
  // resets the cache. No index of every historical owner is retained.
  _structurePriorityOwners() {
    const features = this.road.features, count = features.length;
    let cache = this._structurePriorityCache;
    if (!cache || cache.source !== features || count < cache.count) {
      cache = this._structurePriorityCache = { source: features, count: 0, owners: new Map() };
    }
    for (const owner of cache.owners.keys()) {
      const ch = this.chunks.get(owner);
      if (!ch?.rec || ch.step >= 3) cache.owners.delete(owner);
    }
    let reindex = false;
    for (const ch of this.chunks.values()) {
      if (ch.rec && ch.step < 3 && !cache.owners.has(ch.c)) {
        cache.owners.set(ch.c, []); reindex = true;
      }
    }
    if (cache.owners.size) {
      const first = reindex ? 0 : cache.count;
      if (reindex) for (const list of cache.owners.values()) list.length = 0;
      for (let i = first; i < count; i++) {
        const f = features[i];
        if (f.type !== 'tunnel' && f.type !== 'bridge') continue;
        const list = cache.owners.get(Math.floor(f.s1 / CHUNK_LEN));
        if (list) list.push(f);
      }
    }
    cache.count = count;
    return cache.owners;
  }
  _jobs(budgetMs) {
    const t0 = performance.now();
    const spans = new Map();
    for (const [owner, features] of this._structurePriorityOwners()) {
      for (const f of features) {
        const d = spanDistance(this.s, f);
        if (d <= 1000) spans.set(owner, Math.min(spans.get(owner) ?? Infinity, d));
      }
    }
    while (performance.now() - t0 < budgetMs) {
      let best = null, bd = 1e18;
      const now = performance.now();
      for (const ch of this.chunks.values()) {
        if (!ch.rec || ch.step >= this._wantStep(ch) || (ch._blockedUntil || 0) > now) continue;
        const centre = Math.abs(ch.s0 + CHUNK_LEN / 2 - this.s);
        // Stop prioritizing the owner when its structural step is complete;
        // its later distant scatter keeps its normal chunk-centre priority.
        const d = ch.step < 3 ? Math.min(centre, spans.get(ch.c) ?? Infinity) : centre;
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
    if (this._disposed || !this._loaded) return;
    this.cam.copy(cameraPos); this.s = s;
    WIND.uTime.value += dt; this._clock += dt;
    this.water.update(dt, this.cam, s); this.backdrop.update(dt, this.cam, s, this.road); updateBoostAnim(dt);
    if ((this._pf = (this._pf || 0) + dt) > 1) { this._pf = 0; this.prefetch(s + 3000); }
    // night lighting (lamp lenses, light pools, beams)
    const nk = smoothstep(0.12, 0.6, lookAt(s, undefined, this.road).night);
    for (const g of this.pool.glow) g.m[g.prop] = g.m.name === 'light_amber' ? Math.max(g.base, g.base * (0.6 + 1.2 * nk)) : g.base * nk;
    if (this.kit.nightMats) for (const g of this.kit.nightMats) g.m[g.prop] = g.base * nk;
    CITY_U.uNight.value = smoothstep(0.05, 0.7, lookAt(s, undefined, this.road).night); CITY_U.uTime.value = this._clock % 3600;
    this._jobs(QUALITY[this.quality].budget * (this.chunks.size > 6 && this._warm ? 1 : 3));
    this._warm = true;
    this.sets.update(s, 1.5);
    if (!this._setsWarm && this.pool.warmer) { this._setsWarm = true; warmSetMaterials(this.pool.warmer); }
    for (const ch of this.chunks.values()) if (ch.dirty) { ch.dirty = false; this._needRebuild = true; }
    // distance culling of chunk extras that declare userData.far (set pieces are one mesh per chunk: pylons, galleries...)
    if ((this._xf = (this._xf || 0) + 1) % 8 === 0) for (const o of this.extraGroup.children) {
      const far = o.userData.far; if (!far || !o.userData.ready) continue;
      const sp = o.geometry && o.geometry.boundingSphere; if (!sp) continue;
      const dx = o.position.x + sp.center.x - this.cam.x, dz = o.position.z + sp.center.z - this.cam.z, r = far + sp.radius;
      o.visible = dx * dx + dz * dz < r * r;
    }
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
      for (const ch of this.chunks.values()) for (const tunnel of ch.tunnels.values()) tunnel.renderReady = this._tunnelRenderReady(tunnel);
      this.stats.rebuilds++; this.stats.rebuildMs = performance.now() - t0; if (this.stats.rebuildMs > this.stats.rebuildMax) this.stats.rebuildMax = this.stats.rebuildMs;
      L.x = this.cam.x; L.y = this.cam.y; L.z = this.cam.z; L.fx = fx; L.fz = fz; L.t = this._clock;
      this._needRebuild = !this._poolOk;
    }
  }

  /** Where the sun shadow map is centred (default: the camera). Call each frame with the truck position if the shadow rig follows the truck. */
  setShadowFocus(v) { this._shadowFocus = v; }
  _shadowInfo(s) {
    const q = QUALITY[this.quality], look = lookAt(s, undefined, this.road);
    const on = q.shadow > 0 && look.sun > -2;
    const f = this._shadowFocus || this.cam, D2R = Math.PI / 180, el = look.sun * D2R, az = look.az * D2R;
    const o = this._sh || (this._sh = {});
    o.on = on; o.fx = f.x; o.fy = f.y; o.fz = f.z;
    o.lx = Math.sin(az) * Math.cos(el); o.ly = Math.sin(el); o.lz = Math.cos(az) * Math.cos(el);
    o.rad = (this.opts.shadowExtent ?? 55) * 1.42 * (q.shadow / 120 > 0.8 ? 1 : 0.8); o.depth = 200;
    return o;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true; this._loaded = false;
    for (const [c] of [...this.chunks]) this.onChunkDrop(c);
    this.pool.dispose(); this.kit.dispose(); this.water.dispose(); this.backdrop.dispose(); this.sets.dispose();
    this.scene.remove(this.extraGroup);
  }
}

const _v = new THREE.Vector3();
const NO_FWD = { x: 0, z: 0 };
