import test from 'node:test';
import assert from 'node:assert/strict';
import { GarageScreen } from '../src/ui/screens/garage.js';
import { DEFAULT_PROFILE, TRUCKS } from '../src/data/upgrades.js';
import { buyWeapon } from '../src/meta/profile.js';
import { buyWeaponOptic } from '../src/meta/weapon_optics.js';

const screen = () => {
  const p = DEFAULT_PROFILE(); p.cash = 100000; p.trucks = ['player_sedan_t1', 'truck_t1', 'player_buggy_t1'];
  p.vehicleUpgrades = { sedan: { armor: 3, ram: 1 }, rustbucket: { armor: 5, ram: 3 }, buggy: { armor: 2, ram: 1 } };
  return Object.assign(Object.create(GarageScreen.prototype), { p });
};

test('garage upgrade prices/maxima use the selected family and keep crew tracks global', () => {
  const s = screen(); s.p.upgrades.vest = 1;
  for (const [truck, cap] of [['player_sedan_t1', 3], ['truck_t1', 5], ['player_buggy_t1', 2]]) {
    s.p.truck = truck;
    const armor = s.upState('armor'); assert.equal(armor.lv, cap); assert.equal(armor.max, cap); assert.equal(armor.state, 'max');
    assert.equal(s.upState('vest').lv, 1); assert.equal(s.upState('vest').max, 3);
  }
  s.p.truck = 'player_sedan_t1'; assert.equal(s.snapshot(s.p).up.ram, 1);
  s.p.truck = 'truck_t1'; assert.equal(s.snapshot(s.p).up.ram, 3);
});

test('garage staged chassis remain locked until their same-family predecessor is owned', () => {
  const s = screen(), state = id => s.truckState(TRUCKS.find(t => t.id === id));
  assert.equal(state('truck_t2').state, 'ok'); assert.equal(state('truck_t3').state, 'locked');
  assert.equal(state('player_buggy_t3').state, 'locked');
  s.p.trucks.push('truck_t2'); assert.equal(state('truck_t3').state, 'ok');
  s.p.trucks.push('truck_t4'); assert.equal(state('truck_t4').state, 'owned', 'legacy owned stages remain usable without forcing retroactive purchases');
});

test('selecting another owned family does not announce its saved upgrades as new purchases', () => {
  const s = screen(), sounds = [];
  s.snap = s.snapshot(s.p); s.fresh = {}; s.q = { rows: { scrollTop: 0 } };
  s.ui = { snd: sound => sounds.push(sound), nav: { cur: { isConnected: true } } };
  s.keepFocus = fn => fn();
  for (const method of ['renderHeader', 'renderTabs', 'renderList', 'renderDetail', 'renderLoadout', 'renderReady', 'renderHints', 'notifyView', 'flashNew']) s[method] = () => {};
  s.p.truck = 'truck_t1'; s.update(s.p);
  assert.deepEqual(sounds, []); assert.deepEqual(s.fresh, {});
  s.p.vehicleUpgrades.rustbucket.engine = 1; s.update(s.p);
  assert.deepEqual(sounds, ['upgrade_unlock']); assert.equal(s.fresh['up:engine'], 0);
});

test('garage sight preview cannot buy a locked gun optic and owned sight equip uses a distinct free transaction', () => {
  const s = screen(), sent = [], previewed = [];
  s.tab = 'weapons'; s.selId = { weapons: 'smg' }; s.opticPrev = 'wide_reflex';
  s.ui = { snd() {}, pressFx() {} }; s.cb = { onBuy(...args) { sent.push(args); }, onView(...args) { previewed.push(args); } };
  s.doOptic({ dataset: { opticBuy: 'wide_reflex' } }); assert.deepEqual(sent, []);
  assert.equal(buyWeapon(s.p, 'smg').ok, true); s.notifyView();
  assert.deepEqual(previewed.at(-1), ['weapons', 'smg', 'wide_reflex']);
  s.doOptic({ dataset: { opticBuy: 'wide_reflex' } });
  assert.deepEqual(sent.at(-1), ['weaponOptic', 'smg', 'wide_reflex']);
  assert.equal(buyWeaponOptic(s.p, 'smg', 'wide_reflex').ok, true);
  s.doOptic({ dataset: { opticBuy: 'standard' } });
  assert.deepEqual(sent.at(-1), ['equipWeaponOptic', 'smg', 'standard']);
});
