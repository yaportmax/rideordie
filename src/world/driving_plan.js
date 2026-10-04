// Shared deterministic driving content. Workers and both seats use this plan;
// it never depends on graphics quality, placement retries or current progress.
import { BIOME_ORDER, BIOME_START, BOSS_S, MINIBOSS_S } from '../data/biomes.js';
import { hash2 } from '../core/util.js';
import { TEN_LEVELS, normalizeJourney, MARATHON_LEVEL_LENGTH, MARATHON_LEVEL_STARTS } from '../data/campaign.js';
import { CAMPAIGN_THEME_IDS } from '../data/campaign_themes.js';

// Signed approach geometry and inert incidental clutter require matching peers.
export const DRIVING_ROUTE_VERSION = 5;
export const BRANCH_BIOMES = Object.freeze([...BIOME_ORDER, ...CAMPAIGN_THEME_IDS]);
/** Later service cuts are narrower, with longer gentle approaches on the dam. */
export const BRANCH_DRIVING = Object.freeze({
  desert: Object.freeze({ label: 'DESERT CUT', spans: Object.freeze([480]), offset: 28, width: 10 }),
  canyon: Object.freeze({ label: 'CANYON CUT', spans: Object.freeze([480]), offset: 28, width: 10 }),
  coast: Object.freeze({ label: 'CLIFFTOP CUT', spans: Object.freeze([480, 576]), offset: 26, width: 9.6, landSide: -1 }),
  mountain: Object.freeze({ label: 'RIDGE CUT', spans: Object.freeze([480, 576]), offset: 24, width: 9.2 }),
  city: Object.freeze({ label: 'CITY ALLEY', spans: Object.freeze([480, 576]), offset: 28, width: 9 }),
  dam: Object.freeze({ label: 'UTILITY CUT', spans: Object.freeze([576, 672]), offset: 30, width: 8.8, landSide: 1 }),
  underground: Object.freeze({ label: 'VAULT SERVICE', spans: Object.freeze([384, 480, 576]), offset: 22, width: 8.6 }),
  sky: Object.freeze({ label: 'PRISM BYPASS', spans: Object.freeze([384, 480, 576]), offset: 22, width: 8.4 }),
  hell: Object.freeze({ label: 'BASALT CUT', spans: Object.freeze([384, 480, 576]), offset: 24, width: 8.2 }),
  space: Object.freeze({ label: 'DOCKING BYPASS', spans: Object.freeze([384, 480, 576]), offset: 22, width: 8 }),
});
/** More choices become available as chapters progress. Geometry still has to
 * earn its shortcut: no candidate is forced through cliffs, water or scenery. */
export const CAMPAIGN_BRANCH_LIMIT = Object.freeze({ desert: 2, canyon: 2, coast: 3, mountain: 3, city: 3,
  dam: 3, underground: 3, sky: 3, hell: 3, space: 3 });
export const BRANCH_SEPARATION = 180;
export const STAGE_WARNING_DISTANCE = 265;
export const STAGE_DRIVING = Object.freeze({
  desert: Object.freeze({ rows: 2, spacing: 135, gap: 9, asset: 'rb_wreck_car', name: 'WRECK CHICANE', depth: 5.2, height: 1.5 }),
  canyon: Object.freeze({ rows: 3, spacing: 110, gap: 8.4, asset: 'rock_03_red', name: 'ROCKFALL', depth: 3.8, height: 2.1 }),
  coast: Object.freeze({ rows: 3, spacing: 100, gap: 8, asset: 'jersey_barrier', name: 'COAST ROAD WORKS', depth: 1.05, height: .9 }),
  mountain: Object.freeze({ rows: 4, spacing: 95, gap: 7.6, asset: 'rock_03', name: 'AVALANCHE DEBRIS', depth: 4, height: 2.4 }),
  city: Object.freeze({ rows: 4, spacing: 90, gap: 7.2, asset: 'rb_container', name: 'FREIGHT CHICANE', depth: 5.4, height: 3.1 }),
  dam: Object.freeze({ rows: 5, spacing: 80, gap: 6.8, asset: 'jersey_barrier', name: 'SPILLWAY SERVICE', depth: 1.05, height: .9 }),
  underground: Object.freeze({ rows: 5, spacing: 78, gap: 6.6, asset: 'campaign_bulkhead', name: 'VAULT BULKHEADS', depth: 2.1, height: 2.4 }),
  sky: Object.freeze({ rows: 5, spacing: 76, gap: 6.4, asset: 'campaign_prism_barrier', name: 'PRISM ARRAY', depth: 2.2, height: 2.5 }),
  hell: Object.freeze({ rows: 6, spacing: 74, gap: 6.2, asset: 'campaign_basalt', name: 'BASALT COLLAPSE', depth: 3.1, height: 2.7 }),
  space: Object.freeze({ rows: 6, spacing: 72, gap: 6, asset: 'campaign_docking_clamp', name: 'DOCKING CLAMPS', depth: 2.4, height: 2.8 }),
});

