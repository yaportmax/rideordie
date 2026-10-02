import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, TRUCKS, upgradeLimit } from '../src/data/upgrades.js';
import { familyOf } from '../src/data/vehicle_families.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';
import { upgradeStats, truckStats } from '../src/ui/garage_stats.js';

function selectedProfile(id, levels = {}) {
  const p = DEFAULT_PROFILE(); p.truck = id;
  if (!p.trucks.includes(id)) p.trucks.push(id);
  Object.assign(p.vehicleUpgrades[familyOf(id)], levels);
  return p;
}

test('garage refill percentage describes the actual runtime tank for every chassis and family-capped nitro level', () => {
  for (const { id } of TRUCKS) for (let level = 0, levels = upgradeLimit(selectedProfile(id), 'nitro'); level <= levels; level++) {
    const profile = selectedProfile(id, { nitro: level });
    const before = structuredClone(profile), nitro = buildPlayerSpec(profile).spec.nitro;
    const rows = upgradeStats(profile, 'nitro'), tank = rows.find(row => row.label === 'NITRO TANK'), refill = rows.find(row => row.label === 'REFILL RATE');
    assert.equal(tank.before, nitro.capacity, 'displayed tank seconds agree with run setup');
    assert.equal(refill.unit, '%/S');
    assert.equal(refill.before, 100 * (nitro.regen / nitro.capacity));
    // A 10% tank charge must take exactly the same time in the garage estimate
    // and Vehicle's seconds-of-boost regeneration law.
    assert.ok(Math.abs(10 / refill.before - nitro.capacity * .1 / nitro.regen) < 1e-12);
    assert.equal(refill.fmt(refill.before), refill.before.toFixed(1), 'fractional refill rates remain visible');
    if (level < levels) {
      const next = structuredClone(profile); next.vehicleUpgrades[familyOf(id)].nitro++;
      const after = buildPlayerSpec(next).spec.nitro;
      assert.equal(tank.after, after.capacity);
      assert.equal(refill.after, 100 * (after.regen / after.capacity), 'preview uses the larger purchased tank as well as its faster seconds/s refill');
    } else { assert.equal(refill.after, null); assert.equal(tank.after, null); }
    assert.deepEqual(profile, before, 'shop comparison must not modify saves or purchases');
  }
});

test('truck and upgrade preview bar scales cover the highest upgraded speed and tank in either unit system', () => {
  for (const units of ['mi', 'km']) for (const { id } of TRUCKS) {
    const profile = selectedProfile(id), levels = profile.vehicleUpgrades[familyOf(id)];
    levels.engine = upgradeLimit(profile, 'engine'); levels.nitro = upgradeLimit(profile, 'nitro');
    const engineRow = upgradeStats(profile, 'engine', units).find(row => row.label === 'TOP SPEED');
    const truckRow = truckStats(profile, profile.truck, units).find(row => row.label === 'TOP SPEED');
    const tankRow = upgradeStats(profile, 'nitro', units).find(row => row.label === 'NITRO TANK');
    assert.equal(engineRow.max, truckRow.max, 'truck and engine use a shared comparison scale');
    assert.equal(engineRow.before, truckRow.before, 'unit conversion agrees for the selected truck');
    assert.ok(engineRow.before < engineRow.max, 'fully upgraded vehicle remains within the speed bar');
    assert.ok(tankRow.before < tankRow.max, 'fully upgraded tank remains within the capacity bar');
    const beforePurchase = structuredClone(profile); beforePurchase.vehicleUpgrades[familyOf(id)].nitro--;
    const nextTank = upgradeStats(beforePurchase, 'nitro', units).find(row => row.label === 'NITRO TANK');
    assert.equal(nextTank.after, tankRow.before); assert.ok(nextTank.after < nextTank.max);
  }
});
