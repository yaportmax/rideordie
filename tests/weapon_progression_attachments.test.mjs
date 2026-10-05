import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, effects, weaponTrackCost } from '../src/data/upgrades.js';
import { WEAPONS, WEAPON_PROGRESSION, weaponStats } from '../src/data/weapons.js';
import { WEAPON_ATTACHMENTS, WEAPON_ATTACHMENT_ORDER, compatibleWeaponAttachment, normalizeWeaponAttachments, equippedWeaponAttachments } from '../src/data/weapon_attachments.js';
import { normalizeProfile, buyWeapon, buyWeaponTrack, equipWeapon, buyWeaponOptic, equipWeaponOptic, buyWeaponAttachment, equipWeaponAttachment } from '../src/meta/profile.js';
import { weaponPurchaseState } from '../src/meta/weapon_progression.js';
import { weaponAttachmentState } from '../src/meta/weapon_attachments.js';
import { creditCampaignLevel } from '../src/data/campaign.js';
import { sanitizeProfile } from '../server/saves/schema.js';
import { assertSupportedProfile, contentProfileVersion } from '../server/saves/profile_support.js';

const tracks = { dmg: 0, mag: 0, rel: 0, hnd: 0 };
const funded = () => { const profile = DEFAULT_PROFILE(); profile.cash = 1000000; return profile; };
function unlock(profile, level) {
  for (let chapter = 1; chapter < level; chapter++) {
    assert.equal(creditCampaignLevel(profile, { runId: `earned-${chapter}`, level: chapter, mode: 'campaign', won: true }), true);
  }
  return profile;
}
function allOwned() { const profile = funded(); for (const id of Object.keys(WEAPONS)) profile.weapons[id] = { ...tracks }; return normalizeProfile(profile); }

test('chapter-one farming and fabricated selected/unlocked chapters cannot buy strong guns', () => {
  const profile = funded();
  profile.campaignProgress.unlockedLevel = 10; profile.campaignProgress.selectedLevel = 10;
  profile.best.furthestS = 100000; profile.runs = 900; profile.totalCash = 1000000;
  const before = structuredClone(profile);
  for (const id of Object.keys(WEAPONS).filter(id => id !== 'pistol')) {
    const state = weaponPurchaseState(profile, id);
    assert.equal(state.availableLevel, 1); assert.equal(state.reason, 'progress');
    assert.deepEqual(buyWeapon(profile, id), { ok: false, reason: 'progress' });
  }
  assert.deepEqual(profile, before);
});

test('every gun unlocks only after preceding contiguous legitimate clear receipts and charges the final price once', () => {
  const expected = { pistol: [1, 0], revolver: [2, 4500], smg: [2, 6500], shotgun: [3, 8500], rifle: [4, 18000],
    sniper: [5, 32000], lmg: [6, 44000], rpg: [7, 70000], minigun: [9, 105000] };
  for (const [id, [level, cost]] of Object.entries(expected)) {
    assert.deepEqual(WEAPON_PROGRESSION[id], { unlockLevel: level, cost });
    assert.equal(WEAPONS[id].cost, cost);
    if (id === 'pistol') continue;
    const profile = unlock(funded(), level - 1), before = structuredClone(profile);
    assert.equal(buyWeapon(profile, id).reason, 'progress'); assert.deepEqual(profile, before);
    assert.equal(creditCampaignLevel(profile, { runId: `last-${level}`, level: level - 1, mode: 'campaign', won: true }), true);
    const balance = profile.cash;
    assert.equal(buyWeapon(profile, id).ok, true); assert.equal(profile.cash, balance - cost);
    const bought = structuredClone(profile);
    assert.equal(buyWeapon(profile, id).reason, 'owned'); assert.deepEqual(profile, bought);
    assert.deepEqual(profile.weaponOptics[id], { owned: ['standard'], equipped: 'standard' });
  }
});

