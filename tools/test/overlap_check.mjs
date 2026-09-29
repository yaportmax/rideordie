// Terrain sanity along the whole route: (1) folds (rows of constant s crossing), (2) overlaps between road sections: terrain vertices
// that lie closer to another section of the road than to their own row by more than 8 m (they would float over / under that section's ground).
import { Road } from '../../src/world/road.js';
import { terrainPoint, COLS, EDGE } from '../../src/world/terrain_gen.js';
const seed = +(process.argv[2] || 7), road = new Road(seed);
road.extendTo(64000);
const P = {}, Q = {}, sm = {}, nb = {};
let folds = 0, over = 0, total = 0; const where = {};
const t0 = performance.now();
for (let s = 0; s < 60000; s += 6) {
  road.sample(s, sm);
  for (const side of [1, -1]) for (let c = 0; c < COLS.length; c += 2) {
    const d = side * (EDGE + COLS[c]);
    terrainPoint(road, seed, s, d, P); terrainPoint(road, seed, s + 3, d, Q);
    total++;
    if ((Q.x - P.x) * sm.fx + (Q.z - P.z) * sm.fz <= 0) folds++;
    const own = Math.hypot(P.x - sm.x, P.z - sm.z);
    road.nearest(P.x, P.z, s, 40, nb);
    if (own > 60) {
      // global nearest (coarse)
      let best = 1e18, bs = 0; for (let j = Math.max(0, Math.floor((s - 3000) / 3)); j < Math.min(road.n, (s + 3000) / 3); j += 3) { const dx = road.x[j] - P.x, dz = road.z[j] - P.z, q = dx * dx + dz * dz; if (q < best && Math.abs(j * 3 - s) > own * 1.3 + 40) { best = q; bs = j * 3; } }
      if (Math.sqrt(best) + 8 < own) { over++; const k = Math.floor(s / 5000) * 5; where[k] = (where[k] || 0) + 1; }
    }
  }
}
console.log('seed', seed, 'folds', folds, 'overlaps', over, 'of', total, JSON.stringify(where), ((performance.now() - t0) / 1000).toFixed(1) + ' s');
