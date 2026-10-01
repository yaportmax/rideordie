import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { initPhysics, createWorld, addStaticBox } from '../src/sim/physics.js';
import { Vehicle } from '../src/sim/vehicle.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { ChaseCam } from '../src/view/camera_rig.js';

const DT = 1 / 120;
async function withTruck(check, id = 'truck_t1') {
  await initPhysics();
  const world = createWorld(DT);
  addStaticBox(world, [0, -1, 0], [2000, 1, 6000]);
  const truck = new Vehicle(world, structuredClone(VEHICLES[id]));
  const step = (input, count = 1) => {
    truck.setInput(input);
    for (let i = 0; i < count; i++) { truck.applyForces(DT, null); world.step(); truck.afterStep(); }
  };
  try { await check(truck, step); } finally { truck.destroy(); world.free(); }
}

test('holding boost through depletion produces one ignition, then recharges without engine chatter', async () => {
  for (const id of ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4']) await withTruck((truck, step) => {
    let previous = false, ignitions = 0, ends = 0, boostedSteps = 0, dryStep = 0;
    for (let i = 0; i < 120 * 9; i++) {
      step({ throttle: 1, nitro: true });
      if (truck.boosting && !previous) ignitions++;
      if (!truck.boosting && previous) { ends++; dryStep = i; }
      if (truck.boosting) boostedSteps++;
      previous = truck.boosting;
      assert.ok(Number.isFinite(truck.speed));
    }
    assert.equal(ignitions, 1, id + ' must not consume tiny recharge pulses while still held');
    assert.equal(ends, 1);
    assert.ok(boostedSteps >= truck.nitroMax / DT && boostedSteps <= truck.nitroMax / DT + 1, id + ' retains initial boost duration');
    assert.equal(truck.boosting, false);
    const expectedCharge = (120 * 9 - dryStep) * DT * truck.spec.nitro.regen;
    assert.ok(Math.abs(truck.nitro - Math.min(truck.nitroMax, expectedCharge)) < 1e-9, id + ' retains passive regeneration');
    assert.ok(truck.speed > 20, id + ' remains drivable when boost finishes');
  }, id);
});

test('empty tank and added fuel wait for release, then a partial meter provides one normal boost', async () => {
  await withTruck((truck, step) => {
    truck.nitro = 0;
    step({ throttle: 1, nitro: true }, 120);
    assert.equal(truck.boosting, false);
    assert.ok(Math.abs(truck.nitro - truck.spec.nitro.regen) < 1e-10);
    truck.nitro = .25; // A pickup or boost pad can add fuel while the control stays held.
    step({ throttle: 1, nitro: true }, 5);
    assert.equal(truck.boosting, false, 'a pickup must not re-trigger the depleted held press');
    assert.ok(truck.nitro > .25, 'new fuel and regeneration are preserved');
    step({ throttle: 1, nitro: false });
    const charge = truck.nitro;
    step({ throttle: 1, nitro: true });
    assert.equal(truck.boosting, true, 'release/re-press rearms available fuel immediately');
    assert.ok(Math.abs(truck.nitro - (charge - DT)) < 1e-10);
    let boostedSteps = 1;
    while (truck.boosting && boostedSteps < 120) {
      step({ throttle: 1, nitro: true }); if (truck.boosting) boostedSteps++;
    }
    assert.ok(boostedSteps <= Math.ceil(charge / DT) + 1);
    step({ throttle: 1, nitro: true }, 120);
    assert.equal(truck.boosting, false, 'second partial boost also ends cleanly');
    assert.ok(truck.nitro > 0);
  });
});

