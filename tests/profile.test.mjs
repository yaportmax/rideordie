import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, UPGRADES, TRUCKS, WEAPON_TRACK_MAX } from '../src/data/upgrades.js';
import { WEAPONS } from '../src/data/weapons.js';
import { normalizeProfile, loadProfile, saveProfile, buyUpgrade, buyTruck, selectTruck, buyWeapon, buyWeaponTrack, equipWeapon, creditRun } from '../src/meta/profile.js';

test('old or damaged saves recover a playable owned truck, weapon and finite stats', () => {
  for (const value of [null, [], {}, { cash: NaN, upgrades: [], weapons: null, loadout: ['missing'], best: null }]) {
    const p = normalizeProfile(value);
    assert.equal(p.truck, 'player_sedan_t1'); assert.deepEqual(p.loadout, ['pistol']); assert.ok(p.weapons.pistol); assert.ok(Number.isFinite(p.cash));
  }
  assert.throws(() => normalizeProfile({ trucks: ['missing'], truck: 'missing' }), error => error?.code === 'unsupported-profile', 'unknown vehicle progress must not be silently projected away');
  const p = normalizeProfile({ cash: 8000, truck: 'truck_t2', trucks: ['truck_t2'], upgrades: { engine: 100, armor: -2 }, weapons: { rifle: { dmg: 99, rel: -2 } }, loadout: ['rifle', 'rifle'], best: { time: Infinity } });
  assert.equal(p.cash, 8000); assert.equal(p.truck, 'truck_t2'); assert.equal(p.vehicleUpgrades.rustbucket.engine, 5);
  assert.equal(p.vehicleUpgrades.rustbucket.armor, 0); assert.equal(p.vehicleUpgrades.sedan.engine, 0);
  assert.equal(Object.hasOwn(p.upgrades, 'engine'), false, 'schema-less old driver purchases migrate out of the global crew inventory');
  assert.equal(p.weapons.rifle.dmg, WEAPON_TRACK_MAX); assert.equal(p.weapons.rifle.rel, 0); assert.deepEqual(p.loadout, ['rifle']); assert.equal(p.best.time, 0);
});

test('save/load roundtrip retains progression and blocked storage never breaks purchases', () => {
  const data = new Map();
  globalThis.localStorage = { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) };
  const p = DEFAULT_PROFILE(); p.cash = 1234; p.best.distance = 7500; p.best.furthestS = 60000;
  p.vehicleUpgrades.sedan.engine = 2; p.upgrades.vest = 1; saveProfile(p);
  assert.equal(loadProfile().cash, 1234); assert.equal(loadProfile(p.campaignId).campaignId, p.campaignId);
  assert.equal(loadProfile().best.furthestS, 60000); assert.equal(loadProfile().best.distance, 7500);
  assert.equal(loadProfile().vehicleUpgrades.sedan.engine, 2); assert.equal(loadProfile().vehicleUpgrades.rustbucket.engine, 0);
  assert.equal(loadProfile().upgrades.vest, 1); assert.equal(Object.hasOwn(loadProfile().upgrades, 'engine'), false);
  data.set('rideordie.profile.v1', '{bad'); assert.equal(loadProfile().truck, 'player_sedan_t1');
  globalThis.localStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  assert.doesNotThrow(() => saveProfile(p)); assert.equal(loadProfile().loadout[0], 'pistol');
});

test('old saves migrate route progress while damaged absolute coordinates retain a finite fallback', () => {
  const legacy = normalizeProfile({ best: { distance: 20000, time: 90, kills: 4 } });
  assert.equal(legacy.best.furthestS, 20000);
  for (const furthestS of [undefined, NaN, Infinity, -10, '60000', {}, 0]) {
    const p = normalizeProfile({ best: { distance: 7500, furthestS } });
    assert.equal(p.best.furthestS, 7500);
    assert.equal(p.best.distance, 7500);
  }
  assert.equal(normalizeProfile({ best: { distance: NaN, furthestS: Infinity } }).best.furthestS, 0);
  assert.equal(normalizeProfile({ best: { distance: 7500, furthestS: 60000 } }).best.furthestS, 60000);
});

