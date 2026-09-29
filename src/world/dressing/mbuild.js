// MB: tiny mesh builder for procedural set pieces (city blocks, the dam...). Emits one indexed BufferGeometry with
// position (relative to an anchor, float precision at 60 km), normal, uv, color and two optional vec4 attributes
// (aFac / aFac2, consumed by the facade shader). Primitives are placed through local frames:
//   F = { x, y, z (origin, world), lx, lz (unit LEFT vector, horizontal), fx, fz (unit forward) }  - left = up x forward
// Local coordinates: x = left (the game's +X convention), y = up (world up), z = forward. Right-handed, so a CCW quad in local
// space is CCW in the world. Winding is always counter-clockwise seen from outside.
import * as THREE from 'three';

class Grow {
  constructor(n, T = Float32Array) { this.a = new T(n); this.n = 0; this.T = T; }
  need(k) { if (this.n + k > this.a.length) { const b = new this.T(Math.max(this.a.length * 2, this.n + k)); b.set(this.a); this.a = b; } }
  push1(a) { this.need(1); this.a[this.n++] = a; }
  push2(a, b) { this.need(2); const o = this.n; this.a[o] = a; this.a[o + 1] = b; this.n += 2; }
  push3(a, b, c) { this.need(3); const o = this.n; this.a[o] = a; this.a[o + 1] = b; this.a[o + 2] = c; this.n += 3; }
  push4(a, b, c, d) { this.need(4); const o = this.n; this.a[o] = a; this.a[o + 1] = b; this.a[o + 2] = c; this.a[o + 3] = d; this.n += 4; }
  view() { return this.a.subarray(0, this.n); }
}

/** Frame from an origin and a yaw (yaw 0 => forward = +Z world, left = +X world; same as THREE rotation.y = yaw). */
export function frameYaw(x, y, z, yaw, out = {}) {
  const s = Math.sin(yaw), c = Math.cos(yaw);
  out.x = x; out.y = y; out.z = z; out.fx = s; out.fz = c; out.lx = c; out.lz = -s;
  return out;
}

export class MB {
  constructor(anchor, opts = {}) {
    this.ax = anchor.x; this.ay = anchor.y; this.az = anchor.z;
    this.fac = opts.fac !== false;
    const n = opts.cap || 4096;
    this.P = new Grow(n * 3); this.N = new Grow(n * 3); this.U = new Grow(n * 2); this.C = new Grow(n * 3);
    if (this.fac) { this.A = new Grow(n * 4); this.B = new Grow(n * 4); }
    this.I = new Grow(n * 2, Uint32Array);
    this.c = [1, 1, 1]; this.f = [0, 1, 1, 0]; this.f2 = [0, 0, 0, 0];
    this.minY = 1e9; this.maxY = -1e9;
  }
  get count() { return this.P.n / 3; }
  col(r, g, b) { this.c[0] = r; this.c[1] = g; this.c[2] = b; return this; }
  setFac(a, b, c, d) { const f = this.f; f[0] = a; f[1] = b; f[2] = c; f[3] = d; return this; }
  setFac2(a, b, c, d) { const f = this.f2; f[0] = a; f[1] = b; f[2] = c; f[3] = d; return this; }

  /** Raw vertex in WORLD coordinates. */
  vert(x, y, z, nx, ny, nz, u, v) {
    this.P.push3(x - this.ax, y - this.ay, z - this.az); this.N.push3(nx, ny, nz); this.U.push2(u, v);
    this.C.push3(this.c[0], this.c[1], this.c[2]);
    if (this.fac) { this.A.push4(this.f[0], this.f[1], this.f[2], this.f[3]); this.B.push4(this.f2[0], this.f2[1], this.f2[2], this.f2[3]); }
    if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
    return this.P.n / 3 - 1;
  }
  tri(a, b, c) { this.I.push3(a, b, c); }
  quadIdx(a, b, c, d) { this.I.push3(a, b, c); this.I.push3(a, c, d); }

  /** Local point -> world (writes into o). */
  static at(F, lx, ly, lz, o) { o.x = F.x + F.lx * lx + F.fx * lz; o.y = F.y + ly; o.z = F.z + F.lz * lx + F.fz * lz; return o; }

