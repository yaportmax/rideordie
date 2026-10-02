import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, TRUCKS, UPGRADES, effects, upgradeLimit, upgradeLevel, effectiveUpgrades } from '../src/data/upgrades.js';
import { normalizeProfile, buyTruck, selectTruck, buyUpgrade, upgradeCost } from '../src/meta/profile.js';
import { DRIVER_UPGRADE_IDS, DRIVER_UPGRADE_MAX, PLAYER_VEHICLE_CATALOGUE, VEHICLE_FAMILIES, familyOf, stageOf, normalizeFamilyUpgrades, stagePurchaseAllowed } from '../src/data/vehicle_families.js';
import { VEHICLES, vehicleModelURL } from '../src/data/vehicles.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';

const FAMILY_STAGES = {
  sedan: ['player_sedan_t1', 'player_sedan_t2'],
  rustbucket: ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4'],
  buggy: ['player_buggy_t1', 'player_buggy_t2', 'player_buggy_t3'],
};
const FAMILY_CAPS = {
  sedan: { engine: 4, armor: 3, tires: 4, nitro: 3, ram: 2, spikes: 1, glass: 2, fueltank: 2, oil: 2, mines: 1 },
  rustbucket: { engine: 5, armor: 5, tires: 5, nitro: 5, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 },
  buggy: { engine: 5, armor: 2, tires: 5, nitro: 4, ram: 1, spikes: 1, glass: 1, fueltank: 2, oil: 1, mines: 1 },
};
const zeroLevels = () => Object.fromEntries(DRIVER_UPGRADE_IDS.map(id => [id, 0]));
const profile = (extra = {}) => normalizeProfile({ campaignId: 'vehicle-family-test', cash: 1000000, ...extra });
const price = id => TRUCKS.find(vehicle => vehicle.id === id).cost;
const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-12, `${label}: ${actual} agrees with ${expected}`);
const rejectedWithoutMutation = (p, action, reason) => {
  const before = structuredClone(p);
  assert.deepEqual(action(), { ok: false, reason });
  assert.deepEqual(p, before, `${reason} rejection must preserve the entire profile`);
};

test('the shop has nine unique player chassis with explicit family stages and real model aliases', () => {
  const expected = Object.values(FAMILY_STAGES).flat();
  assert.equal(PLAYER_VEHICLE_CATALOGUE.length, 9);
  assert.equal(new Set(PLAYER_VEHICLE_CATALOGUE.map(vehicle => vehicle.id)).size, 9);
  assert.deepEqual(PLAYER_VEHICLE_CATALOGUE.map(vehicle => vehicle.id), expected);
  assert.deepEqual(TRUCKS.map(vehicle => vehicle.id), expected);
  assert.deepEqual(Object.keys(VEHICLE_FAMILIES), Object.keys(FAMILY_STAGES));
  assert.deepEqual(DRIVER_UPGRADE_MAX, FAMILY_CAPS.rustbucket);
  assert.equal(DRIVER_UPGRADE_IDS.length, 10);
  for (const [family, stages] of Object.entries(FAMILY_STAGES)) {
    assert.deepEqual(VEHICLE_FAMILIES[family].stageIDs, stages);
    assert.deepEqual(VEHICLE_FAMILIES[family].caps, FAMILY_CAPS[family]);
    for (const [index, id] of stages.entries()) {
      const catalogue = PLAYER_VEHICLE_CATALOGUE.find(vehicle => vehicle.id === id), spec = VEHICLES[id];
      assert.equal(catalogue.family, family); assert.equal(catalogue.tier, index + 1);
      assert.equal(familyOf(id), family); assert.equal(stageOf(id), index + 1);
      assert.equal(spec.kind, 'player'); assert.equal(spec.family, family); assert.equal(spec.familyStage, index + 1);
      assert.equal(spec.id, id); assert.equal(spec.tier, index + 1);
      assert.ok(spec.model?.bbox && spec.model?.sockets && spec.model?.wheels, `${id} resolves production model metadata`);
      assert.equal(vehicleModelURL(id), `/models/vehicles/${family === 'rustbucket' ? id : stages[0]}.glb`);
      assert.equal(spec.wheels.length, 4); assert.ok(spec.seats.driver && spec.seats.gunner);
      assert.ok(Number.isFinite(spec.hp) && spec.hp > 0 && Number.isFinite(spec.engine.accel0) && spec.engine.accel0 > 0);
    }
  }
  assert.equal(price('player_sedan_t1'), 0);
  assert.ok(price('truck_t1') > 0 && price('player_buggy_t1') > 0, 'the other starter chassis are paid purchases');
  assert.notEqual(VEHICLES.player_sedan_t1.mass, VEHICLES.truck_t1.mass);
  assert.notEqual(VEHICLES.player_buggy_t1.engine.accel0, VEHICLES.truck_t1.engine.accel0);
  assert.notEqual(vehicleModelURL('player_sedan_t1'), vehicleModelURL('truck_t1'));
  assert.notEqual(vehicleModelURL('player_buggy_t1'), vehicleModelURL('truck_t1'));
});

