import test from 'node:test';
import assert from 'node:assert/strict';
import { Road } from '../src/world/road.js';
import { RoadQuery } from '../src/sim/road_query.js';
import { rng } from '../src/core/util.js';

test('accelerated simulation projection matches the full search across the entire route and distant/stale hints', () => {
  for (const seed of [1, 7, 11, 31]) {
    const road = new Road(seed), query = new RoadQuery(road), random = rng(seed * 29), ref = {}, actual = {};
    for (let i = 0; i < 3000; i++) {
      const s = random.range(0, 61000), d = random.range(-90, 90), point = road.pointAt(s, d);
      const window = [35, 60, 90, 400][i % 4], hint = s + random.range(-window * 2, window * 2);
      road.nearest(point.x, point.z, hint, window, ref);
      query.nearest(point.x, point.z, hint, window, actual);
      assert.deepEqual(actual, ref, `seed ${seed}, s ${s}, offset ${d}, hint ${hint}`);
    }
  }
});

test('projection remains exact as road generation grows and at shared segment endpoints', () => {
  const road = new Road(13), query = new RoadQuery(road), ref = {}, actual = {};
  for (let s = 0; s <= 4000; s += 3) {
    const point = road.pointAt(s, 0);
    road.nearest(point.x, point.z, s, 60, ref);
    query.nearest(point.x, point.z, s, 60, actual);
    assert.deepEqual(actual, ref);
  }
});

test('roads with reversed segments safely use the full projection search', () => {
  const road = new Road(11); road.extendTo(400);
  road.z[21] = road.z[19] - 1;
  const query = new RoadQuery(road);
  for (const [x, z, hint] of [[2, 58, 60], [-8, 72, 80], [0, 120, 100]]) {
    assert.deepEqual(query.nearest(x, z, hint, 90), road.nearest(x, z, hint, 90));
  }
  assert.equal(query.monotonic, false);
});
