// SOURCE-AUTHORED, UNRUN. Ordinary actual-source graph, no overlays/snippets.
// Requires root's generated/validated Deepwarden extraction. Declared loaded
// ground, upright poses and speed are policy fixtures, not Rapier trajectory,
// terrain floor/ceiling, continuous swept containment or native acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Road } from '../src/world/road.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { DEEPWARDEN_ELITE, resolveEliteVehicle } from '../src/data/elite_vehicles.js';
import { EnemyBrain, enemyDrivingContext } from '../src/sim/ai.js';
import { drillLaneFootprintFits, drillPhysicalFootprintFits } from '../src/sim/drill_corridor.js';

const LEVEL = TEN_LEVELS.find(level => level.id === 'underground');
const SPEC = resolveEliteVehicle(VEHICLES.e_heavy, DEEPWARDEN_ELITE);
const SEEDS = [7, 31, 73];
const UP = new THREE.Vector3(0, 1, 0);

function pose(road, spec, s, d = 0, route = null) {
  const p = road.drivingPointAt(s, d, route, {});
  return { spec, s, d, route, crew: { driver: { alive: true } }, engineHp: 1000,
    veh: { vf: 30, grounded: spec.wheels.length, up: UP.clone(), driverAlive: true,
      stunned: 0, slipAngle: 0, poseRevision: 0, restComHeight: .7,
      pos: new THREE.Vector3(p.x, p.y + .7, p.z),
      quat: new THREE.Quaternion().setFromAxisAngle(UP, p.th) } };
}

function policy(road, s, d = 0, route = null) {
  const ground = { hasColliderAt: () => true };
  const car = pose(road, SPEC, s, d, route), player = pose(road, VEHICLES.truck_t1, s + 14, d, route);
  const context = { car, sim: { road, ground, player }, atk: null };
  const path = enemyDrivingContext(road, car, player, {});
  return { road, ground, car, player, context, path,
    safe: () => EnemyBrain.prototype._drillSafe.call(context, path) };
}

function actualRoad(seed) {
  const road = new Road(seed, { version: 1, mode: 'campaign', level: LEVEL.number });
  road.ensureDrivingBranches();
  return road;
}

function arenaWindows(road) {
  const windows = [];
  // Finite sample beyond the real chapter boss threshold. No road sample,
  // curvature, feature or branch plan is overridden to manufacture an arena.
  for (let s = LEVEL.bossDistance + 32; s <= LEVEL.bossDistance + 3800; s += 32) {
    const f = policy(road, s);
    if (f.safe() && (!windows.length || s - windows.at(-1).car.s >= 96)) windows.push(f);
  }
  return windows;
}

for (const seed of SEEDS) {
  test(`Underground seed ${seed}: actual generated route offers several bounded body-safe drill windows after its real boss threshold`, () => {
    const road = actualRoad(seed), windows = arenaWindows(road);
    assert.equal(DRIVING_ROUTE_VERSION, 5);
    assert.equal(LEVEL.number, 7); assert.equal(LEVEL.bossDistance, 5200);
    assert.ok(windows.length >= 3, `only ${windows.length} feasible windows; investigate the authored route/charge gate before shipping`);
    for (const f of windows.slice(0, 3)) {
      assert.equal(drillPhysicalFootprintFits(road, f.ground, f.car), true);
      for (const ds of [0, 25, 55]) assert.equal(drillLaneFootprintFits(road, f.ground, SPEC, f.car.s + ds, 0), true);
      assert.equal(f.car.spec.modelId, 'boss_deepwarden');
      assert.equal(f.car.spec.wheels.length, 6);
    }
  });
}

test('actual Underground service strips can fit the extracted tractor but remain a no-charge escape route', () => {
  let observed = 0;
  for (const seed of SEEDS) {
    const road = actualRoad(seed);
    for (const branch of road.ensureDrivingBranches()) {
      const s = (branch.s0 + branch.s1) / 2, f = policy(road, s, 0, branch.id);
      observed++;
      assert.equal(branch.biome, 'underground');
      assert.equal(f.path.branch, branch); assert.equal(f.path.crossRoute, false);
      assert.equal(drillLaneFootprintFits(road, f.ground, SPEC, s, 0, branch.id), true,
        `real ${branch.id} centre cannot fit exported tractor; do not assume nominal width means geometry fits`);
      assert.equal(drillPhysicalFootprintFits(road, f.ground, f.car), true);
      assert.equal(f.safe(), false, 'branch pursuit must never become a locked drill charge');
      f.car.route = null;
      const crossed = enemyDrivingContext(road, f.car, f.player, {});
      assert.equal(crossed.crossRoute, true);
      assert.equal(EnemyBrain.prototype._drillSafe.call(f.context, crossed), false);
    }
  }
  assert.ok(observed > 0, 'the actual selected seeds must expose at least one qualified service strip');
});