test('new profiles own only the sedan and begin with independent empty family inventories', () => {
  const p = DEFAULT_PROFILE(), other = DEFAULT_PROFILE();
  assert.equal(p.truck, 'player_sedan_t1'); assert.deepEqual(p.trucks, ['player_sedan_t1']);
  assert.equal(p.vehicleUpgradeSchema, 2);
  assert.deepEqual(p.vehicleUpgrades, { sedan: {}, rustbucket: {}, buggy: {} });
  p.vehicleUpgrades.sedan.engine = 1;
  assert.deepEqual(other.vehicleUpgrades, { sedan: {}, rustbucket: {}, buggy: {} });
  for (const raw of [null, [], {}, { trucks: ['missing', 'e_sedan'], truck: 'missing' }]) {
    const repaired = normalizeProfile(raw);
    assert.equal(repaired.truck, 'player_sedan_t1'); assert.deepEqual(repaired.trucks, ['player_sedan_t1']);
    assert.equal(repaired.vehicleUpgradeSchema, 2);
    for (const stages of Object.values(FAMILY_STAGES)) {
      for (const id of DRIVER_UPGRADE_IDS) assert.equal(upgradeLevel(repaired, id, stages[0]), 0);
    }
  }
});

test('normalization preserves valid legacy pickup ownership and selection without inventing a free pickup for new saves', () => {
  const old = normalizeProfile({ truck: 'truck_t4', trucks: ['truck_t2', 'truck_t4', 'truck_t4', 'missing', 'e_sedan'] });
  assert.equal(old.truck, 'truck_t4');
  assert.ok(old.trucks.includes('truck_t2') && old.trucks.includes('truck_t4'));
  assert.equal(old.trucks.filter(id => id === 'truck_t4').length, 1);
  assert.ok(!old.trucks.includes('missing') && !old.trucks.includes('e_sedan'));
  const selectedOnly = normalizeProfile({ truck: 'truck_t3' });
  assert.equal(selectedOnly.truck, 'truck_t3'); assert.ok(selectedOnly.trucks.includes('truck_t3'));
  const unownedModern = normalizeProfile({ vehicleUpgradeSchema: 2, trucks: ['player_sedan_t1'], truck: 'truck_t3' });
  assert.equal(unownedModern.truck, 'player_sedan_t1'); assert.ok(!unownedModern.trucks.includes('truck_t3'));
});

