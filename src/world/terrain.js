// Chunk streamer: schedules terrain/road chunk generation in workers, builds meshes + Rapier trimesh colliders,
// swaps LODs, disposes what is behind / too far. Chunk = CHUNK_LEN metres along the road.
import * as THREE from 'three';
import { CHUNK_LEN } from './terrain_gen.js';
import { Road } from './road.js';
import { setRoadNight, makeWorldFloor, FLOOR_R } from './terrain_material.js';
import { lookAt } from './look.js';
import { CoverField } from './dressing/groundcover.js';
import { RAPIER, GROUPS } from '../sim/physics.js';
import { appendDiagnostic } from '../core/diagnostics.js';

/** Private look output (lookAt's default output object is shared by the render loop: never overwrite it from here). */
const _look = (() => { const src = lookAt(0), o = {}; for (const [k, v] of Object.entries(src)) o[k] = v && v.isColor ? v.clone() : k === 'grade' ? { con: 0, sat: 1, shT: [0, 0, 0], hiT: [1, 1, 1] } : v; return o; })();
const _fs = {}, _fs2 = {};
const LOD_DIST = [320, 850, 5000];      // chunk-centre distance thresholds (m) for LOD0/1/2
const AHEAD = 2100, BEHIND = 420;      // streaming window along s (behind: the gunner looks back at pursuers)
const COLLIDE_AHEAD = 400, COLLIDE_BEHIND = 330;

