import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveResolutionController } from '../src/view/post/adaptive_resolution.js';

const feed = (controller, ms, count, current = 1, ceiling = 1) => {
  const changes = [];
  for (let i = 0; i < count; i++) {
    const next = controller.update(ms, current, ceiling);
    if (next !== null) { changes.push(next); current = next; }
  }
  return { changes, current };
};

test('one missed refresh after healthy frames never lowers resolution', () => {
  const controller = new AdaptiveResolutionController();
  assert.deepEqual(feed(controller, 1000 / 60, 300).changes, []);
  assert.equal(controller.update(33.3, 1, 1), null);
  assert.deepEqual(feed(controller, 1000 / 60, 300).changes, []);
});

test('sustained load lowers one step only after two seconds of pressure', () => {
  const controller = new AdaptiveResolutionController();
  assert.deepEqual(feed(controller, 20, 99).changes, []);
  const overloaded = feed(controller, 20, 70);
  assert.deepEqual(overloaded.changes, [0.9]);
  assert.equal(controller.update(20, 0.9, 1), null);
});

test('repeated 30 fps samples lower resolution, while sparse misses do not', () => {
  assert.deepEqual(feed(new AdaptiveResolutionController(), 1000 / 30, 90).changes, [0.9]);
  const controller = new AdaptiveResolutionController();
  for (let i = 0; i < 1000; i++) assert.equal(controller.update(i % 31 === 0 ? 33.3 : 1000 / 60, 1, 1), null);
});

test('borderline sustained 17.9 ms qualifies, but 17.7 ms does not', () => {
  assert.deepEqual(feed(new AdaptiveResolutionController(), 17.7, 1000).changes, []);
  const result = feed(new AdaptiveResolutionController(), 17.9, 150);
  assert.deepEqual(result.changes, [0.9]);
});

test('isolated large misses cannot pass the meaningful miss ratio gate', () => {
  const controller = new AdaptiveResolutionController();
  for (let i = 0; i < 1000; i++) assert.equal(controller.update(i % 31 === 0 ? 100 : 1000 / 60, 1, 1), null);
});

test('about seven percent missed refreshes at city load lowers resolution', () => {
  const controller = new AdaptiveResolutionController();
  let current = 1, firstChange = null;
  for (let i = 0; i < 180; i++) {
    const next = controller.update(i % 14 === 13 ? 33.4 : 16.7, current, 1);
    if (next !== null) { firstChange ??= next; current = next; }
  }
  assert.equal(firstChange, 0.9);
});

test('recovery requires twenty continuous healthy seconds and respects ceiling', () => {
  const controller = new AdaptiveResolutionController();
  assert.deepEqual(feed(controller, 1000 / 60, 1199, 0.95).changes, []);
  assert.deepEqual(feed(controller, 1000 / 60, 2, 0.95).changes, [1]);
  assert.deepEqual(feed(controller, 1000 / 60, 1500, 1).changes, []);
});

test('an overload interrupts recovery and prevents stale twenty-second promotion', () => {
  const controller = new AdaptiveResolutionController();
  assert.deepEqual(feed(controller, 1000 / 60, 1150, 0.8).changes, []);
  assert.equal(controller.update(50, 0.8, 1), null);
  assert.deepEqual(feed(controller, 1000 / 60, 600, 0.8).changes, []);
});

test('invalid frames and inactivity reset pressure without consuming their duration', () => {
  for (const invalid of [NaN, Infinity, -1, 0, 0.5, 101, 1000]) {
    const controller = new AdaptiveResolutionController();
    assert.deepEqual(feed(controller, 20, 99).changes, []);
    assert.equal(controller.update(invalid, 1, 1), null);
    assert.deepEqual(feed(controller, 20, 99).changes, [], String(invalid));
    assert.equal(controller.averageMs > 17.8, true);
  }
});

test('lower ceilings define the floor and are never exceeded', () => {
  const controller = new AdaptiveResolutionController(0.5);
  assert.deepEqual(feed(controller, 30, 300, 0.5, 0.5).changes, []);
  assert.deepEqual(feed(controller, 1000 / 60, 1500, 0.5, 0.5).changes, []);
  assert.equal(controller.update(20, 0.9, 0.6), 0.6);
  assert.deepEqual(feed(controller, 30, 300, 0.6, 0.6).changes, []);
  assert.equal(controller.update(20, 0.9, 0.62366), 0.62366);
});

test('downshift stops at the floor without increasing an already lower scale', () => {
  assert.deepEqual(feed(new AdaptiveResolutionController(), 20, 170, 0.7).changes, [0.65]);
  assert.deepEqual(feed(new AdaptiveResolutionController(), 30, 300, 0.65).changes, []);
  assert.deepEqual(feed(new AdaptiveResolutionController(), 30, 300, 0.55).changes, []);
});

test('a manual scale change and reset clear stale overload samples', () => {
  const controller = new AdaptiveResolutionController();
  assert.deepEqual(feed(controller, 20, 99).changes, []);
  assert.deepEqual(feed(controller, 20, 99, 0.85).changes, []);
  controller.reset(0.8);
  assert.equal(controller.averageMs, 16.7);
  assert.equal(controller.update(20, 0.8, 0.8), null);
});
