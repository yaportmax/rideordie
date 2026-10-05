import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, weaponTrackCost } from '../src/data/upgrades.js';
import { WEAPONS, weaponStats } from '../src/data/weapons.js';
import { normalizeProfile, buyWeaponTrack, buyWeaponAttachment, equipWeaponAttachment } from '../src/meta/profile.js';
import { weaponTrackPurchaseState } from '../src/meta/weapon_tuning.js';
import { equippedWeaponAttachments } from '../src/data/weapon_attachments.js';

function owned(id, levels = {}) {
  const profile = normalizeProfile(DEFAULT_PROFILE()); profile.cash = 1000000;
  profile.weapons[id] = { dmg: 0, mag: 0, rel: 0, hnd: 0, ...levels }; return profile;
}

test('installed extended magazines block masked next tiers without any money, ownership or version changes', () => {
  for (const id of ['pistol', 'smg', 'shotgun', 'rifle', 'lmg', 'sniper', 'minigun']) {
    const profile = owned(id); assert.equal(buyWeaponAttachment(profile, id, 'extended_mag').ok, true);
    for (const level of [0, 1]) {
      profile.weapons[id].mag = level; const before = structuredClone(profile);
      const state = weaponTrackPurchaseState(profile, id, 'mag');
      assert.equal(state.reason, 'covered'); assert.equal(state.coveredByAttachment, true);
      assert.equal(state.cost, weaponTrackCost(id, 'mag', level));
      assert.deepEqual(buyWeaponTrack(profile, id, 'mag'), { ok: false, reason: 'covered' });
      assert.deepEqual(profile, before);
    }
  }
});

test('removing an owned extended magazine restores ordinary first-tier purchases and exact original price', () => {
  const profile = owned('rifle'); buyWeaponAttachment(profile, 'rifle', 'extended_mag');
  assert.equal(equipWeaponAttachment(profile, 'rifle', 'extended_mag', false).ok, true);
  const balance = profile.cash, old = weaponStats('rifle', profile.weapons.rifle);
  assert.equal(weaponTrackPurchaseState(profile, 'rifle', 'mag').ok, true);
  assert.equal(buyWeaponTrack(profile, 'rifle', 'mag').ok, true);
  assert.equal(profile.cash, balance - weaponTrackCost('rifle', 'mag', 0)); assert.equal(profile.weapons.rifle.mag, 1);
  assert.ok(weaponStats('rifle', profile.weapons.rifle).mag > old.mag);
  assert.deepEqual(profile.weaponAttachments.rifle, { owned: ['extended_mag'], equipped: [] });
});

test('the next magazine tier that genuinely exceeds an installed part stays purchasable; rounded ties refuse', () => {
  for (const id of ['pistol', 'smg', 'rifle', 'lmg', 'sniper', 'minigun']) {
    const profile = owned(id); buyWeaponAttachment(profile, id, 'extended_mag'); profile.weapons[id].mag = 2;
    const balance = profile.cash, old = weaponStats(id, profile.weapons[id], equippedWeaponAttachments(profile)[id]);
    assert.equal(buyWeaponTrack(profile, id, 'mag').ok, true); assert.equal(profile.weapons[id].mag, 3);
    assert.equal(profile.cash, balance - weaponTrackCost(id, 'mag', 2));
    assert.ok(weaponStats(id, profile.weapons[id], equippedWeaponAttachments(profile)[id]).mag > old.mag);
  }
  const shotgun = owned('shotgun'); buyWeaponAttachment(shotgun, 'shotgun', 'extended_mag'); shotgun.weapons.shotgun.mag = 2;
  const before = structuredClone(shotgun);
  assert.equal(weaponStats('shotgun', { mag: 2 }, ['extended_mag']).mag, weaponStats('shotgun', { mag: 3 }, ['extended_mag']).mag);
  assert.equal(buyWeaponTrack(shotgun, 'shotgun', 'mag').reason, 'covered'); assert.deepEqual(shotgun, before);
});