test('failed, skipped and duplicate clear reports cannot turn money into early access', () => {
  const profile = funded();
  for (const result of [
    { runId: 'loss', level: 1, mode: 'campaign', won: false },
    { runId: 'skip', level: 6, mode: 'campaign', won: true },
    { runId: 'marathon', level: 1, mode: 'marathon', won: true },
  ]) assert.equal(creditCampaignLevel(profile, result), false);
  assert.equal(weaponPurchaseState(profile, 'rifle').availableLevel, 1);
  assert.equal(buyWeapon(profile, 'rifle').reason, 'progress');
  assert.equal(creditCampaignLevel(profile, { runId: 'one-clear', level: 1, mode: 'campaign', won: true }), true);
  assert.equal(creditCampaignLevel(profile, { runId: 'one-clear', level: 2, mode: 'campaign', won: true }), false);
  assert.equal(weaponPurchaseState(profile, 'rifle').availableLevel, 2);
});

test('progression-ready cash shortfall is atomic and prices do not inflate historical track bases', () => {
  const profile = unlock(funded(), 4); profile.cash = WEAPONS.rifle.cost - 1;
  const before = structuredClone(profile);
  assert.equal(buyWeapon(profile, 'rifle').reason, 'cash'); assert.deepEqual(profile, before);
  assert.equal(WEAPONS.rifle.baseCost, 4200);
  assert.equal(weaponTrackCost('rifle', 'dmg', 0), Math.round(4200 * .16 * 1.25));
  assert.equal(weaponTrackCost('pistol', 'mag', 0), Math.round(1800 * .12 * 1.25));
});

test('a guest career cannot borrow host chapter unlocks and invalid authority career levels are atomic', () => {
  const shared = unlock(funded(), 9), before = structuredClone(shared);
  assert.equal(weaponPurchaseState(shared, 'rifle', 1).availableLevel, 1);
  assert.equal(buyWeapon(shared, 'rifle', 1).reason, 'progress'); assert.deepEqual(shared, before);
  for (const invalid of [0, 11, NaN, Infinity, '9', {}, null]) {
    assert.equal(weaponPurchaseState(shared, 'rifle', invalid).reason, 'invalid');
    assert.equal(buyWeapon(shared, 'rifle', invalid).reason, 'invalid'); assert.deepEqual(shared, before);
  }
  shared.weapons.rifle = { ...tracks };
  assert.equal(weaponPurchaseState(shared, 'rifle', 1).owned, true);
  assert.equal(equipWeapon(shared, 'rifle', 0).ok, true);
});

test('legacy owned strong guns, their tiers and paid sights survive without granting unearned chapter progression', () => {
  const profile = normalizeProfile({ ...funded(), weapons: { pistol: { ...tracks }, rifle: { dmg: 2, mag: 3, rel: 2, hnd: 3 }, rpg: { ...tracks } },
    loadout: ['rifle', 'rpg'], weaponOptics: { rifle: { owned: ['standard', 'wide_reflex'], equipped: 'wide_reflex' } } });
  assert.equal(weaponPurchaseState(profile, 'rifle').owned, true);
  assert.equal(weaponPurchaseState(profile, 'rifle').availableLevel, 1);
  assert.equal(equipWeapon(profile, 'rifle', 0).ok, true);
  assert.equal(buyWeaponTrack(profile, 'rifle', 'dmg').ok, true);
  assert.equal(profile.weapons.rifle.mag, 3); assert.equal(profile.weaponOptics.rifle.equipped, 'wide_reflex');
  assert.equal(buyWeapon(profile, 'minigun').reason, 'progress');
  assert.equal(profile.campaignProgress.unlockedLevel, 1);
});

