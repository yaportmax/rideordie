// Scenery exclusions are authored before actors spawn, so the physical world
// and its visible dressing leave the same shooting lanes and water surface.
// This module only reads the deterministic encounter catalog and road frames.
import { HALF_ROAD, SHOULDER } from '../data/biomes.js';
import { plannedStageEncounters, stageBoatWaterCutBounds, STAGE_BOAT_WATER_CUT } from '../data/stage_encounters.js';

const EDGE = HALF_ROAD + SHOULDER;
const ACTOR_KINDS = new Set(['gun_tower', 'grenade_nest', 'cliff_riflemen']);
const RESERVATIONS = new WeakMap(), ASSET_BOUNDS = new WeakMap();

/** Complete authored retry area and incoming/outgoing firing lanes. A far
 * station can be physically clear yet hidden behind a wall before the site;
 * the 120 m longitudinal apron keeps those genuine approach rays open. */
export function stageActorReservationBounds(site) {
  if (ACTOR_KINDS.has(site.kind)) {
    const side = site.side < 0 ? -1 : 1;
    return Object.freeze({ id: site.id, kind: site.kind, s0: site.s0 - 120, s1: site.s0 + 76 + 120,
      d0: side > 0 ? 9 : -93, d1: side > 0 ? 93 : -9 });
  }
  const water = stageBoatWaterCutBounds(site);
  if (!water) return null;
  const far = EDGE + STAGE_BOAT_WATER_CUT.lateralEnd;
  return Object.freeze({ id: site.id, kind: site.kind, s0: water.start - water.fade, s1: water.end + water.fade,
    d0: water.side > 0 ? EDGE : -far, d1: water.side > 0 ? far : -EDGE });
}

export function stageActorReservations(road) {
  let areas = RESERVATIONS.get(road);
  if (!areas) {
    areas = Object.freeze(plannedStageEncounters(road).map(stageActorReservationBounds).filter(Boolean).sort((a, b) => a.s0 - b.s0));
    RESERVATIONS.set(road, areas);
  }
  return areas;
}

/** A full scenery rectangle in road coordinates. Half extents matter: a
 * building whose origin is outside the site can still cover its weakpoint. */
export function stageActorReserved(road, s, d, halfS = 0, halfD = halfS) {
  halfS = Math.abs(halfS); halfD = Math.abs(halfD);
  for (const area of stageActorReservations(road)) {
    if (area.s0 > s + halfS) break;
    if (area.s1 < s - halfS) continue;
    if (s + halfS >= area.s0 && s - halfS <= area.s1 && d + halfD >= area.d0 && d - halfD <= area.d1) return true;
  }
  return false;
}

function assetBounds(asset) {
  let b = ASSET_BOUNDS.get(asset);
  if (b) return b;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  if (asset.box) {
    x0 = asset.box.min.x; x1 = asset.box.max.x;
    z0 = asset.box.min.z; z1 = asset.box.max.z;
  }
  const positions = asset.collision?.pos;
  if (positions) for (let i = 0; i < positions.length; i += 3) {
    x0 = Math.min(x0, positions[i]); x1 = Math.max(x1, positions[i]);
    z0 = Math.min(z0, positions[i + 2]); z1 = Math.max(z1, positions[i + 2]);
  }
  if (!Number.isFinite(x0 + x1 + z0 + z1)) {
    const radius = Math.abs(asset.radius || asset.sphere?.radius || 0);
    x0 = z0 = -radius; x1 = z1 = radius;
  }
  b = { x0, x1, z0, z1 }; ASSET_BOUNDS.set(asset, b); return b;
}

/** Project actual visible and collision bounds, including off-center meshes,
 * into a road-frame rectangle. Padding can include a larger foundation. */
export function sceneryFootprint(road, s, x, z, yaw, asset, scale = 1, padding = 0, out = {}) {
  const b = assetBounds(asset), frame = road.sample(s, {}), c = Math.cos(yaw), sn = Math.sin(yaw);
  let s0 = Infinity, s1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  for (const lx of [b.x0, b.x1]) for (const lz of [b.z0, b.z1]) {
    const dx = x + (lx * c + lz * sn) * scale - frame.x;
    const dz = z + (-lx * sn + lz * c) * scale - frame.z;
    const ds = dx * frame.fx + dz * frame.fz, d = dx * frame.nx + dz * frame.nz;
    s0 = Math.min(s0, ds); s1 = Math.max(s1, ds); d0 = Math.min(d0, d); d1 = Math.max(d1, d);
  }
  out.s = s + (s0 + s1) * .5; out.d = (d0 + d1) * .5;
  out.halfS = (s1 - s0) * .5 + padding; out.halfD = (d1 - d0) * .5 + padding;
  return out;
}

export function stageSceneryReserved(road, s, x, z, yaw, asset, scale = 1, padding = 0) {
  const p = sceneryFootprint(road, s, x, z, yaw, asset, scale, padding);
  return stageActorReserved(road, p.s, p.d, p.halfS, p.halfD);
}
