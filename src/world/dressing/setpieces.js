// Set-piece manager: big one-off structures that are not tied to a terrain chunk (the dam). Each piece has a visibility window
// along the road; its generator is run in small time slices (no frame spikes) when the player gets close, its meshes are warmed
// (shader compile + texture upload, see Game.warmMeshes) while hidden and shown together; everything is dropped again far away.
import * as THREE from 'three';
import { DAM, buildDam } from './dam.js';

const PIECES = [
  { id: 'dam', sA: DAM.sA - 4800, sB: DAM.sB + 4500, build: buildDam },
];

export class SetPieces {
  constructor(dress) {
    this.dress = dress; this.scene = dress.scene;
    this.group = new THREE.Group(); this.group.name = 'set-pieces'; this.scene.add(this.group);
    this.live = new Map();   // id -> {gen, group, meshes, state}
    this.stats = { ms: 0 };
  }

  terrainMat() { for (const ch of this.dress.chunks.values()) { const m = ch.rec && ch.rec.mesh && ch.rec.mesh.material; if (m) return m; } return null; }

  update(s, budgetMs = 2) {
    for (const p of PIECES) {
      const want = s > p.sA && s < p.sB, L = this.live.get(p.id);
      if (want && !L) {
        const g = new THREE.Group(); g.name = 'set:' + p.id; g.visible = false; this.group.add(g);
        const rec = { group: g, meshes: [], state: 'build' };
        rec.gen = p.build(this.dress.ctx, (m) => { rec.meshes.push(m); g.add(m); }, () => this.terrainMat());
        this.live.set(p.id, rec);
      } else if (!want && L) this._drop(p.id);
    }
    const t0 = performance.now();
    for (const rec of this.live.values()) {
      if (rec.state !== 'build') continue;
      while (performance.now() - t0 < budgetMs) {
        const r = rec.gen.next();
        if (r.done) { rec.state = 'warm'; this._warm(rec); break; }
      }
    }
    this.stats.ms = performance.now() - t0;
  }

  _warm(rec) {
    const w = this.dress.pool.warmer;
    const show = () => { if (rec.state === 'warm') { rec.state = 'ready'; rec.group.visible = true; } };
    if (w && rec.meshes.length) w(rec.meshes).then(show); else show();
  }

  _drop(id) {
    const rec = this.live.get(id); if (!rec) return;
    rec.state = 'dead';
    this.group.remove(rec.group);
    for (const m of rec.meshes) m.geometry.dispose();
    this.live.delete(id);
  }

  dispose() { for (const id of [...this.live.keys()]) this._drop(id); this.scene.remove(this.group); }
}
