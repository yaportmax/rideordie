import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';
import { VEHICLES } from '../src/data/vehicles.js';

function frame(tick, time, x = time * 10, rechargeLocked = false) {
  const spec = VEHICLES.truck_t1;
  const car = { id: 1, spec, kind: 'player', hp: 400, maxHp: 400, engineHp: 100, crew: { driver: { alive: true }, gunner: { alive: true, aimYaw: 0.2, aimPitch: 0.1, weapon: 0 } }, veh: { pos: { x, y: 1, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 10, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 }, wheels: spec.wheels.map(() => ({ L: 0.4, slip: 0, grounded: true })), steerAngle: 0, rpm01: 0.5, brakeApplied: 0 } };
  car.veh.nitroRechargeLocked = rechargeLocked;
  return encodeSnapshot({ cars: new Map([[1, car]]), time, state: 'run', projectiles: { rockets: [], grenades: [] }, boss: null }, tick, { dist: time * 10, hp01: 1, dhp01: 1, ghp01: 1, nitro01: 0.5, medkits: 2 });
}

test('authoritative boost recharge lock reaches the remote driver without changing packet length', () => {
  const ready = frame(1, 0), locked = frame(2, .1, 1, true);
  assert.equal(ready.byteLength, locked.byteLength);
  assert.equal(decodeSnapshot(ready).cars[0].fl & 4096, 0);
  assert.equal(decodeSnapshot(locked).cars[0].fl & 4096, 4096);
  const b = new SnapshotBuffer();
  b.push(decodeSnapshot(ready), 10); b.push(decodeSnapshot(locked), 10.1);
  b.clockOffset = 10; b.delay = 0;
  b.sample(10.1); assert.equal(b.states.get(1).nitroRechargeLocked, true);
  b.push(decodeSnapshot(frame(3, .2, 2)), 10.2);
  b.delay = 0;
  b.sample(10.2); assert.equal(b.states.get(1).nitroRechargeLocked, false);
});

test('snapshot roundtrip retains truck pose, crew, suspension, HUD and typed-array offsets', () => {
  const ab = frame(120, 1.0), s = decodeSnapshot(ab);
  assert.equal(s.tick, 120); assert.equal(s.cars[0].spec, 'truck_t1'); assert.equal(s.cars[0].x, 10);
  assert.equal(s.medkits, 2); assert.equal(s.cars[0].L.length, 4); assert.ok(Math.abs(s.cars[0].gyaw - 0.2) < 1e-4);
  const padded = new Uint8Array(ab.byteLength + 10); padded.set(new Uint8Array(ab), 5);
  assert.equal(decodeSnapshot(padded.subarray(5, 5 + ab.byteLength)).tick, 120);
});

test('every truncated packet is ignored; unknown specs and non-finite positions cannot crash a frame', () => {
  const ab = frame(120, 1);
  for (let n = 0; n < ab.byteLength; n++) assert.equal(decodeSnapshot(ab.slice(0, n)), null, 'truncated at ' + n);
  const invalid = ab.slice(0); new DataView(invalid).setUint8(36, 255); assert.equal(decodeSnapshot(invalid), null);
  const nan = ab.slice(0); new DataView(nan).setFloat32(42, NaN, true); assert.equal(decodeSnapshot(nan), null);
  assert.equal(decodeSnapshot({}), null);
});

test('unordered and duplicate packets cannot rewind the interpolation buffer', () => {
  const b = new SnapshotBuffer();
  assert.equal(b.push(decodeSnapshot(frame(120, 1)), 10), true);
  assert.equal(b.push(decodeSnapshot(frame(124, 1.033)), 10.033), true);
  const offset = b.clockOffset;
  assert.equal(b.push(decodeSnapshot(frame(122, 1.016)), 10.04), false);
  assert.equal(b.push(decodeSnapshot(frame(124, 1.033)), 10.05), false);
  assert.equal(b.latest.tick, 124); assert.equal(b.snaps.length, 2); assert.equal(b.clockOffset, offset);
});

test('interpolation fills between snapshots and extrapolation stops after 100 ms', () => {
  const b = new SnapshotBuffer(); b.push(decodeSnapshot(frame(120, 1)), 10); b.push(decodeSnapshot(frame(132, 1.1)), 10.1);
  b.clockOffset = 9; b.delay = 0;
  b.sample(10.05); assert.ok(Math.abs(b.states.get(1).pos.x - 10.5) < 0.001);
  b.sample(20); assert.ok(Math.abs(b.states.get(1).pos.x - 12) < 0.001);
});

test('newest despawns remove ghosts and future state is not used before the first frame', () => {
  const b = new SnapshotBuffer(); const a = decodeSnapshot(frame(1, 0)), z = decodeSnapshot(frame(2, 0.1)); z.cars = [];
  b.push(a, 1); b.push(z, 1.1); b.clockOffset = 1; b.delay = 0;
  b.sample(0.8); assert.equal(b.states.size, 1);
  b.sample(1.2); assert.equal(b.states.size, 0);
});

test('simulation slow-motion moves the local clock offset in both directions', () => {
  const b = new SnapshotBuffer(); b.push(decodeSnapshot(frame(1, 1)), 10);
  for (let n = 1; n <= 20; n++) b.push(decodeSnapshot(frame(1 + n, 1 + n * 0.01)), 10 + n * 0.03);
  assert.ok(b.clockOffset > 9.15); assert.ok(Number.isFinite(b.sample(10.7).t));
});
