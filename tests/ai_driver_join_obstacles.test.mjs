import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { AIDriver } from '../src/game/ai_driver.js';
import { Road } from '../src/world/road.js';
import { VEHICLES } from '../src/data/vehicles.js';

function fixture(driverBranch, separated = false, obstacle = 'car', continuation = null) {
  const road = new Road(7), branch = road.ensureDrivingBranches()[0];
  assert.ok(branch, 'actual authored fork is required');
  // Entry/exit labels differ despite overlapping physical lane space. At the
  // middle of the fork, the opposite corridor must remain genuinely separate.
  const s = continuation === 'exit' ? branch.s1 - 8 : continuation === 'entry' ? branch.s0 - 28 : separated ? (branch.s0 + branch.s1) / 2 : driverBranch ? branch.s1 - 20 : branch.s0 - 12;
  const obstacleS = s + (continuation === 'exit' ? 24 : 16);
  const ownRoute = driverBranch ? branch.id : null, otherRoute = driverBranch ? null : branch.id;
  const here = road.drivingPointAt(s, 0, ownRoute, {}), ahead = road.drivingPointAt(obstacleS, 0, otherRoute, {});
  const P = { id: 1, s, d: 0, route: ownRoute, spec: VEHICLES.truck_t1,
    crew: { driver: { alive: true, hp: 100, max: 100 }, gunner: { alive: true, hp: 100, max: 100 } },
    veh: { pos: new Vector3(here.x, here.y + 1, here.z), fwd: new Vector3(Math.sin(here.th), 0, Math.cos(here.th)), left: new Vector3(Math.cos(here.th), 0, -Math.sin(here.th)),
      up: new Vector3(0, 1, 0), vel: new Vector3(), vf: 0, speed: 0, nitroMax: 0, nitro: 0 } };
  const other = { id: 2, s: obstacleS, d: 0, route: otherRoute, kind: 'enemy', exploded: obstacle === 'wreck',
    veh: { pos: new Vector3(ahead.x, ahead.y + 1, ahead.z), vel: new Vector3(), vf: 0 } };
  // Isolate existing obstacle policy from random roadblocks/stage instructions,
  // retaining actual fork geometry/projections and ordinary16m pursuit.
  road.featuresIn = () => [];
  const sim = { road, state: 'run', time: 1, cars: new Map([[1, P]]), hazards: { enemyMines: [] }, boss: null };
  const driver = new AIDriver({ player: P, sim, _unflip() {} }); driver._route = ownRoute; driver.laneT = 100;
  const clean = { ...driver.update(1 / 60) };
  if (obstacle === 'mine') sim.hazards.enemyMines.push({ pos: other.veh.pos.clone() });
  else sim.cars.set(2, other);
  const occupied = { ...driver.update(1 / 60) };
  return { clean, occupied, road, branch, P, other };
}

for (const obstacle of ['car', 'wreck', 'mine']) {
  test(`${obstacle}: branch-labelled pursuit detects actual main-road continuation beyond exit and before entry`, () => {
    for (const continuation of ['exit', 'entry']) {
      const f = fixture(true, false, obstacle, continuation);
      assert.ok(continuation === 'exit' ? f.other.s > f.branch.s1 + 8 : f.other.s < f.branch.s0 - 8);
      assert.ok(Math.abs(f.occupied.steer - f.clean.steer) > .01, `${continuation}: future main-road hazard must not be lost at finite branch endpoint`);
    }
  });
  test(`${obstacle}: existing avoidance sees different-route overlap at entry/exit joins`, () => {
    for (const driverBranch of [false, true]) {
      const f = fixture(driverBranch, false, obstacle);
      assert.ok(Math.abs(f.occupied.steer - f.clean.steer) > .01, `driverBranch=${driverBranch}: physically overlapping hazard must affect pursuit`);
      assert.ok(Number.isFinite(f.occupied.steer));
    }
  });
  test(`${obstacle}: genuinely separated opposite fork does not alter the driver's own pursuit`, () => {
    for (const driverBranch of [false, true]) {
      const f = fixture(driverBranch, true, obstacle);
      assert.ok(Math.abs(f.occupied.steer - f.clean.steer) < 1e-12);
      assert.equal(f.occupied.throttle, f.clean.throttle); assert.equal(f.occupied.brake, f.clean.brake);
    }
  });
}

test('same-route vehicle avoidance retains legacy policy and ordinary16m pursuit lookahead', () => {
  const f = fixture(false, false);
  f.other.route = f.P.route;
  const point = f.road.drivingPointAt(f.other.s, 0, f.P.route, {});
  f.other.veh.pos.set(point.x, point.y + 1, point.z);
  const calls = [], original = f.road.pointAt;
  f.road.pointAt = function(s, d, out) { calls.push({ s, d }); return original.call(this, s, d, out); };
  const sim = { road: f.road, state: 'run', time: 1, cars: new Map([[1, f.P], [2, f.other]]), hazards: { enemyMines: [] }, boss: null };
  const driver = new AIDriver({ player: f.P, sim, _unflip() {} }); driver._route = null; driver.laneT = 100;
  const c = driver.update(1 / 60);
  assert.ok(calls.some(call => Math.abs(call.s - (f.P.s + 16)) < 1e-12 && Math.abs(call.d) > 0));
  assert.ok(Math.abs(c.steer - f.clean.steer) > .01);
});

test('locked stage passage brakes for overlapping cross-route wrecks using own-corridor lateral position', () => {
  const f = fixture(false, false, 'wreck');
  const feature = { type: 'stage_challenge', s0: f.P.s + 50, s1: f.P.s + 54, passSide: 1, gap: 6, challengeId: 'fixture', row: 0 };
  f.road.featuresIn = (_a, _b, type) => type === 'stage_challenge' ? [feature] : [];
  const p = f.road.drivingPointAt(f.other.s, 3, f.branch.id, {});
  f.other.veh.pos.set(p.x, p.y + 1, p.z); f.other.d = -5; // foreign local d must not decide a main-road passage.
  f.P.veh.speed = f.P.veh.vf = 32;
  const sim = { road: f.road, state: 'run', time: 1, cars: new Map([[1, f.P]]), hazards: { enemyMines: [] }, boss: null };
  const driver = new AIDriver({ player: f.P, sim, _unflip() {} }); driver._route = null; driver.laneT = 100;
  const clean = { ...driver.update(1 / 60) };
  sim.cars.set(2, f.other); const blocked = driver.update(1 / 60);
  assert.ok(blocked.brake > clean.brake + .2, 'physical wreck in locked passage must brake without crossing solid edge');
  assert.equal(blocked.steer, clean.steer, 'stage owns steering while traffic only lowers speed');
});
