import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, UPGRADES, TRUCKS, WEAPON_TRACK_MAX } from '../src/data/upgrades.js';
import { WEAPONS } from '../src/data/weapons.js';
import { normalizeProfile, loadProfile, saveProfile, buyUpgrade, buyTruck, buyWeapon, buyWeaponTrack, equipWeapon, creditRun } from '../src/meta/profile.js';

test('old or damaged saves recover a playable owned truck, weapon and finite stats', () => {
  for (const value of [null, [], {}, { cash: NaN, upgrades: [], weapons: null, trucks: ['missing'], truck: 'missing', loadout: ['missing'], best: null }]) {
    const p = normalizeProfile(value);
    assert.equal(p.truck, 'truck_t1'); assert.deepEqual(p.loadout, ['pistol']); assert.ok(p.weapons.pistol); assert.ok(Number.isFinite(p.cash));
  }
  const p = normalizeProfile({ cash: 8000, truck: 'truck_t2', trucks: ['truck_t2'], upgrades: { engine: 100, armor: -2 }, weapons: { rifle: { dmg: 99, rel: -2 } }, loadout: ['rifle', 'rifle'], best: { time: Infinity } });
  assert.equal(p.cash, 8000); assert.equal(p.truck, 'truck_t2'); assert.equal(p.upgrades.engine, 5);
  assert.equal(p.weapons.rifle.dmg, WEAPON_TRACK_MAX); assert.equal(p.weapons.rifle.rel, 0); assert.deepEqual(p.loadout, ['rifle']); assert.equal(p.best.time, 0);
});

test('save/load roundtrip retains progression and blocked storage never breaks purchases', () => {
  const data = new Map();
  globalThis.localStorage = { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) };
  const p = DEFAULT_PROFILE(); p.cash = 1234; saveProfile(p);
  assert.equal(loadProfile().cash, 1234); assert.equal(loadProfile(p.campaignId).campaignId, p.campaignId);
  data.set('rideordie.profile.v1', '{bad'); assert.equal(loadProfile().truck, 'truck_t1');
  globalThis.localStorage = { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } };
  assert.doesNotThrow(() => saveProfile(p)); assert.equal(loadProfile().loadout[0], 'pistol');
});

test('every truck and upgrade charges its catalog price exactly and stops at its maximum', () => {
  const p = DEFAULT_PROFILE(); p.cash = 1000000;
  for (const t of TRUCKS.slice(1)) { const before = p.cash; assert.equal(buyTruck(p, t.id).ok, true); assert.equal(p.cash, before - t.cost); }
  for (const u of UPGRADES) {
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

test('unaffordable purchases do not spend cash or grant ownership', () => {
  const p = DEFAULT_PROFILE();
  assert.equal(buyWeapon(p, 'rifle').reason, 'cash'); assert.equal(buyTruck(p, 'truck_t4').reason, 'cash');
  assert.equal(buyUpgrade(p, 'engine').reason, 'cash'); assert.equal(p.cash, 0); assert.equal(p.weapons.rifle, undefined);
  assert.ok(WEAPONS.rifle.cost > 0);
});
