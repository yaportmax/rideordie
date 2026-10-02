import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Director } from '../src/sim/director.js';
import { Road } from '../src/world/road.js';

function fixture(route, side) {
  const road = new Road(7), branch = road.ensureDrivingBranches()[0];
  const s = branch.s0 + (branch.s1 - branch.s0) * 0.25;
  const impulses = [], torques = [], rolls = [0.2, 0.7];
  const car = { id: 2, kind: 'enemy', s, d: side, route: route ? branch.id : null, spec: {},
    lastHitBy: 1, lastHitT: 10, veh: { mass: 1300, speed: 30, fwd: new Vector3(0.2, 0, 0.98), pos: new Vector3(),
      body: { applyImpulse(v, wake) { impulses.push({ ...v, wake }); }, applyTorqueImpulse(v, wake) { torques.push({ ...v, wake }); } } } };
  const sim = { road, time: 11, cars: new Map([[2, car]]) };
  const director = new Director();
  let calls = 0;
  director.r = () => { calls++; assert.ok(rolls.length, 'no additional RNG draw'); return rolls.shift(); };
  return { road, branch, s, car, sim, director, impulses, torques, get calls() { return calls; } };
}

test('branch wreck push follows the actual branch normal and preserves authored force/torque/RNG', () => {
  for (const side of [-1, 1]) {
    const f = fixture(true, side);
    const branch = f.road.drivingPointAt(f.s, 0, f.branch.id, {}), main = f.road.sample(f.s, {});
    assert.ok(Math.abs(branch.nx - main.nx) + Math.abs(branch.nz - main.nz) > 0.01,
      'negative control must distinguish branch and main tangents');
    f.director.onExplode(f.sim, f.car);
    assert.equal(f.calls, 2); assert.equal(f.impulses.length, 1); assert.equal(f.torques.length, 1);
    const push = 1300 * (4 + 0.7 * 3 + 30 * 0.14), impulse = f.impulses[0];
    assert.ok(Math.abs(impulse.x - branch.nx * side * push) < 1e-8);
    assert.ok(Math.abs(impulse.z - branch.nz * side * push) < 1e-8);
    assert.equal(impulse.y, 0); assert.equal(impulse.wake, true);
    assert.ok(Math.abs(impulse.x - main.nx * side * push) + Math.abs(impulse.z - main.nz * side * push) > 1);
    // The fixture's first RNG value0.2 selects the original positive tumble.
    const torque = 1300 * (2.5 + 30 * 0.12);
    assert.deepEqual(f.torques[0], { x: 0.2 * torque, y: 0 * torque, z: 0.98 * torque, wake: true });
  }
});

test('main wreck launch retains the exact original sample, sign, magnitude and two RNG draws', () => {
  for (const side of [-1, 1]) {
    const f = fixture(false, side), main = f.road.sample(f.s, {});
    f.road.drivingPointAt = () => { throw new Error('main path must not use branch lookup'); };
    f.director.onExplode(f.sim, f.car);
    const push = 1300 * (4 + 0.7 * 3 + 30 * 0.14);
    assert.deepEqual(f.impulses[0], { x: main.nx * side * push, y: 0, z: main.nz * side * push, wake: true });
    assert.equal(f.calls, 2);
  }
});

test('forward lethal-ram launch skips roadside frame, torque and RNG while chain credit stays active', () => {
  const f = fixture(true, 1);
  f.road.sample = f.road.drivingPointAt = () => { throw new Error('replacement launch must not query any roadside frame'); };
  const neighbor = { id: 3, kind: 'enemy', exploded: false, spec: {}, veh: { pos: new Vector3(3, 0, 0) },
    crew: { driver: { alive: false } }, fuseT: -1, burning: 0 };
  f.sim.cars.set(3, neighbor); f.sim.emit = () => {};
  f.director.r = () => 0.3;
  f.director.onExplode(f.sim, f.car, { launchWreck: false });
  assert.equal(f.impulses.length, 0); assert.equal(f.torques.length, 0);
  assert.equal(neighbor.lastHitBy, 1); assert.equal(neighbor.lastHitT, 11);
  assert.equal(neighbor.chainFrom, 2); assert.ok(neighbor.fuseT > 0);
});