export class TerrainStreamer {
  /**
   * @param {{scene:THREE.Scene, world:any|null, seed:number, terrainMat:THREE.Material, roadMat:THREE.Material, workers?:number}} o
   */
  constructor(o) {
    this.scene = o.scene; this.world = o.world; this.seed = o.seed;
    this.road = new Road(this.seed, o.journey); this.journey = this.road.journey;
    this.terrainMat = o.terrainMat; this.roadMat = o.roadMat;
    this.chunks = new Map();      // chunk index -> record
    this.group = new THREE.Group(); this.group.name = 'terrain'; this.scene.add(this.group);
    this.pending = new Set();     // keys in flight  `${chunk}:${lod}`
    this.workers = [];
    this.ready = 0;
    const n = o.workers ?? 3;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./terrain_worker.js', import.meta.url), { type: 'module' });
      w.busy = 0;
      w.onmessage = (e) => this._onMsg(w, e.data);
      w.postMessage({ type: 'init', seed: this.seed, journey: this.journey });
      this.workers.push(w);
    }
    this.stats = { built: 0, tris: 0 };
    this.cover = new CoverField(this.group);
    // world floor: a dark disc well below the terrain around the player. Invisible in normal play (always under the ground); a camera that
    // ends up inside a hill or canyon wall (death orbit) sees dark rock all round instead of the void under the heightfield.
    this.floor = makeWorldFloor(); this.group.add(this.floor);
    this.onChunk = null; // callback(chunkIndex, record)
    this._sLast = 0;
    this._want = []; this._wantPool = [];
    this._scheduleS = NaN; this._scheduleLo = Infinity; this._scheduleHi = -Infinity;
    this._scheduleDirty = true;
  }

  lodFor(dist) { return dist < LOD_DIST[0] ? 0 : dist < LOD_DIST[1] ? 1 : 2; }

  /** Ask for the chunks around road distance s. Cheap to call every frame. */
  update(s) {
    if (this.disposed) return;
    this._sLast = s;
    setRoadNight(this.roadMat, lookAt(s, _look, this.road).night);
    const c0 = Math.floor((s - BEHIND) / CHUNK_LEN), c1 = Math.floor((s + AHEAD) / CHUNK_LEN);
    const want = this._want;
    const changed = s !== this._scheduleS && !(s > this._scheduleLo && s < this._scheduleHi);
    if (changed) {
      want.length = 0;
      // Chunk-window, LOD and nearest-first order can change only at these boundaries.
      // Strict intervals deliberately re-evaluate an exact boundary once; a stationary
      // player there still uses the exact-position cache below.
      const half = CHUNK_LEN / 2;
      let lo = Math.floor(s / half) * half, hi = lo + half;
      if (s === lo) hi = s; // At a priority tie, either direction must re-sort once.
      const bound = (b) => { if (b <= s) lo = Math.max(lo, b); if (b >= s) hi = Math.min(hi, b); };
      bound(c0 * CHUNK_LEN + BEHIND); bound((c0 + 1) * CHUNK_LEN + BEHIND);
      bound(c1 * CHUNK_LEN - AHEAD); bound((c1 + 1) * CHUNK_LEN - AHEAD);
      for (let c = c0; c <= c1; c++) {
        const centre = c * CHUNK_LEN + half, dist = Math.abs(centre - s);
        const lod = this.lodFor(centre < s ? dist * 1.6 : dist);
        bound(centre - LOD_DIST[0]); bound(centre - LOD_DIST[1]);
        bound(centre + LOD_DIST[0] / 1.6); bound(centre + LOD_DIST[1] / 1.6);
        const i = want.length, rec = this._wantPool[i] || (this._wantPool[i] = { c: 0, lod: 0, dist: 0 });
        rec.c = c; rec.lod = lod; rec.dist = dist; want.push(rec);
      }
      want.sort((a, b) => a.dist - b.dist);
      this._scheduleS = s; this._scheduleLo = lo; this._scheduleHi = hi;
    }
    if (changed || this._scheduleDirty) {
      this._scheduleDirty = false;
      for (const w of want) {
        const rec = this.chunks.get(w.c);
        if (rec && rec.lod === w.lod) continue;
        const key = `${w.c}:${w.lod}`;
        if (this.pending.has(key)) continue;
        let wk = this.workers[0];
        for (let i = 1; i < this.workers.length; i++) if (this.workers[i].busy < wk.busy) wk = this.workers[i];
        if (!wk || wk.busy >= 2) break;
        this.pending.add(key); wk.busy++;
        wk.postMessage({ type: 'chunk', key, chunk: w.c, lod: w.lod, road: !rec });
      }
    }
    // drop far chunks
    for (const [c, rec] of this.chunks) {
      if (c < c0 - 1 || c > c1 + 2) this._dispose(c, rec);
      else this._collision(c, rec, s);
    }
    this.cover.update(this.chunks, s);   // near-road ground cover: one draw per kind for the chunks around the player
    if (this.road) {
      const r = this.road, a = r.sample(s, _fs);
      const y = Math.min(a.y, r.sample(s - FLOOR_R, _fs2).y, r.sample(s + FLOOR_R, _fs2).y) - 100;
      this.floor.position.set(a.x, y, a.z); this.floor.updateMatrix(); this.floor.visible = true;
    }
  }

  _onMsg(w, m) {
    if (this.disposed) return;
    const _t0 = performance.now();
    try { this._onMsg2(w, m); } finally { const ms = performance.now() - _t0; if (ms > 12) appendDiagnostic(window, '__spikes', { what: 'terrainMsg', ms: +ms.toFixed(1), at: +(performance.now() / 1000).toFixed(1) }); }
  }
  _onMsg2(w, m) {
    if (this.disposed) return;
    if (m.type === 'ready') { this.ready++; return; }
    if (m.type !== 'chunk') return;
    w.busy = Math.max(0, w.busy - 1); this.pending.delete(m.key); this._scheduleDirty = true;
    const c0 = Math.floor((this._sLast - BEHIND) / CHUNK_LEN) - 1, c1 = Math.floor((this._sLast + AHEAD) / CHUNK_LEN) + 2;
    if (m.chunk < c0 || m.chunk > c1) return;
    let rec = this.chunks.get(m.chunk);
    if (!rec) { rec = { chunk: m.chunk, lod: -1, mesh: null, roadMesh: null, colT: null, colR: null, tCol: null, rCol: null, branchMeshes: [], branchData: new Map(), colB: new Map(), alive: true, cover: null, coverVersion: 0 }; this.chunks.set(m.chunk, rec); }
    // terrain mesh
    const t = m.t;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(t.normals, 3));
    g.setAttribute('aSplat0', new THREE.BufferAttribute(t.splat[0], 4));
    g.setAttribute('aSplat1', new THREE.BufferAttribute(t.splat[1], 4));
    g.setAttribute('aSplat2', new THREE.BufferAttribute(t.splat[2], 4));
    g.setAttribute('aAux', new THREE.BufferAttribute(t.aux, 4));
    g.setIndex(new THREE.BufferAttribute(t.indices, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.terrainMat);
    mesh.position.set(t.anchor[0], t.anchor[1], t.anchor[2]);
    mesh.receiveShadow = true; mesh.castShadow = m.lod === 0; mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    if (rec.mesh) { this.group.remove(rec.mesh); rec.mesh.geometry.dispose(); }
    rec.mesh = mesh; rec.lod = m.lod; this.group.add(mesh);
    this.stats.built++;
    // Render LOD changes must not discard the fine collision surface. Its
    // retention window is wider than LOD0, and reversing can re-enter that
    // window before another fine worker reply arrives.
    if (t.colPositions) {
      rec.tCol = { pos: t.colPositions, idx: t.colIndices, anchor: t.anchor };
      let minY = Infinity;
      for (let i = 1; i < t.colPositions.length; i += 3) minY = Math.min(minY, t.colPositions[i] + t.anchor[1]);
      rec.minGroundY = minY;
    }
    rec.waterY = t.aux[3] > -1000 ? t.aux[3] : null;
    // road mesh (first time only; road strip does not change with LOD)
    if (m.r) {
      const r = m.r, rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(r.positions, 3));
      rg.setAttribute('normal', new THREE.BufferAttribute(r.normals, 3));
      rg.setAttribute('uv', new THREE.BufferAttribute(r.uvs, 2));
      if (r.roadA) {
        rg.setAttribute('aRoadA', new THREE.BufferAttribute(r.roadA, 4)); rg.setAttribute('aRoadB', new THREE.BufferAttribute(r.roadB, 4));
        rg.setAttribute('aSplat0', new THREE.BufferAttribute(r.splat[0], 4)); rg.setAttribute('aSplat1', new THREE.BufferAttribute(r.splat[1], 4)); rg.setAttribute('aSplat2', new THREE.BufferAttribute(r.splat[2], 4));
        rg.setAttribute('aAux', new THREE.BufferAttribute(r.aux, 4));
      }
      rg.setIndex(new THREE.BufferAttribute(r.indices, 1));
      rg.computeBoundingSphere();
      const rm = new THREE.Mesh(rg, this.roadMat);
      rm.position.set(r.anchor[0], r.anchor[1] + 0.012, r.anchor[2]);
      rm.receiveShadow = true; rm.matrixAutoUpdate = false; rm.updateMatrix();
      if (rec.roadMesh) { this.group.remove(rec.roadMesh); rec.roadMesh.geometry.dispose(); }
      rec.roadMesh = rm; this.group.add(rm);
      rec.rCol = { pos: r.positions, idx: null, anchor: r.anchor, uvIdx: r.indices };
      // the road strip's collision uses its own (Uint16) indices as Uint32
      rec.rCol.idx = Uint32Array.from(r.indices);
    }
    if (m.b) {
      // Fine route strips arrive with the first reply, even at a distant LOD.
      // Later terrain LOD replacements keep their view and physical support.
      for (const old of rec.branchMeshes) { this.group.remove(old); old.geometry.dispose(); }
      for (const old of rec.colB.values()) this.world?.removeRigidBody(old.rb);
      rec.branchMeshes.length = 0; rec.colB.clear(); rec.branchData.clear();
      for (const b of m.b) {
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.BufferAttribute(b.positions, 3));
        bg.setAttribute('normal', new THREE.BufferAttribute(b.normals, 3)); bg.setAttribute('uv', new THREE.BufferAttribute(b.uvs, 2));
        bg.setAttribute('aRoadA', new THREE.BufferAttribute(b.roadA, 4)); bg.setAttribute('aRoadB', new THREE.BufferAttribute(b.roadB, 4));
        bg.setAttribute('aSplat0', new THREE.BufferAttribute(b.splat[0], 4)); bg.setAttribute('aSplat1', new THREE.BufferAttribute(b.splat[1], 4)); bg.setAttribute('aSplat2', new THREE.BufferAttribute(b.splat[2], 4));
        bg.setAttribute('aAux', new THREE.BufferAttribute(b.aux, 4)); bg.setIndex(new THREE.BufferAttribute(b.indices, 1)); bg.computeBoundingSphere();
        const bm = new THREE.Mesh(bg, this.roadMat); bm.name = b.route;
        bm.position.set(...b.anchor); bm.receiveShadow = true; bm.matrixAutoUpdate = false; bm.updateMatrix();
        this.group.add(bm); rec.branchMeshes.push(bm);
        rec.branchData.set(b.route, { pos: b.positions, idx: b.indices, anchor: b.anchor, s0: b.s0, s1: b.s1 });
      }
    }
    if (this.onChunk) this.onChunk(m.chunk, rec);
    this._collision(m.chunk, rec, this._sLast);
  }

  /** Create/destroy Rapier trimesh colliders for chunks near the player. */
  _collision(c, rec, s) {
    if (!this.world) return;
    const centre = c * CHUNK_LEN + CHUNK_LEN / 2;
    const near = centre > s - COLLIDE_BEHIND && centre < s + COLLIDE_AHEAD;
    if (!near) { if (rec.colT || rec.colR || rec.colB?.size) this._dropCol(rec); return; }
    if (!rec.colT && rec.tCol) rec.colT = this._trimesh(rec.tCol);
    // Road collision data is always fine, including a tile's first far-LOD
    // reply. Keep asphalt solid while the detailed off-road surface loads.
    if (!rec.colR && rec.rCol) rec.colR = this._trimesh(rec.rCol);
    for (const [route, data] of rec.branchData || []) if (!rec.colB.has(route)) rec.colB.set(route, this._trimesh(data));
  }
  _trimesh(d) {
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(d.anchor[0], d.anchor[1], d.anchor[2]));
    const cd = RAPIER.ColliderDesc.trimesh(d.pos, d.idx).setCollisionGroups(GROUPS.world).setFriction(0.9).setRestitution(0);
    const col = this.world.createCollider(cd, rb);
    return { rb, col };
  }
  _dropCol(rec) {
    if (rec.colT) { this.world.removeRigidBody(rec.colT.rb); rec.colT = null; }
    if (rec.colR) { this.world.removeRigidBody(rec.colR.rb); rec.colR = null; }
    for (const col of rec.colB?.values() || []) this.world.removeRigidBody(col.rb);
    rec.colB?.clear();
  }
  _dispose(c, rec) {
    this._dropCol(rec);
    if (rec.mesh) { this.group.remove(rec.mesh); rec.mesh.geometry.dispose(); }
    if (rec.roadMesh) { this.group.remove(rec.roadMesh); rec.roadMesh.geometry.dispose(); }
    for (const mesh of rec.branchMeshes || []) { this.group.remove(mesh); mesh.geometry.dispose(); }
    rec.branchMeshes?.splice(0); rec.branchData?.clear();
    rec.cover = null; rec.alive = false;
    this.chunks.delete(c);
    if (this.onChunkDrop) this.onChunkDrop(c);
  }

  hasColliderAt(s, route = null) { const r = this.chunks.get(Math.floor(s / CHUNK_LEN)); return !!(r && r.colT && r.colR && (!route || r.colB?.has(route))); }

  /** Query only asphalt, so hills/tunnel roofs cannot be mistaken for a road recovery surface. */
  roadHeightAt(s, x, z, y, route = null) {
    const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    let height = null;
    const c = Math.floor(s / CHUNK_LEN);
    for (let i = c - 1; i <= c + 1; i++) {
      const rec = this.chunks.get(i), col = route ? rec?.colB?.get(route)?.col : rec?.colR?.col;
      const hit = col?.castRayAndGetNormal(ray, 8, true);
      if (hit && hit.normal.y > 0.5) height = Math.max(height ?? -Infinity, y - hit.timeOfImpact);
    }
    return height;
  }

  /** Physical lower bound and authored water level for the current tile and its neighbours. */
  recoveryBoundsAt(s) {
    let minY = Infinity, waterY = null;
    const c = Math.floor(s / CHUNK_LEN);
    for (let i = c - 1; i <= c + 1; i++) {
      const rec = this.chunks.get(i);
      if (rec?.minGroundY != null) minY = Math.min(minY, rec.minGroundY);
      if (rec?.waterY != null) waterY = Math.max(waterY ?? -Infinity, rec.waterY);
    }
    return Number.isFinite(minY) ? { minY, waterY } : null;
  }

  /** True once the chunks around s have their colliders (used to hold the car until the ground exists). */
  groundReady(s, route = null) {
    for (let c = Math.floor((s - 40) / CHUNK_LEN); c <= Math.floor((s + 80) / CHUNK_LEN); c++) {
      const r = this.chunks.get(c); if (!r || !r.mesh || (this.world && (!r.colT || !r.colR))) return false;
      if (route && this.world) {
        const b = this.road.drivingBranch(route);
        if (!b) return false;
        const lo = c * CHUNK_LEN, hi = lo + CHUNK_LEN;
        if (b.s1 + 4 >= lo && b.s0 - 4 <= hi && !r.colB?.has(route)) return false;
      }
    }
    return true;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    for (const w of this.workers) { w.onmessage = null; w.onerror = null; w.terminate(); }
    this.workers.length = 0; this.pending.clear(); this._want.length = 0; this._wantPool.length = 0;
    for (const [c, r] of this.chunks) this._dispose(c, r);
    this.cover.dispose(); this.floor.geometry.dispose(); this.scene.remove(this.group);
  }
}
