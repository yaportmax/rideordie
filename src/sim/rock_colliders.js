// Streamed rocks keep every solid surface available to weapon queries. Rapier
// bodies are prepared only around moving cars, in small spatial batches, so a
// far roadside boulder cannot add a large synchronous BVH build to a frame.
import { RAPIER, GROUPS, setColliderLabel, removeBody } from './physics.js';

export const ROCK_CELL = 32;
const _normal = { x: 0, y: 0, z: 0 };
const AXES = ['x', 'y', 'z'];

function boxTOI(b, o, d, max) {
  let lo = 0, hi = max;
  for (let k = 0; k < 3; k++) {
    const axis = AXES[k], v = d[axis], p = o[axis];
    if (Math.abs(v) < 1e-12) { if (p < b[k] || p > b[k + 3]) return Infinity; continue; }
    let a = (b[k] - p) / v, c = (b[k + 3] - p) / v;
    if (a > c) { const t = a; a = c; c = t; }
    lo = Math.max(lo, a); hi = Math.min(hi, c); if (lo > hi) return Infinity;
  }
  return lo;
}

function triangleTOI(pos, idx, o, d, max, normal) {
  let best = Infinity;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
    const ex = pos[b] - ax, ey = pos[b + 1] - ay, ez = pos[b + 2] - az;
    const fx = pos[c] - ax, fy = pos[c + 1] - ay, fz = pos[c + 2] - az;
    const px = d.y * fz - d.z * fy, py = d.z * fx - d.x * fz, pz = d.x * fy - d.y * fx;
    const det = ex * px + ey * py + ez * pz;
    if (Math.abs(det) < 1e-10) continue;
    const inv = 1 / det, tx = o.x - ax, ty = o.y - ay, tz = o.z - az;
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < -1e-7 || u > 1 + 1e-7) continue;
    const qx = ty * ez - tz * ey, qy = tz * ex - tx * ez, qz = tx * ey - ty * ex;
    const v = (d.x * qx + d.y * qy + d.z * qz) * inv;
    if (v < -1e-7 || u + v > 1 + 1e-7) continue;
    const t = (fx * qx + fy * qy + fz * qz) * inv;
    if (t < 0 || t > max || t >= best) continue;
    best = t;
    const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx, len = Math.hypot(nx, ny, nz) || 1;
    // Rapier's double-sided trimesh normal opposes an exiting ray as well.
    const sign = nx * d.x + ny * d.y + nz * d.z > 0 ? -1 : 1;
    normal.x = sign * nx / len; normal.y = sign * ny / len; normal.z = sign * nz / len;
  }
  return best;
}

