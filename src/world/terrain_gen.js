// Terrain strip generation (pure functions; runs in a Web Worker or in Node).
// The world around the road is parameterised by (s, d): s = distance along the road, d = lateral offset (left +).
// Terrain height = road elevation + biome profile(s, d). Chunks are CHUNK_LEN long along s and span both sides.
import { BIOMES, biomeAt, HALF_ROAD, SHOULDER } from '../data/biomes.js';
import { clamp, clamp01, lerp, smoothstep, fbm2, fbm1, ridged2, vnoise2, hash2 } from '../core/util.js';
import { DS } from './road.js';

export const CHUNK_LEN = 96;
export const EDGE = HALF_ROAD + SHOULDER;             // 9.5 m: road strip / terrain seam
export const LAYERS = ['sand', 'dirt_red', 'gravel', 'dry_grass', 'rock_red', 'rock_grey', 'snow', 'forest_floor', 'grass_green', 'concrete', 'cliff', 'concrete_cracked'];
const L = Object.fromEntries(LAYERS.map((n, i) => [n, i]));

/** Lateral columns for the terrain strip (offsets beyond EDGE, one side). */
export const COLS = [0, 1.0, 2.0, 3.2, 4.6, 6.2, 8.0, 10, 12.5, 15.5, 19, 23, 27.5, 32, 37, 42.5, 48.5, 55, 62, 70, 79, 89, 100, 113, 128, 145, 165, 194, 231, 275, 327, 388, 460, 545, 645, 765, 900];
// (20-170 m: ~6-17 m spacing so canyon / mountain / valley walls carry their gullies, ribs and ledges instead of reading as flat slabs)
/** Road strip lateral columns (from -EDGE..EDGE). */
export const ROAD_COLS = [-EDGE, -HALF_ROAD, -5.25, -3.5, -1.75, 0, 1.75, 3.5, 5.25, HALF_ROAD, EDGE];
export const LOD_STRIDE = [1, 2, 4]; // row stride per LOD (rows are DS = 3 m apart at LOD0)
/** Ground textures are addressed with world xz wrapped by this period (every tile size / noise scale in the shaders divides it): keeps
 *  texture coordinates small (fp32 precision) at 60 km without seams. Road strip uv.y (distance) wraps with ROAD_WRAP (= 8 chunks). */
export const TEX_WRAP = 720;
export const ROAD_WRAP = 768;
const wrapOff = (v) => v - TEX_WRAP * Math.floor(v / TEX_WRAP);

const NB = { desert: 0, canyon: 1, coast: 2, mountain: 3, city: 4, dam: 5 };
/** Biome weight of `id` in a biomeAt() result. */
const bw = (bio, id) => (bio.a === id ? 1 - bio.w : 0) + (bio.b === id ? bio.w : 0);