test('throttle, stun and driver death do not spend nitro or bypass a depleted held press', async () => {
  await withTruck((truck, step) => {
    step({ throttle: 1, nitro: true }, 15);
    const before = truck.nitro;
    step({ throttle: 0, nitro: true }, 10);
    assert.equal(truck.boosting, false);
    assert.ok(truck.nitro > before);
    step({ throttle: 1, nitro: true });
    assert.equal(truck.boosting, true, 'releasing throttle alone does not discard a nonempty boost press');
    truck.driverAlive = false;
    const aliveCharge = truck.nitro;
    step({ throttle: 1, nitro: true }, 15);
    assert.equal(truck.boosting, false); assert.ok(truck.nitro > aliveCharge);
    truck.driverAlive = true; truck.stunned = .1;
    step({ throttle: 1, nitro: true });
    assert.equal(truck.boosting, false, 'stunned throttle cannot boost');
    truck.stunned = 0;
    step({ throttle: 1, nitro: true }, 150);
    assert.equal(truck.boosting, false);
    truck.driverAlive = false; step({ throttle: 1, nitro: true }, 30);
    truck.driverAlive = true; step({ throttle: 0, nitro: true }, 30);
    step({ throttle: 1, nitro: true });
    assert.equal(truck.boosting, false, 'eligibility transitions cannot bypass exhaustion');
    step({ throttle: 1, nitro: false }); step({ throttle: 1, nitro: true });
    assert.equal(truck.boosting, true);
  });
});

test('depleted held boost retains the existing drift recharge bonus without re-igniting', async () => {
  await withTruck((truck, step) => {
    truck.nitro = 0;
    truck.body.setLinvel({ x: 10, y: 0, z: 20 }, true);
    step({ throttle: 1, nitro: true });
    assert.ok(Math.abs(truck.slipAngle) > .25 && truck.speed > 15, 'real body velocity enters drift recharge range');
    assert.equal(truck.boosting, false);
    assert.ok(Math.abs(truck.nitro - DT * truck.spec.nitro.regen * 3) < 1e-12, 'drift still recharges at three times the passive rate');
    step({ throttle: 1, nitro: true });
    assert.equal(truck.boosting, false, 'drift fuel cannot trigger a rapid depletion/recharge pulse');
  });
});

test('non-nitro vehicles keep a finite empty meter and never activate boost', async () => {
  await withTruck((truck, step) => {
    assert.equal(truck.nitroMax, 0);
    step({ throttle: 1, nitro: true }, 60);
    assert.equal(truck.boosting, false); assert.equal(truck.nitro, 0);
    step({ throttle: 1, nitro: false }); step({ throttle: 1, nitro: true });
    assert.equal(truck.boosting, false); assert.ok(Number.isFinite(truck.speed));
  }, 'e_sedan');
});

test('real cockpit camera retains one boost punch then settles after held depletion at even and uneven frame pacing', async () => {
  const schedules = [30, 45, 49, 60, 120].map(fps => ({ label: `${fps} FPS`, frameDt: () => 1 / fps }));
  schedules.push({ label: 'uneven 16/33/20/8/25 ms', frameDt: i => [.016, .033, .020, .008, .025][i % 5] });
  for (const { label, frameDt } of schedules) await withTruck((truck, step) => {
    const camera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 200), chase = new ChaseCam(camera);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), eye = new THREE.Vector3();
    let elapsed = 0, accumulator = 0, frame = 0, rises = 0, wasBoost = false, maxTrauma = 0, maxFov = 0;
    while (elapsed < 7) {
      const dt = frameDt(frame++); elapsed += dt; accumulator += dt;
      while (accumulator + 1e-10 >= DT) { step({ throttle: 1, nitro: true }); accumulator -= DT; }
      truck.lerpPose(Math.max(0, accumulator / DT), pos, quat);
      eye.set(.4, 1.55 - truck.restComHeight, .55).applyQuaternion(quat).add(pos);
      chase.update(dt, pos, quat, truck.vel, { cockpitEye: eye, boosting: truck.boosting });
      if (truck.boosting && !wasBoost) rises++;
      wasBoost = truck.boosting;
      maxTrauma = Math.max(maxTrauma, chase.shake.trauma); maxFov = Math.max(maxFov, camera.fov);
      if (elapsed > 2) { assert.equal(truck.boosting, false, label); assert.equal(chase.shake.trauma, 0, label + ' must stop repeated camera punches'); }
      assert.ok(camera.position.toArray().every(Number.isFinite));
    }
    assert.equal(rises, 1, label);
    assert.ok(maxTrauma > 0 && maxTrauma <= .22, label + ' preserves the initial boost punch');
    assert.ok(maxFov < 108, label + ' FOV must remain inside normal speed/boost targets');
  });
});