/** Finite authored planning extents. Boss arenas are open-ended for driving,
 * but obstacle/fork generation stops before the boss and never extends forever. */
export function drivingJourneyStages(journey) {
  const context = normalizeJourney(journey);
  if (context.mode === 'legacy') return BIOME_ORDER.map((biome, i) => ({ biome, index: i, s0: BIOME_START[i], s1: BIOME_START[i + 1] ?? BOSS_S, boss: MINIBOSS_S[i] ?? BOSS_S }));
  const levels = context.mode === 'campaign' ? [TEN_LEVELS[context.level - 1]] : TEN_LEVELS;
  return levels.map((level, i) => ({ biome: level.id, index: level.number - 1, s0: context.mode === 'campaign' ? 0 : MARATHON_LEVEL_STARTS[i],
    s1: context.mode === 'campaign' ? level.bossDistance + 600 : MARATHON_LEVEL_STARTS[i] + MARATHON_LEVEL_LENGTH,
    boss: (context.mode === 'campaign' ? 0 : MARATHON_LEVEL_STARTS[i]) + level.bossDistance }));
}

const FOOTPRINTS = new WeakMap();
/** Cover complete visible geometry and authored collision, including off-centre models. */
export function drivingFootprintRadius(asset, scale = 1) {
  let r = FOOTPRINTS.get(asset);
  if (r === undefined) {
    const b = asset.box;
    r = b ? Math.hypot(Math.max(Math.abs(b.min.x), Math.abs(b.max.x)), Math.max(Math.abs(b.min.z), Math.abs(b.max.z))) : asset.radius || 0;
    const pos = asset.collision?.pos;
    if (pos) for (let i = 0; i < pos.length; i += 3) r = Math.max(r, Math.hypot(pos[i], pos[i + 2]));
    FOOTPRINTS.set(asset, r);
  }
  return r * Math.abs(scale);
}

function protectedJourneySpan(a, b, stages) {
  if (a < 650) return true;
  return stages.some(stage => (b > stage.boss - 1000 && a < stage.boss + 1000) || (stage.s0 > 0 && b > stage.s0 - 300 && a < stage.s0 + 650));
}

export function protectedDrivingSpan(a, b, journey) {
  if (normalizeJourney(journey).mode !== 'legacy') return protectedJourneySpan(a, b, drivingJourneyStages(journey));
  if (a < 650 || b >= BOSS_S - 1400) return true;
  return MINIBOSS_S.some(s => b > s - 1000 && a < s + 1000);
}

/** Six distinct obstacle runs, separated by quiet road and excluded from boss approaches. */
export function stageChallenges(seed, journey) {
  if (normalizeJourney(journey).mode !== 'legacy') return campaignChallenges(seed, journey);
  // A readable canyon entrance survives every seed rather than disappearing
  // when random major structures are displaced by the new challenge groups.
  const tunnelS = BIOME_START[1] + 384;
  const out = [{ type: 'tunnel', s0: tunnelS, s1: tunnelS + 240, rock: true, authoredDriving: true }];
  for (let bi = 0; bi < BIOME_ORDER.length; bi++) {
    const biome = BIOME_ORDER[bi], cfg = STAGE_DRIVING[biome];
    const lo = BIOME_START[bi] + 1100;
    const hi = Math.min(BIOME_START[bi + 1] ?? BOSS_S, BOSS_S - 1400) - 700;
    const shift = Math.floor(hash2(seed | 0, bi + 917) * 160 / 3) * 3;
    for (let at = lo + shift, ordinal = 0; at < hi; at += 1700, ordinal++) {
      const end = at + (cfg.rows - 1) * cfg.spacing + cfg.depth;
      if (end >= hi || protectedDrivingSpan(at - STAGE_WARNING_DISTANCE, end + 100)) continue;
      const id = `${biome}-challenge-${ordinal}`;
      const firstSide = hash2(seed + 53, bi * 31 + ordinal) < .5 ? -1 : 1;
      const group = { id, biome, s0: at - STAGE_WARNING_DISTANCE, s1: end + 100 };
      out.push({ type: 'stage_warning', s0: group.s0, s1: group.s0 + 1, group, biome, challengeId: id });
      for (let row = 0; row < cfg.rows; row++) {
        const s = at + row * cfg.spacing, side = firstSide * (row % 2 ? -1 : 1);
        out.push({ type: 'stage_challenge', s0: s, s1: s + cfg.depth, group, biome, challengeId: id, row, passSide: side, gap: cfg.gap });
      }
    }
  }
  return out.sort((a, b) => a.s0 - b.s0 || (a.row ?? -1) - (b.row ?? -1));
}