test('every truck and upgrade charges its catalog price exactly and stops at its maximum', () => {
  const p = DEFAULT_PROFILE(); p.cash = 1000000;
  for (const t of TRUCKS.slice(1)) { const before = p.cash; assert.equal(buyTruck(p, t.id).ok, true); assert.equal(p.cash, before - t.cost); }
  // This test checks every published upgrade price through its full global
  // catalogue length. Rustbucket keeps those full limits; lighter families'
  // separate caps/isolation have dedicated vehicle_families coverage.
  assert.equal(selectTruck(p, 'truck_t4').ok, true);
  for (const u of UPGRADES) {
    if (u.retired) {
      const before = structuredClone(p);
      assert.deepEqual(buyUpgrade(p, u.id), { ok: false, reason: 'retired' });
      assert.deepEqual(p, before, 'archived equipment is never charged or reactivated');
      continue;
    }
    for (const cost of u.costs) { const before = p.cash; assert.equal(buyUpgrade(p, u.id).ok, true); assert.equal(p.cash, before - cost); }
    assert.equal(buyUpgrade(p, u.id).reason, 'max');
  }
});

test('invalid upgrade and weapon-track requests leave the wallet and loadout untouched', () => {
  const p = DEFAULT_PROFILE(); p.cash = 10000;
  const before = structuredClone(p);
  for (const id of ['missing', 'constructor', '__proto__']) {
    assert.equal(buyUpgrade(p, id).ok, false); assert.equal(buyWeapon(p, id).ok, false);
    assert.equal(buyWeaponTrack(p, 'pistol', id).ok, false);
  }
  assert.equal(equipWeapon(p, 'pistol', -1).ok, false); assert.equal(equipWeapon(p, 'pistol', 9).ok, false);
  assert.deepEqual(p, before);
});

test('equipping into a full loadout replaces only the chosen slot; owned slots can swap', () => {
  const p = DEFAULT_PROFILE(); p.cash = 100000;
  for (const id of ['revolver', 'smg', 'rifle']) buyWeapon(p, id);
  assert.deepEqual(p.loadout, ['pistol', 'revolver', 'smg']);
  equipWeapon(p, 'rifle', 1); assert.deepEqual(p.loadout, ['pistol', 'rifle', 'smg']);
  equipWeapon(p, 'smg', 0); assert.deepEqual(p.loadout, ['smg', 'rifle', 'pistol']);
});

test('a repeated result pays once and malformed rewards cannot poison the save', () => {
  const p = DEFAULT_PROFILE(), run = { id: 'one-life', cash: 200, distance: 1500, time: 90, kills: 4, minibosses: [0] };
  creditRun(p, run); creditRun(p, run);
  assert.equal(p.cash, 200); assert.equal(p.runs, 1); assert.equal(p.best.kills, 4); assert.equal(p.minibosses[0], true);
  creditRun(p, { id: 'another-life', cash: NaN, distance: NaN, time: -1, kills: Infinity });
  assert.equal(p.cash, 200); assert.equal(p.best.time, 90); assert.equal(p.runs, 2);
});

test('checkpoint route records persist without changing distance rewards or paying a repeated result twice', () => {
  const p = normalizeProfile({ best: { distance: 20000 }, cash: 100, totalCash: 100 });
  const run = { id: 'dam-retry', cash: 975, distance: 7500, startS: 52500, furthestS: 60000, time: 30, kills: 2 };
  creditRun(p, run);
  assert.equal(p.best.distance, 20000);
  assert.equal(p.best.furthestS, 60000);
  assert.equal(p.cash, 1075); assert.equal(p.totalCash, 1075); assert.equal(p.runs, 1);
  const credited = structuredClone(p);
  creditRun(p, run);
  assert.deepEqual(p, credited);
  assert.equal(normalizeProfile(JSON.parse(JSON.stringify(p))).best.furthestS, 60000);
  creditRun(p, { id: 'shorter-life', cash: 0, distance: 25000, furthestS: 25040 });
  assert.equal(p.best.distance, 25000); assert.equal(p.best.furthestS, 60000);
});

test('legacy and malformed result coordinates cannot poison or erase the absolute route record', () => {
  const p = DEFAULT_PROFILE();
  creditRun(p, { id: 'legacy-life', cash: 0, distance: 15000 });
  assert.equal(p.best.furthestS, 15000);
  for (const [i, furthestS] of [NaN, Infinity, -1, '60000'].entries()) {
    creditRun(p, { id: `damaged-${i}`, cash: NaN, distance: 1000, furthestS });
    assert.equal(p.best.furthestS, 15000);
    assert.equal(p.best.distance, 15000);
    assert.equal(p.cash, 0);
  }
});

test('unaffordable purchases do not spend cash or grant ownership', () => {
  const p = DEFAULT_PROFILE();
  assert.equal(buyWeapon(p, 'rifle').reason, 'cash'); assert.equal(buyTruck(p, 'truck_t4').reason, 'cash');
  assert.equal(buyUpgrade(p, 'engine').reason, 'cash'); assert.equal(p.cash, 0); assert.equal(p.weapons.rifle, undefined);
  assert.ok(WEAPONS.rifle.cost > 0);
});