test('foregrip plus stock cannot charge masked handling tier one, while productive handling tiers and other tracks remain', () => {
  const profile = owned('rifle'); buyWeaponAttachment(profile, 'rifle', 'foregrip'); buyWeaponAttachment(profile, 'rifle', 'stock');
  const before = structuredClone(profile);
  assert.equal(weaponTrackPurchaseState(profile, 'rifle', 'hnd').reason, 'covered');
  assert.equal(buyWeaponTrack(profile, 'rifle', 'hnd').reason, 'covered'); assert.deepEqual(profile, before);
  assert.equal(equipWeaponAttachment(profile, 'rifle', 'foregrip', false).ok, true);
  const balance = profile.cash; assert.equal(buyWeaponTrack(profile, 'rifle', 'hnd').ok, true);
  assert.equal(profile.cash, balance - weaponTrackCost('rifle', 'hnd', 0));
  assert.equal(equipWeaponAttachment(profile, 'rifle', 'foregrip', true).ok, true);
  const kit = equippedWeaponAttachments(profile).rifle, old = weaponStats('rifle', profile.weapons.rifle, kit);
  assert.equal(buyWeaponTrack(profile, 'rifle', 'hnd').ok, true);
  const after = weaponStats('rifle', profile.weapons.rifle, kit); assert.ok(after.spreadMul < old.spreadMul);
  assert.equal(buyWeaponTrack(profile, 'rifle', 'dmg').ok, true); assert.equal(buyWeaponTrack(profile, 'rifle', 'rel').ok, true);
});

test('a foregrip alone still permits first handling tier when recoil actually improves', () => {
  const profile = owned('rifle'); buyWeaponAttachment(profile, 'rifle', 'foregrip');
  const kit = equippedWeaponAttachments(profile).rifle, old = weaponStats('rifle', profile.weapons.rifle, kit);
  assert.equal(buyWeaponTrack(profile, 'rifle', 'hnd').ok, true);
  assert.ok(weaponStats('rifle', profile.weapons.rifle, kit).recoilMul < old.recoilMul);
});

test('legacy included magazines and no-kit tracks preserve their original sequential upgrades without grants or extra capability', () => {
  const profile = owned('rifle', { mag: 1 }); const cash = profile.cash;
  assert.equal(buyWeaponTrack(profile, 'rifle', 'mag').ok, true); assert.equal(profile.weapons.rifle.mag, 2);
  assert.equal(profile.cash, cash - weaponTrackCost('rifle', 'mag', 1)); assert.equal(profile.v, 1);
  assert.equal(Object.hasOwn(profile, 'weaponAttachments'), false);
  const rpg = owned('rpg');
  for (let level = 0; level < 3; level++) {
    const balance = rpg.cash; assert.equal(buyWeaponTrack(rpg, 'rpg', 'mag').ok, true);
    assert.equal(rpg.cash, balance - weaponTrackCost('rpg', 'mag', level));
  }
  assert.ok(weaponStats('rpg', rpg.weapons.rpg).mag > WEAPONS.rpg.mag);
});

test('cash, maximum, invalid and locked tuning checks preserve atomic rejection', () => {
  const profile = owned('rifle'); profile.cash = 0; const before = structuredClone(profile);
  assert.equal(buyWeaponTrack(profile, 'rifle', 'mag').reason, 'cash');
  assert.equal(buyWeaponTrack(profile, 'pistol', 'future').reason, 'invalid');
  assert.equal(buyWeaponTrack(profile, 'smg', 'mag').reason, 'locked'); assert.deepEqual(profile, before);
  profile.weapons.rifle.mag = 3; const maxed = structuredClone(profile);
  assert.equal(buyWeaponTrack(profile, 'rifle', 'mag').reason, 'max'); assert.deepEqual(profile, maxed);
});
