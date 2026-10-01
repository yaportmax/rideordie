import assert from 'node:assert/strict';
import test from 'node:test';
import { Hud } from '../src/ui/hud.js';

function fixture() {
  const hud = Object.create(Hud.prototype);
  const node = () => ({ textContent: '', style: {} });
  hud.q = Object.fromEntries(['spd', 'rpm', 'nitro', 'nitroBox', 'hp', 'area', 'boss', 'vig'].map(k => [k, node()]));
  Object.assign(hud, { el: { style: {} }, seenAreas: new Set(), areaT: 0, vigT: 0, msgT: 0, gunnerOn: false, arrowPool: [] });
  const data = { speed: 0, rpm01: 0, nitro01: 0, hp01: 1, dhp01: 1, ghp01: 1, biome: 'Scorched Highway' };
  return { hud, data };
}

test('loading and missing remote state cannot consume the starting place notice', () => {
  const { hud, data } = fixture();
  hud.update(10, data, false);
  assert.equal(hud.seenAreas.size, 0);
  assert.equal(hud.q.area.textContent, '');
  data.biome = 'Sunken City'; hud.update(0.1, data, true);
  assert.equal(hud.q.area.textContent, 'Sunken City');
  assert.equal(hud.q.area.style.opacity, 1);
  assert.equal(hud.seenAreas.has('Scorched Highway'), false);
});

test('pause preserves the place notice and revisiting does not repeat it', () => {
  const { hud, data } = fixture();
  hud.update(0.25, data, true);
  hud.update(10, data, false);
  assert.equal(hud.areaT, 3.75);
  hud.update(4, data, true);
  assert.equal(hud.q.area.style.opacity, 0);
  data.biome = 'Sunken City'; hud.update(0.1, data, true);
  assert.equal(hud.q.area.textContent, 'Sunken City');
  hud.update(4, data, true);
  data.biome = 'Scorched Highway'; hud.update(0.1, data, true);
  assert.equal(hud.q.area.style.opacity, 0);
  assert.equal(hud.seenAreas.size, 2);
});
