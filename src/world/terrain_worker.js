// Web Worker: builds terrain + road chunk geometry off the main thread.
import { Road } from './road.js';
import { genTerrainChunk, genRoadChunk } from './terrain_gen.js';

let road = null, seed = 0;
const own = (a) => (a.byteOffset === 0 && a.byteLength === a.buffer.byteLength ? a : a.slice());

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { seed = m.seed; road = new Road(seed); self.postMessage({ type: 'ready' }); return; }
  if (m.type !== 'chunk') return;
  const t = genTerrainChunk(road, seed, m.chunk, m.lod);
  const out = { type: 'chunk', key: m.key, chunk: m.chunk, lod: m.lod, t: {
    anchor: t.anchor, positions: own(t.positions), normals: own(t.normals), aux: own(t.aux), splat: t.splat.map(own), indices: own(t.indices), nVerts: t.nVerts,
    colPositions: t.colPositions, colIndices: t.colIndices,
  }, r: null };
  const tr = [out.t.positions.buffer, out.t.normals.buffer, out.t.aux.buffer, out.t.indices.buffer, ...out.t.splat.map((a) => a.buffer)];
  if (t.colPositions) tr.push(t.colPositions.buffer, t.colIndices.buffer);
  if (m.road) {
    const r = genRoadChunk(road, seed, m.chunk);
    out.r = { anchor: r.anchor, positions: r.positions, normals: r.normals, uvs: r.uvs, roadA: r.roadA, roadB: r.roadB, splat: r.splat, aux: r.aux, indices: r.indices, colPositions: m.lod === 0 ? r.colPositions : null, colIndices: m.lod === 0 ? r.colIndices : null };
    tr.push(r.positions.buffer, r.normals.buffer, r.uvs.buffer, r.roadA.buffer, r.roadB.buffer, r.aux.buffer, ...r.splat.map((a) => a.buffer), r.indices.buffer);
    if (out.r.colPositions) tr.push(r.colPositions.buffer === r.positions.buffer ? undefined : r.colPositions.buffer, r.colIndices.buffer);
  }
  self.postMessage(out, tr.filter(Boolean));
};
