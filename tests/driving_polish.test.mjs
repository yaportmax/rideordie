import test from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics, createWorld, addStaticBox, GRAVITY } from '../src/sim/physics.js';
import { Vehicle } from '../src/sim/vehicle.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { DEFAULT_PROFILE, effects } from '../src/data/upgrades.js';
import { familyOf } from '../src/data/vehicle_families.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';
import { Sim } from '../src/sim/sim.js';
import { StructureColliders } from '../src/sim/structure_colliders.js';
import { loadRockAssets } from './helpers/rock-assets.mjs';
import { RockCollisionBatch } from '../src/world/dressing/rock_collisions.js';
import { InstList } from '../src/world/dressing/util.js';
import { SCATTER, tierOf } from '../src/world/dressing/types.js';

const DT = 1 / 120;
const trucks = ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4'];
function upgradedProfile(id, levels) {
  const p = DEFAULT_PROFILE(); p.truck = id;
  if (!p.trucks.includes(id)) p.trucks.push(id);
  Object.assign(p.vehicleUpgrades[familyOf(id)], levels);
  return p;
}
async function withCar(id, check, spec = VEHICLES[id]) {
  await initPhysics();
  const world = createWorld(DT), ground = addStaticBox(world, [0, -1, 0], [10000, 1, 10000]);
  const car = new Vehicle(world, structuredClone(spec));
  const step = (input = {}, count = 1) => {
    car.setInput(input);
    for (let i = 0; i < count; i++) {
      car.applyForces(DT, null); world.step(); car.afterStep();
      assert.ok(car.pos.toArray().every(Number.isFinite) && Number.isFinite(car.speed), id);
    }
  };
  try { step({}, 240); return await check(car, step, world); }
  finally {
    car.destroy(); world.removeRigidBody(ground.rb);
    assert.equal(world.bodies.len(), 0, 'vehicle and owned world fixtures must release');
    assert.equal(world.colliders.len(), 0); world.free();
  }
}

test('every chassis reaches its greater cruising speed gradually on a real straight road', async () => {
  for (const id of Object.keys(VEHICLES)) await withCar(id, (car, step) => {
    let t90 = null; const speeds = [];
    // The slow ten-ton bus has a longer velocity/acceleration time scale.
    // Let every chassis settle for seven of its own time scales, retaining
    // the original minimum interval and the same strict terminal tolerance.
    const settleSeconds = Math.max(80, Math.ceil(7 * car.spec.engine.vmax / car.spec.engine.accel0));
    for (let sec = 1; sec <= settleSeconds; sec++) {
      step({ throttle: 1 }, 120); speeds.push(car.speed);
      assert.equal(car.poseRevision, 0, 'ordinary physics never marks a teleport');
      assert.equal(car.grounded, car.wheels.length, id + ' stays supported on asphalt');
      assert.ok(car.up.y > .99, id + ' remains upright');
    }
    const cruise = speeds.at(-1);
    t90 = speeds.findIndex(speed => speed >= cruise * .9) + 1;
    assert.ok(cruise > car.spec.engine.vmax * .84 && cruise < car.spec.engine.vmax, id + ' settles near its stated limit');
    assert.ok(t90 >= 13, id + ' higher cruising speed needs a sustained straight');
    assert.ok(speeds[4] < cruise * .65 && speeds[29] > cruise * .95, id + ' early and late acceleration differ');
    assert.ok(Math.abs(speeds.at(-1) - speeds.at(-11)) < .003,
      id + ' reaches a stable eventual cruise within ' + settleSeconds + 's');
  });
});

test('left/right steering is mirrored and turns trade cruising speed for grip without rollover', async () => {
  for (const id of trucks) {
    const results = [];
    for (const steer of [1, -1]) results.push(await withCar(id, (car, step) => {
      step({ throttle: 1 }, 30 * 120); const startSpeed = car.speed;
      let minUp = 1;
      for (let i = 0; i < 6 * 120; i++) {
        step({ throttle: 1, steer }); minUp = Math.min(minUp, car.up.y);
        assert.equal(car.grounded, 4, id + ' keeps four wheels through the turn');
      }
      assert.ok(minUp > .9 && car.speed < startSpeed * .94, id + ' high speed corner needs a lift');
      assert.equal(Math.sign(car.pos.x), steer, id + ' +X is the authored left direction');
      return { x: car.pos.x, z: car.pos.z, speed: car.speed, yaw: car.yawRate };
    }));
    assert.ok(Math.abs(results[0].x + results[1].x) < .01, id + ' symmetric wheel loads');
    assert.ok(Math.abs(results[0].z - results[1].z) < .01);
    assert.ok(Math.abs(results[0].speed - results[1].speed) < .01);
    assert.ok(Math.abs(results[0].yaw + results[1].yaw) < .001);
  }
});

