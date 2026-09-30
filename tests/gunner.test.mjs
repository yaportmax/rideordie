import test from 'node:test';
import assert from 'node:assert/strict';
import { GunnerController } from '../src/game/gunner.js';
import { weaponStats } from '../src/data/weapons.js';
import { DEFAULT_PROFILE, effects } from '../src/data/upgrades.js';
import { gunnerLoadout } from '../src/game/run_setup.js';

const ctx = () => ({ emit: () => {}, ownCar: () => null, targets: function* () {}, raycastWorld: () => null });
const neutral = () => ({ dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1, crouch: false, moveX: 0, moveZ: 0 });

test('pouches and steady-hands purchases apply to every equipped gun and stack with weapon tracks', () => {
  const p = DEFAULT_PROFILE(); p.upgrades.pouches = 3; p.upgrades.steady = 3;
  p.weapons.rifle = { dmg: 0, mag: 0, rel: 2, hnd: 2 }; p.loadout = ['pistol', 'rifle'];
  const g = new GunnerController(gunnerLoadout(effects(p)), ctx());
  for (let i = 0; i < g.slots.length; i++) {
    const base = weaponStats(g.slots[i], p.weapons[g.slots[i]]);
    assert.ok(Math.abs(g.stats[i].reload - base.reload * 0.64) < 1e-9);
    assert.ok(Math.abs(g.stats[i].spreadMul - base.spreadMul * 0.7) < 1e-9);
    assert.ok(Math.abs(g.stats[i].recoilMul - base.recoilMul * 0.7) < 1e-9);
  }
});

test('reload refills the current magazine at the purchased reload speed', () => {
  const g = new GunnerController({ weapons: ['rifle'], reloadMul: 0.64 }, ctx()); g.mag[0] = 0; g.startReload();
  for (let i = 0; i < 76; i++) g.update(1 / 60, neutral(), null, 0);
  assert.equal(g.reloading, true);
  g.update(1 / 60, neutral(), null, 0); assert.equal(g.reloading, false); assert.equal(g.magNow, g.weapon.mag);
});

test('swapping guns cancels a reload and preserves each gun magazine', () => {
  const g = new GunnerController({ weapons: ['pistol', 'rifle'] }, ctx());
  g.mag[0] = 2; g.startReload(); g.update(1 / 60, { ...neutral(), slot: 1 }, null, 0);
  assert.equal(g.cur, 1); assert.equal(g.reloading, false); assert.equal(g.mag[0], 2); assert.equal(g.mag[1], 30);
});