function campaignChallenges(seed, journey) {
  const out = [], stages = drivingJourneyStages(journey);
  for (const stage of stages) {
    const cfg = STAGE_DRIVING[stage.biome], hi = stage.boss - 1100;
    // Bosses own the approach and arena. One explicit canyon intro has an open
    // bore and uses the established rock-tunnel collision contract.
    if (stage.biome === 'canyon') out.push({ type: 'tunnel', s0: stage.s0 + 384, s1: stage.s0 + 624, rock: true, authoredDriving: true });
    const shift = Math.floor(hash2(seed | 0, stage.index + 917) * 160 / 3) * 3;
    for (let at = stage.s0 + 1100 + shift, ordinal = 0; at < hi; at += 1400, ordinal++) {
      const end = at + (cfg.rows - 1) * cfg.spacing + cfg.depth;
      if (end >= hi || protectedJourneySpan(at - STAGE_WARNING_DISTANCE, end + 100, stages)) continue;
      const id = `${stage.biome}-level-${stage.index + 1}-challenge-${ordinal}`;
      const firstSide = hash2(seed + 53, stage.index * 31 + ordinal) < .5 ? -1 : 1;
      const group = { id, biome: stage.biome, s0: at - STAGE_WARNING_DISTANCE, s1: end + 100 };
      out.push({ type: 'stage_warning', s0: group.s0, s1: group.s0 + 1, group, biome: stage.biome, challengeId: id });
      for (let row = 0; row < cfg.rows; row++) {
        const s = at + row * cfg.spacing, side = firstSide * (row % 2 ? -1 : 1);
        out.push({ type: 'stage_challenge', s0: s, s1: s + cfg.depth, group, biome: stage.biome, challengeId: id, row, passSide: side, gap: cfg.gap });
      }
    }
  }
  return out.sort((a, b) => a.s0 - b.s0 || (a.row ?? -1) - (b.row ?? -1));
}

/** Random legacy structures must not conceal a planned lane choice. */
export function drivingReserved(plan, a, b, pad = 0) {
  return plan.some(f => {
    const span = f.type === 'stage_warning' ? f.group : f.authoredDriving ? f : null;
    return span && b > span.s0 - pad && a < span.s1 + pad;
  });
}

/** Off-road cuts intentionally provide an escape around main-road encounters.
 * Their actors reserve the actual paved strip separately; warning envelopes
 * must not erase every optional route from later, busier chapters. */
export function branchDrivingReserved(plan, a, b, pad = 0) {
  return plan.some(f => {
    if (f.type === 'stage_encounter_reservation') return false;
    const span = f.type === 'stage_warning' ? f.group : f.authoredDriving ? f : null;
    return span && b > span.s0 - pad && a < span.s1 + pad;
  });
}

/** Physical main-road slice, with a generous clear corridor on the indicated side. */
export function stageObstacleSpan(feature, halfRoad = 7) {
  const width = 2 * halfRoad - feature.gap;
  const side = -feature.passSide;
  return { width, d: side * (halfRoad - width / 2), gapD: feature.passSide * width / 2, gap: feature.gap };
}

const ENCOUNTER_DRIVING_KINDS = new Set(['shoot_gate', 'rockfall', 'lava_fall', 'steam_vent']);

