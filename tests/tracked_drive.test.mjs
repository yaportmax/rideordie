// AUTHORED, UNRUN. Root-only complete candidate CPU checks, never native proof.
// The real candidate must include the actual tank spec and shared rideInfo patch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';

const candidate = fileURLToPath(new URL('../', import.meta.url));
const prefix = 'tank-tracked-before://source/';
const frozen = resolve(candidate, 'tests/fixtures/tank_before_version');
const sourcePaths = ['src/sim/vehicle.js', 'src/data/vehicles.js'];
const oldSources = new Map(sourcePaths.map(path => [prefix + path, readFileSync(resolve(frozen, path + '.txt'), 'utf8')]));
const load = (root, path) => import(pathToFileURL(resolve(root, path)).href);
assert.equal(createHash('sha256').update(oldSources.get(prefix + 'src/sim/vehicle.js')).digest('hex').toUpperCase(),
  'D9BCF9D2001A646825A2897847AC6ED0BE2D55C3126ACAAEA217A7EA04518C4D', 'baseline Vehicle must be the bound unchanged source');
assert.equal(createHash('sha256').update(readFileSync(resolve(candidate, 'src/sim/physics.js'))).digest('hex').toUpperCase(),
  'FE111CD68FC25F201CFC1A90F146E21AAF1340D380E1B3D27ECF723E01DEA7FA', 'baseline physics world must be the bound unchanged source');