// ------------------------------------------------------------------------------------------------ profile
/** Terrain offset above the road-edge plane for one biome. a = distance beyond the shoulder edge (>=0), side = +1 left / -1 right. */
function profile(id, seed, s, a, side, sm) {
  const T = BIOMES[id].terrain;
  const ramp = smoothstep(0, 6, a); // continuity with the road edge
  // far ridges: peaks and saddles (two scales) that crest 550-750 m out and fall away toward the 900 m edge, so the skyline is a
  // ragged ridgeline instead of the straight cut of the terrain boundary
  const farW = smoothstep(160, 600, a) * (1 - 0.7 * smoothstep(660, 900, a));
  const far = T.far * farW * (0.72 * ridged2(s / 700 + side * 3.1, a / 650 + 1.7, 4, seed + 101) + 0.45 * ridged2(s / 160 + side * 1.3, a / 140, 3, seed + 102));
  let h = 0;
  switch (T.kind) {
    case 'dunes': {
      const n = fbm2(s / 95, (a + side * 300) / 70, 4, seed + 11) * 2 - 1;
      const n2 = fbm2(s / 40, (a + side * 300) / 30, 3, seed + 12) * 2 - 1;
      h = (T.amp * n + 0.9 * n2) * smoothstep(0, T.flat + 30, a) + T.amp * 0.15 * n2;
      // occasional mesas / rock outcrops
      const mesa = smoothstep(0.66, 0.8, fbm2(s / 380 + 9 * side, a / 300, 3, seed + 13)) * smoothstep(60, 140, a);
      h += mesa * (26 + 40 * fbm2(s / 90, a / 90, 2, seed + 14));
      break;
    }
    case 'canyon': {
      const wallH = T.wall * (0.55 + 0.9 * fbm1(s / 650 + side * 7, 3, seed + 21));
      // floor width beside the road; buttresses and gullies move the wall foot in and out every ~40 m
      const gap = Math.max(5, 5 + 34 * Math.pow(fbm1(s / 420 + 3 + side * 5, 3, seed + 22), 1.6) + (ridged2(s / 38 + side * 7, 0.3, 2, seed + 27) - 0.5) * 12);
      const t = smoothstep(gap, gap + 14 + 8 * fbm1(s / 60, 2, seed + 23), a);
      const rough = 0.75 + 0.25 * ridged2(s / 55, a / 38, 3, seed + 24);
      let v = t * t * wallH * rough;
      const terr = 7.5;
      const st = v / terr, fl = Math.floor(st), fr = st - fl;
      const stepped = (fl + smoothstep(0.0, 0.3, fr)) * terr; // ledges
      v = lerp(v, stepped, 0.55 * smoothstep(3, 20, v));
      const floorN = (fbm2(s / 60, a / 45, 3, seed + 25) * 2 - 1) * T.amp * 0.5 * smoothstep(0, 30, a) * (1 - t);
      const top = smoothstep(gap + 30, gap + 120, a) * 9 * (fbm2(s / 110, a / 110, 3, seed + 26) * 2 - 1);
      h = v + floorN + top;
      break;
    }
    case 'coast': {
      const isSea = side === T.seaSide;
      if (isSea) {
        const edge = 5 + 9 * fbm1(s / 70, 2, seed + 31);
        const drop = smoothstep(edge, edge + 7 + 4 * fbm1(s / 30, 2, seed + 32), a);
        h = -T.cliff * drop - smoothstep(70, 320, a) * 26 + (fbm2(s / 25, a / 20, 3, seed + 33) - 0.5) * 3 * (1 - drop);
        h += (fbm2(s / 30, a / 26, 3, seed + 34) * 2 - 1) * 2.2 * drop;
        // small rocky shelf near the shoreline
      } else {
        const n = fbm2(s / 160, a / 120, 4, seed + 35) * 2 - 1;
        h = (T.amp * n + 5) * smoothstep(0, 35, a) + 46 * smoothstep(40, 260, a) * (0.4 + 0.6 * fbm2(s / 240, a / 200, 3, seed + 36));
      }
      break;
    }
    case 'lake': {
      const isSea = side === T.seaSide;
      if (isSea) {
        const edge = 6 + 8 * fbm1(s / 90, 2, seed + 41);
        const drop = smoothstep(edge, edge + 10, a);
        h = -T.cliff * drop - smoothstep(60, 380, a) * 10;
      } else {
        // valley wall: buttresses and gullies move the foot in and out, ledges break the face into terraces
        const gul = (ridged2(s / 42, 0.37, 3, seed + 44) - 0.55) * 12 + (fbm1(s / 15, 2, seed + 45) - 0.5) * 4;
        const t = smoothstep(9 + Math.max(0, gul) * 0.4, 52 + gul * 1.6, a);
        let v = t * t * 70 * (0.7 + 0.3 * ridged2(s / 80, a / 50, 3, seed + 42));
        v *= 0.7 + 0.3 * ridged2(s / 60 + 3, a / 400, 3, seed + 47);          // spurs / couloirs
        const st = v / 8.5, fl = Math.floor(st), fr = st - fl;
        v = lerp(v, (fl + smoothstep(0.0, 0.35, fr)) * 8.5, 0.45 * smoothstep(4, 18, v));
        v += (ridged2(s / 24, a / 20, 2, seed + 46) - 0.5) * 5 * smoothstep(14, 30, a);
        h = v + (fbm2(s / 70, a / 60, 3, seed + 43) - 0.5) * 6 * (1 - t);
      }
      break;
    }
    case 'mountain': {
      const side01 = fbm1(s / 1400 + 2.2, 2, seed + 51);
      const up = side * (side01 > 0.5 ? 1 : -1) > 0; // this side is the uphill side
      const massH = T.mass * (up ? 1 : 0.35) * (0.5 + ridged2(s / 520 + side * 4, a / 300, 4, seed + 52));
      // buttresses: the foot of the slope moves in and out along the road
      const foot = up ? (fbm1(s / 110 + side * 3, 3, seed + 57) - 0.5) * 36 + (ridged2(s / 34, 0.4, 2, seed + 58) - 0.5) * 16 : 0;
      // the run of the slope grows with its height (no 250 m sheer walls: ~40-55 deg mountainsides)
      const run = up ? 70 + massH * 0.75 : 110;
      const slope = smoothstep(4 + Math.max(0, foot) * 0.4, run + foot, a);
      const detail = (fbm2(s / 45, a / 40, 4, seed + 53) * 2 - 1) * T.amp * smoothstep(0, 30, a);
      // crags, ribs and gullies running up the big slopes (far enough from the road that the drivable verge is unchanged)
      const crag = ((ridged2(s / 55, a / 38, 3, seed + 55) - 0.5) * 22 + (ridged2(s / 21, a / 70, 2, seed + 56) - 0.5) * 16
        + (ridged2(s / 28, a / 260, 2, seed + 59) - 0.55) * 34) * smoothstep(22, 80, a) * (up ? 1 : 0.4);
      let mv = massH * slope * slope * 0.9;
      if (up) {
        // spurs and couloirs: V-shaped gullies notch the face and the skyline, deeper higher up (ribs keep their full height)
        const rib = ridged2(s / 85 + side * 5, a / 520, 3, seed + 62), rib2 = ridged2(s / 33 + 7, a / 300, 2, seed + 63);
        mv *= 0.62 + 0.3 * rib + 0.08 * rib2;
        // benches: the face breaks into ledges (forest / snow collect on them)
        const terr = 16 + 8 * fbm1(s / 240, 2, seed + 60), st = mv / terr, fl = Math.floor(st), fr = st - fl;
        mv = lerp(mv, (fl + smoothstep(0.1, 0.55, fr)) * terr, 0.4 * smoothstep(10, 40, mv));
      }
      h = mv + detail + crag;
      if (!up) h -= 55 * smoothstep(6, 55, a) * (0.6 + 0.4 * fbm1(s / 300, 2, seed + 54)); // valley side drops away
      break;
    }
    case 'plain':
    default: {
      const n = fbm2(s / 180, (a + side * 200) / 150, 3, seed + 61) * 2 - 1;
      h = T.amp * n * smoothstep(0, 60, a) + (fbm2(s / 20, a / 20, 2, seed + 62) - 0.5) * 0.8;
      break;
    }
  }
  return h * ramp + far;
}