/** First hard slice still overlapping or ahead of a vehicle. Reservation
 * warnings do not count as geometry: commit to their actual core and keep its
 * escape lane until the full vehicle clears. Both existing AI seats use this
 * query, without changing their normal lane selection or route behavior. */
export function drivingLaneTarget(road, s, length = 5.3, lookAhead = 265, out = {}, route = null) {
  // Existing callers already suppress main-road slices on a separated branch.
  // Preserve that guard for direct/shared route queries as well.
  if (route && road.drivingBranch?.(route)) return null;
  const behind = length / 2 + 3;
  const features = road.featuresIn(Math.max(0, s - behind), s + lookAhead, 'stage_challenge');
  let next = null, nextS0 = Infinity, nextS1 = Infinity, encounter = false;
  for (const f of features) {
    if (f.s1 < s - behind || f.s0 > nextS0) continue;
    next = f; nextS0 = f.s0; nextS1 = f.s1;
  }
  // The plan is finite and is available before incremental Road features have
  // streamed this far. Scan it directly rather than manufacturing new solids
  // or extending the road to an entire warning envelope on every AI update.
  for (const f of road.drivingPlan || []) {
    if (f.type !== 'stage_encounter_reservation' || !ENCOUNTER_DRIVING_KINDS.has(f.encounterKind)) continue;
    if (!Number.isFinite(f.coreS0) || !Number.isFinite(f.coreS1) || f.coreS1 < f.coreS0 ||
      !Number.isFinite(f.gapD) || !Number.isFinite(f.gap) || f.gap <= 0 || Math.abs(f.gapD) + f.gap / 2 > 7 + .001) continue;
    if (f.coreS1 < s - behind || f.coreS0 > s + lookAhead || f.coreS0 >= nextS0) continue;
    next = f; nextS0 = f.coreS0; nextS1 = f.coreS1; encounter = true;
  }
  if (!next) return null;
  const span = encounter ? next : stageObstacleSpan(next);
  out.d = span.gapD; out.gap = span.gap; out.distance = nextS0 - s; out.s0 = nextS0; out.s1 = nextS1;
  out.speed = Math.max(24, Math.min(38, 24 + (out.distance - 30) * .11));
  out.id = encounter ? next.encounterId : next.challengeId; out.row = encounter ? -1 : next.row;
  out.encounterKind = encounter ? next.encounterKind : null;
  return out;
}

// Branch descriptors feed the same carved terrain, fine collision strip and
// route projection. Authoritative Sim recovery still requires route-aware wiring.
export function branchSample(road, branch, s, out = {}) {
  const u = Math.max(0, Math.min(1, (s - branch.s0) / (branch.s1 - branch.s0)));
  const sm = road.sample(s, out), d = branch.side * branch.offset * Math.sin(Math.PI * u) ** 2;
  out.x += sm.nx * d; out.z += sm.nz * d; out.y = road.surfaceY(sm, d);
  out.mainS = s; out.d = d; out.route = branch.id;
  return out;
}

/** Vehicle/recovery target on the same banked strip as the renderer/collider. */
export function branchPointAt(road, branch, s, d = 0, out = {}) {
  const p = branchSample(road, branch, s, out), a = branchSample(road, branch, s - 1.5, {}), b = branchSample(road, branch, s + 1.5, {});
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
  out.nx = dz / len; out.nz = -dx / len; out.fx = dx / len; out.fz = dz / len;
  out.x += out.nx * d; out.z += out.nz * d; out.y = p.y - d * Math.tan(p.bank);
  out.th = Math.atan2(dx, dz); out.d = d; out.route = branch.id; out.halfWidth = branch.width / 2;
  return out;
}

