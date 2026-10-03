import test from 'node:test';
import assert from 'node:assert/strict';
import { initPhysics, createWorld, addStaticBox } from '../src/sim/physics.js';
import { Vehicle } from '../src/sim/vehicle.js';
import { VEHICLES, PLAYER_NITRO_RECHARGE_SECONDS } from '../src/data/vehicles.js';
import { DEFAULT_PROFILE, effects, upgradeLimit, UPGRADE_BY_ID } from '../src/data/upgrades.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';

const DT = 1 / 120;
const PREVIOUS_TANKS = {
  truck_t1: 1, truck_t2: 2, truck_t3: 3, truck_t4: 4,
  player_sedan_t1: .85, player_sedan_t2: 1.35,
  player_buggy_t1: 1.55, player_buggy_t2: 2.25, player_buggy_t3: 3,
};
const AUTHORED_THRUST = {
  truck_t1: 1.6, truck_t2: 1.65, truck_t3: 1.7, truck_t4: 1.8,
  player_sedan_t1: 1.55, player_sedan_t2: 1.6,
  player_buggy_t1: 1.65, player_buggy_t2: 1.7, player_buggy_t3: 1.75,
};
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-10, message);

async function withVehicle(check, vehicleID = 'player_sedan_t1') {
  await initPhysics();
  const world = createWorld(DT);
  addStaticBox(world, [0, -1, 0], [100, 1, 2000]);
  const vehicle = new Vehicle(world, structuredClone(VEHICLES[vehicleID]));
  const step = nitro => {
    vehicle.setInput({ throttle: 1, nitro });
    vehicle.applyForces(DT, null); world.step(); vehicle.afterStep();
  };
  try { await check(vehicle, step); } finally { vehicle.destroy(); world.free(); }
}

test('rapid boost presses cannot spend any fuel during a depleted full-tank recharge cycle', async () => {
  await withVehicle((vehicle, step) => {
    // Exhaust a real initial tank, rather than toggling the lock directly.
    let boosted = 0;
    while (vehicle.nitro > 0 && boosted < 1000) { step(true); boosted++; }
    assert.ok(boosted > 100 && boosted < 200);
    assert.equal(vehicle.nitro, 0); assert.equal(vehicle.nitroRechargeLocked, true);
    for (let i = 0; i < 120 * 10; i++) {
      step(i % 2 === 0);
      assert.equal(vehicle.boosting, false, 'every re-press stays blocked while recharge is incomplete');
      assert.equal(vehicle.nitroRechargeLocked, true);
      close(vehicle.nitro, (i + 1) * DT * vehicle.spec.nitro.regen, 'spam cannot consume or create refill fuel');
    }
    assert.ok(vehicle.nitro < vehicle.nitroMax);
    let rechargeSteps = 120 * 10;
    while (vehicle.nitroRechargeLocked && rechargeSteps < 120 * 13) {
      step(true); rechargeSteps++;
      assert.equal(vehicle.boosting, false, 'the final refill step itself does not consume the new tank');
    }
    close(vehicle.nitro, vehicle.nitroMax, 'recharge ends only at a completely full tank');
    assert.ok(Math.abs(rechargeSteps * DT - PLAYER_NITRO_RECHARGE_SECONDS) <= DT + 1e-10);
    step(true);
    assert.equal(vehicle.boosting, true, 'a release during recharge avoids requiring an extra press after full');
    close(vehicle.nitro, vehicle.nitroMax - DT, 'normal second burst resumes');
  });
});

test('voluntary partial bursts remain responsive without increasing available fuel', async () => {
  await withVehicle((vehicle, step) => {
    const initial = vehicle.nitro;
    for (let i = 0; i < 30; i++) step(true);
    assert.equal(vehicle.nitroRechargeLocked, false, 'stopping before empty does not force a full recharge');
    for (let i = 0; i < 30; i++) step(false);
    const beforeResume = vehicle.nitro;
    step(true);
    assert.equal(vehicle.boosting, true);
    close(beforeResume, initial - 30 * DT + 30 * DT * vehicle.spec.nitro.regen, 'release only adds the authored passive fuel');
    close(vehicle.nitro, beforeResume - DT, 'the next press costs normal boost fuel');
  });
});

