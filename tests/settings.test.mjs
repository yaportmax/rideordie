import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, conflictSet } from '../src/ui/settings_store.js';

test('damaged settings cannot create an invalid camera or render scale', () => {
  const s = normalizeSettings({ quality: 9, fov: 'bad', resScale: -5, shake: Infinity, music: NaN, invertY: 'false', soloSeat: 'gunner' });
  assert.equal(s.quality, 3); assert.equal(s.fov, 80); assert.equal(s.resScale, 0.5); assert.equal(s.shake, 1);
  assert.equal(s.music, 0.7); assert.equal(s.invertY, false); assert.equal(s.soloSeat, 'gunner');
});

test('global medkit and pause bindings conflict with either seat while seat-only bindings remain separate', () => {
  assert.ok(conflictSet('reload').includes('medkit'));
  assert.ok(conflictSet('throttle').includes('medkit'));
  assert.ok(conflictSet('medkit').includes('reload'));
  assert.ok(conflictSet('medkit').includes('throttle'));
  assert.ok(conflictSet('medkit').includes('pause'));
  assert.ok(conflictSet('view').includes('pause'));
  assert.equal(conflictSet('throttle').includes('reload'), false);
  assert.equal(conflictSet('reload').includes('throttle'), false);
});