export function branchGeometry(road, branch, step = 3) {
  const count = Math.ceil((branch.s1 - branch.s0) / step), nodes = [];
  let arc = 0, maxGrade = 0, maxCurvature = 0, monotonicZ = true;
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let i = 0; i <= count; i++) {
    const s = branch.s0 + (branch.s1 - branch.s0) * i / count;
    const p = branchSample(road, branch, s, {});
    bounds.minX = Math.min(bounds.minX, p.x); bounds.maxX = Math.max(bounds.maxX, p.x);
    bounds.minZ = Math.min(bounds.minZ, p.z); bounds.maxZ = Math.max(bounds.maxZ, p.z);
    if (i) {
      const a = nodes[i - 1], horizontal = Math.hypot(p.x - a.x, p.z - a.z);
      if (!(p.z > a.z)) monotonicZ = false;
      arc += Math.hypot(horizontal, p.y - a.y);
      maxGrade = Math.max(maxGrade, Math.abs(p.y - a.y) / Math.max(.1, horizontal));
    }
    nodes.push({ x: p.x, y: p.y, z: p.z, s, arc });
  }
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[Math.max(0, i - 1)], b = nodes[Math.min(count, i + 1)];
    nodes[i].heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (i > 1) {
      const da = nodes[i].heading - nodes[i - 1].heading;
      maxCurvature = Math.max(maxCurvature, Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) / Math.max(.1, nodes[i].arc - nodes[i - 1].arc));
    }
  }
  return { ...branch, nodes, length: arc, saved: branch.s1 - branch.s0 - arc, maxGrade, maxCurvature, monotonicZ, bounds };
}

function nearBranch(branch, x, z, pad) {
  const b = branch.bounds;
  return !b || (x >= b.minX - pad && x <= b.maxX + pad && z >= b.minZ - pad && z <= b.maxZ + pad);
}

/** Only a solely opposite-bank guard is clear of a landward water-stage fork. */
export function branchFeatureObstructs(feature, biome) {
  if (feature.type === 'guard') {
    const landSide = BRANCH_DRIVING[biome]?.landSide;
    const opposite = landSide === -1 ? 'L' : landSide === 1 ? 'R' : null;
    return !opposite || feature.side !== opposite;
  }
  return ['bridge', 'tunnel', 'overpass', 'roadblock', 'ramp'].includes(feature.type);
}

/** Branch progress maps continuously into the original route; no boss or payout threshold is skipped. */
export function projectDrivingBranch(branch, x, z, out = {}) {
  const count = branch.nodes.length - 1;
  let best = Infinity, bestIndex = count;
  const project = (i) => {
    const a = branch.nodes[i], b = branch.nodes[i + 1], dx = b.x - a.x, dz = b.z - a.z;
    const zd = z < a.z ? a.z - z : z > b.z ? z - b.z : 0;
    if (branch.monotonicZ && zd * zd > best) return false;
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), xd = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    if (xd * xd + zd * zd > best && branch.monotonicZ) return true;
    const u = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const px = a.x + u * dx, pz = a.z + u * dz, dd = (x - px) ** 2 + (z - pz) ** 2;
    if (dd > best || (dd === best && i >= bestIndex)) return true;
    best = dd; bestIndex = i; out.s = a.s + u * (b.s - a.s); out.arc = a.arc + u * (b.arc - a.arc);
    out.y = a.y + u * (b.y - a.y); out.d = ((x - px) * dz - (z - pz) * dx) / Math.hypot(dx, dz);
    out.th = Math.atan2(dx, dz); out.x = px; out.z = pz;
    return true;
  };
  if (!branch.monotonicZ) for (let i = 0; i < count; i++) project(i);
  else {
    // Exact lower bounds retain the full polyline answer while avoiding a
    // 160-segment scan for every worker terrain point and suspension ray.
    let lo = 0, hi = count - 1;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (branch.nodes[mid + 1].z < z) lo = mid + 1; else hi = mid; }
    let left = lo, right = lo + 1;
    while (left >= 0 || right < count) {
      if (left >= 0 && !project(left--)) left = -1;
      if (right < count && !project(right++)) right = count;
    }
  }
  out.dist = Math.sqrt(best); out.route = branch.id; out.halfWidth = branch.width / 2;
  return out;
}