test('legacy driver levels migrate once into Rustbucket while crew and shared levels remain global', () => {
  const raw = {
    truck: 'player_sedan_t1', trucks: ['player_sedan_t1', 'truck_t2'],
    upgrades: { engine: 99, armor: -3, tires: 2.9, nitro: NaN, ram: Infinity, spikes: '2', glass: [], fueltank: null, oil: {}, mines: 1, vest: 2, grenades: 1, scavenger: 3 },
    vehicleUpgrades: { sedan: { armor: 1 }, rustbucket: { nitro: 2 }, buggy: { tires: 1 } },
  };
  const before = structuredClone(raw), p = normalizeProfile(raw);
  assert.deepEqual(raw, before, 'repairing a save never mutates the supplied raw data');
  assert.equal(p.vehicleUpgradeSchema, 2);
  assert.deepEqual(p.vehicleUpgrades.rustbucket, { ...zeroLevels(), engine: 5, tires: 2, nitro: 2, mines: 1 });
  assert.deepEqual(p.vehicleUpgrades.sedan, { ...zeroLevels(), armor: 1 });
  assert.deepEqual(p.vehicleUpgrades.buggy, { ...zeroLevels(), tires: 1 });
  for (const id of DRIVER_UPGRADE_IDS) assert.ok(!Object.hasOwn(p.upgrades, id), `${id} is no longer a global driver purchase`);
  assert.equal(p.upgrades.vest, 2); assert.equal(p.upgrades.grenades, 1); assert.equal(p.upgrades.scavenger, 3);
  const roundtrip = normalizeProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(roundtrip, p, 'save reload does not duplicate, erase or repeat the migration');
  const selected = effectiveUpgrades(p);
  assert.equal(selected.engine, 0); assert.equal(selected.armor, 1); assert.equal(selected.vest, 2);
  assert.equal(upgradeLevel(p, 'engine', 'truck_t2'), 5);
});

test('schema two ignores stray global driver levels instead of remigrating or sharing them', () => {
  const raw = {
    vehicleUpgradeSchema: 2, truck: 'player_buggy_t1', trucks: ['player_sedan_t1', 'truck_t1', 'player_buggy_t1'],
    upgrades: { engine: 5, nitro: 5, armor: 5, vest: 2, scavenger: 1 },
    vehicleUpgrades: { sedan: { engine: 2 }, rustbucket: { engine: 1 }, buggy: { armor: 1 } },
  };
  const p = normalizeProfile(raw), familyOnly = normalizeFamilyUpgrades(raw);
  assert.equal(p.vehicleUpgrades.rustbucket.engine, 1); assert.equal(p.vehicleUpgrades.rustbucket.nitro, 0);
  assert.equal(p.vehicleUpgrades.sedan.engine, 2); assert.equal(p.vehicleUpgrades.buggy.engine, 0);
  assert.equal(effects(p).engineMul, 1); assert.equal(effects(p).gunnerHp, 150); assert.equal(effects(p).cashMul, 1.1);
  for (const id of DRIVER_UPGRADE_IDS) assert.ok(!Object.hasOwn(familyOnly.upgrades, id));
  assert.equal(familyOnly.upgrades.vest, 2); assert.equal(familyOnly.upgrades.scavenger, 1);
  assert.deepEqual(normalizeFamilyUpgrades(familyOnly), familyOnly, 'the schema marker makes migration idempotent');
});

test('damaged family inventories clamp finite integer levels to each family cap', () => {
  const raw = { vehicleUpgradeSchema: 2, upgrades: {}, vehicleUpgrades: {
    sedan: { engine: 100, armor: 2.9, tires: -1, nitro: Infinity, ram: '2', spikes: NaN, glass: null, fueltank: [], oil: {}, mines: 100, unknown: 9 },
    rustbucket: [], buggy: { engine: 100, armor: 100, tires: 100, nitro: 100, ram: 100, spikes: 100, glass: 100, fueltank: 100, oil: 100, mines: 100 }, ignored: { engine: 5 },
  } };
  const before = structuredClone(raw), result = normalizeFamilyUpgrades(raw);
  assert.deepEqual(result.vehicleUpgrades.sedan, { ...zeroLevels(), engine: 4, armor: 2, mines: 1 });
  assert.deepEqual(result.vehicleUpgrades.rustbucket, zeroLevels());
  assert.deepEqual(result.vehicleUpgrades.buggy, FAMILY_CAPS.buggy);
  assert.deepEqual(Object.keys(result.vehicleUpgrades), Object.keys(FAMILY_STAGES));
  assert.deepEqual(raw, before);
});