test('wheel spring loads carry aero downforce exactly once and damp to a stable ride height', async () => {
  for (const id of trucks) await withCar(id, (car, step) => {
    let total = 0, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < 4 * 120; i++) {
      const vel = car.body.linvel();
      car.body.setLinvel({ x: 0, y: vel.y, z: 40 }, true);
      step({}); if (i >= 3 * 120) {
        total += car.wheels.reduce((sum, w) => sum + w.load, 0);
        minY = Math.min(minY, car.pos.y); maxY = Math.max(maxY, car.pos.y);
      }
    }
    const meanLoad = total / 120;
    const expected = car.mass * (GRAVITY + car.spec.downforce * 40 ** 2 * .01);
    assert.ok(Math.abs(meanLoad / expected - 1) < .002, id + ' springs already include all aerodynamic load');
    assert.ok(maxY - minY < .0005 && car.up.y > .99, id + ' settled suspension varies by less than half a millimeter');
  });
});

test('real tangential tire impulses never exceed the actual spring load grip budget at high speed', async () => {
  for (const id of trucks) await withCar(id, (car, step) => {
    for (let i = 0; i < 4 * 120; i++) {
      const vel = car.body.linvel(); car.body.setLinvel({ x: 0, y: vel.y, z: 40 }, true); step({});
    }
    const calls = [], apply = car.body.applyImpulseAtPoint;
    car.body.applyImpulseAtPoint = function (impulse, point, wake) {
      calls.push({ x: impulse.x, y: impulse.y, z: impulse.z });
      return apply.call(this, impulse, point, wake);
    };
    try {
      const vel = car.body.linvel(); car.body.setLinvel({ x: 50, y: vel.y, z: 40 }, true);
      car.setInput({}); car.applyForces(DT, null);
      assert.equal(calls.length, 8, 'four real suspension impulses followed by four tires');
      for (let i = 0; i < 4; i++) {
        const w = car.wheels[i], impulse = calls[4 + i];
        const mu = Math.max(w.front ? car.spec.grip.front : car.spec.grip.rear, car.spec.grip.long);
        assert.ok(Math.hypot(impulse.x, impulse.z) <= mu * w.load * DT * 1.000001,
          id + ' high lateral demand cannot spend aero load twice');
      }
    } finally { car.body.applyImpulseAtPoint = apply; }
  });
});

test('all truck tiers retain strong brakes, capped reverse and stable alternating steering at their new speeds', async () => {
  for (const id of trucks) await withCar(id, (car, step) => {
    step({ throttle: 1 }, 30 * 120);
    for (let i = 0; i < 4; i++) {
      step({ throttle: 1, steer: i % 2 ? -1 : 1 }, 60);
      assert.ok(car.up.y > .9 && car.grounded === 4, id + ' keyboard flicks cannot roll the truck');
    }
    let stop = null;
    for (let i = 0; i < 8 * 120; i++) {
      step({ brake: 1 });
      if (car.speed < .5) { stop = (i + 1) * DT; break; }
    }
    assert.ok(stop !== null && stop < 5, id + ' braking from high speed remains useful');
    step({ brake: 1 }, 15 * 120);
    assert.ok(car.vf < -2 && Math.abs(car.vf) < car.spec.engine.reverseMax, id + ' reverse stays controllable and capped');
  });
});