/** Terrain offset blended between the two biomes active at s. */
function biomeProfile(seed, s, a, side, sm, bio) {
  if (bio.w <= 0.001) return profile(bio.a, seed, s, a, side, sm);
  if (bio.w >= 0.999) return profile(bio.b, seed, s, a, side, sm);
  return lerp(profile(bio.a, seed, s, a, side, sm), profile(bio.b, seed, s, a, side, sm), bio.w);
}

/** Tunnels: raise a hill over the road so the tube sits inside the mountain. */
function tunnelRaise(road, s, a, list) {
  let h = 0;
  for (const f of list || road.features) {
    if (f.type !== 'tunnel' || s < f.s0 - 40 || s > f.s1 + 40) continue;
    const ws = smoothstep(f.s0 - 30, f.s0 + 5, s) * (1 - smoothstep(f.s1 - 5, f.s1 + 30, s));
    h = Math.max(h, ws * 22 * (1 - smoothstep(10, 70, a)) + ws * 6);
  }
  return h;
}

/** Bridge dips: a ravine under the span. */
function featureDip(road, s, a, list) {
  let dip = 0;
  for (const f of list || road.features) {
    if (f.type !== 'bridge' || s < f.s0 - 60 || s > f.s1 + 60) continue;
    const ws = smoothstep(f.s0 - 40, f.s0 + 10, s) * (1 - smoothstep(f.s1 - 10, f.s1 + 40, s));
    const wl = 1 - smoothstep(20, 70 + f.depth, a);
    dip = Math.max(dip, ws * wl * f.depth);
  }
  return dip;
}

const _sm = {}, _smC = {};
/** Layer shown on cut faces (chunk end caps, outer curtains). */
function capRock(bio) { const id = bio.w > 0.5 ? bio.b : bio.a; return id === 'desert' || id === 'canyon' ? L.rock_red : id === 'mountain' || id === 'city' ? L.rock_grey : L.cliff; }
const FOLD_MAX = 0.85, SQUEEZE_U0 = 0.62;
// ------------------------------------------------------------------------------------------------ lateral limits
// Each road section owns the ground up to the Voronoi boundary with any OTHER section of the road (a bend, a hairpin, the road coming back
// round a hill), and never beyond its own curvature radius (rows of constant s would fold over). Without this the 900 m terrain strips of
// different sections overlap in plan and show floating slabs / cliffs over the void from any raised camera. Up to 62 % of the limit
// nothing changes (the road side is untouched); beyond it the columns are squeezed smoothly into the limit, and near a Voronoi boundary the
// height blends into the average of both sections' terrain, so the two strips meet in one continuous surface.
const LIM_WIN = 3000, LIM_STEP = 4;                               // search +-3 km of road, every 4th sample (12 m)
const _lim = new Map();
let _limRoad = null;
/**
 * {dmax (lateral distance from the centreline where this row's ground ends), jB (road sample index of the section on the other side, -1 =
 * none)}. A point o + n*D on the row's normal stays closer to o than to a road sample q (|s' - s| > 24 m) while D < |q-o|^2 / (2 n.(q-o)):
 * the minimum over all samples is the Voronoi boundary with other sections of the road, and on the inside of a bend it equals the
 * curvature radius (the neighbouring rows of the arc), i.e. where rows of constant s would start to fold over.
 */
function rowLimit(road, s, side) {
  if (_limRoad !== road) { _limRoad = road; _lim.clear(); }
  const key = Math.round(s * 4) * 2 + (side > 0 ? 1 : 0);
  let L = _lim.get(key);
  if (L) return L;
  road.extendTo(s + LIM_WIN + 100);
  const sm = road.sample(s, _smL), i0 = Math.round(s / DS);
  const ox = sm.x, oz = sm.z, nx = sm.nx * side, nz = sm.nz * side;
  const excl = Math.ceil(24 / DS), lo = Math.max(0, i0 - LIM_WIN / DS), hi = Math.min(road.n - 1, i0 + LIM_WIN / DS);
  let best = 1e9, bj = -1;
  for (let j = lo; j <= hi; j += LIM_STEP) {
    if (j > i0 - excl && j < i0 + excl) { j = i0 + excl - LIM_STEP; continue; }
    const qx = road.x[j] - ox, qz = road.z[j] - oz, dn = qx * nx + qz * nz;
    if (dn <= 0) continue;
    const D = (qx * qx + qz * qz) / (2 * dn);
    if (D < best) { best = D; bj = j; }
  }
  L = best < EDGE + 920 ? { dmax: Math.max(EDGE + 12, best), jB: bj } : { dmax: 1e9, jB: -1 };
  if (_lim.size > 40000) _lim.clear();
  _lim.set(key, L);
  return L;
}
const _smL = {}, _nB = {}, _smB = {};