export class RockColliders {
  constructor(world, bodies) {
    this.world = world; this.bodies = bodies; this.groups = new Map(); this.cells = new Map(); this.index = new Map();
    this.points = []; this.queue = []; this._query = 0;
    this.stats = { created: 0, removed: 0, buildMs: 0, maxBuildMs: 0, maxUpdateMs: 0, triangleTests: 0 };
  }
  add(req) {
    if (this.groups.has(req.id)) return;
    const ids = [];
    for (let i = 0; i < req.cells.length; i++) {
      const c = req.cells[i], id = `${req.id}:${i}`, p = c.pos;
      const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let j = 0; j < p.length; j += 3) for (let k = 0; k < 3; k++) { bounds[k] = Math.min(bounds[k], p[j + k]); bounds[k + 3] = Math.max(bounds[k + 3], p[j + k]); }
      const rec = { id, parent: req.id, pos: p, idx: c.idx, bounds, body: null, distance: Infinity, visit: 0, want: false };
      this.cells.set(id, rec); ids.push(id);
      for (let x = Math.floor(bounds[0] / ROCK_CELL); x <= Math.floor(bounds[3] / ROCK_CELL); x++) for (let z = Math.floor(bounds[2] / ROCK_CELL); z <= Math.floor(bounds[5] / ROCK_CELL); z++) {
        const key = `${x}:${z}`; let list = this.index.get(key); if (!list) this.index.set(key, list = new Set()); list.add(rec);
      }
    }
    this.groups.set(req.id, ids);
  }
  remove(id) {
    const ids = this.groups.get(id); if (!ids) return;
    for (const key of ids) {
      const rec = this.cells.get(key); if (!rec) continue;
      this._drop(rec); this.cells.delete(key);
      const b = rec.bounds;
      for (let x = Math.floor(b[0] / ROCK_CELL); x <= Math.floor(b[3] / ROCK_CELL); x++) for (let z = Math.floor(b[2] / ROCK_CELL); z <= Math.floor(b[5] / ROCK_CELL); z++) {
        const k = `${x}:${z}`, list = this.index.get(k); list?.delete(rec); if (!list?.size) this.index.delete(k);
      }
    }
    this.groups.delete(id);
  }
  _drop(rec) {
    if (!rec.body) return;
    removeBody(this.world, rec.body); this.bodies.delete(rec.id); rec.body = null; this.stats.removed++;
  }
  _build(rec) {
    const t = performance.now(), b = rec.bounds, cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
    const local = new Float32Array(rec.pos.length);
    for (let i = 0; i < local.length; i += 3) { local[i] = rec.pos[i] - cx; local[i + 1] = rec.pos[i + 1] - cy; local[i + 2] = rec.pos[i + 2] - cz; }
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz));
    const col = this.world.createCollider(RAPIER.ColliderDesc.trimesh(local, rec.idx).setCollisionGroups(GROUPS.world).setFriction(.3).setRestitution(.05), rb);
    setColliderLabel(this.world, col, 'scatter-rocks'); rec.body = rb; this.bodies.set(rec.id, rb);
    const ms = performance.now() - t; this.stats.created++; this.stats.buildMs += ms; this.stats.maxBuildMs = Math.max(this.stats.maxBuildMs, ms);
  }
  update(cars, budget = 2.5) {
    const t = performance.now(), points = this.points; let n = 0;
    for (const car of cars) {
      const p = car.veh?.pos || car.pos; if (!p) continue;
      const v = car.veh?.vel || car.vel, speed = v ? Math.hypot(v.x, v.z) : 0;
      const q = points[n] || (points[n] = {}); q.x = p.x; q.z = p.z; q.radius = 80 + Math.min(100, speed * 1.5); n++;
    }
    points.length = n; const queue = this.queue; queue.length = 0;
    for (const rec of this.cells.values()) {
      const b = rec.bounds; let distance = Infinity, want = false, retain = false;
      for (const p of points) {
        const dx = Math.max(b[0] - p.x, 0, p.x - b[3]), dz = Math.max(b[2] - p.z, 0, p.z - b[5]), d = Math.hypot(dx, dz);
        distance = Math.min(distance, d); if (d <= p.radius) want = true; if (d <= p.radius + 40) retain = true;
      }
      rec.distance = distance; rec.want = want;
      if (rec.body && !retain) this._drop(rec);
      if (!rec.body && want) queue.push(rec);
    }
    if (queue.length > 1) queue.sort((a, b) => a.distance - b.distance);
    for (const rec of queue) {
      // A newly spawned/teleported car cannot wait inside an unbuilt obstacle.
      // Ordinary approach begins 80-180 m away and respects the frame budget.
      if (rec.distance > 40 && performance.now() - t >= budget) break;
      this._build(rec);
    }
    this.stats.maxUpdateMs = Math.max(this.stats.maxUpdateMs, performance.now() - t);
  }
  raycast(o, d, max) {
    if (!(max >= 0) || !Number.isFinite(max) || !Number.isFinite(o.x + o.y + o.z + d.x + d.y + d.z) || Math.hypot(d.x, d.y, d.z) < 1e-12) return null;
    let x = Math.floor(o.x / ROCK_CELL), z = Math.floor(o.z / ROCK_CELL), travel = 0, best = max, hit = null;
    const sx = Math.sign(d.x), sz = Math.sign(d.z), dx = sx ? ROCK_CELL / Math.abs(d.x) : Infinity, dz = sz ? ROCK_CELL / Math.abs(d.z) : Infinity;
    let tx = sx ? ((x + (sx > 0 ? 1 : 0)) * ROCK_CELL - o.x) / d.x : Infinity;
    let tz = sz ? ((z + (sz > 0 ? 1 : 0)) * ROCK_CELL - o.z) / d.z : Infinity;
    const query = ++this._query;
    for (let step = 0; step < 4096 && travel <= best; step++) {
      const records = this.index.get(`${x}:${z}`);
      if (records) for (const rec of records) {
        if (rec.visit === query) continue; rec.visit = query;
        if (boxTOI(rec.bounds, o, d, best) === Infinity) continue;
        const t = triangleTOI(rec.pos, rec.idx, o, d, best, _normal); this.stats.triangleTests += rec.idx.length / 3;
        if (t <= best) { best = t; hit = { timeOfImpact: t, normal: { ..._normal }, kind: 'rock' }; }
      }
      if (tx === Infinity && tz === Infinity) break;
      if (tx <= tz) { travel = tx; x += sx; tx += dx; }
      else { travel = tz; z += sz; tz += dz; }
    }
    return hit;
  }
  dispose() {
    for (const id of [...this.groups.keys()]) this.remove(id);
    this.points.length = 0; this.queue.length = 0;
  }
}
