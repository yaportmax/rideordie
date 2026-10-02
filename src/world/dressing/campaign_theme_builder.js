// Loading/chunk-build helpers only. No per-frame update, DOM, textures, lights
// or unbounded route cache. Static collision triangles are copied from the
// exact rendered primitives, so a wall cannot silently lose its collider.
import * as THREE from 'three';
import { CHUNK_LEN } from './util.js';
import { MB, frameYaw } from './mbuild.js';

export const CAMPAIGN_CHUNK_BUDGET = Object.freeze({ vertices: 24000, collisionTriangles: 4096, instances: 96, mergedDraws: 2 });
const BODY_KEY = 'campaign-theme-body';
const GLOW_KEY = 'campaign-theme-glow';
const BLOCKING = new Set(['bridge', 'tunnel', 'overpass', 'ramp', 'roadblock', 'stage_challenge']);

function asset(name, geometry, material) {
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const box = geometry.boundingBox.clone(), size = box.getSize(new THREE.Vector3());
  const tris = (geometry.index?.count ?? geometry.attributes.position.count) / 3;
  return { name, kind: 'prop', url: 'procedural', parts: [{ name, geometry, material, role: 'main', tris }], sockets: {}, collision: null, box, size,
    sphere: geometry.boundingSphere.clone(), radius: Math.hypot(size.x, size.z) / 2, height: box.max.y, tris, hasRoad: false, procedural: true };
}

/** Call during Dressing.load, before pool warming; AssetKit owns all resources. */
export function registerCampaignThemeAssets(kit, pool) {
  if (!kit.assets.has(BODY_KEY)) {
    const body = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .76, metalness: .2, side: THREE.DoubleSide });
    body.name = BODY_KEY;
    const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, toneMapped: false });
    glow.name = GLOW_KEY;
    // Resource sentinel geometries are never placed in the pool. They ensure
    // shared chunk materials use the existing AssetKit disposal contract.
    kit.assets.set(BODY_KEY, asset(BODY_KEY, new THREE.BoxGeometry(.01, .01, .01), body));
    kit.assets.set(GLOW_KEY, asset(GLOW_KEY, new THREE.BoxGeometry(.01, .01, .01), glow));
    const beacon = new THREE.OctahedronGeometry(1, 0);
    kit.assets.set('campaign-prism', asset('campaign-prism', beacon, body));
    const pin = new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0);
    kit.assets.set('campaign-beacon', asset('campaign-beacon', pin, glow));
    // Each late-stage obstacle has a different silhouette and an exact visible
    // collision mesh. Stage placement stretches it only into the closed lane.
    for (const [name, build, color] of [
      ['campaign_bulkhead', mb => {
        const F = frameYaw(0, 0, 0, 0);
        mb.box(F, -.5, .5, 0, .22, -.5, .5, { bottom: true });
        mb.box(F, -.5, -.3, .22, 1, -.34, .34, { bottom: true });
        mb.box(F, .3, .5, .22, 1, -.34, .34, { bottom: true });
        mb.box(F, -.3, .3, .4, .83, -.2, .2, { bottom: true });
        mb.beam(F, -.4, .3, -.32, .4, .94, -.32, .1, .1);
      }, [.34, .42, .47]],
      ['campaign_prism_barrier', mb => {
        const F = frameYaw(0, 0, 0, 0);
        mb.cyl(F, -.3, 0, 0, .78, .23, .04, 5);
        mb.cyl(F, 0, -.05, 0, 1, .26, .01, 5);
        mb.cyl(F, .3, .05, 0, .87, .24, .025, 5);
      }, [.31, .6, .8]],
      ['campaign_basalt', mb => {
        const F = frameYaw(0, 0, 0, 0);
        for (const [x, z, h] of [[-.28, -.12, .78], [.05, .16, 1], [.3, -.17, .7]]) mb.cyl(F, x, z, 0, h, .27, .21, 6);
      }, [.18, .14, .14]],
      ['campaign_docking_clamp', mb => {
        const F = frameYaw(0, 0, 0, 0);
        mb.box(F, -.5, .5, 0, .25, -.5, .5, { bottom: true });
        mb.box(F, -.5, -.26, .25, 1, -.38, .38, { bottom: true });
        mb.box(F, .26, .5, .25, .85, -.38, .38, { bottom: true });
        mb.box(F, -.26, .26, .47, .67, -.2, .2, { bottom: true });
        mb.beam(F, -.38, .82, 0, .12, .93, 0, .16, .16);
      }, [.49, .55, .65]],
    ]) {
      const mb = new MB({ x: 0, y: 0, z: 0 }, { fac: false, cap: 256 });
      mb.col(...color); build(mb);
      const entry = asset(name, mb.build(), body);
      entry.collision = { pos: Float32Array.from(entry.parts[0].geometry.attributes.position.array), idx: Uint32Array.from(entry.parts[0].geometry.index.array) };
      kit.assets.set(name, entry);
      pool?.register(name, { far: 650, shadow: true, behind: true, merge: false });
    }
  }
  pool?.register('campaign-prism', { far: 1100, shadow: true, fade: false, merge: false });
  pool?.register('campaign-beacon', { far: 1200, shadow: false, fade: false, merge: false });
}

