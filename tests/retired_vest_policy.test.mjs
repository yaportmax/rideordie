import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE, TRUCKS, UPGRADE_BY_ID, effects, upgradeLimit } from '../src/data/upgrades.js';
import { normalizeProfile, buyUpgrade, upgradeCost } from '../src/meta/profile.js';
import { sanitizeProfile, canonicalJson } from '../server/saves/schema.js';
import { upgradeStats, suggestNext } from '../src/ui/garage_stats.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';

test('legacy vest tiers remain archived through normalization and wire sanitation without a wallet or receipt migration', () => {
  for (const tier of [1, 2, 3]) {
    const raw = { ...DEFAULT_PROFILE(), campaignId: 'legacy-vest-owner', cash: 12345, totalCash: 90000,
      upgrades: { vest: tier, grenades: 2, medkit: 1, scavenger: 2 }, lastRunId: 'last-personal', coopLastRunId: 'last-party' };
    const before = structuredClone(raw), normalized = normalizeProfile(raw), wire = sanitizeProfile(normalized);
    assert.deepEqual(raw, before); assert.equal(normalized.upgrades.vest, tier); assert.equal(wire.upgrades.vest, tier);
    assert.equal(wire.cash, raw.cash); assert.equal(wire.totalCash, raw.totalCash);
    assert.equal(wire.lastRunId, raw.lastRunId); assert.equal(wire.coopLastRunId, raw.coopLastRunId);
    assert.deepEqual(normalizeProfile(normalized), normalized);
    assert.equal(canonicalJson(sanitizeProfile(wire)), canonicalJson(wire));
    assert.equal(Object.hasOwn(wire, 'retiredVestTier'), false, 'this release does not change cloud save versions or content');
  }
});

test('retired vest has no purchasable level, charge, preview or player stat benefit on any existing chassis', () => {
  assert.equal(UPGRADE_BY_ID.vest.retired, true);
  for (const tr of TRUCKS) for (const tier of [0, 1, 2, 3, 999]) {
    const p = DEFAULT_PROFILE(); p.truck = tr.id; p.trucks = [tr.id]; p.cash = 100000; p.upgrades = { vest: tier, medkit: 2 };
    const before = structuredClone(p), without = { ...p, upgrades: { medkit: 2 } };
    assert.equal(upgradeLimit(p, 'vest'), 0); assert.equal(upgradeCost(p, 'vest'), null);
    assert.deepEqual(buyUpgrade(p, 'vest'), { ok: false, reason: 'retired' });
    assert.deepEqual(upgradeStats(p, 'vest'), []);
    assert.deepEqual(effects(p), effects(without)); assert.deepEqual(buildPlayerSpec(p), buildPlayerSpec(without));
    assert.equal(effects(p).gunnerHp, 100); assert.equal(effects(p).gunnerArmor, 0); assert.equal(effects(p).armorTier, 0);
    assert.notEqual(suggestNext(p, 'GUNNER SHOT')?.id, 'vest');
    assert.deepEqual(p, before, 'source consumers neither refund nor erase archived personal ownership');
  }
});