test('all driver tracks charge exact prices, stop at family caps and leave other inventories untouched', () => {
  for (const [family, stages] of Object.entries(FAMILY_STAGES)) {
    const p = profile({ truck: stages[0], trucks: [stages[0]], vehicleUpgradeSchema: 2 });
    for (const id of DRIVER_UPGRADE_IDS) {
      const upgrade = UPGRADES.find(item => item.id === id), cap = FAMILY_CAPS[family][id];
      assert.equal(upgradeLimit(p, id), cap);
      for (let level = 0; level < cap; level++) {
        const beforeCash = p.cash, beforeOther = structuredClone(p.vehicleUpgrades);
        assert.equal(upgradeCost(p, id), upgrade.costs[level]);
        assert.deepEqual(buyUpgrade(p, id), { ok: true });
        assert.equal(p.cash, beforeCash - upgrade.costs[level]);
        assert.equal(upgradeLevel(p, id), level + 1); assert.equal(p.vehicleUpgrades[family][id], level + 1);
        assert.ok(!Object.hasOwn(p.upgrades, id));
        for (const other of Object.keys(FAMILY_STAGES).filter(item => item !== family)) assert.deepEqual(p.vehicleUpgrades[other], beforeOther[other]);
      }
      assert.equal(upgradeCost(p, id), null);
      rejectedWithoutMutation(p, () => buyUpgrade(p, id), 'max');
    }
  }
});

test('purchased driver levels persist through family switches and chassis stages without copying purchases', () => {
  const p = profile();
  assert.deepEqual(buyUpgrade(p, 'engine'), { ok: true });
  assert.deepEqual(buyUpgrade(p, 'nitro'), { ok: true });
  assert.deepEqual(buyTruck(p, 'truck_t1'), { ok: true });
  assert.equal(upgradeLevel(p, 'engine'), 0); assert.equal(upgradeLevel(p, 'nitro'), 0);
  assert.deepEqual(buyUpgrade(p, 'engine'), { ok: true }); assert.deepEqual(buyUpgrade(p, 'engine'), { ok: true });
  assert.deepEqual(buyTruck(p, 'truck_t2'), { ok: true }); assert.equal(upgradeLevel(p, 'engine'), 2);
  assert.deepEqual(buyTruck(p, 'player_buggy_t1'), { ok: true }); assert.equal(upgradeLevel(p, 'engine'), 0);
  assert.deepEqual(buyUpgrade(p, 'armor'), { ok: true });
  assert.deepEqual(selectTruck(p, 'player_sedan_t1'), { ok: true });
  assert.equal(upgradeLevel(p, 'engine'), 1); assert.equal(upgradeLevel(p, 'nitro'), 1); assert.equal(upgradeLevel(p, 'armor'), 0);
  assert.deepEqual(buyTruck(p, 'player_sedan_t2'), { ok: true }); assert.equal(upgradeLevel(p, 'engine'), 1);
  const beforeCash = p.cash;
  assert.deepEqual(selectTruck(p, 'truck_t1'), { ok: true }); assert.equal(upgradeLevel(p, 'engine'), 2);
  assert.deepEqual(selectTruck(p, 'player_buggy_t1'), { ok: true }); assert.equal(upgradeLevel(p, 'armor'), 1);
  assert.equal(p.cash, beforeCash, 'selecting owned chassis never charges another purchase');
  assert.equal(upgradeLimit(p, 'armor', 'truck_t4'), 5); assert.equal(upgradeLimit(p, 'armor', 'player_sedan_t2'), 3);
  const restored = normalizeProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(restored.vehicleUpgrades, p.vehicleUpgrades); assert.equal(restored.truck, p.truck);
});

test('crew and shared purchases stay global across all vehicle families', () => {
  const p = profile();
  for (const id of ['vest', 'scavenger']) {
    const upgrade = UPGRADES.find(item => item.id === id);
    assert.equal(upgradeLimit(p, id), upgrade.costs.length);
    const before = p.cash; assert.deepEqual(buyUpgrade(p, id), { ok: true }); assert.equal(p.cash, before - upgrade.costs[0]);
    assert.equal(p.upgrades[id], 1);
    for (const inventory of Object.values(p.vehicleUpgrades)) assert.ok(!Object.hasOwn(inventory, id));
  }
  for (const id of ['truck_t1', 'player_buggy_t1']) {
    assert.deepEqual(buyTruck(p, id), { ok: true });
    assert.equal(upgradeLevel(p, 'vest'), 1); assert.equal(upgradeLevel(p, 'scavenger'), 1);
    assert.equal(effects(p).gunnerHp, 120); assert.equal(effects(p).cashMul, 1.1);
  }
});

