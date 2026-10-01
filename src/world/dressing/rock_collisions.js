// Solid scatter rocks share a small, cached collision mesh. Separate stones in
// one GLB remain separate hulls: a bounding box or whole-asset hull would bridge
// the visible gaps. Instances are batched in their owning streamed chunk.
import * as THREE from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { ROCK_CELL } from '../../sim/rock_colliders.js';

const CACHE = new WeakMap();
const MIN_HEIGHT = 0.6, MIN_WIDTH = 1.2;

/** Pebbles and vegetation stay decoration; visible car-sized rocks are solid. */
export function isSolidRock(entry, asset, scale) {
  return (entry.cat === 'rock' || entry.cat === 'pillar') &&
    asset.height * (1 - entry.sink) * scale >= MIN_HEIGHT &&
    Math.max(asset.size.x, asset.size.z) * scale >= MIN_WIDTH;
}

/** One-time hull reduction from the actual loaded model, including its nodes. */
export function rockCollisionMesh(asset) {
  if (CACHE.has(asset)) return CACHE.get(asset);
  // Pillars have deep concave waists. They are sparse, so retain their exact
  // indexed surface rather than introducing a solid invisible convex bridge.
  if (asset.name.startsWith('canyon_pillar_')) {
    const pos = [], idx = [], box = new THREE.Box3();
    for (const part of asset.parts) {
      const g = part.geometry, p = g.getAttribute('position'), base = pos.length / 3;
      if (!p) continue;
      for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(base + g.index.getX(i));
      else for (let i = 0; i < p.count; i++) idx.push(base + i);
      box.union(part.geometry.boundingBox || new THREE.Box3().setFromBufferAttribute(p));
    }
    const out = idx.length ? [{ pos: new Float32Array(pos), idx: new Uint32Array(idx), box }] : [];
    CACHE.set(asset, out); return out;
  }
  const vertices = [], parents = [], welded = new Map();
  const find = n => { while (parents[n] !== n) { parents[n] = parents[parents[n]]; n = parents[n]; } return n; };
  const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parents[b] = a; };
  for (const part of asset.parts) {
    const g = part.geometry, p = g.getAttribute('position');
    if (!p) continue;
    const ids = new Uint32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
      let id = welded.get(key);
      if (id === undefined) { id = vertices.length; welded.set(key, id); vertices.push(new THREE.Vector3(x, y, z)); parents.push(id); }
      ids[i] = id;
    }
    const count = g.index ? g.index.count : p.count;
    for (let i = 0; i + 2 < count; i += 3) {
      const a = ids[g.index ? g.index.getX(i) : i], b = ids[g.index ? g.index.getX(i + 1) : i + 1], c = ids[g.index ? g.index.getX(i + 2) : i + 2];
      join(a, b); join(a, c);
    }
  }
  const components = new Map();
  for (let i = 0; i < vertices.length; i++) { const id = find(i); let points = components.get(id); if (!points) components.set(id, points = []); points.push(vertices[i]); }
  const out = [];
  for (const points of components.values()) {
    if (points.length < 4) continue;
    const box = new THREE.Box3().setFromPoints(points);
    if (box.max.y - box.min.y < 1e-5) continue;
    // Sampling a few support directions lets the truck visibly enter large
    // rocks. The actual component hull is still much smaller than the visual
    // triangulation, and its one-time construction is cached per loaded asset.
    const hull = new ConvexHull().setFromPoints(points), pos = [], idx = [], ids = new Map();
    for (const face of hull.faces) {
      let edge = face.edge;
      do {
        const p = edge.head().point; let id = ids.get(p);
        if (id === undefined) { id = ids.size; ids.set(p, id); pos.push(p.x, p.y, p.z); }
        idx.push(id); edge = edge.next;
      } while (edge !== face.edge);
    }
    if (idx.length) out.push({ pos: new Float32Array(pos), idx: new Uint32Array(idx), box });
  }
  CACHE.set(asset, out);
  return out;
}

/** Exact InstList matrix: yaw, surface-normal alignment, nonuniform scale/sink. */
export class RockCollisionBatch {
  constructor() { this.pos = []; this.idx = []; this.rocks = 0; this.cells = new Map(); }
  add(entry, asset, scale, matrices, offset) {
    if (!isSolidRock(entry, asset, scale)) return;
    const key = `${Math.floor(matrices[offset + 12] / ROCK_CELL)}:${Math.floor(matrices[offset + 14] / ROCK_CELL)}`;
    let added = false;
    for (const c of rockCollisionMesh(asset)) {
      // Satellite pebbles buried by the model's sink do not need a barrier.
      if ((c.box.max.y - entry.sink * asset.height) * scale < MIN_HEIGHT || Math.max(c.box.max.x - c.box.min.x, c.box.max.z - c.box.min.z) * scale < MIN_WIDTH) continue;
      // Bound each BVH construction independently of a dense outcrop. A
      // sparse exact pillar is the only single component above this limit.
      let n = 0, cell = this.cells.get(`${key}:${n}`);
      while (cell && cell.idx.length + c.idx.length > 2048 * 3 && cell.idx.length) cell = this.cells.get(`${key}:${++n}`);
      if (!cell) this.cells.set(`${key}:${n}`, cell = { pos: [], idx: [] });
      const base = this.pos.length / 3, cellBase = cell.pos.length / 3, p = c.pos, m = matrices, o = offset;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2];
        const px = m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12], py = m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13], pz = m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14];
        this.pos.push(px, py, pz); cell.pos.push(px, py, pz);
      }
      for (const i of c.idx) { this.idx.push(base + i); cell.idx.push(cellBase + i); }
      added = true;
    }
    if (added) this.rocks++;
  }
  flush(ctx, chunk, tier) {
    if (!this.idx.length) return;
    const n = chunk.rockCollisionBatches || 0; chunk.rockCollisionBatches = n + 1;
    const id = `scatter-rocks:${chunk.c}:${tier}:${n}`;
    chunk.hooks.push(id);
    const cells = [...this.cells.values()].filter(c => c.idx.length).map(c => ({ pos: new Float32Array(c.pos), idx: new Uint32Array(c.idx) }));
    ctx.hook({ type: 'static', id, asset: 'scatter-rocks', cells, rocks: this.rocks });
  }
}