/** Terrain height of the section at (s, d) without lateral limits (used for the other side of a Voronoi seam). */
function rawHeight(road, seed, s, d) {
  const sm = road.sample(s, _smB), side = d >= 0 ? 1 : -1, a = Math.max(0, Math.abs(d) - EDGE);
  const yPlane = road.surfaceY(sm, side * EDGE) - side * a * Math.tan(sm.bank) * (1 - smoothstep(0, 30, a));
  return yPlane + biomeProfile(seed, s, a, side, sm, biomeAt(s));
}

/** World position of terrain at (s, d). Writes into out {x,y,z}. d beyond +-EDGE. */
export function terrainPoint(road, seed, s, d, out, bridges, tunnels) {
  const sm = road.sample(s, _sm);
  const side = d >= 0 ? 1 : -1;
  const ad0 = Math.abs(d);
  // lateral limit: own curvature radius (inside of a bend) and the Voronoi boundary with other sections of the road
  const L = ad0 > EDGE + 20 ? rowLimit(road, s, side) : null;
  const kin = sm.k * side;                                        // > 0: this side is the inside of the bend
  const dFold = kin > 1e-5 ? FOLD_MAX / kin : 1e9;
  const dLim = Math.min(dFold, L ? L.dmax : 1e9);
  let ad = ad0;
  const u0 = EDGE + (dLim - EDGE) * SQUEEZE_U0;
  if (ad0 > u0) ad = u0 + (dLim - u0) * (1 - Math.exp(-(ad0 - u0) / (dLim - u0)));
  const dd = side * ad;
  const a = ad - EDGE;
  const bio = biomeAt(s);
  // road-plane height at the seam, banked plane fading outward
  const yEdge = road.surfaceY(sm, side * EDGE);
  const bankFade = 1 - smoothstep(0, 30, a);
  const yPlane = yEdge - side * a * Math.tan(sm.bank) * bankFade;
  let off = biomeProfile(seed, s, Math.max(a, 0), side, sm, bio);
  off -= featureDip(road, s, a, bridges);
  off += tunnelRaise(road, s, a, tunnels);
  out.x = sm.x + sm.nx * dd; out.z = sm.z + sm.nz * dd; out.y = yPlane + off;
  // Voronoi seam: blend into the mean of both sections' terrain (both sides compute the same mean at the boundary)
  if (L && L.jB >= 0 && L.dmax <= dFold) {
    const w = smoothstep(EDGE + (L.dmax - EDGE) * 0.45, L.dmax, ad);
    if (w > 0) {
      const nb = road.nearest(out.x, out.z, L.jB * DS, 160, _nB);
      if (Math.abs(nb.d) > EDGE + 1) { const yB = rawHeight(road, seed, nb.s, nb.d); out.y += w * 0.5 * (yB - out.y); off = out.y - yPlane; }
    }
  }
  out.s = s; out.a = a; out.side = side; out.off = off; out.bio = bio;
  return out;
}