/** Campaign Road is authoritative, including marathon/finite-level context. */
export function campaignBiomeAt(road, s) {
  if (typeof road.biomeAt !== 'function') throw new Error('Campaign dressing requires Road.biomeAt(s)');
  const bio = road.biomeAt(s);
  if (typeof bio === 'string') return bio;
  if (bio?.id) return bio.id;
  if (bio?.a && bio?.b) return bio.w > .5 ? bio.b : bio.a;
  throw new Error('Campaign Road.biomeAt(s) returned no biome identity');
}

export class CampaignThemeBuilder {
  constructor(ctx, chunk, theme, id) {
    this.ctx = ctx; this.road = ctx.road; this.chunk = chunk; this.theme = theme; this.def = theme; this.id = id;
    this.palette = theme.dressing.palette;
    this.s0 = chunk.s0; this.s1 = chunk.s0 + CHUNK_LEN;
    this.anchor = this.road.sample(this.s0, {});
    this.body = new MB(this.anchor, { fac: false, cap: 2048 });
    this.glow = new MB(this.anchor, { fac: false, cap: 512 });
    this.collision = { pos: [], idx: [] };
    this.instances = 0;
    this.stats = { theme: id, vertices: 0, collisionTriangles: 0, instances: 0, draws: 0, skipped: 0 };
  }
  themeAt(s) { return campaignBiomeAt(this.road, s); }
  at(s, d, dy = 0) { const p = this.road.pointAt(s, d, {}); p.y += dy; return p; }
  frame(s, d = 0, dy = 0) { const p = this.at(s, d, dy), sm = this.road.sample(s, {}); return frameYaw(p.x, p.y, p.z, sm.th, {}); }
  ground(s, d) {
    if (!this.chunk.ground?.done) throw new Error('Campaign dressing requires complete ChunkGround');
    return this.chunk.ground.sample(s, d, {});
  }
  /** Whole footprint, not just its origin; check nearby folded main road too. */
  reserve(s, d, radius = 0) {
    const p = this.at(s, d), near = this.road.nearest(p.x, p.z, s, Math.max(160, radius * 2 + 80), {});
    const clear = Math.abs(near.d) >= 10.25 + radius && !this.road.corridorBlocked(p.x, p.z, radius + .5, s);
    if (!clear) this.stats.skipped++;
    return clear;
  }
  spanFree(a, b) {
    if (this.themeAt(a) !== this.id || this.themeAt(Math.max(a, b - .001)) !== this.id) return false;
    if (this.road.featuresIn(a - 24, b + 24).some(f => BLOCKING.has(f.type))) return false;
    // A vault/arch cannot be clipped through a carved branch. Keep the whole
    // visible volume and collider absent, rather than leaving invisible walls.
    return !this.road.ensureDrivingBranches().some(branch => b > branch.s0 - 60 && a < branch.s1 + 60);
  }
  _emit(opts, fn) {
    const mb = opts.glow ? this.glow : this.body, nv = mb.count, ni = mb.I.n;
    fn(mb);
    if (opts.solid) {
      const pos = this.collision.pos, idx = this.collision.idx, base = pos.length / 3;
      for (let i = nv * 3; i < mb.P.n; i += 3) pos.push(mb.P.a[i] + this.anchor.x, mb.P.a[i + 1] + this.anchor.y, mb.P.a[i + 2] + this.anchor.z);
      for (let i = ni; i < mb.I.n; i++) idx.push(base + mb.I.a[i] - nv);
    }
  }
  box(s, d, dy, w, h, len, col, opts = {}) {
    if (this.themeAt(s) !== this.id) return false;
    const radius = Math.hypot(w, len) / 2;
    if (opts.overhead) {
      if (dy - h / 2 < 24 || !this.spanFree(s - len / 2, s + len / 2)) return false;
    } else if (!this.reserve(s, d, radius)) return false;
    const frame = this.frame(s, d, dy);
    this._emit(opts, mb => mb.col(...col).box(frame, -w / 2, w / 2, -h / 2, h / 2, -len / 2, len / 2, { bottom: true }));
    return true;
  }
  column(s, d, dy, h, r0, r1, col, opts = {}) {
    if (this.themeAt(s) !== this.id || !this.reserve(s, d, Math.max(r0, r1))) return false;
    const frame = this.frame(s, d);
    this._emit(opts, mb => mb.col(...col).cyl(frame, 0, 0, dy, dy + h, r0, r1, opts.sides ?? 8, true));
    return true;
  }
  tube(a, b, r, col, opts = {}) {
    // Endpoints are supplied by an already reserved builder span. Copy MB's
    // actual six-sided tube, so the art/physics pair has no separate radius.
    this._emit(opts, mb => mb.col(...col).tubeW(a, b, r, opts.sides ?? 6, true));
    return true;
  }
  quad(points, col, hint = { x: 0, y: 1, z: 0 }, opts = {}) {
    this._emit(opts, mb => mb.col(...col).quadOut(points[0], points[1], points[2], points[3], hint.x, hint.y, hint.z));
  }
  prism(s, d, dy, sx, sy, sz, col) {
    if (this.themeAt(s) !== this.id || !this.reserve(s, d, Math.hypot(sx, sz))) return false;
    if (++this.instances > CAMPAIGN_CHUNK_BUDGET.instances) throw new Error('Campaign theme instance budget exceeded');
    const p = this.at(s, d, dy), sm = this.road.sample(s, {});
    this.chunk.list('campaign-prism').push(p.x, p.y, p.z, sm.th, sx, sy, sz, 0, 1, 0, 0, Math.hypot(sx, sy, sz), ...col);
    return true;
  }
  finish() {
    const total = this.body.count + this.glow.count;
    if (total > CAMPAIGN_CHUNK_BUDGET.vertices || this.collision.idx.length / 3 > CAMPAIGN_CHUNK_BUDGET.collisionTriangles) throw new Error(`Campaign ${this.id} chunk exceeds geometry/collision budget`);
    this.stats.vertices = total; this.stats.collisionTriangles = this.collision.idx.length / 3; this.stats.instances = this.instances;
    for (const [mb, key, shadow] of [[this.body, BODY_KEY, true], [this.glow, GLOW_KEY, false]]) {
      if (!mb.count) continue;
      const material = this.ctx.kit.get(key)?.parts[0]?.material;
      if (!material) throw new Error('Register campaign theme assets during loading');
      const mesh = new THREE.Mesh(mb.build(), material);
      mesh.position.set(this.anchor.x, this.anchor.y, this.anchor.z); mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      mesh.name = `campaign-${this.id}-${shadow ? 'body' : 'glow'}`;
      mesh.castShadow = shadow; mesh.receiveShadow = shadow;
      mesh.userData.ownGeo = true; mesh.userData.far = this.theme.dressing.far;
      this.chunk.addExtra(mesh); this.stats.draws++;
    }
    if (this.collision.idx.length) {
      const id = `campaign-theme:${this.id}:${this.chunk.c}`;
      this.chunk.hooks.push(id);
      this.ctx.hook({ type: 'static', id, asset: `campaign-${this.id}`, collision: { pos: new Float32Array(this.collision.pos), idx: new Uint32Array(this.collision.idx) } });
    }
    this.chunk.dirty = true;
    (this.chunk.campaignThemeStats || (this.chunk.campaignThemeStats = [])).push(this.stats);
    return this.stats;
  }
}
