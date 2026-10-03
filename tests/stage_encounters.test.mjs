import test from 'node:test';
import assert from 'node:assert/strict';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { Road } from '../src/world/road.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { STAGE_ENCOUNTERS, STAGE_ENCOUNTER_KINDS, STAGE_ENCOUNTER_LIMIT, plannedStageEncounters,
  stageEncounterPlan, stageEncounterReservations, stageEncounterRange, stageEncounterForId, stageEncounterGap } from '../src/data/stage_encounters.js';
import { stageChallenges, protectedDrivingSpan, drivingReserved, drivingJourneyStages,
  CAMPAIGN_BRANCH_LIMIT, BRANCH_SEPARATION, branchPointAt, branchDrivingReserved, drivingLaneTarget, stageObstacleSpan } from '../src/world/driving_plan.js';

test('ten chapters define authored threat identities and eleven encounter mechanics', () => {
  assert.deepEqual(Object.keys(STAGE_ENCOUNTERS), TEN_LEVELS.map(level => level.id));
  const all = new Set(Object.values(STAGE_ENCOUNTERS).flat());
  assert.deepEqual([...all].sort(), Object.keys(STAGE_ENCOUNTER_KINDS).sort());
  for (const choices of Object.values(STAGE_ENCOUNTERS)) {
    assert.equal(choices.length, 5);
    assert.equal(new Set(choices).size, choices.length);
    assert.ok(Object.isFrozen(choices));
  }
  assert.equal(STAGE_ENCOUNTERS.canyon[0], 'rockfall');
  assert.equal(STAGE_ENCOUNTERS.coast[0], 'patrol_boat');
  assert.equal(STAGE_ENCOUNTERS.underground[0], 'steam_vent');
  assert.equal(STAGE_ENCOUNTERS.sky[0], 'flying_drone');
  assert.equal(STAGE_ENCOUNTERS.hell[0], 'lava_fall');
});

test('every real finite campaign seed reaches all eleven mechanics across its chapter cores and each chapter mixes at least two threats', () => {
  const required = Object.keys(STAGE_ENCOUNTER_KINDS).sort();
  for (const seed of [1, 7, 11, 31, 12345, 381442461, 561889576, -17]) {
    const covered = new Set();
    for (const level of TEN_LEVELS) {
      const journey = { mode: 'campaign', level: level.number }, road = new Road(seed, journey);
      const plan = plannedStageEncounters(road), kinds = plan.map(encounter => encounter.kind);
      assert.ok(plan.length >= 2, `${level.id}/${seed}: the second core encounter must fit before the protected boss approach`);
      assert.deepEqual(kinds.slice(0, 2), STAGE_ENCOUNTERS[level.id].slice(0, 2));
      assert.ok(new Set(kinds).size >= 2, `${level.id}/${seed}: actual placed content mixes threats`);
      for (const encounter of plan) {
        covered.add(encounter.kind);
        assert.ok(encounter.warningS >= 650 && encounter.s1 < level.bossDistance - 1000);
        assert.equal(protectedDrivingSpan(encounter.warningS, encounter.s1, journey), false);
      }
    }
    assert.deepEqual([...covered].sort(), required, `${seed}: catalogue-only mechanics must not count as reachable content`);
  }
});

test('actual selected-level roads have cached finite deterministic encounters without extending their geometry or consuming simulation randomness', () => {
  for (const level of TEN_LEVELS) for (const seed of [1, 7, 31, -17]) {
    const journey = { mode: 'campaign', level: level.number }, road = new Road(seed, journey), sEnd = road.sEnd;
    const plan = plannedStageEncounters(road);
    assert.equal(road.sEnd, sEnd, 'encounter planning is pure and does not build a route');
    assert.equal(plannedStageEncounters(road), plan);
    assert.deepEqual(plan, stageEncounterPlan(seed, journey));
    assert.ok(plan.length >= 2 && plan.length <= STAGE_ENCOUNTER_LIMIT, `${level.id}/${seed} has both core encounters`);
    assert.equal(plan[0].kind, STAGE_ENCOUNTERS[level.id][0]);
    assert.ok(Object.isFrozen(plan) && plan.every(Object.isFrozen));
    const solids = stageChallenges(seed, journey).filter(feature => ['stage_challenge', 'tunnel'].includes(feature.type));
    for (const encounter of plan) {
      assert.equal(encounter.biome, level.id); assert.equal(encounter.level, level.number);
      assert.equal(protectedDrivingSpan(encounter.warningS, encounter.s1, journey), false);
      assert.ok(encounter.s0 >= 915 && encounter.s1 < level.bossDistance - 1000);
      assert.ok(encounter.s0 - encounter.warningS >= 265, 'warning remains readable at highway speed');
      assert.ok(solids.every(feature => encounter.s1 < feature.s0 - 75 || encounter.s0 > feature.s1 + 75), 'actors stay outside existing hard chicanes');
      assert.equal(Math.sign(encounter.gapD), -encounter.side);
      assert.ok(encounter.gap >= 6.2 && Math.abs(encounter.gapD) + encounter.gap / 2 <= 7 + 1e-9);
      assert.equal(stageEncounterForId(road, encounter.id), encounter);
      assert.deepEqual(stageEncounterRange(road, encounter.warningS, encounter.s1).filter(row => row.id === encounter.id), [encounter]);
      if (encounter.kind === 'patrol_boat') assert.equal(encounter.waterSide, level.id === 'coast' ? 1 : -1);
    }
    assert.equal(stageEncounterForId(road, 'unknown-encounter'), null);
    const reuse = [null];
    assert.equal(stageEncounterRange(road, 1e9, 1e9 + 50, reuse), reuse); assert.deepEqual(reuse, []);
  }
});

