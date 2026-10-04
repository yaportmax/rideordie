// Exact road projection for the simulation's repeated wheel/contact queries.
// Generated roads advance monotonically in Z. Search outward from the segment
// at the query's Z and stop only when the distance bound cannot beat the result.
// Unusual/non-monotonic roads retain the full reference search.
import { BLOCK, DS } from '../world/road.js';
import { projectDrivingRoute } from '../world/driving_plan.js';

export class RoadQuery {
  constructor(road) { this.road = road; this.checked = 0; this.monotonic = true; }

  /** Route-aware cars keep this query's accepted accelerated main projection. */
  projectDriving(x, z, hint = 0, window = 90, out = {}) {
    return projectDrivingRoute(this.road, this.road.ensureDrivingBranches(), x, z, hint, window, out, this, this._drivingScratch || (this._drivingScratch = {}));
  }

  nearest(x, z, hint = 0, window = 90, out = {}) {
    const road = this.road;
    // Analytic pre-start segments have signed indices; do not feed them to
    // the positive typed arrays or unsigned binary-search midpoint below.
    if (hint - window < 0) return road.nearest(x, z, hint, window, out);
    road.extendTo(hint + window + BLOCK);
    for (let i = this.checked; i < road.n - 1; i++) if (!(road.z[i + 1] > road.z[i])) this.monotonic = false;
    this.checked = road.n - 1;
    if (!this.monotonic) return road.nearest(x, z, hint, window, out);
    const i0 = Math.max(0, Math.floor((hint - window) / DS)), i1 = Math.min(road.n - 2, Math.ceil((hint + window) / DS));
    if (i0 > i1) { out.s = hint; out.d = 0; out.dist = 1e9; return out; }
    let lo = i0, hi = i1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (road.z[mid + 1] < z) lo = mid + 1; else hi = mid; }
    let left = lo, right = lo + 1, best = 1e18, bi = i0, bt = 0, px = 0, pz = 0;
    while (left >= i0 || right <= i1) {
      let i;
      if (left >= i0) { i = left--; }
      else { i = right++; }
      const ax = road.x[i], az = road.z[i], bx = road.x[i + 1], bz = road.z[i + 1];
      const zd = z < az ? az - z : z > bz ? z - bz : 0;
      // All further segments on this side are farther in Z. Do not terminate
      // the other side, which may still contain a better projection.
      if (zd * zd > best) { if (i < lo) left = i0 - 1; else right = i1 + 1; continue; }
      const minX = ax < bx ? ax : bx, maxX = ax > bx ? ax : bx;
      const xd = x < minX ? minX - x : x > maxX ? x - maxX : 0;
      if (xd * xd + zd * zd > best) continue;
      const dx = bx - ax, dz = bz - az, lengthSq = dx * dx + dz * dz;
      let t = ((x - ax) * dx + (z - az) * dz) / lengthSq; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const sx = ax + dx * t, sz = az + dz * t;
      const dd = (x - sx) * (x - sx) + (z - sz) * (z - sz);
      if (dd < best || (dd === best && i < bi)) { best = dd; bi = i; bt = t; px = sx; pz = sz; }
    }
    const th = road.th[bi] + (road.th[bi + 1] - road.th[bi]) * bt;
    out.s = (bi + bt) * DS; out.d = (x - px) * Math.cos(th) - (z - pz) * Math.sin(th); out.dist = Math.sqrt(best);
    return out;
  }
}