/** Candidate branches only. The caller must carve/reserve them before enabling them. */
export function planDrivingBranches(road, biomes = BRANCH_BIOMES) {
  if (normalizeJourney(road.journey).mode !== 'legacy') return planCampaignBranches(road, biomes);
  const out = [];
  // All copies decide the requested bounded campaign scope before serving
  // chunks, so worker request order cannot move a corridor. This runs in loading.
  const last = Math.max(...biomes.map(id => BIOME_ORDER.indexOf(id)));
  if (last < 0) return out;
  road.extendTo((BIOME_START[last + 1] ?? BOSS_S) + 100);
  for (let bi = 0; bi < BIOME_ORDER.length; bi++) {
    const biome = BIOME_ORDER[bi], lo = BIOME_START[bi] + 1000;
    if (!biomes.includes(biome)) continue;
    const cfg = BRANCH_DRIVING[biome];
    const hi = Math.min(BIOME_START[bi + 1] ?? BOSS_S, BOSS_S - 1400) - 900;
    let best = null;
    for (let s0 = lo; s0 + cfg.spans[0] < hi; s0 += 96) for (const length of cfg.spans) {
      const s1 = s0 + length;
      if (s1 >= hi) continue;
      if (protectedDrivingSpan(s0 - 200, s1 + 200) || branchDrivingReserved(road.drivingPlan, s0, s1, 100)) continue;
      if (road.featuresIn(s0 - 100, s1 + 100).some(f => branchFeatureObstructs(f, biome))) continue;
      const sm = road.sample((s0 + s1) / 2, {}), side = Math.sign(sm.k);
      if (!side || (cfg.landSide && side !== cfg.landSide)) continue;
      const branch = branchGeometry(road, { id: `${biome}-service-${s0}`, biome, s0, s1, side, offset: cfg.offset, width: cfg.width });
      if (branch.saved < 4 || branch.maxGrade > .085 || branch.maxCurvature > 1 / 70) continue;
      if (!best || branch.saved > best.saved) best = branch;
    }
    if (best) out.push(best);
  }
  return out;
}

function planCampaignBranches(road, biomes) {
  const out = [], allStages = drivingJourneyStages(road.journey), stages = allStages.filter(stage => biomes.includes(stage.biome));
  if (!stages.length) return out;
  // This bounds selected-level loading to its 3.5–6 km approach. A marathon
  // intentionally authors its finite80 km once, never its infinitefinalarena.
  road.extendTo(Math.max(...stages.map(stage => stage.s1)) + 100);
  for (const stage of stages) {
    const cfg = BRANCH_DRIVING[stage.biome], lo = stage.s0 + 720, hi = stage.boss - 1100;
    const candidates = [];
    for (let s0 = lo; s0 + cfg.spans[0] < hi; s0 += 48) for (const length of cfg.spans) {
      const s1 = s0 + length;
      if (s1 >= hi || protectedJourneySpan(s0 - 100, s1 + 100, allStages) || branchDrivingReserved(road.drivingPlan, s0, s1, 100)) continue;
      if (road.featuresIn(s0 - 100, s1 + 100).some(f => branchFeatureObstructs(f, stage.biome))) continue;
      const sm = road.sample((s0 + s1) / 2, {}), side = Math.sign(sm.k);
      if (!side || (cfg.landSide && side !== cfg.landSide)) continue;
      const branch = branchGeometry(road, { id: `${stage.biome}-level-${stage.index + 1}-service-${s0}`, biome: stage.biome, level: stage.index + 1,
        s0, s1, side, offset: cfg.offset, width: cfg.width });
      if (branch.saved < 4 || branch.maxGrade > .085 || branch.maxCurvature > 1 / 70) continue;
      candidates.push(branch);
    }
    // The original best cut remains the first selection. Additional branches
    // use quiet nonoverlapping spans with time to read their entry/merge signs.
    candidates.sort((a, b) => b.saved - a.saved || a.s0 - b.s0 || a.s1 - b.s1);
    const selected = [];
    for (const branch of candidates) {
      if (selected.some(previous => branch.s1 + BRANCH_SEPARATION > previous.s0 && branch.s0 - BRANCH_SEPARATION < previous.s1)) continue;
      selected.push(branch);
      if (selected.length >= CAMPAIGN_BRANCH_LIMIT[stage.biome]) break;
    }
    out.push(...selected.sort((a, b) => a.s0 - b.s0));
  }
  return out;
}

