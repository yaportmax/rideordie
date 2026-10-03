// Shared encounter placement for authority, scenery and both co-op seats.
// A finite route receives a finite plan. Endless boss roads never grow this list.
import { hash2 } from '../core/util.js';
import { drivingJourneyStages, protectedDrivingSpan, stageChallenges } from '../world/driving_plan.js';

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

export const STAGE_ENCOUNTER_VERSION = 1;
export const STAGE_ENCOUNTER_KINDS = freeze({
  shoot_gate: { title: 'BREAK THE BLOCKADE', hint: 'GUNNER: SHOOT THE GATE. DRIVER: OPEN SIDE LANE.', span: 70, warning: 265 },
  rockfall: { title: 'ROCKFALL AHEAD', hint: 'WATCH THE FALLING ROCKS. TAKE THE CLEAR SIDE.', span: 190, warning: 280 },
  cliff_riflemen: { title: 'CLIFFSIDE AMBUSH', hint: 'GUNNER: LOOK UP. DRIVER: KEEP MOVING.', span: 210, warning: 265 },
  gun_tower: { title: 'OUTPOST UNDER FIRE', hint: 'SHOOT THE TOWER GUNNERS OR SPEED PAST.', span: 210, warning: 265 },
  barrel_convoy: { title: 'BARREL RUNNER', hint: 'SHOOT THE ROLLING BARRELS OR DODGE THEM.', span: 250, warning: 265 },
  collapse_arch: { title: 'COLLAPSIBLE ARCH', hint: 'SHOOT THE SUPPORT AFTER PASSING TO TRAP PURSUERS.', span: 160, warning: 265 },
  patrol_boat: { title: 'WATERSIDE RAID', hint: 'GUNNER: CHECK THE WATER. DRIVER: STAY ON THE ROAD.', span: 260, warning: 265 },
  flying_drone: { title: 'AIRBORNE HUNTERS', hint: 'GUNNER: LOOK UP. KEEP OUT OF THE FIRING LINE.', span: 240, warning: 280 },
  steam_vent: { title: 'PRESSURE RELEASE', hint: 'AMBER VENTS ARE CHARGING. TAKE THE CLEAR SIDE.', span: 190, warning: 280 },
  lava_fall: { title: 'LAVA CASCADE', hint: 'AVOID THE GLOWING CASCADE. BLUE MARKERS SHOW THE GAP.', span: 210, warning: 290 },
  grenade_nest: { title: 'GRENADE AMBUSH', hint: 'DESTROY THE THROWERS. DODGE THE MARKED BLAST.', span: 180, warning: 265 },
});

/** The first two slots are the reachable chapter core, even on its shortest
 * finite approach. Together those cores cover every mechanic. Extra quiet-road
 * slots on longer legacy/marathon approaches rotate through the remaining pool. */
export const STAGE_ENCOUNTERS = freeze({
  desert: ['shoot_gate', 'barrel_convoy', 'gun_tower', 'grenade_nest', 'collapse_arch'],
  canyon: ['rockfall', 'cliff_riflemen', 'collapse_arch', 'grenade_nest', 'shoot_gate'],
  coast: ['patrol_boat', 'shoot_gate', 'gun_tower', 'barrel_convoy', 'collapse_arch'],
  mountain: ['rockfall', 'grenade_nest', 'cliff_riflemen', 'shoot_gate', 'collapse_arch'],
  city: ['gun_tower', 'flying_drone', 'barrel_convoy', 'shoot_gate', 'grenade_nest'],
  dam: ['patrol_boat', 'gun_tower', 'shoot_gate', 'barrel_convoy', 'grenade_nest'],
  underground: ['steam_vent', 'shoot_gate', 'barrel_convoy', 'gun_tower', 'grenade_nest'],
  sky: ['flying_drone', 'shoot_gate', 'gun_tower', 'grenade_nest', 'collapse_arch'],
  hell: ['lava_fall', 'collapse_arch', 'rockfall', 'grenade_nest', 'shoot_gate'],
  space: ['flying_drone', 'gun_tower', 'shoot_gate', 'barrel_convoy', 'grenade_nest'],
});

export const STAGE_ENCOUNTER_LIMIT = 12;
/** Real shoreline opening shared by the terrain worker and viaduct dressing. */
export const STAGE_BOAT_WATER_CUT = freeze({ approach: 200, departure: 220, blend: 100, dropWidth: .75,
  floorDepth: 8, lateralCore: 240, lateralEnd: 320 });