// ------------------------------------------------------------------------------------------------ splat
function splatWeights(w, bioId, seed, s, a, side, slope, wy, wx, wz, seaY) {
  // returns weights for the layers of one biome (written into w, unnormalised)
  const n1 = fbm2(wx / 60, wz / 60, 3, seed + 201), n2 = fbm2(wx / 17 + 5, wz / 17, 2, seed + 202);
  const shoulder = 1 - smoothstep(0, 5, a);
  const steep = smoothstep(0.42, 0.72, slope);
  const vsteep = smoothstep(0.7, 0.95, slope);
  switch (bioId) {
    case 'desert': {
      const dirt = smoothstep(0.5, 0.7, n1) * (1 - steep), grass = smoothstep(0.62, 0.8, n2 * 0.6 + n1 * 0.6) * (1 - steep);
      w[L.sand] += (1 - steep) * (1 - dirt) * (1 - grass) * (1 - shoulder * 0.6);
      w[L.dirt_red] += dirt * 0.9 + steep * 0.4; w[L.dry_grass] += grass * 0.7;
      w[L.gravel] += shoulder * 0.8; w[L.rock_red] += steep * (1 - vsteep) * 0.9; w[L.cliff] += vsteep;
      break;
    }
    case 'canyon': {
      w[L.dirt_red] += (1 - steep) * (0.7 + 0.3 * n1); w[L.sand] += (1 - steep) * smoothstep(0.55, 0.75, n1) * 0.6;
      w[L.rock_red] += steep * (1 - vsteep); w[L.cliff] += vsteep; w[L.gravel] += shoulder * 0.9;
      break;
    }
    case 'coast': {
      const nearSea = 1 - smoothstep(seaY + 1, seaY + 9, wy);
      w[L.grass_green] += (1 - steep) * (1 - nearSea) * (0.6 + 0.4 * n1); w[L.rock_grey] += steep + nearSea * 0.4 * (1 - steep);
      w[L.sand] += nearSea * (1 - steep) * 0.7; w[L.gravel] += shoulder * 0.8; w[L.cliff] += vsteep; w[L.dry_grass] += (1 - steep) * smoothstep(0.55, 0.75, n2) * 0.5;
      break;
    }
    case 'mountain': {
      const snow = smoothstep(0.0, 25, wy - (BIOMES.mountain.terrain.snowLine + 40 * (n1 - 0.5))) * (1 - vsteep);
      w[L.snow] += snow; w[L.forest_floor] += (1 - snow) * (1 - steep) * (0.7 + 0.3 * n2); w[L.rock_grey] += steep * (1 - snow) * (1 - vsteep);
      w[L.cliff] += vsteep * (1 - snow * 0.6); w[L.gravel] += shoulder * 0.8;
      break;
    }
    case 'city': {
      const cr = smoothstep(0.45, 0.7, n1 + 0.3 * n2);
      w[L.concrete] += (1 - cr) * (1 - steep) * 0.7; w[L.concrete_cracked] += cr * (1 - steep); w[L.dirt_red] += smoothstep(0.55, 0.75, n2) * 0.35 * (1 - steep);
      w[L.gravel] += shoulder * 0.7 + (1 - steep) * smoothstep(0.4, 0.7, n2) * 0.45; w[L.rock_grey] += steep; w[L.dry_grass] += smoothstep(0.62, 0.8, n1) * 0.4 * (1 - steep);
      break;
    }
    case 'dam':
    default: {
      w[L.gravel] += (1 - steep) * (0.35 + 0.3 * n1) + shoulder * 0.8; w[L.dry_grass] += (1 - steep) * smoothstep(0.45, 0.7, n2) * 0.8;
      w[L.dirt_red] += (1 - steep) * smoothstep(0.55, 0.75, n1) * 0.25; w[L.rock_grey] += steep * 0.8 + 0.25 * (1 - steep) * n2;
      w[L.cliff] += vsteep;
      break;
    }
  }
}

/** Normalised splat weights (12 layers, written into w) of the terrain at a point: blends the two biomes active at s. */
export function splatAt(w, seed, s, a, side, slope, wx, wy, wz, seaY, bio) {
  w.fill(0);
  if (bio.w < 0.999) splatWeights(w, bio.a, seed, s, a, side, slope, wy, wx, wz, seaY);
  if (bio.w > 0.001) {
    if (bio.w < 0.999) { const wa = w.slice(); w.fill(0); splatWeights(w, bio.b, seed, s, a, side, slope, wy, wx, wz, seaY); for (let k = 0; k < 12; k++) w[k] = wa[k] * (1 - bio.w) + w[k] * bio.w; }
    else { w.fill(0); splatWeights(w, bio.b, seed, s, a, side, slope, wy, wx, wz, seaY); }
  }
  let sum = 0; for (let k = 0; k < 12; k++) sum += w[k];
  if (sum < 1e-4) { w[L.dirt_red] = 1; sum = 1; }
  for (let k = 0; k < 12; k++) w[k] /= sum;
  return w;
}

// ------------------------------------------------------------------------------------------------ chunk
/**
 * Generate render + collision data for one chunk.
 * @returns {{anchor:number[], positions:Float32Array, normals:Float32Array, splat:Float32Array[], macro:Float32Array, indices:Uint16Array|Uint32Array, colPositions?:Float32Array, colIndices?:Uint32Array, nx:number, rows:number}}
 */
