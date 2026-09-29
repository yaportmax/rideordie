// Shared helpers for the dressing system: deterministic seeds, instance lists, exact terrain lookup, road frames.
// Pure maths (no WebGL): everything here is deterministic from (seed, chunk).
import { rng } from '../../core/util.js';
import { terrainPoint, CHUNK_LEN, EDGE, COLS } from '../terrain_gen.js';
import { DS } from '../road.js';

export { CHUNK_LEN, EDGE };

/** Stable 32-bit hash of (seed, a, b). */
export function seedOf(seed, a, b = 0) {
  let h = Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((a | 0) + 0x632be5ab, 0x85ebca6b) ^ Math.imul((b | 0) + 0x165667b1, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}
export const rngOf = (seed, a, b) => rng(seedOf(seed, a, b));
/** Small stable integer id for a string (used to decorrelate per-type random streams). */
export function strId(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h | 0; }

/** Terrain triangles interpolation for LOD0 mesh grid: returns the height/normal the LOD0 terrain mesh has at (s, d). */
function interp(pos, rows, nc, side, r, c, u, v, o) {
  const at = (rr, cc) => ((side * rows + rr) * nc + cc) * 3;
  const A = at(r, c), B = at(r + 1, c), C = at(r + 1, c + 1), D = at(r, c + 1);
  let bx, by, bz, cx, cy, cz;
  let x, y, z, nx, ny, nz;
  if (u >= v) {
    const k1 = u - v, k2 = v;
    x = pos[A] + k1 * (pos[B] - pos[A]) + k2 * (pos[C] - pos[A]);
    y = pos[A + 1] + k1 * (pos[B + 1] - pos[A + 1]) + k2 * (pos[C + 1] - pos[A + 1]);
    z = pos[A + 2] + k1 * (pos[B + 2] - pos[A + 2]) + k2 * (pos[C + 2] - pos[A + 2]);
    bx = pos[B] - pos[A]; by = pos[B + 1] - pos[A + 1]; bz = pos[B + 2] - pos[A + 2];
    cx = pos[C] - pos[A]; cy = pos[C + 1] - pos[A + 1]; cz = pos[C + 2] - pos[A + 2];
  } else {
    const k1 = u, k2 = v - u;
    x = pos[A] + k1 * (pos[C] - pos[A]) + k2 * (pos[D] - pos[A]);
    y = pos[A + 1] + k1 * (pos[C + 1] - pos[A + 1]) + k2 * (pos[D + 1] - pos[A + 1]);
    z = pos[A + 2] + k1 * (pos[C + 2] - pos[A + 2]) + k2 * (pos[D + 2] - pos[A + 2]);
    bx = pos[C] - pos[A]; by = pos[C + 1] - pos[A + 1]; bz = pos[C + 2] - pos[A + 2];
    cx = pos[D] - pos[A]; cy = pos[D + 1] - pos[A + 1]; cz = pos[D + 2] - pos[A + 2];
  }
  nx = by * cz - bz * cy; ny = bz * cx - bx * cz; nz = bx * cy - by * cx;
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const l = Math.hypot(nx, ny, nz) || 1;
  o.x = x; o.y = y; o.z = z; o.nx = nx / l; o.ny = ny / l; o.nz = nz / l;
  return o;
}

function locate(s, d, s0, rows) {
  let fr = (s - s0) / DS;
  if (fr < 0) fr = 0; else if (fr > rows - 1.000001) fr = rows - 1.000001;
  const r = fr | 0, u = fr - r;
  let a = Math.abs(d) - EDGE; if (a < 0) a = 0;
  const nc = COLS.length;
  let c = 0; while (c < nc - 2 && a > COLS[c + 1]) c++;
  let v = (a - COLS[c]) / (COLS[c + 1] - COLS[c]); v = v < 0 ? 0 : v > 1 ? 1 : v;
  return [r, c, u, v];
}

/** Cached LOD0 terrain grid of one chunk (2 sides x 33 rows x 33 cols). sample() returns exactly what the terrain mesh shows. */
export class ChunkGround {
  constructor(road, seed, c, bridges) {
    this.c = c; this.s0 = c * CHUNK_LEN; this.rows = CHUNK_LEN / DS + 1; this.nc = COLS.length;
    this.pos = new Float32Array(2 * this.rows * this.nc * 3);
    const P = {};
    let o = 0;
    for (let si = 0; si < 2; si++) {
      const side = si === 0 ? 1 : -1;
      for (let r = 0; r < this.rows; r++) for (let k = 0; k < this.nc; k++) {
        terrainPoint(road, seed, this.s0 + r * DS, side * (EDGE + COLS[k]), P, bridges);
        this.pos[o++] = P.x; this.pos[o++] = P.y; this.pos[o++] = P.z;
      }
    }
  }
  sample(s, d, o = {}) {
    const [r, c, u, v] = locate(s, d, this.s0, this.rows);
    return interp(this.pos, this.rows, this.nc, d >= 0 ? 0 : 1, r, c, u, v, o);
  }
}

const _c = [{}, {}, {}, {}];
/** Stateless terrain lookup identical to the LOD0 mesh (4 terrainPoint calls). */
export function groundAt(road, seed, s, d, o = {}, bridges) {
  const s0 = Math.floor(s / CHUNK_LEN) * CHUNK_LEN;
  const [r, c, u, v] = locate(s, d, s0, CHUNK_LEN / DS + 1);
  const side = d >= 0 ? 1 : -1;
  const tmp = new Float32Array(4 * 3 * 2);
  // build a mini grid with just the 4 corners (rows r, r+1; cols c, c+1) laid out as a 2x2 grid using the same interp code
  const P = _c[0];
  const put = (idx, rr, cc) => { terrainPoint(road, seed, s0 + rr * DS, side * (EDGE + COLS[cc]), P, bridges); tmp[idx] = P.x; tmp[idx + 1] = P.y; tmp[idx + 2] = P.z; };
  put(0, r, c); put(3, r, c + 1); put(6, r + 1, c); put(9, r + 1, c + 1);
  // layout for interp with rows=2, nc=2, side 0: at(rr,cc) = (rr*2+cc)*3
  return interp(tmp, 2, 2, 0, 0, 0, u, v, o);
}

/** Frame of a road-aligned piece: origin at (s, d), extending `len` forward. Follows slope and bank. */
export function roadFrame(road, s, len, d, out = {}) {
  const p0 = road.pointAt(s, d, {}), p1 = road.pointAt(s + len, d, {});
  const pl = road.pointAt(s + len * 0.5, d + 1, {}), pr = road.pointAt(s + len * 0.5, d - 1, {});
  let fx = p1.x - p0.x, fy = p1.y - p0.y, fz = p1.z - p0.z; let l = Math.hypot(fx, fy, fz) || 1; fx /= l; fy /= l; fz /= l;
  let tx = pl.x - pr.x, ty = pl.y - pr.y, tz = pl.z - pr.z; l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
  // up = f x lateral (lateral = +left)
  let ux = fy * tz - fz * ty, uy = fz * tx - fx * tz, uz = fx * ty - fy * tx; l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
  let lx = uy * fz - uz * fy, ly = uz * fx - ux * fz, lz = ux * fy - uy * fx; l = Math.hypot(lx, ly, lz) || 1; lx /= l; ly /= l; lz /= l;
  out.x = p0.x; out.y = p0.y; out.z = p0.z;
  out.fx = fx; out.fy = fy; out.fz = fz; out.ux = ux; out.uy = uy; out.uz = uz; out.lx = lx; out.ly = ly; out.lz = lz;
  out.yaw = Math.atan2(fx, fz);
  out.s = s; out.d = d; out.len = len;
  return out;
}

/** Growable list of instance matrices (16 floats each) + optional colours, with an AABB for cheap rejection. */
export class InstList {
  constructor(cap = 32) {
    this.n = 0; this.cap = cap;
    this.m = new Float32Array(cap * 16); this.col = new Float32Array(cap * 3);
    this.minx = 1e18; this.miny = 1e18; this.minz = 1e18; this.maxx = -1e18; this.maxy = -1e18; this.maxz = -1e18; this.rad = 0;
    this.version = 0;
  }
  _grow() {
    this.cap *= 2;
    const m = new Float32Array(this.cap * 16); m.set(this.m); this.m = m;
    const c = new Float32Array(this.cap * 3); c.set(this.col); this.col = c;
  }
  /** Column basis (X=l*sx, Y=u*sy, Z=f*sz), translation (px,py,pz), radius = bounding radius of that instance. */
  pushBasis(px, py, pz, lx, ly, lz, ux, uy, uz, fx, fy, fz, sx, sy, sz, rad = 1, r = 1, g = 1, b = 1) {
    if (this.n >= this.cap) this._grow();
    const m = this.m, o = this.n * 16;
    m[o] = lx * sx; m[o + 1] = ly * sx; m[o + 2] = lz * sx; m[o + 3] = 0;
    m[o + 4] = ux * sy; m[o + 5] = uy * sy; m[o + 6] = uz * sy; m[o + 7] = 0;
    m[o + 8] = fx * sz; m[o + 9] = fy * sz; m[o + 10] = fz * sz; m[o + 11] = 0;
    m[o + 12] = px; m[o + 13] = py; m[o + 14] = pz; m[o + 15] = 1;
    const c = this.n * 3; this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b;
    this.n++;
    if (px < this.minx) this.minx = px; if (px > this.maxx) this.maxx = px;
    if (py < this.miny) this.miny = py; if (py > this.maxy) this.maxy = py;
    if (pz < this.minz) this.minz = pz; if (pz > this.maxz) this.maxz = pz;
    if (rad > this.rad) this.rad = rad;
    this.version++;
    return this.n - 1;
  }
  /** Ground-aligned instance: yaw about local up, up vector blended between world-up and the surface normal by `align`. */
  push(px, py, pz, yaw, sx, sy, sz, nx = 0, ny = 1, nz = 0, align = 0, rad = 1, r = 1, g = 1, b = 1) {
    let ux = nx * align, uy = 1 + (ny - 1) * align, uz = nz * align;
    const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    let fx = Math.sin(yaw), fy = 0, fz = Math.cos(yaw);
    const dp = fx * ux + fy * uy + fz * uz; fx -= ux * dp; fy -= uy * dp; fz -= uz * dp;
    const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    // x = up x f
    const lx = uy * fz - uz * fy, ly = uz * fx - ux * fz, lz = ux * fy - uy * fx;
    return this.pushBasis(px, py, pz, lx, ly, lz, ux, uy, uz, fx, fy, fz, sx, sy, sz, rad, r, g, b);
  }
  /** Push from a THREE.Matrix4.elements-like array. */
  pushMatrix(e, rad = 1, r = 1, g = 1, b = 1) {
    if (this.n >= this.cap) this._grow();
    this.m.set(e, this.n * 16);
    const c = this.n * 3; this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b;
    this.n++;
    const px = e[12], py = e[13], pz = e[14];
    if (px < this.minx) this.minx = px; if (px > this.maxx) this.maxx = px;
    if (py < this.miny) this.miny = py; if (py > this.maxy) this.maxy = py;
    if (pz < this.minz) this.minz = pz; if (pz > this.maxz) this.maxz = pz;
    if (rad > this.rad) this.rad = rad;
    this.version++;
    return this.n - 1;
  }
}

export const lerp3 = (a, b, t) => a + (b - a) * t;
