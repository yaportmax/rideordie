import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { EnemyBrain, enemyDrivingContext } from '../src/sim/ai.js';
import { Road } from '../src/world/road.js';
import { VEHICLES } from '../src/data/vehicles.js';

function car(road, s, d, route, id, spec = VEHICLES.e_muscle) {
  const p = road.drivingPointAt(s, d, route, {});
  return { id, s, d, route, spec, kind: id === 1 ? 'player' : 'enemy', crew: { driver: { alive: true } },
    veh: { pos: new Vector3(p.x, p.y + 1, p.z), fwd: new Vector3(Math.sin(p.th), 0, Math.cos(p.th)),
      left: new Vector3(Math.cos(p.th), 0, -Math.sin(p.th)), up: new Vector3(0, 1, 0),
      input: {}, vf: 28, speed: 28, vl: 0 } };
}
function fixture({ enemyRoute, playerRoute, enemyD = 0, playerD = 0, spec } = {}) {
  const road = new Road(7), branch = road.ensureDrivingBranches()[0];
  assert.ok(branch, 'actual planned branch required');
  const s = (branch.s0 + branch.s1) / 2;
  const enemy = car(road, s, enemyD, enemyRoute ? branch.id : null, 2, spec);
  const player = car(road, s + 30, playerD, playerRoute ? branch.id : null, 1);
  const sim = { road, player, cars: new Map([[1, player], [2, enemy]]), emit() {}, time: 10 };
  const brain = new EnemyBrain(enemy, sim, { behavior: 'flanker', skill: 0.6, level: 0.8, guns: {} });
  brain.atkCd = 99; brain.laneT = 99;
  return { road, branch, enemy, player, sim, brain };
}

test('same-branch controller targets the branch strip and keeps complete chassis support at both edges', () => {
  for (const spec of [VEHICLES.e_muscle, VEHICLES.e_heavy]) for (const side of [-1, 1]) {
    const f = fixture({ enemyRoute: true, playerRoute: true, enemyD: side * 4, playerD: side * 3, spec });
    f.brain.dTs = side * 7.3; // old main-road attack target at the route transition
    f.brain._drive(1 / 60, side * 20, 50, 0, false, false, true);
    const limit = f.branch.width / 2 - spec.width / 2 - 0.35;
    assert.ok(Math.abs(f.brain._lastDT) <= limit + 1e-9);
    assert.ok(Math.abs(f.brain._lastDT) + spec.width / 2 + 0.35 <= f.branch.width / 2 + 1e-9);
    const p = f.road.drivingPointAt(f.enemy.s + 24.8, f.brain._lastDT, f.branch.id, {});
    assert.ok(Math.hypot(f.brain._tp.x - p.x, f.brain._tp.z - p.z) < 1e-8);
    assert.ok(Number.isFinite(f.enemy.veh.input.steer));
  }
});

test('cross-route lateral positions are projected from world geometry, never mixed local d values', () => {
  for (const arrangement of [{ enemyRoute: true, playerRoute: false }, { enemyRoute: false, playerRoute: true }]) {
    const f = fixture(arrangement), context = enemyDrivingContext(f.road, f.enemy, f.player);
    assert.equal(context.crossRoute, true);
    assert.ok(Math.abs(context.playerD - f.player.d) > 10);
    f.brain.atk = { kind: 'swipe', phase: 'hit', t: 0, side: 1 };
    f.brain.update(1 / 60);
    assert.equal(f.brain.atk, null, 'no lateral ram across separated roads');
    const limit = context.halfWidth - f.enemy.spec.width / 2 - 0.35;
    assert.ok(Math.abs(f.brain._lastDT) <= limit + 1e-9);
    assert.equal(f.brain._tp.route || null, arrangement.enemyRoute ? f.branch.id : null);
  }
});

test('same-route lane coordinates remain exact and main-road pursuit retains its original target', () => {
  const f = fixture({ enemyD: 1, playerD: 2 });
  const context = enemyDrivingContext(f.road, f.enemy, f.player);
  assert.equal(context.crossRoute, false); assert.equal(context.carD, 1); assert.equal(context.playerD, 2);
  f.brain._drive(1 / 60, 2, 40, 0, false, false);
  assert.equal(f.brain._lastDT, 1);
  const p = f.road.pointAt(f.enemy.s + 24.8, 1, {});
  assert.equal(f.brain._tp.x, p.x); assert.equal(f.brain._tp.z, p.z);
});

test('a blocked narrow branch brakes instead of adding outward collision-avoidance steering', () => {
  const f = fixture({ enemyRoute: true, playerRoute: true });
  f.player.veh.pos.copy(f.enemy.veh.pos).addScaledVector(f.enemy.veh.fwd, 7);
  f.player.veh.vf = 10;
  f.brain._drive(1 / 60, 0, 40, 0, false, false);
  assert.ok(f.enemy.veh.input.brake >= 0.6);
  assert.ok(Math.abs(f.enemy.veh.input.steer) < 0.35, 'pursuit remains on the existing strip');
});

test('main roadblock/challenge lane offsets are not applied to an occupied branch', () => {
  const f = fixture({ enemyRoute: true, playerRoute: true });
  const original = f.road.featuresIn;
  f.road.featuresIn = function(...args) {
    assert.notEqual(args[2], 'roadblock'); assert.notEqual(args[2], 'stage_challenge');
    return original.apply(this, args);
  };
  f.brain.update(1 / 60);
  assert.equal(f.brain._tp.route, f.branch.id);
});