export function genTerrainChunk(road, seed, chunk, lod) {
  const stride = LOD_STRIDE[lod];
  const s0 = chunk * CHUNK_LEN, s1 = s0 + CHUNK_LEN;
  road.extendTo(s1 + 200);
  const rowsN = CHUNK_LEN / (DS * stride) + 1;
  const anchorSm = road.sample(s0);
  const ax = anchorSm.x, ay = anchorSm.y, az = anchorSm.z;
  const nCol = COLS.length;
  const P = {}, Pa = {}, Pb = {}, Pc = {}, Pd = {};
  const bridges = road.features.filter((f) => f.type === 'bridge' && f.s1 > s0 - 300 && f.s0 < s1 + 300);
  const tunnels = road.features.filter((f) => f.type === 'tunnel' && f.s1 > s0 - 100 && f.s0 < s1 + 100);
  const sides = [1, -1];
  const caps = [];                               // deferred cap rims: {side, r, bottoms[], outward}
  // vertex layout per side: (rows) x (nCol) + skirt verts on the 3 open edges; we generate two independent grids.
  const vertsPerSide = rowsN * nCol;
  const skirtVerts = rowsN + rowsN + nCol * 2; // outer column skirt, first/last row skirts
  const capVerts = 2 * nCol;                     // per side: rim copies of the first/last rows for the end caps (appended after both sides)
  const totalV = 2 * (vertsPerSide + skirtVerts) + 2 * capVerts;
  const positions = new Float32Array(totalV * 3), normals = new Float32Array(totalV * 3), aux = new Float32Array(totalV * 4);
  const splat = [new Float32Array(totalV * 4), new Float32Array(totalV * 4), new Float32Array(totalV * 4)];
  const offX = wrapOff(ax), offZ = wrapOff(az);
  const idx = [];
  const w = new Float32Array(12);
  let vi = 0;
  const colPos = []; // lod0 only: collision positions (same grid without skirts), separate index list
  const colIdx = [];
  const collide = lod === 0;
  const seaY = (() => { // sea level for coast/lake: fixed world height under the road of that biome
    const bio = biomeAt((s0 + s1) / 2);
    return bio.a === 'coast' || bio.b === 'coast' ? seaLevel(road, 'coast') : bio.a === 'dam' ? seaLevel(road, 'dam') : -1e9;
  })();
  for (const side of sides) {
    const base = vi;
    const gridIndex = (r, c) => base + r * nCol + c;
    for (let r = 0; r < rowsN; r++) {
      const s = s0 + r * DS * stride;
      const dsN = DS * stride;
      for (let c = 0; c < nCol; c++) {
        const d = side * (EDGE + COLS[c]);
        terrainPoint(road, seed, s, d, P, bridges, tunnels);
        // analytic normal by central differences in (s,d)
        const dc = Math.max(0.6, (COLS[Math.min(nCol - 1, c + 1)] - COLS[Math.max(0, c - 1)]) * 0.5);
        terrainPoint(road, seed, s + dsN, d, Pa, bridges, tunnels); terrainPoint(road, seed, s - dsN, d, Pb, bridges, tunnels);
        terrainPoint(road, seed, s, d + side * dc, Pc, bridges, tunnels); terrainPoint(road, seed, s, d - side * (c === 0 ? 0 : dc), Pd, bridges, tunnels);
        const tsx = Pa.x - Pb.x, tsy = Pa.y - Pb.y, tsz = Pa.z - Pb.z; // along s
        const tdx = (Pc.x - Pd.x) * side, tdy = (Pc.y - Pd.y) * side, tdz = (Pc.z - Pd.z) * side; // toward outside (away from road)
        let nx = tsy * tdz - tsz * tdy, ny = tsz * tdx - tsx * tdz, nz = tsx * tdy - tsy * tdx;
        // choose upward
        if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
        const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
        const o = vi * 3;
        positions[o] = P.x - ax; positions[o + 1] = P.y - ay; positions[o + 2] = P.z - az;
        normals[o] = nx; normals[o + 1] = ny; normals[o + 2] = nz;
        // splat
        splatAt(w, seed, s, P.a, side, 1 - ny, P.x, P.y, P.z, seaY, P.bio);
        for (let k = 0; k < 12; k++) splat[(k / 4) | 0][vi * 4 + (k % 4)] = w[k];
        aux[vi * 4] = offX; aux[vi * 4 + 1] = offZ; aux[vi * 4 + 2] = bw(P.bio, 'desert') + bw(P.bio, 'canyon'); aux[vi * 4 + 3] = seaY > -1e8 ? seaY : -1e4;
        if (collide) colPos.push(P.x - ax, P.y - ay, P.z - az);
        vi++;
      }
    }
    // indices (grid)
    for (let r = 0; r < rowsN - 1; r++) for (let c = 0; c < nCol - 1; c++) {
      const a = gridIndex(r, c), b = gridIndex(r + 1, c), cc = gridIndex(r + 1, c + 1), dd = gridIndex(r, c + 1);
      if (side > 0) { idx.push(a, b, cc, a, cc, dd); } else { idx.push(a, cc, b, a, dd, cc); }
    }
    if (collide) {
      const cbase = side > 0 ? 0 : rowsN * nCol;
      for (let r = 0; r < rowsN - 1; r++) for (let c = 0; c < nCol - 1; c++) {
        const a = cbase + r * nCol + c, b = cbase + (r + 1) * nCol + c, cc = cbase + (r + 1) * nCol + c + 1, dd = cbase + r * nCol + c + 1;
        if (side > 0) colIdx.push(a, b, cc, a, cc, dd); else colIdx.push(a, cc, b, a, dd, cc);
      }
    }
    // skirts. First / last row: a solid END CAP down to a flat base 40 m under the lowest point of the row (rock-textured, facing out along
    // the road), so a chunk whose neighbour is not streamed in shows a cut-away cliff instead of an open slab over the void. When the
    // neighbour exists the cap is buried under the shared seam. Outer column: a 250 m curtain facing outward.
    const skirt = (r, c, y, onx, onz, rock) => {
      const src = gridIndex(r, c);
      positions[vi * 3] = positions[src * 3]; positions[vi * 3 + 1] = y; positions[vi * 3 + 2] = positions[src * 3 + 2];
      normals[vi * 3] = onx; normals[vi * 3 + 1] = 0; normals[vi * 3 + 2] = onz;
      for (let k = 0; k < 3; k++) splat[k].fill(0, vi * 4, vi * 4 + 4);
      splat[(rock / 4) | 0][vi * 4 + (rock % 4)] = 1;
      aux.copyWithin(vi * 4, src * 4, src * 4 + 4);
      return vi++;
    };
    const rowMin = (r) => { let m = 1e9; for (let c = 0; c < nCol; c++) m = Math.min(m, positions[gridIndex(r, c) * 3 + 1]); return m; };
    const smA = road.sample(s0), smB = road.sample(s1);
    const rockA = capRock(biomeAt(s0)), rockB = capRock(biomeAt(s1));
    const rowFirst = [], rowLast = [];
    const yA = rowMin(0) - 40, yB = rowMin(rowsN - 1) - 40;
    for (let c = 0; c < nCol; c++) rowFirst.push(skirt(0, c, yA, -smA.fx, -smA.fz, rockA));
    for (let c = 0; c < nCol; c++) rowLast.push(skirt(rowsN - 1, c, yB, smB.fx, smB.fz, rockB));
    caps.push({ side, r: 0, gridIndex, bottoms: rowFirst, onx: -smA.fx, onz: -smA.fz, rock: rockA, first: true });
    caps.push({ side, r: rowsN - 1, gridIndex, bottoms: rowLast, onx: smB.fx, onz: smB.fz, rock: rockB, first: false });
    // outer column
    const colSk = [];
    for (let r = 0; r < rowsN; r++) {
      const sm = road.sample(s0 + r * DS * stride, _smC), src = gridIndex(r, nCol - 1);
      colSk.push(skirt(r, nCol - 1, positions[src * 3 + 1] - 250, sm.nx * side, sm.nz * side, capRock(biomeAt(sm.s))));
    }
    for (let r = 0; r < rowsN - 1; r++) {
      const g0 = gridIndex(r, nCol - 1), g1 = gridIndex(r + 1, nCol - 1), k0 = colSk[r], k1 = colSk[r + 1];
      idx.push(g0, k0, k1, g0, k1, g1);
    }
    // inner edge (toward the road strip): seam vertices sit exactly on the road strip edge, no skirt needed
  }
  // end-cap rims: copies of the first / last rows with the cap's outward normal and rock splat (appended after both sides so the per-side
  // layout that ChunkGround.fromTerrainMesh reads stays unchanged)
  for (const cp of caps) {
    const top = [];
    for (let c = 0; c < nCol; c++) {
      const src = cp.gridIndex(cp.r, c);
      positions[vi * 3] = positions[src * 3]; positions[vi * 3 + 1] = positions[src * 3 + 1]; positions[vi * 3 + 2] = positions[src * 3 + 2];
      normals[vi * 3] = cp.onx; normals[vi * 3 + 1] = 0; normals[vi * 3 + 2] = cp.onz;
      for (let k = 0; k < 3; k++) splat[k].fill(0, vi * 4, vi * 4 + 4);
      splat[(cp.rock / 4) | 0][vi * 4 + (cp.rock % 4)] = 1;
      aux.copyWithin(vi * 4, src * 4, src * 4 + 4);
      top.push(vi++);
    }
    // winding: faces point along the outward normal (first row: backward, last row: forward), mirrored for the right-hand side
    const flip = (cp.side > 0) === cp.first;
    for (let c = 0; c < nCol - 1; c++) {
      const g0 = top[c], g1 = top[c + 1], k0 = cp.bottoms[c], k1 = cp.bottoms[c + 1];
      if (flip) idx.push(g0, k1, k0, g0, g1, k1); else idx.push(g0, k0, k1, g0, k1, g1);
    }
  }
  const res = {
    anchor: [ax, ay, az], positions: positions.subarray(0, vi * 3), normals: normals.subarray(0, vi * 3), aux: aux.subarray(0, vi * 4),
    splat: splat.map((a) => a.subarray(0, vi * 4)), indices: vi > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), nVerts: vi,
  };
  if (collide) { res.colPositions = new Float32Array(colPos); res.colIndices = new Uint32Array(colIdx); }
  return res;
}

