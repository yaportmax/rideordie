import test from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics, createWorld, addStaticBox, GRAVITY } from '../src/sim/physics.js';
import { Vehicle } from '../src/sim/vehicle.js';
import { VEHICLES, rideInfo } from '../src/data/vehicles.js';

const DT = 1 / 120;
async function constructOrder(ids) {
  await initPhysics();
  const specs = structuredClone(VEHICLES), before = JSON.stringify(specs), world = createWorld(DT), cars = new Map();
  for (const spec of Object.values(specs)) Object.freeze(spec.susp);
  addStaticBox(world, [0, -1, 0], [2000, 1, 6000]);
  try {
    const locations = Object.keys(specs);
    for (const id of ids) cars.set(id, new Vehicle(world, specs[id], { x: locations.indexOf(id) * 25 }));
    for (let step = 0; step < 360; step++) {
      for (const vehicle of cars.values()) vehicle.applyForces(DT, null);
      world.step();
      for (const vehicle of cars.values()) vehicle.afterStep();
    }
    const result = Object.fromEntries([...cars].map(([id, v]) => {
      const spec = specs[id], massPerWheel = spec.mass / spec.wheels.length, canonical = rideInfo(VEHICLES[id]);
      const expectedK = spec.susp.k ?? massPerWheel * (2 * Math.PI * (spec.susp.freq ?? 2.1)) ** 2;
      const expectedC = spec.susp.c ?? 2 * (spec.susp.zeta ?? .5) * Math.sqrt(expectedK * massPerWheel);
      assert.equal(v.springK, expectedK, `${id} must derive springs from its own mass`);
      assert.equal(v.damperC, expectedC, `${id} must derive damping from its own mass`);
      assert.equal(v.spec, spec, 'keep supplied spec identity and explicit settings');
      assert.ok(Math.abs(v.restComHeight - canonical.restComHeight) < 1e-12, `${id} authority/view ride heights must agree`);
      assert.ok(Math.abs(v.restLen - (v.maxLen - massPerWheel * GRAVITY / expectedK)) < 1e-12);
      assert.ok(v.pos.toArray().every(Number.isFinite));
      assert.ok(v.wheels.every(w => w.grounded), `${id} must settle on its raycast wheels`);
      return [id, { springK: v.springK, damperC: v.damperC, restLen: v.restLen, restComHeight: v.restComHeight,
        position: v.pos.toArray(), rotation: v.quat.toArray(), lengths: v.wheels.map(w => w.L) }];
    }));
    assert.equal(JSON.stringify(specs), before, 'constructing/stepping every car must not mutate any suspension/spec table');
    return result;
  } finally { for (const vehicle of cars.values()) vehicle.destroy(); world.free(); }
}

test('all player and enemy suspension coefficients, settled poses and view ride heights are independent of spawn order', async () => {
  const ids = Object.keys(VEHICLES);
  const forward = await constructOrder(ids), reversed = await constructOrder([...ids].reverse());
  for (const id of ids) {
    assert.equal(reversed[id].springK, forward[id].springK, id);
    assert.equal(reversed[id].damperC, forward[id].damperC, id);
    assert.equal(reversed[id].restLen, forward[id].restLen, id);
    for (const field of ['position', 'rotation', 'lengths']) forward[id][field].forEach((value, i) => {
      assert.ok(Math.abs(value - reversed[id][field][i]) < 1e-7, `${id} ${field}[${i}] changed with construction order`);
    });
  }
});

test('repeated tier restarts preserve canonical spec tables and respect explicit custom spring/damper coefficients', async () => {
  const original = JSON.stringify(VEHICLES);
  await constructOrder(['truck_t1', 'truck_t4', 'truck_t2', 'truck_t3']);
  await constructOrder(['truck_t4', 'truck_t1', 'truck_t3', 'truck_t2']);
  assert.equal(JSON.stringify(VEHICLES), original);
  const spec = structuredClone(VEHICLES.truck_t1), world = createWorld(DT);
  spec.susp = Object.freeze({ ...spec.susp, k: 64000, c: 5100 });
  const vehicle = new Vehicle(world, spec);
  try {
    assert.equal(vehicle.springK, 64000); assert.equal(vehicle.damperC, 5100);
    assert.equal(vehicle.restComHeight, rideInfo(spec).restComHeight);
    assert.ok(Object.isFrozen(spec.susp));
  } finally { vehicle.destroy(); world.free(); }
});