test('legacy and marathon plans are bounded by their finite approach and preserve the same descriptors after reservation integration', () => {
  for (const journey of [undefined, { mode: 'marathon', level: 1 }]) {
    const seed = 31, base = stageChallenges(seed, journey), reservations = stageEncounterReservations(seed, journey, base);
    const road = new Road(seed, journey), before = plannedStageEncounters(road), stages = drivingJourneyStages(journey);
    assert.ok(before.length > stages.length);
    assert.ok(before.length <= stages.length * STAGE_ENCOUNTER_LIMIT);
    assert.equal(new Set(before.map(row => row.id)).size, before.length);
    assert.deepEqual(before, stageEncounterPlan(seed, journey, [...base, ...reservations]));
    assert.ok(before.every(encounter => stages.some(stage => encounter.biome === stage.biome && encounter.s1 <= stage.boss - 1000)));
    for (const reservation of reservations) {
      assert.equal(reservation.type, 'stage_encounter_reservation');
      assert.equal(reservation.authoredDriving, true);
      const encounter = before.find(row => row.id === reservation.encounterId);
      assert.equal(reservation.encounterKind, encounter.kind);
      assert.equal(reservation.coreS0, encounter.s0); assert.equal(reservation.coreS1, encounter.s1);
      assert.equal(reservation.gapD, encounter.gapD); assert.equal(reservation.gap, encounter.gap);
      assert.equal(drivingReserved(reservations, reservation.s0, reservation.s1), true);
      assert.equal(branchDrivingReserved(reservations, reservation.s0, reservation.s1), false, 'an optional cut may bypass a main-road encounter');
    }
    const plan = stageEncounterPlan(seed, journey);
    assert.deepEqual(plan, stageEncounterPlan(seed, journey));
    assert.ok(plan.at(-1).s1 < (journey ? 78000 : 59000));
  }
});

test('actual road queries select both sides of every new driving hazard, fit the widest player car and retain the lane until its rear clears', () => {
  const kinds = ['shoot_gate', 'rockfall', 'lava_fall', 'steam_vent'], cases = new Map();
  for (let seed = 1; seed <= 32; seed++) for (const level of [1, 2, 7, 9]) {
    const road = new Road(seed, { mode: 'campaign', level });
    for (const encounter of plannedStageEncounters(road)) {
      const key = `${encounter.kind}/${encounter.side}`;
      if (kinds.includes(encounter.kind) && !cases.has(key)) cases.set(key, { road, encounter });
    }
  }
  const playerSpecs = Object.values(VEHICLES).filter(spec => spec.kind === 'player');
  const width = Math.max(...playerSpecs.map(spec => spec.width)), length = Math.max(...playerSpecs.map(spec => spec.length)), behind = length / 2 + 3;
  for (const kind of kinds) for (const side of [-1, 1]) {
    const example = cases.get(`${kind}/${side}`);
    assert.ok(example, `${kind}/${side}: actual seeded plan must contain both orientations`);
    const { road, encounter } = example, out = {};
    const pre = drivingLaneTarget(road, encounter.s0 - 60, length, 59, out);
    assert.notEqual(pre?.id, encounter.id, 'warning envelope cannot pull a core into a shorter look-ahead query');
    for (const s of [encounter.s0 - 60, encounter.s0, (encounter.s0 + encounter.s1) / 2, encounter.s1 + behind - .01]) {
      const lane = drivingLaneTarget(road, s, length, 265, out);
      assert.equal(lane, out); assert.equal(lane.id, encounter.id); assert.equal(lane.encounterKind, kind);
      assert.equal(lane.d, encounter.gapD); assert.equal(lane.gap, encounter.gap);
      assert.equal(lane.s0, encounter.s0); assert.equal(lane.s1, encounter.s1); assert.equal(lane.distance, encounter.s0 - s);
      assert.ok(lane.speed >= 24 && lane.speed <= 38);
      assert.ok(width < lane.gap && Math.abs(lane.d) + width / 2 < 7, 'complete maximum-width player chassis fits the escape passage');
    }
    assert.notEqual(drivingLaneTarget(road, encounter.s1 + behind + .01, length)?.id, encounter.id, 'the passed reservation must release normal driving');
  }
});

