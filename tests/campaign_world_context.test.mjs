import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { Road } from '../src/world/road.js';
import { biomeAt, BIOME_PLAN, BIOME_START } from '../src/data/biomes.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { roadBiomeAt, contextualRoad, biomeRange, biomeWeight, biomeDistance } from '../src/world/biome_context.js';
import { LOOKS, lookAt } from '../src/world/look.js';
import { Backdrop } from '../src/world/dressing/backdrop.js';
import { Dressing } from '../src/world/dressing.js';
import { buildWrecks } from '../src/world/dressing/furniture.js';
import { buildDamRoad } from '../src/world/dressing/damroad.js';
import { LandmarkPlanner } from '../src/world/dressing/landmarks.js';
import { cityDens, cityCore, cityItems, buildCity } from '../src/world/dressing/city.js';
import { DAM, damDefinition, buildDam } from '../src/world/dressing/dam.js';
import { SetPieces } from '../src/world/dressing/setpieces.js';
import { Water } from '../src/world/water.js';

const customIds = ['underground', 'sky', 'hell', 'space'];
const held = id => new Road(7, { mode: 'campaign', level: TEN_LEVELS.find(level => level.id === id).number });
const snapshot = value => Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, entry?.isColor ? entry.toArray() : key === 'grade' ? { ...entry, shT: [...entry.shT], hiT: [...entry.hiT] } : entry]));

test('world queries use the owning road and only missing legacy stub methods fall back', () => {
  for (const s of [0, 9999, 40350, 60000, 200000]) assert.deepEqual(roadBiomeAt({}, s), biomeAt(s));
  const sky = held('sky'), city = held('city');
  for (const s of [0, 8000, 60000, 200000]) {
    assert.equal(roadBiomeAt(sky, s).a, 'sky');
    assert.equal(roadBiomeAt(city, s).a, 'city');
    assert.equal(roadBiomeAt(sky, s).b, 'sky');
  }
  assert.throws(() => roadBiomeAt({ biomeAt() { throw new Error('invalid road'); } }, 500), /invalid road/);
});

test('all held campaign looks remain complete and stable beyond legacy boundaries', () => {
  for (const level of TEN_LEVELS) {
    const road = held(level.id), first = snapshot(lookAt(0, undefined, road));
    for (const s of [3500, 50000, 80000, 200000]) assert.deepEqual(snapshot(lookAt(s, undefined, road)), first, level.id + '@' + s);
    for (const [key, value] of Object.entries(first)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), level.id + '.' + key);
      if (Array.isArray(value)) assert.ok(value.every(Number.isFinite), level.id + '.' + key);
    }
    assert.equal(first.sun, LOOKS[level.id].sun);
  }
});

test('contextual look blends the explicit road weights without affecting a second road', () => {
  const mix = { biomeAt: () => ({ a: 'sky', b: 'space', w: .25 }) };
  const sky = held('sky'), first = snapshot(lookAt(45000, undefined, sky));
  const blend = snapshot(lookAt(45000, undefined, mix));
  assert.ok(Math.abs(blend.sunI - (LOOKS.sky.sunI * .75 + LOOKS.space.sunI * .25)) < 1e-12);
  assert.deepEqual(snapshot(lookAt(45000, undefined, sky)), first);
  assert.equal(biomeWeight(mix, 0, 'sky'), .75);
  assert.equal(biomeWeight(mix, 0, 'desert'), 0);
});

test('legacy road and a methodless legacy stub retain the original midpoint lighting anchors', () => {
  const road = new Road(7);
  assert.equal(contextualRoad(road), false);
  for (const s of [0, 4999, 5000, 8000, 15000, 35000, 50000, 80000]) {
    const legacy = snapshot(lookAt(s));
    assert.deepEqual(snapshot(lookAt(s, undefined, road)), legacy);
    assert.deepEqual(snapshot(lookAt(s, undefined, {})), legacy);
  }
  for (let i = 0; i < BIOME_PLAN.length; i++) {
    const s = BIOME_START[i] + (i === BIOME_PLAN.length - 1 ? 1500 : BIOME_PLAN[i].len / 2);
    assert.ok(Math.abs(lookAt(s).sunI - LOOKS[BIOME_PLAN[i].id].sunI) < 1e-12);
  }
});

