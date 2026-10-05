import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { WEAPONS, weaponStats } from '../src/data/weapons.js';
import { normalizeCampaignProgress } from '../src/data/campaign.js';
import { GarageScreen, garageInitialSelection, garageWeaponPreview } from '../src/ui/screens/garage.js';
import { weaponRows } from '../src/ui/garage_stats.js';
import { buyWeaponAttachment, equipWeaponAttachment, weaponAttachmentState } from '../src/meta/weapon_attachments.js';
import { equippedWeaponAttachments } from '../src/data/weapon_attachments.js';

// Actual generated markup and purchase/preview methods. Native layout,
// sight apertures and physical meshes require the separate browser checks.
function screen({ owned = false, level = 1, careerLevel, magazine = 0 } = {}) {
  const p = DEFAULT_PROFILE(); p.cash = 1000000;
  p.campaignProgress = normalizeCampaignProgress({ cleared: Array.from({ length: level - 1 }, (_, i) => i + 1), selectedLevel: level });
  if (owned) { p.weapons.rifle = { dmg: 0, mag: magazine, rel: 0, hnd: 0 }; p.loadout = ['rifle', 'pistol']; }
  const events = [];
  return Object.assign(Object.create(GarageScreen.prototype), {
    p, events, extra: { weaponCareerLevel: careerLevel }, ...garageInitialSelection(p, { tab: 'weapons', select: 'rifle' }),
    weaponPage: 'loadout', trackPrev: null, opticPrev: null, attachmentPrev: null, fresh: {},
    ui: { settings: {}, snd() {}, pressFx() {} },
    cb: { onBuy: (...args) => events.push(['buy', ...args]), onView: (...args) => events.push(['view', ...args]) },
    keepFocus: fn => fn(), burst() {}, denied: (_btn, need) => events.push(['denied', need]),
  });
}
function markup(s) {
  const old = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = () => 0;
  s.q = { det: { innerHTML: '' }, foot: { innerHTML: '' }, detail: { classList: { toggle() {} } } };
  try { s.renderDetail(); return { body: s.q.det.innerHTML, footer: s.q.foot.innerHTML }; }
  finally { if (old === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = old; }
}

test('a rich level1 career still sees an accurate locked rifle price and cannot dispatch its purchase', () => {
  const s = screen(), rendered = markup(s), row = s.weaponState('rifle');
  assert.equal(row.state, 'locked'); assert.equal(row.unlockLevel, 4); assert.equal(row.cost, WEAPONS.rifle.cost);
  assert.ok(rendered.body.includes('REACH LEVEL 4 TO UNLOCK')); assert.ok(rendered.footer.includes('UNLOCK AT LEVEL 4'));
  assert.ok(rendered.footer.includes('aria-disabled="true"')); assert.ok(!rendered.footer.includes('data-buy="1"'));
  const before = structuredClone(s.p); s.doBuy({}); assert.deepEqual(s.events, []); assert.deepEqual(s.p, before);
  s.p.campaignProgress = normalizeCampaignProgress({ cleared: [1, 2, 3] });
  assert.equal(s.weaponState('rifle').state, 'ok'); assert.ok(markup(s).footer.includes('data-buy="1"'));
  s.doBuy({}); assert.deepEqual(s.events.at(-1), ['buy', 'weapon', 'rifle']);
});

test('shared level9 presentation respects the buyer personal level1 career while owned legacy guns remain selectable', () => {
  const s = screen({ level: 9, careerLevel: 1 }); s.selId.weapons = 'rpg';
  assert.equal(s.weaponState('rpg').state, 'locked'); assert.ok(markup(s).footer.includes('UNLOCK AT LEVEL 7'));
  s.selId.weapons = 'rifle'; s.p.weapons.rifle = { dmg: 1, mag: 0, rel: 0, hnd: 1 };
  assert.equal(s.weaponState('rifle').state, 'owned'); assert.equal(s.weaponState('rifle').owned, true);
  s.extra.weaponCareerLevel = 2; assert.equal(s.weaponState('smg').state, 'ok'); assert.equal(s.weaponState('rpg').state, 'locked');
});

test('attachment page has only four compatible selected-gun parts and preview never purchases or equips', () => {
  const s = screen({ owned: true, level: 4 }), before = structuredClone(s.p);
  s.renderDetail = () => {}; s.switchWeaponPage('attachments'); s.selectAttachment('laser');
  assert.deepEqual(s.p, before); assert.equal(s.events.some(row => row[0] === 'buy'), false);
  const preview = s.events.at(-1); assert.equal(preview[0], 'view'); assert.equal(preview[1], 'weapons'); assert.equal(preview[2], 'rifle');
  assert.deepEqual(preview[4].attachments, ['laser']); assert.ok(Object.isFrozen(preview[4])); assert.ok(Object.isFrozen(preview[4].attachments));
  s.renderDetail = GarageScreen.prototype.renderDetail; const rendered = markup(s);
  assert.equal((rendered.body.match(/data-attachment="/g) || []).length, 4);
  assert.equal((rendered.body.match(/data-weapon-page="/g) || []).length, 4);
  assert.ok(!rendered.body.includes('data-slot="')); assert.ok(!rendered.body.includes('data-trk="')); assert.ok(!rendered.body.includes('data-optic="'));
  assert.ok(rendered.footer.includes('data-attachment-buy="laser"'));
  s.selId.weapons = 'rpg'; s.attachmentPrev = null;
  assert.equal(s.attachmentChoices('rpg').length, 0); assert.ok(markup(s).body.includes('no compatible rail or magazine attachments'));
});

test('actual attachment buy, remove and reinstall use distinct actions and never charge a second purchase', () => {
  const s = screen({ owned: true, level: 4 }); s.weaponPage = 'attachments';
  const cash = s.p.cash, cost = weaponAttachmentState(s.p, 'rifle', 'laser').cost;
  s.cb.onBuy = (kind, gun, command) => {
    s.events.push(['buy', kind, gun, command]);
    const result = kind === 'weaponAttachment' ? buyWeaponAttachment(s.p, gun, command.id) : equipWeaponAttachment(s.p, gun, command.id, command.enabled);
    assert.equal(result.ok, true);
  };
  s.doAttachment({ dataset: { attachmentBuy: 'laser' } });
  assert.deepEqual(s.events.at(-1), ['buy', 'weaponAttachment', 'rifle', { id: 'laser', enabled: true }]);
  assert.equal(s.p.cash, cash - cost); assert.deepEqual(equippedWeaponAttachments(s.p).rifle, ['laser']);
  assert.ok(markup(s).footer.includes('REMOVE PART'));
  s.doAttachment({ dataset: { attachmentBuy: 'laser' } });
  assert.deepEqual(s.events.at(-1), ['buy', 'equipWeaponAttachment', 'rifle', { id: 'laser', enabled: false }]);
  assert.equal(s.p.cash, cash - cost); assert.deepEqual(equippedWeaponAttachments(s.p).rifle, []);
  s.doAttachment({ dataset: { attachmentBuy: 'laser' } });
  assert.deepEqual(s.events.at(-1), ['buy', 'equipWeaponAttachment', 'rifle', { id: 'laser', enabled: true }]);
  assert.equal(s.p.cash, cash - cost); assert.deepEqual(equippedWeaponAttachments(s.p).rifle, ['laser']);
});

test('included legacy extended magazine is clear and nonremovable instead of charging for the same upgrade', () => {
  const s = screen({ owned: true, magazine: 2 }); s.weaponPage = 'attachments'; s.attachmentPrev = 'extended_mag';
  const before = structuredClone(s.p), rendered = markup(s);
  assert.ok(rendered.body.includes('LEGACY MAGAZINE LV 2')); assert.ok(rendered.footer.includes('LEGACY MAGAZINE INCLUDED'));
  assert.ok(!rendered.footer.includes('data-attachment-buy='));
  s.doAttachment({ dataset: { attachmentBuy: 'extended_mag' } }); assert.deepEqual(s.events, []); assert.deepEqual(s.p, before);
});

test('legacy track and paid part previews pass exactly the composed combat levels without mutating the profile', () => {
  const s = screen({ owned: true, level: 4 }), before = structuredClone(s.p);
  const preview = garageWeaponPreview(s.p, 'rifle', { track: 'mag', attachmentId: 'extended_mag' });
  assert.equal(preview.levels.mag, 1); assert.deepEqual(preview.attachments, ['extended_mag']); assert.deepEqual(s.p, before);
  assert.ok(Object.isFrozen(preview.levels));
  buyWeaponAttachment(s.p, 'rifle', 'laser');
  const expected = weaponStats('rifle', s.p.weapons.rifle, ['laser']);
  const actual = weaponRows(s.p, 'rifle');
  assert.equal(actual.find(row => row.label === 'MAGAZINE').before, expected.mag);
  assert.equal(actual.find(row => row.label === 'SPREAD').before, expected.spread.hip * expected.spreadMul);
  const withGrip = weaponRows(s.p, 'rifle', null, ['laser', 'foregrip']);
  const after = weaponStats('rifle', s.p.weapons.rifle, ['laser', 'foregrip']);
  assert.equal(withGrip.find(row => row.label === 'RECOIL').after, after.recoil.pitch * after.recoilMul);
  assert.equal(withGrip.find(row => row.label === 'SPREAD').after, after.spread.hip * after.spreadMul);
});