test('new later stages require their own immediate predecessor while each family starter remains purchasable', () => {
  const p = profile();
  assert.equal(stagePurchaseAllowed(p, 'truck_t1'), true); assert.equal(stagePurchaseAllowed(p, 'player_buggy_t1'), true);
  assert.equal(stagePurchaseAllowed(p, 'player_sedan_t2'), true, 'the starter sedan is already the required predecessor');
  assert.equal(stagePurchaseAllowed({ trucks: ['truck_t4'] }, 'player_sedan_t2'), false, 'a pickup cannot substitute for the sedan predecessor');
  assert.equal(stagePurchaseAllowed(p, 'missing'), false);
  for (const stages of Object.values(FAMILY_STAGES)) {
    for (const id of stages.slice(1)) {
      if (id === 'player_sedan_t2') continue; // Every repaired campaign already owns its starter sedan.
      const unrelated = Object.values(FAMILY_STAGES).filter(other => other !== stages).flat();
      const locked = profile({ truck: 'player_sedan_t1', trucks: ['player_sedan_t1', ...unrelated], vehicleUpgradeSchema: 2 });
      assert.equal(stagePurchaseAllowed(locked, id), false, `${id} cannot use a predecessor from another family`);
      rejectedWithoutMutation(locked, () => buyTruck(locked, id), 'locked');
    }
  }
  for (const [family, stages] of Object.entries(FAMILY_STAGES)) {
    const owned = profile();
    if (family !== 'sedan') assert.deepEqual(buyTruck(owned, stages[0]), { ok: true });
    for (const id of stages.slice(1)) {
      assert.equal(stagePurchaseAllowed(owned, id), true);
      const before = owned.cash; assert.deepEqual(buyTruck(owned, id), { ok: true });
      assert.equal(owned.cash, before - price(id)); assert.equal(owned.truck, id); assert.ok(owned.trucks.includes(id));
    }
  }
});

test('legacy ownership of a later stage stays selectable even when the predecessor was absent', () => {
  for (const id of ['truck_t4', 'player_sedan_t2', 'player_buggy_t3']) {
    const p = profile({ truck: id, trucks: [id] }), beforeCash = p.cash;
    assert.ok(p.trucks.includes(id)); assert.equal(stagePurchaseAllowed(p, id), true);
    assert.deepEqual(selectTruck(p, 'player_sedan_t1'), { ok: true });
    assert.deepEqual(selectTruck(p, id), { ok: true }); assert.equal(p.truck, id); assert.equal(p.cash, beforeCash);
    rejectedWithoutMutation(p, () => buyTruck(p, id), 'owned');
  }
});

test('invalid, capped, unaffordable and unowned requests leave cash, selection and inventories unchanged', () => {
  const p = profile();
  for (const id of ['missing', 'constructor', '__proto__', 'e_sedan']) {
    rejectedWithoutMutation(p, () => buyTruck(p, id), 'invalid');
    rejectedWithoutMutation(p, () => buyUpgrade(p, id), 'invalid');
    assert.equal(upgradeCost(p, id), null);
  }
  rejectedWithoutMutation(p, () => selectTruck(p, 'player_buggy_t1'), 'locked');
  rejectedWithoutMutation(p, () => selectTruck(p, 'missing'), 'locked');
  const poor = profile({ cash: 0 });
  rejectedWithoutMutation(poor, () => buyTruck(poor, 'truck_t4'), 'cash');
  rejectedWithoutMutation(poor, () => buyTruck(poor, 'truck_t1'), 'cash');
  rejectedWithoutMutation(poor, () => buyUpgrade(poor, 'engine'), 'cash');
  const exact = profile({ cash: price('truck_t1') });
  assert.deepEqual(buyTruck(exact, 'truck_t1'), { ok: true }); assert.equal(exact.cash, 0);
  exact.cash = upgradeCost(exact, 'engine');
  assert.deepEqual(buyUpgrade(exact, 'engine'), { ok: true }); assert.equal(exact.cash, 0);
});

