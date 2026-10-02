import test from 'node:test';
import assert from 'node:assert/strict';
import { METERS_PER_MILE, distanceValue, speedValue, formatDistance, speedLabel } from '../src/ui/units.js';
import { normalizeSettings, loadSettings, saveSettings } from '../src/ui/settings_store.js';
import { SettingsScreen } from '../src/ui/screens/settings.js';
import { Hud } from '../src/ui/hud.js';
import { GarageScreen } from '../src/ui/screens/garage.js';
import { ResultsScreen } from '../src/ui/screens/results.js';
import { truckStats, upgradeStats } from '../src/ui/garage_stats.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { BOSS_S } from '../src/data/biomes.js';
import { Cockpit } from '../src/view/cockpit.js';

test('display conversion uses the exact mile boundary and preserves metric speed', () => {
  assert.equal(distanceValue(METERS_PER_MILE), 1);
  assert.equal(formatDistance(METERS_PER_MILE), '1.0 MI');
  assert.equal(formatDistance(1000, 'km'), '1.0 KM');
  assert.equal(formatDistance(METERS_PER_MILE * 1.05), '1.1 MI');
  assert.ok(Math.abs(speedValue(METERS_PER_MILE / 60) - 60) < 1e-12);
  assert.equal(speedValue(25, 'km'), 90);
  assert.equal(speedLabel(), 'MPH');
  assert.equal(speedLabel('km'), 'KM/H');
});

test('old and invalid settings default to miles while selected metric units persist independently of FOV', () => {
  for (const units of [undefined, null, 0, 'invalid', 'KM']) assert.equal(normalizeSettings({ units }).units, 'mi');
  assert.equal(normalizeSettings({ fov: 80 }).units, 'mi');
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), data = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => data.get(key), setItem: (key, value) => data.set(key, value),
  } });
  try {
    assert.equal(loadSettings().units, 'mi');
    saveSettings(normalizeSettings({ units: 'km', driverFov: 93, fov: 77 }));
    const restored = loadSettings();
    assert.equal(restored.units, 'km'); assert.equal(restored.driverFov, 93); assert.equal(restored.fov, 77);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  }
});

test('units selector supports keyboard and click changes without changing numeric quality selectors', () => {
  const screen = Object.create(SettingsScreen.prototype), selected = [];
  screen.tabId = 'video'; screen.cb = {};
  screen.ui = { settings: normalizeSettings({}), changeSetting(key, value) { this.settings[key] = value; }, snd() {} };
  const row = { querySelectorAll: () => [0, 1, 2, 3].map(i => ({ dataset: { v: String(i) }, classList: { toggle(name, on) { selected[i] = on; } } })) };
  const units = screen.rowDef('units');
  assert.match(screen.rowHtml(units), /data-v="0" class="on">MILES/);
  screen.step(units, row, 1);
  assert.equal(screen.S.units, 'km'); assert.equal(selected[1], true);
  assert.match(screen.rowHtml(units), /data-v="1" class="on">KILOMETERS/);
  screen.setSeg(units, row, 0); assert.equal(screen.S.units, 'mi');
  screen.setSeg(screen.rowDef('quality'), row, 3); assert.equal(screen.S.quality, 3);
});

test('HUD speed changes units immediately at the last sampled physical speed', () => {
  const hud = Object.create(Hud.prototype), node = () => ({ textContent: '', style: {} });
  hud.q = Object.fromEntries(['spd', 'spdUnit', 'rpm', 'nitro', 'nitroBox', 'nitroStatus', 'hp', 'area', 'boss', 'vig'].map(key => [key, node()]));
  Object.assign(hud, { el: { style: {} }, seenAreas: new Set(), areaT: 0, vigT: 0, msgT: 0, gunnerOn: false, arrowPool: [] });
  const data = { speed: METERS_PER_MILE / 60, rpm01: .5, nitro01: 0, hp01: 1 };
  hud.setUnits('mi'); hud.update(0, data);
  assert.equal(hud.q.spd.textContent, 60); assert.equal(hud.q.spdUnit.textContent, 'MPH');
  hud.setUnits('km');
  assert.equal(hud.q.spd.textContent, 97); assert.equal(hud.q.spdUnit.textContent, 'KM/H');
  assert.equal(data.speed, METERS_PER_MILE / 60, 'display changes never alter simulation speed');
});