const { VEHICLES, rideInfo } = await load(candidate, 'src/data/vehicles.js');
const { Vehicle } = await load(candidate, 'src/sim/vehicle.js');
const physics = await load(candidate, 'src/sim/physics.js');
const oldHooks = registerHooks({
  resolve(specifier, context, next) {
    if (oldSources.has(specifier)) return { url: specifier, shortCircuit: true };
    if (context.parentURL?.startsWith(prefix) && specifier.startsWith('.')) {
      const url = new URL(specifier, context.parentURL).href;
      if (oldSources.has(url)) return { url, shortCircuit: true };
      return { url: pathToFileURL(resolve(candidate, new URL(url).pathname.slice(1))).href, shortCircuit: true };
    }
    if (context.parentURL?.startsWith(prefix)) {
      // Package resolution needs a real file parent on Windows. Retain the
      // immutable baseline namespace/source while resolving its bare imports
      // through the corresponding candidate file and unchanged dependencies.
      return next(specifier, { ...context,
        parentURL: pathToFileURL(resolve(candidate, new URL(context.parentURL).pathname.slice(1))).href });
    }
    return next(specifier, context);
  },
  load(url, context, next) { return oldSources.has(url) ? { format: 'module', source: oldSources.get(url), shortCircuit: true } : next(url, context); },
});
let OLD_VEHICLES, OldVehicle;
try { ({ VEHICLES: OLD_VEHICLES } = await import(prefix + 'src/data/vehicles.js')); ({ Vehicle: OldVehicle } = await import(prefix + 'src/sim/vehicle.js')); }
finally { oldHooks.deregister(); }
const oldPhysics = physics; // exact hash-bound unchanged Rapier world law
const { trackedContactRadius, createTrackedDriveState, writeTrackedDriveForces } = await load(candidate, 'src/sim/tracked_drive.js');
const tank = VEHICLES.player_tank_t1;
if (!tank || tank.driveMode !== 'tracks') throw new Error('Actual integrated player_tank_t1 is required; no positive synthetic Vehicle spec');
const DT = 1 / 120;
const close = (a, b, label, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${label}: ${a} vs ${b}`);
const contacts = () => tank.wheels.map(w => ({ mount: { x: w.x, z: w.z }, drive: w.drive,
  grounded: true, load: tank.mass * physics.GRAVITY / 4, surface: { grip: 1 }, grip: 1 }));
const solve = (wheels, steer = 1, drive = 0, budget = 18000, yaw = 0, enabled = true) =>
  writeTrackedDriveForces(createTrackedDriveState(tank), tank, wheels, drive, budget, steer, yaw, enabled);

test('four-contact track calibration preserves measured art radius and rejects invalid side/contact layouts', () => {
  assert.equal(tank.wheels.length, 4); assert.equal(tank.mass, 6500);
  assert.equal(trackedContactRadius(tank), .39); assert.equal(tank.wheelRadius, tank.model.wheels.FL.r);
  assert.notEqual(tank.wheelRadius, trackedContactRadius(tank), 'shoe envelope is independent of actual roadwheel geometry');
  for (const change of [s => { s.wheels.pop(); }, s => { s.wheels[0].x = 0; },
    s => { s.wheels[0].x = -Math.abs(s.wheels[0].x); }, s => { s.wheels[0].drive = 0; },
    s => { s.trackedDrive.contactRadius = NaN; }, s => { s.trackedDrive.lateralScrub = 0; },
    s => { s.trackedDrive.turnPower = 1.1; }, s => { s.wheels[2].z = s.wheels[0].z; }]) {
    const invalid = structuredClone(tank); change(invalid); assert.throws(() => createTrackedDriveState(invalid));
  }
  for (const spec of Object.values(OLD_VEHICLES)) {
    assert.equal(createTrackedDriveState(spec), null); assert.equal(trackedContactRadius(spec), spec.wheelRadius);
  }
});

test('contact motor requests are mirrored, bounded and oppose runaway yaw without adding net pivot thrust', () => {
  const w = contacts(), left = solve(w, 1), right = solve(w, -1);
  assert.equal(left.bilateral, true); assert.ok(left.leftForce < 0 && left.rightForce > 0);
  close(left.leftForce + left.rightForce, 0, 'neutral pivot has zero net longitudinal force');
  for (let i = 0; i < 4; i++) close(left.forces[i], -right.forces[i], 'mirror force');
  assert.ok(left.forces.reduce((sum, force) => sum + Math.abs(force), 0) <= 18000 + 1e-9);
  const overspeed = solve(w, .2, 0, 18000, 2);
  assert.ok(overspeed.leftForce > 0 && overspeed.rightForce < 0, 'motor contact forces oppose excess yaw');
  const powered = solve(w, 1, 18000);
  assert.ok(powered.forces.reduce((sum, force) => sum + Math.abs(force), 0) <= 18000 + 1e-9);
  assert.ok(powered.rightForce > powered.leftForce, 'forward positive steer drives right track harder');
});

test('no airborne, unloaded, zero-grip or one-side-only motor pivot is fabricated', () => {
  for (const suppress of [w => { w.grounded = false; }, w => { w.load = 0; }, w => { w.surface.grip = 0; }]) {
    const w = contacts(); w.forEach(suppress); const state = solve(w);
    assert.equal(state.bilateral, false); assert.deepEqual([...state.forces], [0, 0, 0, 0]);
  }
  for (const supportedSign of [-1, 1]) {
    const w = contacts(); for (const contact of w) if (Math.sign(contact.mount.x) !== supportedSign) contact.grounded = false;
    const a = solve(w, 1), b = solve(w, -1);
    assert.equal(a.bilateral, false); assert.deepEqual([...a.forces], [0, 0, 0, 0]);
    assert.deepEqual([...a.forces], [...b.forces]);
    const straight = solve(w, 0, 5000), turning = solve(w, 1, 5000);
    assert.deepEqual([...turning.forces], [...straight.forces], 'one side may propel, but steer adds no imaginary opposite track');
  }
  const disabled = solve(contacts(), 1, 0, 18000, 0, false);
  assert.deepEqual([...disabled.forces], [0, 0, 0, 0]);
});

async function withTank(check, platforms = [[0, -1, 0, 1000, 1, 1000]], settle = 240) {
  await physics.initPhysics(); const world = physics.createWorld(DT);
  const ground = platforms.map(p => physics.addStaticBox(world, p.slice(0, 3), p.slice(3)));
  const car = new Vehicle(world, structuredClone(tank));
  const step = (input = {}, count = 1) => {
    car.setInput(input); for (let i = 0; i < count; i++) { car.applyForces(DT, null); world.step(); car.afterStep(); }
  };
  try { step({}, settle); return await check(car, step, world); }
  finally { car.destroy(); for (const g of ground) world.removeRigidBody(g.rb);
    assert.equal(world.bodies.len(), 0); assert.equal(world.colliders.len(), 0); world.free(); }
}

test('actual tracked Vehicle and CarState share shoe-radius ride height; all four steer values stay zero', async () => {
  await withTank((car, step) => {
    close(car.restComHeight, rideInfo(tank).restComHeight, 'shared COM frame');
    assert.equal(car.wheelR, .39); assert.equal(car.wheels.length, 4);
    step({ steer: 1 }, 240);
    assert.equal(car.steerAngle, 0); assert.ok(car.wheels.every(w => w.steer === 0));
    assert.equal(car.driftMode, false); assert.equal(car.drifting, false);
    assert.ok(car.yawRate > .03, 'real traction turns the supported tank without throttle');
    assert.ok(Math.hypot(car.pos.x, car.pos.z) < .5, 'neutral differential pivot is not forward drift propulsion');
    assert.ok(car.up.y > .94 && car.grounded === 4, 'pivot remains on its support rays');
    assert.ok(car.pos.toArray().every(Number.isFinite));
  });
});

test('actual opposite pivots are mirrored and the parking brake stops active motor yaw', async t => {
  const settleSteps = 240, pivotSteps = 240, brakeSteps = 240;
  // Native translations cross Rapier's Float32Array scratch buffer. This is
  // an engineering budget for two independently stepped solver trajectories,
  // not a mathematical bound on all accumulated solver error. The fixed
  // 100-micrometre ceiling prevents longer/larger fixtures relaxing this gate.
  const geometryScale = Math.max(1, tank.length, tank.width,
    ...tank.wheels.flatMap(w => [Math.abs(w.x), Math.abs(w.z)]));
  const geometryUlp = 2 ** (Math.floor(Math.log2(geometryScale)) - 23);
  const pairStepBudget = 2 * (settleSteps + pivotSteps + brakeSteps) * geometryUlp;
  const forwardPositionBudget = Math.min(1e-4, pairStepBudget);
  assert.ok(Number.isFinite(forwardPositionBudget) && forwardPositionBudget > 0 && forwardPositionBudget <= 1e-4);
  const runPivot = (steer, fixtureShiftZ = 0) => withTank((car, step) => {
    if (fixtureShiftZ) {
      // Negative only: translate the real settled Rapier body before its
      // normal forces/steps. Positive endpoints are never manufactured.
      const p = car.body.translation();
      car.body.setTranslation({ x: p.x, y: p.y, z: p.z + fixtureShiftZ }, true);
    }
    step({ steer }, pivotSteps); const movingYaw = car.yawRate;
    step({ steer, handbrake: true }, brakeSteps);
    assert.equal(car.trackedDrive.differential, 0); assert.ok(car.trackedDrive.forces.every(force => force === 0));
    assert.ok(Math.abs(car.yawRate) < Math.abs(movingYaw), 'all four parking contacts resist the pivot');
    assert.equal(car.grounded, 4, 'the complete mirror trajectory retains all four physical contacts');
    const sample = { movingYaw, x: car.pos.x, z: car.pos.z, fixtureShiftZ };
    for (const axis of ['x', 'z']) {
      assert.ok(Number.isFinite(sample[axis]), 'real endpoint is finite');
      assert.equal(Math.fround(sample[axis]), sample[axis], 'endpoint uses the actual float32 translation transport');
    }
    return sample;
  }, undefined, settleSteps);
  const results = [];
  for (const steer of [-1, 1]) results.push(await runPivot(steer));
  t.diagnostic(JSON.stringify({ scope: 'ordinary-real-Rapier-mirror', settleSteps, pivotSteps, brakeSteps,
    geometryScale, geometryUlp, pairStepBudget, forwardPositionBudget, results }));
  close(results[0].movingYaw, -results[1].movingYaw, 'mirrored pivot rate', 1e-6);
  close(results[0].x, -results[1].x, 'mirrored pivot position', 1e-5);
  close(results[0].z, results[1].z, 'mirrored pivot forward position', forwardPositionBudget);
  for (const result of results) assert.ok(Math.hypot(result.x, result.z) < 1e-3, 'neutral pivot/brake endpoint stays within one millimetre of the origin');
  const shifted = await runPivot(1, 1e-3);
  t.diagnostic(JSON.stringify({ scope: 'real-Rapier-initial-position-negative', forwardPositionBudget, shifted }));
  assert.ok(Math.abs(results[0].z - shifted.z) > forwardPositionBudget, 'actual shifted physics sample exceeds the declared forward budget');
  assert.throws(() => close(results[0].z, shifted.z, 'mirrored pivot forward position negative', forwardPositionBudget),
    /mirrored pivot forward position negative/, 'a real one-millimetre position bias cannot pass the float32 budget');
});

test('actual reverse intent steers backward from rest and propulsion opposes its capped reverse motion', async () => {
  await withTank((car, step) => {
    car.setInput({ brake: 1, steer: 1 }); car.applyForces(DT, null);
    assert.equal(car.reversing, true); assert.ok(car.trackedDrive.differential < 0, 'reverse intent changes motor yaw before the old speed threshold');
    step({ brake: 1 }, 15 * 120);
    assert.ok(car.vf < -1 && -car.vf < tank.engine.reverseMax, 'real reverse speed remains capped');
    const before = car.vf; step({ throttle: 1 }, 240);
    assert.ok(car.vf > before, 'forward drive arrests reverse');
    assert.equal(car.steerAngle, 0); assert.ok(car.up.y > .94);
  });
});

test('actual impulse capture respects every loaded contact friction ellipse, including sub-newton and zero grip', async () => {
  await withTank(car => {
    for (const surfaceGrip of [1, 1e-6, 0]) {
      const calls = [], apply = car.body.applyImpulseAtPoint;
      car.body.applyImpulseAtPoint = function (impulse, point, wake) {
        calls.push({ x: impulse.x, y: impulse.y, z: impulse.z }); return apply.call(this, impulse, point, wake);
      };
      try {
        car.body.setLinvel({ x: 35, y: 0, z: 15 }, true); car.setInput({ throttle: 1, steer: 1 });
        car.applyForces(DT, { surfaceAt: () => ({ grip: surfaceGrip, drag: 0, kind: 'controlled-test' }) });
        assert.equal(calls.length, 8, 'four suspension plus four actual contact traction impulses');
        for (let i = 0; i < 4; i++) {
          const wheel = car.wheels[i], impulse = calls[4 + i];
          const lateral = (wheel.front ? tank.grip.front : tank.grip.rear) * tank.trackedDrive.lateralScrub * surfaceGrip * wheel.grip * wheel.load * DT;
          const longitudinal = tank.grip.long * surfaceGrip * wheel.grip * wheel.load * DT;
          if (!surfaceGrip) { close(impulse.x, 0, 'zero lateral traction'); close(impulse.z, 0, 'zero longitudinal traction'); }
          else assert.ok(Math.hypot(impulse.x / lateral, impulse.z / longitudinal) <= 1 + 1e-9, 'real forces share actual load once');
        }
      } finally { car.body.applyImpulseAtPoint = apply; }
    }
  });
});

test('actual airborne and one-side-only steering has no direct body yaw or motor pivot request', async () => {
  for (const [platforms, expected] of [[[], 0], [[[1.23, -1, 0, .30, 1, 100]], 2]]) {
    await withTank(car => {
      const calls = [], torque = car.body.applyTorqueImpulse;
      car.body.applyTorqueImpulse = function (impulse, wake) { calls.push({ ...impulse }); return torque.call(this, impulse, wake); };
      try {
        car.setInput({ steer: 1 }); car.applyForces(DT, null);
        assert.equal(car.grounded, expected); assert.equal(car.trackedDrive.bilateral, false);
        assert.equal(car.trackedDrive.differential, 0); assert.ok(car.trackedDrive.forces.every(force => force === 0));
        for (const impulse of calls) close(impulse.x * car.up.x + impulse.y * car.up.y + impulse.z * car.up.z, 0, 'no direct airborne/body yaw axis motor');
      } finally { car.body.applyTorqueImpulse = torque; }
    // A freshly created Rapier world has not stepped its shapes/broad phase.
    // One ordinary neutral forces/world/afterStep cycle precedes the query;
    // no synthetic contact or alternate runtime force path is supplied.
    }, platforms, 1);
  }
});

test('actual driver loss/stun disables powered pivot and the shared finite tank cannot be spammed', async () => {
  await withTank((car, step) => {
    car.driverAlive = false; step({ steer: 1 }, 10); assert.equal(car.trackedDrive.differential, 0);
    car.driverAlive = true; car.stunned = .5; step({ steer: 1 }, 10); assert.equal(car.trackedDrive.differential, 0);
    step({}, 120); const capacity = car.nitroMax; assert.ok(capacity > 0);
    let used = 0; while (car.nitro > 0 && used < Math.ceil(capacity / DT) + 3) { step({ throttle: 1, nitro: true }); used++; }
    assert.equal(car.nitro, 0); assert.equal(car.nitroRechargeLocked, true);
    assert.ok(Math.abs(used * DT - capacity) <= DT + 1e-9);
    for (let i = 0; i < 120 * 10; i++) { step({ throttle: 1, nitro: i % 2 === 0 }); assert.equal(car.boosting, false); }
    assert.equal(car.nitroRechargeLocked, true); assert.ok(car.nitro < capacity);
    for (let i = 0; i < 120 * 3 && car.nitroRechargeLocked; i++) step({ throttle: 1, nitro: false });
    assert.equal(car.nitro, capacity); step({ throttle: 1, nitro: true }); assert.equal(car.boosting, true);
    close(car.nitro, capacity - DT, 'second finite burst pays ordinary fuel');
  });
});

const numericalState = car => ({ pos: car.pos.toArray(), quat: car.quat.toArray(), vel: car.vel.toArray(), av: car.angvel.toArray(),
  nitro: car.nitro, lock: car.nitroRechargeLocked, release: car.nitroNeedsRelease, boosting: car.boosting,
  steer: car.steerAngle, smooth: car.steerSmooth, driftMode: car.driftMode, drifting: car.drifting,
  wheels: car.wheels.map(w => [w.L, w.load, w.steer, w.vf, w.vl, w.slip, w.spin, w.spinRate]) });

test('all bound non-tank source specs produce numerically identical actual physics across steering, brake, boost and drift inputs', async () => {
  await physics.initPhysics(); await oldPhysics.initPhysics();
  const inputs = [{}, { throttle: 1 }, { throttle: 1, steer: 1, nitro: true }, { throttle: 1, steer: -1 },
    { brake: 1, steer: .5 }, { throttle: 1, steer: 1, handbrake: true }, { nitro: false }, { brake: 1 }];
  for (const [id, spec] of Object.entries(OLD_VEHICLES)) {
    assert.deepEqual(VEHICLES[id], spec, id + ' old canonical spec is unchanged');
    const wa = physics.createWorld(DT), wb = oldPhysics.createWorld(DT);
    const ga = physics.addStaticBox(wa, [0, -1, 0], [1000, 1, 1000]), gb = oldPhysics.addStaticBox(wb, [0, -1, 0], [1000, 1, 1000]);
    const a = new Vehicle(wa, structuredClone(spec)), b = new OldVehicle(wb, structuredClone(spec));
    try {
      for (const input of inputs) for (let i = 0; i < (input.brake ? 360 : 120); i++) {
        if (input.handbrake && i === 0) {
          const imposed = a.fwd.clone().multiplyScalar(32).addScaledVector(a.left, 12);
          a.body.setLinvel(imposed, true); b.body.setLinvel(imposed, true);
        }
        a.setInput(input); b.setInput(input); a.applyForces(DT, null); b.applyForces(DT, null);
        wa.step(); wb.step(); a.afterStep(); b.afterStep();
        assert.deepEqual(numericalState(a), numericalState(b), id + ' identical numerical legacy path');
      }
    } finally { a.destroy(); b.destroy(); wa.removeRigidBody(ga.rb); wb.removeRigidBody(gb.rb); wa.free(); wb.free(); }
  }
});