test('every compatible purchased attachment charges once, installs, removes and reinstalls without refund or extra charge', () => {
  const profile = allOwned();
  for (const id of Object.keys(WEAPONS)) for (const part of WEAPON_ATTACHMENT_ORDER) {
    if (!compatibleWeaponAttachment(id, part)) continue;
    const state = weaponAttachmentState(profile, id, part), balance = profile.cash;
    assert.equal(state.cost, Math.round(WEAPON_ATTACHMENTS[part].baseCosts[id] * 1.25));
    assert.equal(buyWeaponAttachment(profile, id, part).ok, true);
    assert.equal(profile.cash, balance - state.cost); assert.equal(profile.v, 4);
    assert.equal(weaponAttachmentState(profile, id, part).equipped, true);
    const bought = structuredClone(profile);
    assert.equal(buyWeaponAttachment(profile, id, part).reason, 'owned'); assert.deepEqual(profile, bought);
    assert.equal(equipWeaponAttachment(profile, id, part, false).ok, true);
    assert.equal(weaponAttachmentState(profile, id, part).equipped, false);
    assert.equal(equipWeaponAttachment(profile, id, part, true).ok, true);
    assert.equal(profile.cash, balance - state.cost);
  }
});

test('invalid, incompatible, unowned and insufficient-cash attachment actions never debit or change inventory', () => {
  const profile = funded(); profile.cash = 0; const before = structuredClone(profile);
  for (const [weapon, part] of [['pistol', 'stock'], ['rpg', 'extended_mag'], ['revolver', 'foregrip'], ['__proto__', 'laser'], ['pistol', '__proto__'], ['rifle', 'stock']]) {
    assert.equal(buyWeaponAttachment(profile, weapon, part).ok, false);
    assert.equal(equipWeaponAttachment(profile, weapon, part).ok, false);
  }
  assert.equal(buyWeaponAttachment(profile, 'pistol', 'laser').reason, 'cash');
  assert.equal(equipWeaponAttachment(profile, 'pistol', 'laser').reason, 'locked');
  assert.deepEqual(profile, before);
});

test('attachment choices are owned, ordered, immutable run snapshots and persist through normalized local/cloud profiles', () => {
  const profile = allOwned();
  for (const part of ['stock', 'laser', 'extended_mag', 'foregrip']) buyWeaponAttachment(profile, 'rifle', part);
  const rows = normalizeWeaponAttachments(profile);
  assert.deepEqual(rows.rifle, { owned: [...WEAPON_ATTACHMENT_ORDER], equipped: [...WEAPON_ATTACHMENT_ORDER] });
  assert.equal(Object.hasOwn(rows, 'rpg'), false);
  const selected = equippedWeaponAttachments(profile), run = effects(profile);
  assert.ok(Object.isFrozen(selected)); assert.ok(Object.isFrozen(selected.rifle));
  assert.deepEqual(run.weaponAttachments.rifle, [...WEAPON_ATTACHMENT_ORDER]);
  const cloud = sanitizeProfile(profile), loaded = normalizeProfile(JSON.parse(JSON.stringify(cloud)));
  assert.deepEqual(loaded.weaponAttachments.rifle, rows.rifle); assert.equal(loaded.v, 4);
  equipWeaponAttachment(profile, 'rifle', 'laser', false);
  assert.deepEqual(selected.rifle, [...WEAPON_ATTACHMENT_ORDER]); assert.deepEqual(run.weaponAttachments.rifle, [...WEAPON_ATTACHMENT_ORDER]);
});

test('an older paid magazine is included without duplicate charge, free buffs, new capability or cloud signature churn', () => {
  const profile = allOwned(); profile.weapons.rifle.mag = 1;
  const before = structuredClone(profile), beforeStats = weaponStats('rifle', profile.weapons.rifle);
  const beforeWire = JSON.stringify(sanitizeProfile(profile));
  const state = weaponAttachmentState(profile, 'rifle', 'extended_mag');
  assert.equal(state.owned, true); assert.equal(state.equipped, true);
  assert.equal(state.includedLegacy, true); assert.equal(state.removable, false); assert.equal(state.legacyLevel, 1);
  assert.equal(buyWeaponAttachment(profile, 'rifle', 'extended_mag').reason, 'owned');
  assert.equal(equipWeaponAttachment(profile, 'rifle', 'extended_mag', false).reason, 'legacy');
  assert.equal(equipWeaponAttachment(profile, 'rifle', 'extended_mag', true).ok, true);
  assert.deepEqual(profile, before); assert.equal(profile.v, 1);
  assert.equal(Object.hasOwn(profile, 'weaponAttachments'), false);
  assert.deepEqual(weaponStats('rifle', profile.weapons.rifle, effects(profile).weaponAttachments.rifle), beforeStats);
  assert.equal(JSON.stringify(sanitizeProfile(normalizeProfile(profile))), beforeWire);
});