test('the real body envelope rejects wide and off-centre overhang even when a width-only gate could accept', () => {
  const road = actualRoad(7), f = arenaWindows(road)[0];
  assert.ok(f, 'a genuine source-generated arena window is required');
  const wide = { ...SPEC, width: .2, model: { ...SPEC.model,
    bbox: { min: [-8, .5, -2], max: [8, 2, 2] } } };
  assert.equal(drillLaneFootprintFits(road, f.ground, wide, f.car.s, 0), false);
  const asymmetric = { ...SPEC, width: 6, model: { ...SPEC.model,
    bbox: { min: [-1, .5, -2], max: [5, 2, 2] } } };
  assert.equal(drillLaneFootprintFits(road, f.ground, asymmetric, f.car.s, 0), true);
  assert.equal(drillLaneFootprintFits(road, f.ground, asymmetric, f.car.s, 2), false);
  assert.equal(drillLaneFootprintFits(road, f.ground, { ...SPEC, model: undefined }, f.car.s, 0), false,
    'missing real extraction fails closed rather than silently using width');
});

test('live body orientation and position qualify independently of a safe requested centreline', () => {
  const road = actualRoad(7), f = arenaWindows(road)[0];
  assert.ok(f);
  const original = f.car.veh.pos.clone(), originalQ = f.car.veh.quat.clone();
  assert.equal(f.safe(), true);
  // Body-centre d5.8 keeps the requested/player lane at0. A nominal target-lane
  // gate cannot detect the authored cutter/body overhang at the actual pose.
  const shifted = pose(road, SPEC, f.car.s, 5.8);
  f.car.veh.pos.copy(shifted.veh.pos); f.car.d = 5.8;
  assert.equal(drillLaneFootprintFits(road, f.ground, SPEC, f.car.s, 0), true);
  assert.equal(drillPhysicalFootprintFits(road, f.ground, f.car), false);
  assert.equal(f.safe(), false);
  f.car.veh.pos.copy(original); f.car.d = 0;
  const p = road.drivingPointAt(f.car.s, 3.5, null, {});
  f.car.veh.pos.set(p.x, p.y + .7, p.z);
  f.car.veh.quat.setFromAxisAngle(UP, p.th + Math.PI / 2);
  assert.equal(drillPhysicalFootprintFits(road, f.ground, f.car), false,
    'long turned body reaches the edge even while the fixture reports no lateral slip');
  f.car.veh.pos.copy(original); f.car.veh.quat.copy(originalQ);
  assert.equal(f.safe(), true, 'restored actual envelope can qualify again');
});

test('missing loaded support within the proposed charge corridor cancels despite both old endpoint checks succeeding', () => {
  const road = actualRoad(7), f = arenaWindows(road)[0];
  assert.ok(f); assert.equal(f.safe(), true);
  const s = f.car.s;
  f.ground.hasColliderAt = at => at < s + 22 || at > s + 28;
  assert.equal(f.ground.hasColliderAt(s), true);
  assert.equal(f.ground.hasColliderAt(f.player.s + 55), true);
  assert.equal(f.safe(), false, 'real projection samples require loaded middle support too');
});

test('locked wind/hit lanes cannot become a new target lane through the corridor guard', () => {
  const road = actualRoad(7), f = arenaWindows(road)[0];
  assert.ok(f);
  f.context.atk = { drill: true, phase: 'wind', lane: 7 };
  assert.equal(f.safe(), false, 'unfit locked lane must cancel rather than retarget to player centre');
  f.context.atk.lane = 0;
  assert.equal(f.safe(), true);
  f.player.d = .2; f.path.playerD = .2;
  assert.equal(f.safe(), true);
  assert.equal(f.context.atk.lane, 0);
  f.context.atk.phase = 'hit';
  assert.equal(f.safe(), true); assert.equal(f.context.atk.lane, 0);
});
