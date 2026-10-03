import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, TRUCKS, effects } from '../src/data/upgrades.js';
import { normalizeProfile, buyTruck, buyUpgrade } from '../src/meta/profile.js';
import { suggestNext, truckStats, upgradeStats } from '../src/ui/garage_stats.js';
import { GarageScreen, garageInitialSelection } from '../src/ui/screens/garage.js';

test('the recommended same-family build opens the Upgrades chassis row and retains its exact price and stats', () => {
  const p = normalizeProfile(DEFAULT_PROFILE()); p.cash = 100000;
  const next = suggestNext(p);
  assert.equal(next.tab, 'upgrades'); assert.equal(next.id, 'player_sedan_t2');
  assert.equal(next.cost, TRUCKS.find(t => t.id === next.id).cost);
  const s = Object.assign(Object.create(GarageScreen.prototype), { p }, garageInitialSelection(p, { tab: next.tab, select: next.id }));
  assert.equal(s.selectedVehicle(), next.id);
  assert.equal(s.truckState(TRUCKS.find(t => t.id === next.id)).cost, next.cost);
  const rows = truckStats(p, next.id);
  assert(rows.every(row => Number.isFinite(row.before) && Number.isFinite(row.after)));
  const before = structuredClone(p); assert.equal(buyTruck(p, next.id).ok, true);
  assert.equal(p.cash, before.cash - next.cost); assert.equal(p.truck, next.id);
  assert.deepEqual(p.vehicleUpgrades, before.vehicleUpgrades);
});

test('gunner-loss recommendations use useful gear rather than body armor, including stale legacy saves', () => {
  for (const tier of [0, 1, 2, 3]) {
    const p = DEFAULT_PROFILE(); p.upgrades.vest = tier; p.cash = 100000;
    const before = structuredClone(p), next = suggestNext(p, 'GUNNER SHOT');
    assert.equal(next.id, 'medkit'); assert.equal(next.tab, 'gunner');
    assert(!/BODY ARMOR|VEST|PLATE CARRIER/i.test(JSON.stringify(next)));
    assert.deepEqual(p, before, 'a recommendation is read-only');
  }
});

test('gunner medkit purchase and displayed stats describe the actual next level', () => {
  const p = normalizeProfile(DEFAULT_PROFILE()); p.cash = 100000;
  const next = suggestNext(p, 'GUNNER');
  const rows = upgradeStats(p, next.id);
  assert.equal(rows.length, 1); assert.equal(rows[0].label, 'MEDKITS PER RUN');
  assert.equal(rows[0].before, effects(p).medkits); assert.equal(rows[0].after, 1);
  const before = p.cash; assert.equal(buyUpgrade(p, next.id).ok, true);
  assert.equal(p.cash, before - next.cost); assert.equal(effects(p).medkits, rows[0].after);
});