export function stageBoatWaterCutBounds(site) {
  if (site?.kind !== 'patrol_boat' || !['coast', 'dam'].includes(site.biome)) return null;
  return { start: site.s0 - STAGE_BOAT_WATER_CUT.approach, end: site.s1 + STAGE_BOAT_WATER_CUT.departure,
    fade: STAGE_BOAT_WATER_CUT.blend, side: site.biome === 'coast' ? 1 : -1, biome: site.biome, id: site.id };
}
const CACHE = new WeakMap();
const SOLIDS = new Set(['stage_challenge', 'tunnel']);

/** Gate and falling-hazard gaps stay wider than a heavy truck even late in
 * the campaign. +d is road-left; side denotes the obstructed/enemy side. */
export function stageEncounterGap(level, side) {
  const gap = Math.max(6.2, 8.2 - (Math.max(1, Math.min(10, level)) - 1) * .22);
  return { gap, gapD: -side * (7 - gap / 2) };
}

function nextClearStart(at, span, solids, hi) {
  for (const feature of solids) {
    if (feature.s1 + 75 < at || feature.s0 - 75 > at + span) continue;
    at = feature.s1 + 76;
    if (at + span > hi) return null;
  }
  return at + span <= hi ? at : null;
}

/** Pure planning is safe during Road construction: it neither samples road
 * geometry nor extends workers, and it consumes no simulation RNG state. */
export function stageEncounterPlan(seed, journey, drivingPlan = stageChallenges(seed, journey)) {
  const out = [], stages = drivingJourneyStages(journey);
  const solids = drivingPlan.filter(feature => SOLIDS.has(feature.type)).sort((a, b) => a.s0 - b.s0);
  for (const stage of stages) {
    const choices = STAGE_ENCOUNTERS[stage.biome];
    if (!choices) continue;
    const hi = stage.boss - 1001, level = stage.index + 1;
    let cursor = stage.s0 + 915 + Math.floor(hash2(seed, stage.index + 1721) * 30);
    // Threat density ramps with each chapter, but actors still receive quiet
    // road between them. Later warnings lengthen as faster vehicles unlock.
    const interval = Math.max(590, 930 - stage.index * 35);
    for (let ordinal = 0; ordinal < STAGE_ENCOUNTER_LIMIT && cursor < hi; ordinal++) {
      const kind = choices[ordinal % choices.length], cfg = STAGE_ENCOUNTER_KINDS[kind];
      const at = nextClearStart(cursor, cfg.span, solids, hi);
      if (at === null) break;
      const warning = Math.max(cfg.warning, 265 + stage.index * 10);
      const warningS = Math.max(stage.s0 + 650, at - warning), s1 = at + cfg.span;
      if (protectedDrivingSpan(warningS, s1, journey)) { cursor = at + interval; continue; }
      const seeded = (Math.imul(seed | 0, 73856093) ^ Math.imul(stage.index + 1, 19349663) ^ Math.imul(ordinal + 1, 83492791)) | 0;
      const waterSide = stage.biome === 'coast' ? 1 : stage.biome === 'dam' ? -1 : 0;
      const side = waterSide && kind === 'patrol_boat' ? waterSide : hash2(seeded, 31) < .5 ? -1 : 1;
      const { gap, gapD } = stageEncounterGap(level, side);
      out.push(freeze({ id: `${stage.biome}-l${level}-event-${ordinal}`, kind, biome: stage.biome, level,
        s0: at, s1, side, gapD, gap, title: cfg.title, hint: cfg.hint, seed: seeded, warningS,
        difficulty: 1 + stage.index * .18, ordinal, waterSide }));
      cursor = at + interval;
    }
  }
  return freeze(out.sort((a, b) => a.s0 - b.s0 || a.id.localeCompare(b.id)));
}

export function plannedStageEncounters(road) {
  let plan = CACHE.get(road);
  if (!plan) { plan = stageEncounterPlan(road.seed, road.journey, road.drivingPlan); CACHE.set(road, plan); }
  return plan;
}

/** Early reservations suppress random structures and scenery through exactly
 * the same corridor before actors are created. They are not colliders. */
export function stageEncounterReservations(seed, journey, drivingPlan) {
  return stageEncounterPlan(seed, journey, drivingPlan).map(encounter => ({ type: 'stage_encounter_reservation',
    s0: encounter.warningS, s1: encounter.s1 + 75, authoredDriving: true, encounterId: encounter.id, biome: encounter.biome,
    encounterKind: encounter.kind, coreS0: encounter.s0, coreS1: encounter.s1, gapD: encounter.gapD, gap: encounter.gap }));
}

export function stageEncounterRange(road, s0, s1, out = []) {
  out.length = 0;
  for (const encounter of plannedStageEncounters(road)) if (encounter.s1 >= s0 && encounter.warningS <= s1) out.push(encounter);
  return out;
}

export function stageEncounterForId(road, id) {
  return plannedStageEncounters(road).find(encounter => encounter.id === id) || null;
}
