// Colliders for dressing structures (bridges, tunnels, overpasses, roadblock wrecks, roadside landmarks). Fed by Dressing's physicsHook.
// Used by the sim world (vehicles collide) and by the gunner peer's query world (bullets hit structures).
import * as THREE from 'three';
import { RAPIER, GROUPS } from './physics.js';

const TYPES = new Set(['bridge', 'tunnel', 'overpass', 'static', 'roadblock']);

export class StructureColliders {
  constructor(world) { this.world = world; this.bodies = new Map(); this.roadblocks = new Map(); }

  hook(req) {
    if (req.type === 'remove') {
      const rb = this.bodies.get(req.id); if (rb) { this.world.removeRigidBody(rb); this.bodies.delete(req.id); }
      this.roadblocks.delete(req.id);
      return;
    }
    if (!TYPES.has(req.type) || !req.collision || !req.collision.pos || !req.collision.idx || this.bodies.has(req.id)) return;
    const pos = req.collision.pos, idx = req.collision.idx;
    if (pos.length < 9 || idx.length < 3) return;
    // re-centre for float precision
    let cx = 0, cy = 0, cz = 0; const n = pos.length / 3;
    for (let i = 0; i < pos.length; i += 3) { cx += pos[i]; cy += pos[i + 1]; cz += pos[i + 2]; }
    cx /= n; cy /= n; cz /= n;
    const local = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { local[i] = pos[i] - cx; local[i + 1] = pos[i + 1] - cy; local[i + 2] = pos[i + 2] - cz; }
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz));
    this.world.createCollider(RAPIER.ColliderDesc.trimesh(local, idx instanceof Uint32Array ? idx : Uint32Array.from(idx)).setCollisionGroups(GROUPS.world).setFriction(0.3).setRestitution(0.05), rb);
    this.bodies.set(req.id, rb);
    if (req.type === 'roadblock') this.roadblocks.set(req.id, new THREE.Vector3(cx, cy, cz));
  }

  roadblockNear(p, r = 18) { for (const c of this.roadblocks.values()) if (c.distanceToSquared(p) < r * r) return true; return false; }
  dispose() { for (const rb of this.bodies.values()) this.world.removeRigidBody(rb); this.bodies.clear(); this.roadblocks.clear(); }
}
