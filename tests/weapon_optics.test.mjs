import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, COST_SCALE } from '../src/data/upgrades.js';
import { WEAPONS, weaponStats } from '../src/data/weapons.js';
import { REFLEX_GUNS, WEAPON_OPTICS, normalizeWeaponOptics, equippedWeaponOptics, compatibleWeaponOptic } from '../src/data/weapon_optics.js';
import { buyWeaponOptic, equipWeaponOptic, weaponOpticState } from '../src/meta/weapon_optics.js';
import { GunnerController } from '../src/game/gunner.js';

function profile() { const p = DEFAULT_PROFILE(); p.cash = 100000; for (const id of Object.keys(WEAPONS)) p.weapons[id] = { dmg: 1, mag: 2, rel: 1, hnd: 2 }; return p; }

test('legacy optic migration preserves every owned weapon and only accepts compatible purchased choices', () => {
  const p = profile(), before = structuredClone(p);
  const rows = normalizeWeaponOptics(p, { pistol: { owned: ['wide_reflex', 'wide_reflex', 'missing'], equipped: 'wide_reflex' },
    rpg: { owned: ['wide_reflex'], equipped: 'wide_reflex' }, revolver: { owned: [null], equipped: 'constructor' }, missing: { owned: ['wide_reflex'] } });
  assert.deepEqual(rows.pistol, { owned: ['standard', 'wide_reflex'], equipped: 'wide_reflex' });
  for (const id of ['rpg', 'revolver', 'sniper']) assert.deepEqual(rows[id], { owned: ['standard'], equipped: 'standard' });
  assert.equal(Object.hasOwn(rows, 'missing'), false); assert.deepEqual(p, before);
  for (const malformed of [null, [], 'wide_reflex', 1, { pistol: { owned: {}, equipped: 'wide_reflex' } }]) {
    for (const row of Object.values(normalizeWeaponOptics(p, malformed))) assert.deepEqual(row, { owned: ['standard'], equipped: 'standard' });
  }
});

test('each of five optics charges its exact price once, equips immediately and restores standard freely', () => {
  const p = profile(), loadout = p.loadout.slice(), levels = structuredClone(p.weapons);
  for (const id of REFLEX_GUNS) {
    const before = p.cash, cost = Math.round(WEAPON_OPTICS.wide_reflex.baseCosts[id] * COST_SCALE);
    assert.equal(weaponOpticState(p, id, 'wide_reflex').cost, cost);
    assert.equal(buyWeaponOptic(p, id, 'wide_reflex').ok, true); assert.equal(p.cash, before - cost);
    assert.equal(weaponOpticState(p, id, 'wide_reflex').equipped, true);
    const bought = structuredClone(p); assert.equal(buyWeaponOptic(p, id, 'wide_reflex').reason, 'owned'); assert.deepEqual(p, bought);
    assert.equal(equipWeaponOptic(p, id, 'standard').ok, true); assert.equal(p.cash, before - cost);
    assert.equal(equipWeaponOptic(p, id, 'wide_reflex').ok, true); assert.equal(p.cash, before - cost);
  }
  assert.deepEqual(p.loadout, loadout); assert.deepEqual(p.weapons, levels);
  const chosen = equippedWeaponOptics(p); assert.ok(Object.isFrozen(chosen));
  for (const id of REFLEX_GUNS) assert.equal(chosen[id], 'wide_reflex');
});

test('invalid, locked, insufficient and unowned optic actions are atomic', () => {
  const p = DEFAULT_PROFILE(); p.cash = 937;
  const before = structuredClone(p);
  for (const [weapon, optic] of [['pistol', 'missing'], ['pistol', 'constructor'], ['__proto__', 'standard'], ['rpg', 'wide_reflex'], ['smg', 'wide_reflex']]) {
    assert.equal(buyWeaponOptic(p, weapon, optic).ok, false); assert.equal(equipWeaponOptic(p, weapon, optic).ok, false);
  }
  assert.equal(buyWeaponOptic(p, 'pistol', 'wide_reflex').reason, 'cash');
  assert.equal(equipWeaponOptic(p, 'pistol', 'wide_reflex').reason, 'locked'); assert.deepEqual(p, before);
  assert.equal(compatibleWeaponOptic('sniper', 'wide_reflex'), false);
});

test('run attachment selection cannot mutate combat stats or create more than three configured guns', () => {
  const p = profile(); for (const id of REFLEX_GUNS) assert.equal(buyWeaponOptic(p, id, 'wide_reflex').ok, true);
  const weapons = ['pistol', 'rifle', 'lmg'], optics = equippedWeaponOptics(p);
  const gunner = new GunnerController({ weapons, levels: p.weapons, optics }, {});
  assert.equal(gunner.slots.length, 3); assert.deepEqual(Object.keys(gunner.optics), weapons); assert.ok(Object.isFrozen(gunner.optics));
  for (const stats of gunner.stats) { const { opticId, ...combat } = stats; assert.equal(opticId, 'wide_reflex'); assert.deepEqual(combat, weaponStats(stats.id, p.weapons[stats.id])); }
  const invalid = new GunnerController({ weapons: ['rpg'], optics: { rpg: 'wide_reflex' } }, {});
  assert.equal(invalid.weapon.opticId, 'standard');
});