  /** Quad from 4 WORLD points (CCW seen from outside), flat normal, uvs per corner. */
  quadW(p0, p1, p2, p3, u0, v0, u1, v1, u2, v2, u3, v3) {
    let ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z, bx = p3.x - p0.x, by = p3.y - p0.y, bz = p3.z - p0.z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    // for degenerate first edge use the other diagonal
    let l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) { ax = p2.x - p0.x; ay = p2.y - p0.y; az = p2.z - p0.z; nx = ay * bz - az * by; ny = az * bx - ax * bz; nz = ax * by - ay * bx; l = Math.hypot(nx, ny, nz) || 1; }
    nx /= l; ny /= l; nz /= l;
    const a = this.vert(p0.x, p0.y, p0.z, nx, ny, nz, u0, v0), b = this.vert(p1.x, p1.y, p1.z, nx, ny, nz, u1, v1);
    const c = this.vert(p2.x, p2.y, p2.z, nx, ny, nz, u2, v2), d = this.vert(p3.x, p3.y, p3.z, nx, ny, nz, u3, v3);
    this.quadIdx(a, b, c, d);
  }
  triW(p0, p1, p2, u0, v0, u1, v1, u2, v2) {
    const ax = p1.x - p0.x, ay = p1.y - p0.y, az = p1.z - p0.z, bx = p2.x - p0.x, by = p2.y - p0.y, bz = p2.z - p0.z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.tri(this.vert(p0.x, p0.y, p0.z, nx, ny, nz, u0, v0), this.vert(p1.x, p1.y, p1.z, nx, ny, nz, u1, v1), this.vert(p2.x, p2.y, p2.z, nx, ny, nz, u2, v2));
  }

  /**
   * Axis-aligned (in frame F) box x0..x1, y0..y1, z0..z1. Wall uvs: u = metres along the wall (+ uo, continuous around the
   * perimeter starting at the front-left corner), v = y - vBase. Top uv = local xz. o.skip: string of faces to skip ('f','b','l','r','t','d').
   * o.topY: [yFL, yFR, yBR, yBL] optional per-corner top heights (slanted / broken tops).
   */
  box(F, x0, x1, y0, y1, z0, z1, o = {}) {
    const vb = o.vBase ?? y0, skip = o.skip || '', uo = o.uo || 0;
    const tY = o.topY || [y1, y1, y1, y1];
    const W = x1 - x0, D = z1 - z0;
    const P = _P;
    // corners: FL (x0,z1) FR (x1,z1) BR (x1,z0) BL (x0,z0) seen from the front (+z is front)
    const c = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    const ul = [0, W, W + D, 2 * W + D, 2 * (W + D)];
    // walls in order front (FL->FR), right (FR->BR), back (BR->BL), left (BL->FL); outward normals => CCW from outside
    const names = 'frbl';
    for (let k = 0; k < 4; k++) {
      if (skip.includes(names[k])) continue;
      const a = c[k], b = c[(k + 1) % 4], ya = tY[k], yb = tY[(k + 1) % 4];
      MB.at(F, a[0], y0, a[1], P[0]); MB.at(F, b[0], y0, b[1], P[1]); MB.at(F, b[0], yb, b[1], P[2]); MB.at(F, a[0], ya, a[1], P[3]);
      const u0 = ul[k] + uo, u1 = ul[k + 1] + uo;
      // the front wall faces +z: its left corner (seen from outside, looking at -z) is FL = x0 ... counter-clockwise from outside means a->b->top
      this.quadW(P[0], P[1], P[2], P[3], u0, y0 - vb, u1, y0 - vb, u1, yb - vb, u0, ya - vb);
    }
    if (!skip.includes('t')) {
      MB.at(F, x0, tY[0], z1, P[0]); MB.at(F, x1, tY[1], z1, P[1]); MB.at(F, x1, tY[2], z0, P[2]); MB.at(F, x0, tY[3], z0, P[3]);
      this.quadW(P[0], P[1], P[2], P[3], x0, z1, x1, z1, x1, z0, x0, z0);
    }
    if (skip.includes('d') === false && o.bottom) {
      MB.at(F, x0, y0, z0, P[0]); MB.at(F, x1, y0, z0, P[1]); MB.at(F, x1, y0, z1, P[2]); MB.at(F, x0, y0, z1, P[3]);
      this.quadW(P[0], P[1], P[2], P[3], x0, z0, x1, z0, x1, z1, x0, z1);
    }
  }

  /** Vertical cylinder / cone (local centre cx, cz; radii r0 at y0, r1 at y1), n sides, optional cap. u = arc length. */
  cyl(F, cx, cz, y0, y1, r0, r1, n = 8, cap = true, vBase = y0) {
    const P = _P, circ = 2 * Math.PI * r0;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      const s0 = Math.sin(a0), c0 = Math.cos(a0), s1 = Math.sin(a1), c1 = Math.cos(a1);
      MB.at(F, cx + s0 * r0, y0, cz + c0 * r0, P[0]); MB.at(F, cx + s1 * r0, y0, cz + c1 * r0, P[1]);
      MB.at(F, cx + s1 * r1, y1, cz + c1 * r1, P[2]); MB.at(F, cx + s0 * r1, y1, cz + c0 * r1, P[3]);
      this.quadW(P[0], P[1], P[2], P[3], circ * k / n, y0 - vBase, circ * (k + 1) / n, y0 - vBase, circ * (k + 1) / n, y1 - vBase, circ * k / n, y1 - vBase);
    }
    if (cap && r1 > 0.01) {
      MB.at(F, cx, y1, cz, P[4]);
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
        MB.at(F, cx + Math.sin(a0) * r1, y1, cz + Math.cos(a0) * r1, P[0]); MB.at(F, cx + Math.sin(a1) * r1, y1, cz + Math.cos(a1) * r1, P[1]);
        this.triW(P[0], P[1], P[4], 0, 0, 1, 0, 0.5, 1);
      }
    }
  }

  /** Beam (box) between two LOCAL points with a w x h section (h along the "up-ish" axis). */
  beam(F, ax, ay, az, bx, by, bz, w, h) {
    const A = MB.at(F, ax, ay, az, _Q[0]), B = MB.at(F, bx, by, bz, _Q[1]);
    let dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z; const L = Math.hypot(dx, dy, dz) || 1; dx /= L; dy /= L; dz /= L;
    // side s = (dz, 0, -dx) (horizontal), u = d x s (up for a horizontal beam): every face ends up CCW from outside
    let sx = dz, sy = 0, sz = -dx; let sl = Math.hypot(sx, sz); if (sl < 1e-4) { sx = 1; sz = 0; sl = 1; } sx /= sl; sz /= sl;
    const ux = dy * sz - dz * sy, uy = dz * sx - dx * sz, uz = dx * sy - dy * sx;
    const hw = w / 2, hh = h / 2, P = _P;
    const corner = (p, i, j, o) => { o.x = p.x + sx * hw * i + ux * hh * j; o.y = p.y + sy * hw * i + uy * hh * j; o.z = p.z + sz * hw * i + uz * hh * j; return o; };
    const sides = [[1, 1, -1, 1], [-1, 1, -1, -1], [-1, -1, 1, -1], [1, -1, 1, 1]];
    for (const [i0, j0, i1, j1] of sides) {
      corner(A, i0, j0, P[0]); corner(B, i0, j0, P[1]); corner(B, i1, j1, P[2]); corner(A, i1, j1, P[3]);
      this.quadW(P[3], P[2], P[1], P[0], 0, 0, L, 0, L, 1, 0, 1);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.P.view().slice(), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.N.view().slice(), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.U.view().slice(), 2));
    g.setAttribute('color', new THREE.BufferAttribute(this.C.view().slice(), 3));
    if (this.fac) { g.setAttribute('aFac', new THREE.BufferAttribute(this.A.view().slice(), 4)); g.setAttribute('aFac2', new THREE.BufferAttribute(this.B.view().slice(), 4)); }
    const nv = this.count, idx = this.I.view();
    g.setIndex(new THREE.BufferAttribute(nv < 65535 ? Uint16Array.from(idx) : idx.slice(), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

const _P = [0, 1, 2, 3, 4].map(() => ({ x: 0, y: 0, z: 0 }));
const _Q = [0, 1].map(() => ({ x: 0, y: 0, z: 0 }));