test('nine legacy chassis retain 40 percent longer native boost and the new Hummer shares 12 second full recharge', () => {
  assert.equal(Object.values(VEHICLES).filter(spec => spec.kind === 'player').length, 10);
  for (const [id, previousCapacity] of Object.entries(PREVIOUS_TANKS)) {
    const spec = VEHICLES[id];
    close(spec.nitro.capacity, previousCapacity * 1.4, id + ' native burst lasts longer');
    close(spec.nitro.capacity / spec.nitro.regen, 12, id + ' full passive recharge is bounded');
    assert.equal(spec.nitro.mul, AUTHORED_THRUST[id], id + ' authored boost thrust is preserved');
  }
  for (const spec of Object.values(VEHICLES).filter(spec => spec.kind !== 'player')) {
    assert.equal(spec.nitro, undefined, spec.id + ' did not acquire a player boost tank');
  }
  const hummer = VEHICLES.player_hummer_t1;
  close(hummer.nitro.capacity, 1.54, 'new Hummer has its authored stock finite burst');
  close(hummer.nitro.capacity / hummer.nitro.regen, 12, 'new Hummer requires full passive recharge');
  assert.equal(hummer.nitro.mul, 1.6, 'new Hummer uses its authored finite boost thrust');
});

test('tank upgrades retain all ten chassis identities, exact costs, longer bursts and faster complete refill', () => {
  assert.deepEqual(UPGRADE_BY_ID.nitro.costs, [1875, 3000, 4750, 7000, 10000]);
  for (const id of [...Object.keys(PREVIOUS_TANKS), 'player_hummer_t1']) {
    const profile = DEFAULT_PROFILE(), base = VEHICLES[id];
    profile.truck = id; profile.trucks = [id];
    const cap = upgradeLimit(profile, 'nitro');
    let previousCapacity = 0, previousRefill = Infinity;
    for (let level = 0; level <= cap; level++) {
      profile.vehicleUpgrades[base.family].nitro = level;
      const original = structuredClone(profile), folded = effects(profile), built = buildPlayerSpec(profile);
      const capacity = base.nitro.capacity + (level > 0 ? .4 + .8 * level : 0);
      const refillSeconds = Math.max(8, 12 - level);
      close(folded.nitroCap, capacity, id + ' purchased capacity');
      close(folded.nitroRegen, capacity / refillSeconds, id + ' proportional full refill');
      close(folded.nitroCap / folded.nitroRegen, refillSeconds, id + ' displayed refill rate agrees');
      assert.equal(built.spec.nitro.capacity, folded.nitroCap);
      assert.equal(built.spec.nitro.regen, folded.nitroRegen);
      assert.equal(built.spec.nitro.mul, base.nitro.mul, 'duration changes do not increase thrust');
      assert.ok(folded.nitroCap > previousCapacity);
      assert.ok(refillSeconds <= previousRefill && refillSeconds >= 8 && refillSeconds <= 12);
      assert.deepEqual(profile, original, 'folding stats does not mutate saves or purchased upgrades');
      previousCapacity = capacity; previousRefill = refillSeconds;
    }
  }
});

test('actual Hummer body inherits depletion lock, ignores boost spam and resumes only after full refill', async () => {
  await withVehicle((vehicle, step) => {
    close(vehicle.nitro, 1.54, 'actual Hummer begins with its finite stock tank');
    let used = 0;
    while (vehicle.nitro > 0 && used < 300) { step(true); used++; }
    assert.ok(used >= 184 && used <= 186, 'actual stock burst lasts the authored seconds, not infinite input time');
    assert.equal(vehicle.nitro, 0); assert.equal(vehicle.nitroRechargeLocked, true);
    for (let i = 0; i < 120 * 11; i++) {
      step(i % 2 === 0); assert.equal(vehicle.boosting, false); assert.equal(vehicle.nitroRechargeLocked, true);
      close(vehicle.nitro, (i + 1) * DT * vehicle.spec.nitro.regen, 'spam cannot spend or create refill fuel');
    }
    let wait = 0;
    while (vehicle.nitroRechargeLocked && wait < 130) { step(true); wait++; }
    assert.ok(wait >= 119 && wait <= 122); assert.equal(vehicle.nitroRechargeLocked, false);
    assert.equal(vehicle.boosting, false, 'the last refill step does not consume the refilled tank');
    close(vehicle.nitro, vehicle.nitroMax, 'full tank is restored exactly');
    step(true);
    assert.equal(vehicle.boosting, true, 'a release during refill arms the next fully charged burst');
    close(vehicle.nitro, vehicle.nitroMax - DT, 'normal second Hummer burst resumes');
  }, 'player_hummer_t1');
});
