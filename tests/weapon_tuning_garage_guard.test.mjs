import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { GarageScreen, garageInitialSelection, garageWeaponPreview } from '../src/ui/screens/garage.js';
import { buyWeaponAttachment, equipWeaponAttachment } from '../src/meta/weapon_attachments.js';
import { buyWeaponTrack } from '../src/meta/profile.js';
import { weaponTrackPurchaseState } from '../src/meta/weapon_tuning.js';

const HELP = 'Installed attachment already provides this benefit; remove it to tune.';
function screen() {
  const p = DEFAULT_PROFILE(); p.cash = 1000000;
  p.weapons.rifle = { dmg: 0, mag: 0, rel: 0, hnd: 0 }; p.loadout = ['rifle', 'pistol'];
  const events = [];
  return Object.assign(Object.create(GarageScreen.prototype), {
    p, events, extra: {}, ...garageInitialSelection(p, { tab: 'weapons', select: 'rifle' }),
    weaponPage: 'tuning', trackPrev: 'mag', opticPrev: null, attachmentPrev: null, fresh: {},
    ui: { settings: {}, snd() {}, pressFx() {}, toast: (...args) => events.push(['toast', ...args]) },
    cb: { onBuy: (...args) => events.push(['buy', ...args]) }, burst() {},
    denied: (_btn, need) => events.push(['denied', need]),
  });
}
function markup(s) {
  const old = globalThis.requestAnimationFrame; globalThis.requestAnimationFrame = () => 0;
  s.q = { det: { innerHTML: '' }, foot: { innerHTML: '' }, detail: { classList: { toggle() {} } } };
  try { s.renderDetail(); return s.q.det.innerHTML; }
  finally { if (old === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = old; }
}
function button(track) { return { dataset: { trk: track }, classList: { remove() {}, add() {} } }; }

test('installed magazine makes a rich-player covered tier visibly disabled and prevents every purchase dispatch', () => {
  const s = screen(); assert.equal(buyWeaponAttachment(s.p, 'rifle', 'extended_mag').ok, true);
  const before = structuredClone(s.p), html = markup(s), purchase = weaponTrackPurchaseState(s.p, 'rifle', 'mag');
  assert.equal(purchase.reason, 'covered'); assert.equal(s.trackState('rifle', 'mag').state, 'covered');
  const opening = html.match(/<div class="([^"]*)" role="button"[^>]*data-trk="mag"[^>]*>/)?.[0];
  assert.ok(opening); assert.ok(opening.includes('aria-disabled="true"')); assert.ok(opening.includes('st-covered')); assert.ok(opening.includes('st-locked'));
  assert.ok(!opening.match(/class="[^"]*\bf\b/)); assert.ok(html.includes('>COVERED</em>')); assert.ok(html.includes(HELP));
  assert.ok(html.includes('INSTALLED BENEFIT'));
  for (let i = 0; i < 3; i++) s.doTrack(button('mag'));
  assert.equal(s.events.filter(row => row[0] === 'buy').length, 0);
  assert.equal(s.events.filter(row => row[0] === 'toast' && row[1] === HELP).length, 3);
  assert.deepEqual(s.p, before);
});

test('covered previews retain installed stats and exact legacy level instead of implying an ineffective paid upgrade', () => {
  const s = screen(); assert.equal(buyWeaponAttachment(s.p, 'rifle', 'extended_mag').ok, true);
  const before = structuredClone(s.p), preview = garageWeaponPreview(s.p, 'rifle', { track: 'mag' });
  assert.equal(preview.levels.mag, 0); assert.deepEqual(preview.attachments, ['extended_mag']);
  assert.ok(Object.isFrozen(preview.levels)); assert.ok(Object.isFrozen(preview.attachments));
  const rows = s.weaponStatRows('rifle'); assert.equal(rows.length, 1); assert.equal(rows[0].label, 'MAGAZINE');
  assert.equal(rows[0].after, null); assert.deepEqual(s.p, before);
});

test('removing the paid magazine enables the actual next sequential tier and charges it exactly once', () => {
  const s = screen(); assert.equal(buyWeaponAttachment(s.p, 'rifle', 'extended_mag').ok, true);
  assert.equal(equipWeaponAttachment(s.p, 'rifle', 'extended_mag', false).ok, true);
  const state = weaponTrackPurchaseState(s.p, 'rifle', 'mag'), cash = s.p.cash;
  assert.equal(state.ok, true); assert.equal(s.trackState('rifle', 'mag').state, 'ok');
  assert.ok(!markup(s).includes('>COVERED</em>'));
  assert.equal(garageWeaponPreview(s.p, 'rifle', { track: 'mag' }).levels.mag, 1);
  s.cb.onBuy = (kind, gun, track) => {
    s.events.push(['buy', kind, gun, track]); assert.equal(buyWeaponTrack(s.p, gun, track).ok, true);
  };
  s.doTrack(button('mag'));
  assert.deepEqual(s.events.at(-1), ['buy', 'weaponTrack', 'rifle', 'mag']);
  assert.equal(s.p.weapons.rifle.mag, 1); assert.equal(s.p.cash, cash - state.cost);
});

test('combined handling parts suppress only their covered next tier while ordinary productive tuning remains buyable', () => {
  const s = screen(); assert.equal(buyWeaponAttachment(s.p, 'rifle', 'foregrip').ok, true);
  assert.equal(s.trackState('rifle', 'hnd').state, 'ok');
  assert.equal(buyWeaponAttachment(s.p, 'rifle', 'stock').ok, true);
  assert.equal(weaponTrackPurchaseState(s.p, 'rifle', 'hnd').reason, 'covered');
  assert.equal(s.trackState('rifle', 'hnd').state, 'covered'); s.trackPrev = 'hnd';
  assert.ok(s.weaponStatRows('rifle').every(row => row.after === null));
  const before = structuredClone(s.p); s.doTrack(button('hnd')); assert.deepEqual(s.p, before);
  assert.equal(s.events.some(row => row[0] === 'buy'), false);
  assert.equal(s.trackState('rifle', 'dmg').state, 'ok'); assert.equal(s.trackState('rifle', 'rel').state, 'ok');
});

test('the shared tuning helper preserves locked, cash and max guards without a paid attachment', () => {
  const s = screen(); assert.equal(s.trackState('rpg', 'mag').state, 'locked');
  s.p.cash = 0; assert.equal(s.trackState('rifle', 'mag').state, 'no'); s.doTrack(button('mag'));
  assert.equal(s.events.at(-1)[0], 'denied'); assert.equal(s.events.some(row => row[0] === 'buy'), false);
  s.p.cash = 1000000; s.p.weapons.rifle.mag = 3;
  assert.equal(s.trackState('rifle', 'mag').state, 'max'); s.doTrack(button('mag'));
  assert.equal(s.events.some(row => row[0] === 'buy'), false);
});
