// AUTHORED UNRUN. Pure geometric cases; does not prove rendered track quality.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tankBeltPose } from '../src/view/tracked_tank_view.js';
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} vs ${expected}`);
const front = { y: .43, z: 2.05 }, rear = { y: .43, z: -2.05 }, radius = .36;
const length = 8.2 + 2 * Math.PI * radius;
const pose = distance => tankBeltPose(front, rear, radius, distance, {});

test('four authored belt poles and wrapped reverse travel follow real capsule geometry', () => {
  const top = pose(0); close(top.y, .79); close(top.z, -2.05); close(top.pitch, 0);
  const nose = pose(4.1 + Math.PI * radius / 2); close(nose.y, .43); close(nose.z, 2.41); close(nose.pitch, Math.PI / 2);
  const sole = pose(4.1 + Math.PI * radius); close(sole.y, .07); close(sole.z, 2.05);
  const tail = pose(8.2 + Math.PI * radius * 1.5); close(tail.y, .43); close(tail.z, -2.41);
  for (const x of [0, .2, 4.1, length - .01]) {
    const a = pose(x), b = pose(x - length * 3); close(a.y, b.y); close(a.z, b.z);
    close(a.length, length);
  }
});

test('tilted endpoint suspension is tangent and continuous at every seam', () => {
  const f = { y: .58, z: 2.05 }, r = { y: .23, z: -2.05 }, straight = Math.hypot(.35, 4.1), arc = Math.PI * radius;
  for (const seam of [straight, straight + arc, 2 * straight + arc, 2 * straight + 2 * arc]) {
    const a = tankBeltPose(f, r, radius, seam - 1e-8, {}), b = tankBeltPose(f, r, radius, seam + 1e-8, {});
    assert.ok(Math.hypot(a.y - b.y, a.z - b.z) < 3e-8);
    assert.ok(Math.abs(Math.sin(a.pitch) - Math.sin(b.pitch)) < 1e-6);
    assert.ok(Math.abs(Math.cos(a.pitch) - Math.cos(b.pitch)) < 1e-6);
  }
  assert.throws(() => tankBeltPose(front, front, radius, 0, {}));
  assert.throws(() => tankBeltPose(front, rear, NaN, 0, {}));
});