test('extended magazine uses the stronger owned capacity rather than double applying old magazine tiers', () => {
  for (const id of Object.keys(WEAPONS)) {
    const base = WEAPONS[id], compatible = compatibleWeaponAttachment(id, 'extended_mag');
    for (let level = 0; level <= 3; level++) {
      const stats = weaponStats(id, { mag: level }, ['extended_mag']);
      assert.equal(stats.mag, Math.round(base.mag * Math.max(1 + .18 * level, compatible ? 1.45 : 1)));
    }
  }
  assert.equal(weaponStats('rifle', { mag: 3 }, ['extended_mag']).mag, weaponStats('rifle', { mag: 3 }).mag);
});

test('laser changes only hip spread and stocks/foregrips retain the stronger legacy handling axes', () => {
  const base = weaponStats('rifle'), laser = weaponStats('rifle', {}, ['laser']);
  assert.equal(laser.spread.hip, base.spread.hip * .8); assert.equal(laser.spread.ads, base.spread.ads);
  for (const key of ['dmg', 'mag', 'reload', 'rate', 'range', 'recoilMul', 'spreadMul']) assert.equal(laser[key], base[key]);
  const kit = weaponStats('rifle', {}, ['foregrip', 'stock']);
  assert.equal(kit.spreadMul, .90); assert.equal(kit.recoilMul, .92 * .82);
  const old = weaponStats('rifle', { hnd: 3 }), combined = weaponStats('rifle', { hnd: 3 }, ['foregrip', 'stock']);
  assert.equal(combined.spreadMul, old.spreadMul); assert.equal(combined.recoilMul, old.recoilMul);
  assert.deepEqual(weaponStats('rpg', {}, WEAPON_ATTACHMENT_ORDER), weaponStats('rpg'));
});

test('paid 3x scope persists and factory sights stay free without granting an unowned or incompatible optic', () => {
  const profile = allOwned();
  for (const id of ['rifle', 'sniper']) {
    const balance = profile.cash;
    assert.equal(buyWeaponOptic(profile, id, 'combat_3x').ok, true);
    assert.equal(profile.cash, balance - Math.round((id === 'rifle' ? 5000 : 6500) * 1.25));
    assert.equal(profile.v, 4); assert.equal(contentProfileVersion(profile), 4);
    assert.equal(equipWeaponOptic(profile, id, 'standard').ok, true);
    assert.equal(equipWeaponOptic(profile, id, 'combat_3x').ok, true);
  }
  const saved = normalizeProfile(sanitizeProfile(profile));
  assert.equal(saved.weaponOptics.rifle.equipped, 'combat_3x'); assert.equal(saved.weaponOptics.sniper.equipped, 'combat_3x');
  assert.equal(buyWeaponOptic(profile, 'pistol', 'combat_3x').reason, 'invalid');
});

test('capability three cannot load new paid attachments or scopes even with an old explicit version marker', () => {
  const attachments = allOwned(); buyWeaponAttachment(attachments, 'pistol', 'laser'); attachments.v = 1;
  assert.throws(() => assertSupportedProfile(attachments, 3), error => error.code === 'unsupported-profile' && error.requiredVersion === 4);
  const scope = allOwned(); buyWeaponOptic(scope, 'sniper', 'combat_3x'); scope.v = 1;
  assert.throws(() => assertSupportedProfile(scope, 3), error => error.code === 'unsupported-profile' && error.requiredVersion === 4);
});
