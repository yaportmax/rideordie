// Synchronous terrain colliders for headless runs (Node tests, bots). Same geometry as the streamer's colliders.
import { RAPIER, GROUPS, setColliderLabel, removeBody } from './physics.js';
import { genTerrainChunk, genRoadChunk, CHUNK_LEN } from '../world/terrain_gen.js';

const AHEAD = 420, BEHIND = 340;
export class SyncGround {
  constructor(sim) { this.sim = sim; this.chunks = new Map(); this.bounds = new Map(); }
  _trimesh(pos, idx, anchor, label) {
    const w = this.sim.world;
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(anchor[0], anchor[1], anchor[2]));
    const col = w.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx).setCollisionGroups(GROUPS.world).setFriction(0.9).setRestitution(0), rb);
    setColliderLabel(w, col, label);
    return rb;
  }
  update(s) {
    const c0 = Math.floor((s - BEHIND) / CHUNK_LEN), c1 = Math.floor((s + AHEAD) / CHUNK_LEN);
    for (let c = c0; c <= c1; c++) {
      if (this.chunks.has(c)) continue;
      const t = genTerrainChunk(this.sim.road, this.sim.seed, c, 0);
      const r = genRoadChunk(this.sim.road, this.sim.seed, c);
      this.chunks.set(c, [this._trimesh(t.colPositions, t.colIndices, t.anchor, 'terrain' + c), this._trimesh(r.colPositions, r.colIndices, r.anchor, 'road' + c)]);
      let minY = Infinity;
      for (let i = 1; i < t.colPositions.length; i += 3) minY = Math.min(minY, t.colPositions[i] + t.anchor[1]);
      this.bounds.set(c, { minY, waterY: t.aux[3] > -1000 ? t.aux[3] : null });
    }
    for (const [c, rbs] of this.chunks) if (c < c0 - 1 || c > c1 + 1) { for (const rb of rbs) removeBody(this.sim.world, rb); this.chunks.delete(c); this.bounds.delete(c); }
  }
  hasColliderAt(s) { return this.chunks.has(Math.floor(s / CHUNK_LEN)); }
  groundReady(s) { return this.hasColliderAt(s) && this.hasColliderAt(s + 60) && this.hasColliderAt(s - 40); }
  roadHeightAt(s, x, z, y) {
    const ray = new RAPIER.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
    let height = null;
    const c = Math.floor(s / CHUNK_LEN);
    for (let i = c - 1; i <= c + 1; i++) {
      const hit = this.chunks.get(i)?.[1]?.collider(0).castRayAndGetNormal(ray, 8, true);
      if (hit && hit.normal.y > .5) height = Math.max(height ?? -Infinity, y - hit.timeOfImpact);
    }
    return height;
  }
  recoveryBoundsAt(s) {
    let minY = Infinity, waterY = null;
    const c = Math.floor(s / CHUNK_LEN);
    for (let i = c - 1; i <= c + 1; i++) {
      const b = this.bounds.get(i); if (!b) continue;
      minY = Math.min(minY, b.minY);
      if (b.waterY != null) waterY = Math.max(waterY ?? -Infinity, b.waterY);
    }
    return Number.isFinite(minY) ? { minY, waterY } : null;
  }
  dispose() { for (const rbs of this.chunks.values()) for (const rb of rbs) removeBody(this.sim.world, rb); this.chunks.clear(); this.bounds.clear(); }
}