/** Fine ribbon data for both render and Rapier collision. Overlaps main asphalt at each join. */
export function drivingBranchRibbon(road, branch, from = branch.s0 - 4, to = branch.s1 + 4) {
  const lo = Math.max(branch.s0 - 4, from), hi = Math.min(branch.s1 + 4, to);
  if (hi <= lo) return null;
  const n = Math.ceil((hi - lo) / 3), pos = new Float32Array((n + 1) * 6), idx = new Uint32Array(n * 6);
  const samples = [];
  for (let i = 0; i <= n; i++) {
    const s = lo + (hi - lo) * i / n;
    samples.push(branchSample(road, branch, s, {}));
  }
  for (let i = 0; i <= n; i++) {
    const p = samples[i], s = lo + (hi - lo) * i / n;
    // The same central derivative on both sides of a streaming boundary keeps
    // shared edge vertices/normals independent of chunk clipping.
    const a = branchSample(road, branch, s - 1.5, {}), b = branchSample(road, branch, s + 1.5, {});
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), nx = dz / length, nz = -dx / length;
    for (let side = 0; side < 2; side++) {
      const d = (side ? -1 : 1) * branch.width / 2, o = i * 6 + side * 3;
      pos[o] = p.x + nx * d; pos[o + 1] = p.y - d * Math.tan(p.bank); pos[o + 2] = p.z + nz * d;
    }
    if (i < n) { const j = i * 2; idx.set([j, j + 2, j + 1, j + 1, j + 2, j + 3], i * 6); }
  }
  return { pos, idx, s0: lo, s1: hi, route: branch.id };
}

/** Exact route query seam for simulation. Main-road callers retain their original projection. */
export function projectDrivingRoute(road, branches, x, z, hint = 0, window = 90, out = {}, query = road, scratch = {}) {
  query.nearest(x, z, hint, window, out);
  const main = road.sample(out.s, scratch.main || (scratch.main = {}));
  out.route = null; out.halfWidth = 7; out.y = road.surfaceY(main, out.d); out.th = main.th;
  out.x = main.x; out.z = main.z; out.arc = out.s;
  const candidate = scratch.branch || (scratch.branch = {});
  for (const branch of branches) {
    if (hint + window < branch.s0 || hint - window > branch.s1) continue;
    if (!nearBranch(branch, x, z, branch.width / 2 + 2.5)) continue;
    projectDrivingBranch(branch, x, z, candidate);
    // Only the actual strip and its shoulder count as a driving route. A closer
    // far-away branch must not turn arbitrary hillside terrain into asphalt.
    if (candidate.s < hint - window || candidate.s > hint + window || candidate.dist > candidate.halfWidth + 2.5 || candidate.dist >= out.dist - .001) continue;
    candidate.y -= candidate.d * Math.tan(road.sample(candidate.s, scratch.bank || (scratch.bank = {})).bank);
    Object.assign(out, candidate);
  }
  return out;
}

/** Terrain carving seam: flatten exactly the same physical corridor as the fine ribbon. */
export function drivingCorridorAt(road, branches, x, z, hint, out = {}) {
  out.weight = 0; out.route = null;
  const projection = {};
  for (const branch of branches) {
    if (hint < branch.s0 - 6 || hint > branch.s1 + 6) continue;
    if (!nearBranch(branch, x, z, branch.width / 2 + 11)) continue;
    projectDrivingBranch(branch, x, z, projection);
    // Nearby lateral terrain cells are up to 4.5 m wide. Their outer vertex
    // must be wholly buried: blending a tall cliff vertex just beyond the
    // pavement raises the triangle back through the fine strip. Six metres
    // covers that cell plus the curved row offset without flattening far land.
    const edge = Math.abs(projection.d) - branch.width / 2 - 6;
    if (edge >= 5 || projection.dist > Math.abs(projection.d) + .25) continue;
    const u = Math.max(0, Math.min(1, edge / 5)), weight = 1 - u * u * (3 - 2 * u);
    if (weight <= out.weight) continue;
    const bank = road.sample(projection.s, {}).bank;
    out.weight = weight; out.y = projection.y - projection.d * Math.tan(bank) - .12;
    out.route = branch.id; out.s = projection.s; out.d = projection.d;
  }
  return out;
}

/** Every type of scenery/collider must use the same reserved world-space corridor. */
export function intersectsDrivingCorridor(branches, x, z, radius = 0, hint = 0) {
  const projection = {};
  for (const branch of branches) {
    if (hint + radius < branch.s0 - 6 || hint - radius > branch.s1 + 6) continue;
    if (!nearBranch(branch, x, z, branch.width / 2 + radius + 2)) continue;
    projectDrivingBranch(branch, x, z, projection);
    if (projection.dist < branch.width / 2 + radius + 2) return true;
  }
  return false;
}