test('actual overlapping approach query retains the existing solid chicane until its rear clears before committing to the following encounter', () => {
  // A seed may put the opening fall BEFORE its first chicane. Select a real
  // authored chicane->fall approach instead of assuming one particular seed
  // has that ordering; never move either source feature to manufacture it.
  let example = null;
  for (let seed = 1; seed <= 32 && !example; seed++) for (const level of [2, 7, 9]) {
    const road = new Road(seed, { mode: 'campaign', level }), encounter = plannedStageEncounters(road)[0];
    const solids = road.drivingPlan.filter(feature => feature.type === 'stage_challenge' && feature.s1 < encounter.s0);
    const last = solids.at(-1);
    if (last && encounter.s0 - last.s1 < 265) { example = { road, encounter, last, seed, level }; break; }
  }
  assert.ok(example, 'the real32-seed canyon/underground/hell matrix must contain an overlapping chicane->fall/vent approach');
  const { road, encounter, last } = example, length = 9, behind = length / 2 + 3, out = {};
  assert.ok(['rockfall', 'steam_vent', 'lava_fall'].includes(encounter.kind));
  assert.ok(encounter.s0 > last.s1 + 75 && encounter.s0 - last.s1 < 265);
  const overlapping = drivingLaneTarget(road, last.s1 + behind - .01, length, 265, out);
  assert.equal(overlapping.id, last.challengeId); assert.equal(overlapping.row, last.row);
  assert.equal(overlapping.d, stageObstacleSpan(last).gapD); assert.equal(overlapping.encounterKind, null);
  const next = drivingLaneTarget(road, last.s1 + behind + .01, length, 265, out);
  assert.equal(next.id, encounter.id); assert.equal(next.d, encounter.gapD); assert.equal(next.row, -1);
  assert.equal(next.encounterKind, encounter.kind);
});

test('pure driving metadata does not turn shooters or distant reservations into lane locks and preserves explicit branch-route separation', () => {
  for (const level of TEN_LEVELS) {
    const road = new Road(31, { mode: 'campaign', level: level.number });
    for (const encounter of plannedStageEncounters(road)) {
      if (['shoot_gate', 'rockfall', 'lava_fall', 'steam_vent'].includes(encounter.kind)) continue;
      assert.notEqual(drivingLaneTarget(road, encounter.s0)?.id, encounter.id, `${encounter.kind}: shooting encounter keeps ordinary lane choice`);
    }
  }
  const road = new Road(7), branch = road.ensureDrivingBranches()[0], gate = plannedStageEncounters(road).find(row => row.kind === 'shoot_gate');
  assert.ok(branch && gate);
  assert.equal(drivingLaneTarget(road, gate.s0, 5.3, 265, {}, branch.id), null, 'a branch seat never targets a main-road encounter');
  assert.equal(drivingLaneTarget(road, gate.s0, 5.3, 265, {}, 'missing-route')?.id, gate.id, 'invalid branch metadata does not hide an actual main-road obstruction');
});

test('later obstacle gaps narrow gently while retaining heavy-truck width and opposite-side escape', () => {
  let previous = Infinity;
  for (let level = 1; level <= 10; level++) for (const side of [-1, 1]) {
    const { gap, gapD } = stageEncounterGap(level, side);
    assert.ok(gap <= previous + 1e-9 && gap >= 6.2); previous = gap;
    assert.equal(Math.sign(gapD), -side);
    assert.ok(Math.abs(gapD) + gap / 2 <= 7 + 1e-9);
  }
});

test('campaign and marathon fork choices retain actual savings, physical qualifications, distinct merges and continuous original progress', () => {
  for (const journey of [{ mode: 'campaign', level: 9 }, { mode: 'marathon', level: 1 }]) for (const seed of [1, 7, 31]) {
    const road = new Road(seed, journey), branches = road.ensureDrivingBranches();
    const other = new Road(seed, journey); other.extendTo(journey.mode === 'marathon' ? 80000 : TEN_LEVELS[journey.level - 1].bossDistance + 800);
    assert.deepEqual(branches, other.ensureDrivingBranches(), 'request order does not change route selection');
    for (const stage of drivingJourneyStages(journey)) {
      const choices = branches.filter(branch => branch.biome === stage.biome);
      assert.ok(choices.length <= CAMPAIGN_BRANCH_LIMIT[stage.biome]);
      for (let i = 1; i < choices.length; i++) assert.ok(choices[i].s0 >= choices[i - 1].s1 + BRANCH_SEPARATION);
      for (const branch of choices) {
        assert.ok(branch.saved >= 4 && branch.maxGrade <= .085 && branch.maxCurvature <= 1 / 70);
        assert.equal(protectedDrivingSpan(branch.s0 - 100, branch.s1 + 100, journey), false);
        const midpoint = (branch.s0 + branch.s1) / 2, point = branchPointAt(road, branch, midpoint, 0, {});
        const projected = road.projectDriving(point.x, point.z, midpoint, 60, {});
        assert.equal(projected.route, branch.id); assert.ok(Math.abs(projected.s - midpoint) < .04);
      }
    }
  }
});