test('runtime and garage effects preserve each chassis tank and purchased duration/refill progression', () => {
  const specsBefore = JSON.stringify(VEHICLES);
  for (const id of trucks) for (let level = 0; level <= 5; level++) {
    const profile = upgradedProfile(id, { nitro: level }), original = JSON.stringify(profile);
    const e = effects(profile), { spec } = buildPlayerSpec(profile), base = VEHICLES[id].nitro;
    const extraCapacity = level ? .4 + .8 * level : 0;
    assert.equal(e.nitroCap, base.capacity + extraCapacity);
    assert.equal(e.nitroRegen, e.nitroCap / Math.max(8, 12 - level));
    assert.equal(spec.nitro.capacity, e.nitroCap); assert.equal(spec.nitro.regen, e.nitroRegen);
    assert.equal(JSON.stringify(profile), original);
  }
  assert.equal(JSON.stringify(VEHICLES), specsBefore, 'profile upgrades cannot mutate canonical vehicle specs');
});

test('actual profile-built tier tanks burn once, then require full recharge and a released press', async () => {
  for (const id of trucks) {
    const { spec } = buildPlayerSpec(upgradedProfile(id, { nitro: 2 }));
    await withCar(id, (car, step) => {
      let starts = 0, previous = false, boosted = 0;
      for (let i = 0; i < 15 * 120; i++) {
        step({ throttle: 1, nitro: true });
        if (car.boosting && !previous) starts++;
        if (car.boosting) boosted++;
        previous = car.boosting;
        assert.ok(car.up.y > .99, id + ' finite held boost stays stable');
      }
      assert.equal(starts, 1); assert.equal(car.boosting, false);
      assert.ok(Math.abs(boosted * DT - spec.nitro.capacity) <= DT);
      assert.ok(car.nitro > 0 && car.nitro <= car.nitroMax, id + ' refill remains finite');
      step({ throttle: 1, nitro: false }); step({ throttle: 1, nitro: true });
      assert.equal(car.boosting, !car.nitroRechargeLocked, id + ' a fresh press cannot bypass an unfinished refill');
      if (car.nitroRechargeLocked) {
        for (let i = 0; i < 12 * 120 && car.nitroRechargeLocked; i++) step({ throttle: 1, nitro: false });
        assert.equal(car.nitro, car.nitroMax, id + ' full refill is required after depletion');
        step({ throttle: 1, nitro: true });
        assert.equal(car.boosting, true, id + ' fully recharged tank accepts a fresh burst');
      }
    }, spec);
  }
});

test('new upgraded/boost speed ceilings retain CCD crash response against an actual shipped boulder', async () => {
  const asset = (await loadRockAssets()).get('boulder_03'), entry = SCATTER.find(e => e.id === 'boulder_03');
  const list = new InstList(), batch = new RockCollisionBatch(), requests = [];
  const scale = 1.8;
  list.push(12, -entry.sink * asset.height * scale, 20, 0, scale * .95, scale, scale * 1.05, 0, 1, 0, entry.align, asset.sphere.radius * scale);
  batch.add(entry, asset, scale, list.m, 0);
  batch.flush({ hook: request => requests.push(request) }, { c: 0, hooks: [] }, tierOf(entry));
  for (const id of trucks) {
    const sim = await new Sim({ seed: 7 }).init(), structures = new StructureColliders(sim.world);
    try {
      sim.director.enabled = false;
      addStaticBox(sim.world, [0, -.5, 25], [70, .5, 90]);
      for (const request of requests) structures.hook(request);
      sim.structures = structures;
      const { spec } = buildPlayerSpec(upgradedProfile(id, { engine: 5 }));
      const player = sim.spawnCar(id, { kind: 'player', spec }), veh = player.veh;
      veh.body.setTranslation({ x: 12, y: veh.restComHeight + .05, z: 0 }, true);
      veh.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      veh.body.setLinvel({ x: 0, y: 0, z: spec.engine.vmax * 1.18 }, true);
      veh.afterStep(); structures.updateRocks(sim.cars.values(), 100);
      sim.start(); sim.drainEvents(); let crashes = 0;
      for (let i = 0; i < 80; i++) {
        structures.updateRocks(sim.cars.values()); sim.step(DT);
        crashes += sim.drainEvents().filter(e => e.t === 'crash' && e.id === 1).length;
      }
      assert.ok(crashes > 0 && player.hp < player.maxHp, id + ' actual high speed impact cannot tunnel through rock without collision');
      assert.ok(veh.pos.toArray().every(Number.isFinite));
    } finally { structures.dispose(); sim.dispose(); }
  }
});