test('all new worlds have explicit finite backdrop profiles and isolated look uniforms', () => {
  const scene = new Scene(), backdrop = new Backdrop(scene);
  try {
    for (const id of customIds) {
      const road = held(id);
      road.sample = (s, out) => Object.assign(out || {}, { x: s, z: 0, y: 10, nx: 0, nz: 1 });
      backdrop.update(.016, { x: 0, y: 10, z: 0 }, 60000, road);
      for (const { u } of backdrop.layers) {
        assert.ok(u.uAmp.value.toArray().every(Number.isFinite));
        assert.ok(u.uColA.value.toArray().every(Number.isFinite));
        assert.equal(u.uNight.value, LOOKS[id].night);
        assert.equal(u.uAmp.value.x > 0, id === 'hell');
      }
    }
  } finally { backdrop.dispose(); }
  assert.equal(scene.children.length, 0);
});

test('new-theme asset prefetch uses the owning road and does not add legacy natural scatter', async () => {
  const requested = [], dressing = Object.assign(Object.create(Dressing.prototype), {
    road: held('space'), _fetched: new Set(), kit: { requestMany: async names => requested.push(...names) },
  });
  await dressing.prefetch(60000);
  assert.deepEqual([...dressing._fetched], ['space']);
  assert.ok(requested.every(name => typeof name === 'string' && name.length > 0));
  assert.ok(!requested.includes('cactus_saguaro'));
  for (const id of customIds) assert.doesNotThrow(() => dressing.assetsFor(id));
});

test('new procedural worlds skip the old roadside wreck and fixed-distance landmark plans', () => {
  for (const id of customIds) {
    const road = held(id), ctx = { road, seed: 7, kit: { state() { throw new Error('legacy asset requested'); } } };
    assert.equal(buildWrecks(ctx, { s0: 60000 }), true);
    assert.deepEqual(new LandmarkPlanner(ctx).plan(59800, 60200), []);
  }
});

test('hand-authored chapter anchors rebase locally while legacy distances stay exact', () => {
  assert.equal(biomeDistance(new Road(7), 'coast', 22600), 22600);
  assert.equal(biomeDistance(held('coast'), 'coast', 22600), 2600 * 4100 / 10000);
  assert.equal(biomeDistance(held('desert'), 'coast', 22600), null);
  const marathon = new Road(7, { mode: 'marathon' });
  assert.deepEqual(biomeRange(marathon, 'city'), { start: 32000, end: 40000 });
  assert.equal(biomeDistance(marathon, 'coast', 22600), 16000 + 2600 * .8);
});

test('held city has local continuous density and other held worlds do not acquire city frontage', () => {
  const city = held('city'), desert = held('desert'), marathon = new Road(7, { mode: 'marathon' });
  assert.equal(cityDens(0, city), 0);
  assert.equal(cityDens(1000, city), 1);
  assert.equal(cityDens(60000, city), 1);
  assert.ok(cityCore(60000, city) > 0);
  for (const s of [0, 44000, 60000]) assert.equal(cityDens(s, desert), 0);
  assert.equal(cityDens(35000, marathon), 1);
  assert.equal(cityDens(45000, marathon), 0);
  assert.deepEqual(cityItems({ road: desert }, 44000, 44200), { b: [], streets: [] });
  assert.equal(buildCity({ road: desert }, { s0: 44000 }), true);
});

test('contextual dam descriptor and set-piece ownership never leak to held non-dam roads', () => {
  const legacy = new Road(7), dam = held('dam'), desert = held('desert'), marathon = new Road(7, { mode: 'marathon' });
  assert.strictEqual(damDefinition(legacy), DAM);
  assert.equal(damDefinition(desert), null);
  assert.deepEqual([damDefinition(dam).sA, damDefinition(dam).sB], [3650, 5500]);
  assert.deepEqual([damDefinition(marathon).sA, damDefinition(marathon).sB], [43650, 45500]);
  assert.equal(buildDam({ road: desert, seed: 7 }, () => { throw new Error('dam leak'); }, () => null).next().done, true);
  assert.equal(buildDamRoad({ road: desert }, { s0: 60000 }), true);
  const scene = new Scene(), pieces = new SetPieces({ scene, road: desert });
  try { pieces.update(60000); assert.equal(pieces.live.size, 0); assert.deepEqual(pieces.pieces, []); }
  finally { pieces.dispose(); }
  assert.equal(scene.children.length, 0);
});

test('water is hidden on a held dry theme even beyond the legacy coast and dam distances', () => {
  const scene = new Scene(), water = new Water(scene, held('hell'));
  try {
    for (const s of [22000, 50000, 100000]) { water.update(.016, { x: 0, y: 2, z: 0 }, s); assert.equal(water.mesh.visible, false); assert.equal(water.uniforms.uFade.value, 0); }
  } finally { water.dispose(); }
  assert.equal(scene.children.length, 0);
});