test('effects provide an immutable ten-upgrade appearance snapshot matching selected-family runtime stats', () => {
  const levels = { engine: 2, armor: 1, tires: 3, nitro: 2, ram: 1, spikes: 1, glass: 1, fueltank: 1, oil: 1, mines: 1 };
  const canonical = structuredClone(VEHICLES);
  for (const id of Object.values(FAMILY_STAGES).flat()) {
    const family = familyOf(id), p = profile({ truck: id, trucks: [id], vehicleUpgradeSchema: 2,
      upgrades: { engine: 5, armor: 5, nitro: 5, vest: 1 },
      vehicleUpgrades: { [family]: levels },
    });
    const before = structuredClone(p), e = effects(p), built = buildPlayerSpec(p), base = VEHICLES[id];
    assert.equal(e.truck, id); assert.equal(e.family, family); assert.equal(e.stage, stageOf(id)); assert.equal(e.tier, stageOf(id));
    assert.equal(Object.keys(e.vehicleUpgradeLevels).length, 10);
    assert.deepEqual(e.vehicleUpgradeLevels, levels); assert.ok(Object.isFrozen(e.vehicleUpgradeLevels));
    assert.throws(() => { e.vehicleUpgradeLevels.engine = 5; }, TypeError);
    assert.notStrictEqual(e.vehicleUpgradeLevels, p.vehicleUpgrades[family]);
    close(e.engineMul, 1.14, 'engine multiplier'); close(e.hpMul, 1.16, 'armor multiplier'); close(e.bulletResist, .96, 'armor resistance');
    close(e.gripMul, 1.12, 'tire grip'); assert.equal(e.runFlat, true);
    assert.equal(e.ramLevel, 1); assert.equal(e.spikes, 1); assert.equal(e.glass, 1); assert.equal(e.fueltank, 1); assert.equal(e.oil, 1); assert.equal(e.mines, 1);
    assert.equal(built.spec.id, id); assert.equal(built.spec.family, family); assert.equal(built.spec.familyStage, stageOf(id));
    assert.equal(built.spec.hp, Math.round(base.hp * 1.16)); close(built.spec.engine.vmax, base.engine.vmax * 1.14, 'selected chassis speed');
    close(built.spec.grip.front, base.grip.front * 1.12, 'selected chassis grip');
    assert.equal(built.spec.nitro.capacity, e.nitroCap); assert.equal(built.spec.nitro.regen, e.nitroRegen);
    assert.deepEqual(p, before, 'stat and appearance snapshots cannot modify the save');
    p.vehicleUpgrades[family].engine = 3;
    assert.equal(e.vehicleUpgradeLevels.engine, 2, 'a previously published snapshot cannot change with the save');
    assert.equal(effects(p).vehicleUpgradeLevels.engine, 3);
  }
  assert.deepEqual(VEHICLES, canonical, 'building upgraded specs cannot alter the production chassis table');
});

test('nitro capacity and regeneration add purchased levels to every selected chassis baseline', () => {
  for (const id of Object.values(FAMILY_STAGES).flat()) {
    const family = familyOf(id), base = VEHICLES[id].nitro;
    for (let level = 0; level <= FAMILY_CAPS[family].nitro; level++) {
      const p = profile({ truck: id, trucks: [id], vehicleUpgradeSchema: 2, vehicleUpgrades: { [family]: { nitro: level } } });
      const before = structuredClone(p), e = effects(p), built = buildPlayerSpec(p);
      const capacity = base.capacity + (level ? .4 + .8 * level : 0);
      const regeneration = base.regen + (level ? .03 : 0) + .03 * level;
      close(e.nitroCap, capacity, `${id} nitro level ${level} capacity`);
      close(e.nitroRegen, regeneration, `${id} nitro level ${level} regeneration`);
      assert.equal(built.spec.nitro.capacity, e.nitroCap); assert.equal(built.spec.nitro.regen, e.nitroRegen);
      assert.deepEqual(p, before);
    }
  }
});
