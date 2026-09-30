import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../src/ui/settings_store.js';

test('damaged settings cannot create an invalid camera or render scale', () => {
  const s = normalizeSettings({ quality: 9, fov: 'bad', resScale: -5, shake: Infinity, music: NaN, invertY: 'false', soloSeat: 'gunner' });
  assert.equal(s.quality, 3); assert.equal(s.fov, 75); assert.equal(s.resScale, 0.5); assert.equal(s.shake, 1);
  assert.equal(s.music, 0.7); assert.equal(s.invertY, false); assert.equal(s.soloSeat, 'gunner');
});
