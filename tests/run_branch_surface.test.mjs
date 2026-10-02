import test from 'node:test';
import assert from 'node:assert/strict';
import { Run } from '../src/game/run.js';
import { Road } from '../src/world/road.js';
import { RoadQuery } from '../src/sim/road_query.js';

function fixture(seed, authority) {
  const road = new Road(seed), query = new RoadQuery(road);
  const run = Object.assign(Object.create(Run.prototype), {
    seed, playerS: 0, ...(authority ? { sim: { roadQuery: query } } : { _road: road, _roadQuery: query }),
  });
  return { road, query, run };
}

test('actual Run identifies all six separated branch pavements for shot, wheel and tyre-audio consumers on both seats', () => {
  const covered = new Set();
  for (const seed of [1, 11]) for (const authority of [true, false]) {
    const { road, query, run } = fixture(seed, authority);
    for (const branch of road.ensureDrivingBranches()) {
      const s = (branch.s0 + branch.s1) / 2;
      const point = road.drivingPointAt(s, 0, branch.id);
      run.playerS = s;
      const main = query.nearest(point.x, point.z, s, 80, {});
      assert.ok(Math.abs(main.d) > 9.7, 'negative control: main-only query would classify separated pavement as off-road');
      assert.equal(run._surfaceKind(point.x, point.z), 'asphalt');
      const wheel = run._surfaceAt(point.x, point.z, s, 80, {}, true);
      assert.equal(wheel.route, branch.id); assert.equal(wheel.kind, 'asphalt');
      assert.ok(Math.abs(wheel.s - s) < .1); assert.equal(wheel.halfWidth, branch.width / 2);
      covered.add(branch.biome);
    }
  }
  assert.deepEqual([...covered].sort(), ['canyon', 'city', 'coast', 'dam', 'desert', 'mountain']);
});

test('branch wheel shoulders use the actual narrower pavement and retain biome-specific shot surfaces', () => {
  const { road, run } = fixture(1, true);
  const branch = road.ensureDrivingBranches().find(b => b.biome === 'desert');
  assert.ok(branch);
  const s = (branch.s0 + branch.s1) / 2;
  run.playerS = s;
  for (const side of [-1, 1]) {
    const p = road.drivingPointAt(s, side * (branch.width / 2 + 1), branch.id);
    assert.equal(run._surfaceAt(p.x, p.z, s, 80, {}, true).kind, 'gravel');
    assert.equal(run._surfaceKind(p.x, p.z), 'sand');
    const off = road.drivingPointAt(s, side * (branch.width / 2 + 4), branch.id);
    assert.equal(run._surfaceAt(off.x, off.z, s, 80, {}, true).kind, 'sand');
  }
});

test('main-road asphalt, gravel and off-road boundaries remain exact with scratch reuse and bounded displaced hints', () => {
  const { road, run } = fixture(7, false), out = {};
  for (const [d, wheel, shot] of [[0, 'asphalt', 'asphalt'], [7.1, 'asphalt', 'asphalt'], [7.3, 'gravel', 'sand'], [9.6, 'gravel', 'sand'], [9.8, 'sand', 'sand']]) {
    const p = road.pointAt(200, d);
    run.playerS = 0;
    assert.equal(run._surfaceAt(p.x, p.z, 0, 80, out, true), out);
    assert.equal(out.route, null); assert.equal(out.kind, wheel, `wheel d=${d}`);
    assert.equal(run._surfaceKind(p.x, p.z), shot, `shot d=${d}`);
  }
  const far = road.pointAt(45000, 30); run.playerS = 44940;
  assert.equal(run._surfaceKind(far.x, far.z), 'concrete', 'displaced hint inside the authored search window still finds city biome');
});