// ------------------------------------------------------------------------------------------------ road strip
/** Road strip for one chunk (always fine rows). Returns render + collision arrays. Also lane-marking UV data. */
export function genRoadChunk(road, seed, chunk) {
  const s0 = chunk * CHUNK_LEN, s1 = s0 + CHUNK_LEN;
  road.extendTo(s1 + 200);
  const rows = CHUNK_LEN / DS + 1, cols = ROAD_COLS.length;
  const a = road.sample(s0);
  const ax = a.x, ay = a.y, az = a.z;
  const nv = rows * cols;
  const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
  // shading attributes: roadA = biome weights (desert, canyon, coast, mountain), roadB = (city, dam, snow, wrap segment),
  // splat = the terrain's layer weights at the strip edge (the verge blends into exactly what the terrain shows), aux = terrain aux
  const roadA = new Float32Array(nv * 4), roadB = new Float32Array(nv * 4), aux = new Float32Array(nv * 4);
  const splat = [new Float32Array(nv * 4), new Float32Array(nv * 4), new Float32Array(nv * 4)];
  const seg = Math.floor(s0 / ROAD_WRAP), sBase = seg * ROAD_WRAP;
  const offX = wrapOff(ax), offZ = wrapOff(az);
  const bio0 = biomeAt((s0 + s1) / 2);
  const seaY = bio0.a === 'coast' || bio0.b === 'coast' ? seaLevel(road, 'coast') : bio0.a === 'dam' || bio0.b === 'dam' ? seaLevel(road, 'dam') : -1e4;
  const sm = {}, w = new Float32Array(12);
  for (let r = 0; r < rows; r++) {
    const s = s0 + r * DS;
    road.sample(s, sm);
    const bio = biomeAt(s);
    const snow = bw(bio, 'mountain') * smoothstep(95, 140, sm.y);
    for (let c = 0; c < cols; c++) {
      const d = ROAD_COLS[c];
      const i = r * cols + c, o = i * 3;
      positions[o] = sm.x + sm.nx * d - ax; positions[o + 1] = road.surfaceY(sm, d) - ay; positions[o + 2] = sm.z + sm.nz * d - az;
      uvs[i * 2] = d; uvs[i * 2 + 1] = s - sBase; // metres in both axes (distance wrapped every ROAD_WRAP m): the shader maps them to tiles
      roadA[i * 4] = bw(bio, 'desert'); roadA[i * 4 + 1] = bw(bio, 'canyon'); roadA[i * 4 + 2] = bw(bio, 'coast'); roadA[i * 4 + 3] = bw(bio, 'mountain');
      roadB[i * 4] = bw(bio, 'city'); roadB[i * 4 + 1] = bw(bio, 'dam'); roadB[i * 4 + 2] = snow; roadB[i * 4 + 3] = seg;
      const side = d >= 0 ? 1 : -1;
      splatAt(w, seed, s, 0, side, 0.02, sm.x + sm.nx * side * EDGE, road.surfaceY(sm, side * EDGE), sm.z + sm.nz * side * EDGE, seaY, bio);
      for (let k = 0; k < 12; k++) splat[(k / 4) | 0][i * 4 + (k % 4)] = w[k];
      aux[i * 4] = offX; aux[i * 4 + 1] = offZ; aux[i * 4 + 2] = 0; aux[i * 4 + 3] = seaY;
    }
  }
  // normals from grid
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const r0 = Math.max(0, r - 1), r1 = Math.min(rows - 1, r + 1), c0 = Math.max(0, c - 1), c1 = Math.min(cols - 1, c + 1);
    const A = (r1 * cols + c) * 3, B = (r0 * cols + c) * 3, C = (r * cols + c1) * 3, D = (r * cols + c0) * 3;
    const tsx = positions[A] - positions[B], tsy = positions[A + 1] - positions[B + 1], tsz = positions[A + 2] - positions[B + 2];
    const tdx = positions[C] - positions[D], tdy = positions[C + 1] - positions[D + 1], tdz = positions[C + 2] - positions[D + 2];
    // d increases to the left (+) ; s forward. normal = ts x td (left) ... choose up
    let nx = tsy * tdz - tsz * tdy, ny = tsz * tdx - tsx * tdz, nz = tsx * tdy - tsy * tdx;
    if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    const o = (r * cols + c) * 3; normals[o] = nx / l; normals[o + 1] = ny / l; normals[o + 2] = nz / l;
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const a0 = r * cols + c, b0 = (r + 1) * cols + c, c0 = (r + 1) * cols + c + 1, d0 = r * cols + c + 1;
    // columns run left-to-right in -d order (ROAD_COLS ascending = from right(-) to left(+)); s forward
    idx.push(a0, b0, c0, a0, c0, d0);
  }
  return { anchor: [ax, ay, az], positions, normals, uvs, roadA, roadB, splat, aux, indices: new Uint16Array(idx), rows, cols, colPositions: positions.slice(), colIndices: new Uint32Array(idx) };
}

/** World sea level (y) for a biome that has water: fixed under the middle of that biome's road. */
const _seaCache = new WeakMap();
export function seaLevel(road, biomeId) {
  let m = _seaCache.get(road); if (!m) { m = {}; _seaCache.set(road, m); }
  if (m[biomeId] === undefined) {
    const T = BIOMES[biomeId].terrain;
    // lowest road elevation seen across the biome, minus the cliff height so cliffs always reach the water
    const mid = biomeId === 'coast' ? 25000 : 55000;
    road.extendTo(mid + 4000);
    let minY = 1e9; for (let s = mid - 5000; s <= mid + 5000; s += 30) minY = Math.min(minY, road.sample(s).y);
    m[biomeId] = minY - (T.cliff ?? 40) * 0.55;
  }
  return m[biomeId];
}