test('cockpit dial labels, numbered ticks and needle agree when units change, with no repeated redraw', () => {
  const cockpit = Object.create(Cockpit.prototype), text = [];
  cockpit.faceCtx = new Proxy({}, { get: (_target, key) => key === 'fillText' ? value => text.push(value) : () => {}, set: () => true });
  cockpit.faceTex = { needsUpdate: false }; cockpit.needleS = { rotation: {} };
  cockpit.gaugeState = { speed: METERS_PER_MILE / 60, hp01: 1, dhp01: 1, ghp01: 1, nitro01: 0 };
  cockpit.setUnits('mi');
  assert.ok(text.includes('MPH') && text.includes('250') && text.includes('50'));
  const angle = ratio => -(Math.PI * .75 + Math.PI * 1.5 * ratio) - Math.PI / 2;
  assert.ok(Math.abs(cockpit.needleS.rotation.z - angle(60 / 250)) < 1e-12);
  const drawCount = text.length; cockpit.setUnits('mi'); assert.equal(text.length, drawCount);
  text.length = 0; cockpit.setUnits('km');
  assert.ok(text.includes('KM/H') && text.includes('400') && text.includes('80'));
  assert.equal(text.includes('MPH'), false);
  assert.ok(Math.abs(cockpit.needleS.rotation.z - angle(speedValue(cockpit.gaugeState.speed, 'km') / 400)) < 1e-12);
  assert.equal(cockpit.faceTex.needsUpdate, true);
});

test('garage best and speed previews switch together without changing records or comparison bars', () => {
  const profile = DEFAULT_PROFILE(); profile.best.distance = METERS_PER_MILE * 2;
  const before = structuredClone(profile), garage = Object.create(GarageScreen.prototype);
  Object.assign(garage, { p: profile, ui: { settings: { units: 'mi' } }, extra: {}, q: { sub: {} } });
  garage.renderHeader(); assert.match(garage.q.sub.textContent, /BEST 2\.0 MI/);
  garage.ui.settings.units = 'km'; garage.renderHeader(); assert.match(garage.q.sub.textContent, /BEST 3\.2 KM/);
  for (const rows of [units => truckStats(profile, 'truck_t2', units), units => upgradeStats(profile, 'engine', units)]) {
    const mi = rows('mi')[0], km = rows('km')[0];
    assert.equal(mi.unit, 'MPH'); assert.equal(km.unit, 'KM/H');
    assert.ok(Math.abs(mi.before / mi.max - km.before / km.max) < 1e-12);
    assert.ok(Math.abs(mi.after / mi.max - km.after / km.max) < 1e-12);
  }
  assert.deepEqual(profile, before);
});

test('results use viewer units for distance tiles, previous best, route and shared cash breakdown', () => {
  const results = Object.create(ResultsScreen.prototype), profile = DEFAULT_PROFILE();
  const run = { distance: METERS_PER_MILE, time: 30, furthestS: 59000, cash: 100,
    breakdown: [{ label: 'DISTANCE 1.6 KM', amount: 100 }], bestBefore: { distance: METERS_PER_MILE * 2 }, newBest: { distance: true } };
  const original = structuredClone(run);
  Object.assign(results, { ui: { settings: { units: 'mi' } }, run, profile, win: false,
    safe: { innerHTML: '', querySelector: () => ({}) }, nextHtml: () => '' });
  results.build();
  assert.equal(results.tiles[0].to, 1); assert.equal(results.tiles[0].unit, 'MI');
  assert.match(results.safe.innerHTML, /PREV 2\.0 MI/);
  assert.match(results.safe.innerHTML, /DISTANCE 1\.0 MI/);
  assert.ok(results.routeHtml().includes(formatDistance(BOSS_S - run.furthestS)));
  const pct = results.routePct;
  results.ui.settings.units = 'km'; results.build();
  assert.equal(results.tiles[0].unit, 'KM');
  assert.match(results.safe.innerHTML, /PREV 3\.2 KM/);
  assert.match(results.safe.innerHTML, /DISTANCE 1\.6 KM/);
  assert.equal(results.routePct, pct); assert.equal(results.total, 100);
  assert.deepEqual(run, original, 'shared summary distances and cash remain raw and unchanged');
});
