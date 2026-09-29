import { Road } from '../../src/world/road.js';
import { genTerrainChunk, genRoadChunk, CHUNK_LEN } from '../../src/world/terrain_gen.js';
const seed = 7, road = new Road(seed);
for (const [name, s] of [['desert', 1500], ['canyon', 14000], ['coast', 24000], ['mountain', 35000], ['city', 45000], ['dam', 53000]]) {
  const chunk = Math.floor(s / CHUNK_LEN);
  let t0 = performance.now();
  const c = genTerrainChunk(road, seed, chunk, 0);
  const t1 = performance.now() - t0;
  t0 = performance.now(); const c2 = genTerrainChunk(road, seed, chunk, 2); const t2 = performance.now() - t0;
  t0 = performance.now(); const r = genRoadChunk(road, seed, chunk); const t3 = performance.now() - t0;
  let yMin = 1e9, yMax = -1e9; for (let i = 1; i < c.positions.length; i += 3) { yMin = Math.min(yMin, c.positions[i]); yMax = Math.max(yMax, c.positions[i]); }
  let nan = 0; for (const a of [c.positions, c.normals, ...c.splat]) for (const v of a) if (!Number.isFinite(v)) nan++;
  console.log(`${name}: lod0 ${t1.toFixed(0)}ms (${c.nVerts} verts, ${c.indices.length / 3} tris) lod2 ${t2.toFixed(0)}ms road ${t3.toFixed(1)}ms  relY ${yMin.toFixed(0)}..${yMax.toFixed(0)}  nan=${nan}`);
}
