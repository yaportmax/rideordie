// Synchronous terrain colliders for headless runs (Node tests, bots). Same geometry as the streamer's colliders.
import { RAPIER, GROUPS } from './physics.js';
import { genTerrainChunk, genRoadChunk, CHUNK_LEN } from '../world/terrain_gen.js';

const AHEAD = 420, BEHIND = 340;
export class SyncGround {
  constructor(sim) { this.sim = sim; this.chunks = new Map(); }
  _trimesh(pos, idx, anchor) {
    const w = this.sim.world;
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(anchor[0], anchor[1], anchor[2]));
    w.createCollider(RAPIER.ColliderDesc.trimesh(pos, idx).setCollisionGroups(GROUPS.world).setFriction(0.9).setRestitution(0), rb);
    return rb;
  }
  update(s) {
    const c0 = Math.floor((s - BEHIND) / CHUNK_LEN), c1 = Math.floor((s + AHEAD) / CHUNK_LEN);
    for (let c = Math.max(0, c0); c <= c1; c++) {
      if (this.chunks.has(c)) continue;
      const t = genTerrainChunk(this.sim.road, this.sim.seed, c, 0);
      const r = genRoadChunk(this.sim.road, this.sim.seed, c);
      this.chunks.set(c, [this._trimesh(t.colPositions, t.colIndices, t.anchor), this._trimesh(r.colPositions, r.colIndices, r.anchor)]);
    }
    for (const [c, rbs] of this.chunks) if (c < c0 - 1 || c > c1 + 1) { for (const rb of rbs) this.sim.world.removeRigidBody(rb); this.chunks.delete(c); }
  }
  hasColliderAt(s) { return this.chunks.has(Math.floor(s / CHUNK_LEN)); }
  groundReady(s) { return this.hasColliderAt(s) && this.hasColliderAt(s + 60) && this.hasColliderAt(s - 40); }
}
