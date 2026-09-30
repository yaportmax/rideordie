// Composition fields for natural scatter: where things grow and where the ground stays bare. Everything is a pure function of world
// position (+ the chunk's ground grid and the anchors already placed in it), so placement stays deterministic.
//  - patch(x, z): large groves vs open ground (150 m + 52 m noise) -> negative space (empty dune fields, bare flats) between vignettes
//  - hollow: height of the surroundings above the point (m): > 0 in washes / dips (vegetation, pebbles), < 0 on crests (rocks)
//  - anchors: rocks / boulders / cacti already placed in the chunk; shrubs and grass gather at their feet
import { vnoise2, smoothstep } from '../../core/util.js';

const _a = {}, _b = {}, _c = {}, _d = {};

/** 0..1 patchiness; different `salt` values give independent fields (vegetation vs rock outcrops). */
export function patch(seed, x, z, salt = 0) {
  return vnoise2(x / 150, z / 150, seed + 911 + salt) * 0.62 + vnoise2(x / 52, z / 52, seed + 912 + salt) * 0.38;
}

/** Mean height of the ground 9 m around (s, d) minus the height at (s, d). Positive in hollows. */
export function hollow(chunk, s, d, gy) {
  const G = chunk.ground, s0 = chunk.s0, s1 = s0 + 96;
  const a = G.sample(s, d + 9, _a).y, b = G.sample(s, d - 9, _b).y;
  const c = G.sample(Math.min(s1, s + 9), d, _c).y, e = G.sample(Math.max(s0, s - 9), d, _d).y;
  return (a + b + c + e) * 0.25 - gy;
}

/** 0..1 closeness to the nearest anchor (1 at its foot, ~0 two radii + 3 m away). */
export function anchorNear(chunk, x, z) {
  const A = chunk.anchors; if (!A || !A.length) return 0;
  let best = 0;
  for (let i = 0; i < A.length; i += 3) {
    const dx = x - A[i], dz = z - A[i + 1], r = A[i + 2] + 3, q = (dx * dx + dz * dz) / (r * r);
    if (q < 4) { const v = Math.exp(-q * 1.2); if (v > best) best = v; }
  }
  return best;
}
export function addAnchor(chunk, x, z, r) { (chunk.anchors || (chunk.anchors = [])).push(x, z, r); }

export const VEG_MAX = 2.2;
/** Vegetation factor 0..VEG_MAX: groves (patch), washes (hollow) and anchor feet; open ground stays nearly bare. */
export function vegFactor(seed, chunk, s, d, g, open = 0.08) {
  const P = patch(seed, g.x, g.z), H = hollow(chunk, s, d, g.y), A = anchorNear(chunk, g.x, g.z);
  const v = (open + 1.25 * smoothstep(0.44, 0.64, P)) * (0.55 + 0.9 * smoothstep(-0.15, 0.7, H)) + 1.6 * A;
  return v > VEG_MAX ? VEG_MAX : v;
}
/** Rock-outcrop factor 0..~1.3 for group centres: its own patch field, favouring crests and slopes over hollows. */
export function rockFactor(seed, chunk, s, d, g) {
  const P = patch(seed, g.x, g.z, 57), H = hollow(chunk, s, d, g.y);
  return (0.15 + 1.0 * smoothstep(0.34, 0.56, P)) * (0.75 + 0.55 * smoothstep(0.1, -0.7, H));
}
