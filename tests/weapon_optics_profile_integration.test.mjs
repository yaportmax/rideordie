import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, effects } from '../src/data/upgrades.js';
import { normalizeProfile, buyWeapon, buyWeaponOptic, equipWeaponOptic } from '../src/meta/profile.js';
import { buildPlayerSpec, gunnerLoadout } from '../src/game/run_setup.js';

const owned = () => { const p = DEFAULT_PROFILE(); p.cash = 100000; buyWeapon(p, 'smg'); buyWeapon(p, 'rifle'); return p; };

test('normalized save restores optics only for valid owned guns and defaults new weapons to factory sights', () => {
  const p = owned(); buyWeaponOptic(p, 'smg', 'wide_reflex');
  p.weaponOptics.rifle = { owned: ['standard'], equipped: 'wide_reflex' };
  p.weaponOptics.rpg = { owned: ['wide_reflex'], equipped: 'wide_reflex' };
  const saved = normalizeProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(saved.weaponOptics.smg, { owned: ['standard', 'wide_reflex'], equipped: 'wide_reflex' });
  assert.deepEqual(saved.weaponOptics.rifle, { owned: ['standard'], equipped: 'standard' });
  assert.equal(Object.hasOwn(saved.weaponOptics, 'rpg'), false);
  assert.equal(buyWeapon(saved, 'shotgun').ok, true);
  assert.deepEqual(saved.weaponOptics.shotgun, { owned: ['standard'], equipped: 'standard' });
  assert.equal(saved.weaponOptics.smg.equipped, 'wide_reflex', 'buying another gun cannot strip a saved optic');
});

test('effective run setup passes only equipped optic identity while combat and family purchases remain unchanged', () => {
  const p = owned(); p.loadout = ['smg', 'rifle'];
  const before = buildPlayerSpec(p), families = structuredClone(p.vehicleUpgrades);
  buyWeaponOptic(p, 'smg', 'wide_reflex');
  const after = buildPlayerSpec(p), e = effects(p), loadout = gunnerLoadout(e);
  assert.deepEqual(after.spec, before.spec); assert.deepEqual(p.vehicleUpgrades, families);
  assert.equal(loadout.optics.smg, 'wide_reflex'); assert.equal(loadout.optics.rifle, 'standard');
  assert.ok(Object.isFrozen(e.weaponOptics));
  assert.equal(equipWeaponOptic(p, 'smg', 'standard').ok, true);
  assert.equal(effects(p).weaponOptics.smg, 'standard');
  assert.equal(e.weaponOptics.smg, 'wide_reflex', 'a frozen running loadout cannot change under a later shop equip');
});
