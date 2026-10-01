import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';
import { VEHICLES } from '../src/data/vehicles.js';

function packet(tick, time, { x = time * 40, y = 1, z = 0, vx = 40, vy = 0, vz = 0, poseRevision = 0, quat = { x: 0, y: 0, z: 0, w: 1 }, count = 1 } = {}) {
  const spec = VEHICLES.truck_t1;
  const cars = Array.from({ length: count }, (_, i) => ({ id: i + 1, spec, kind: i ? 'enemy' : 'player', hp: 400, maxHp: 400, engineHp: 100,
    crew: { driver: { alive: true }, gunner: { alive: true, aimYaw: 0, aimPitch: 0, weapon: 0 } },
    veh: { pos: { x, y, z: z + i * 8 }, quat, vel: { x: vx, y: vy, z: vz }, angvel: { x: 0, y: 0, z: 0 }, poseRevision,
      wheels: spec.wheels.map(() => ({ L: .4, slip: 0, grounded: true })), steerAngle: 0, rpm01: .5, brakeApplied: 0 } }));
  const bytes = encodeSnapshot({ cars: new Map(cars.map(c => [c.id, c])), time, state: 'run', projectiles: { rockets: [], grenades: [] }, boss: null }, tick, { hp01: 1, dist: x });
  const decoded = decodeSnapshot(bytes); assert(decoded, 'Real snapshot encode/decode fixture');
  return { bytes, decoded };
}
function replay({ drop = () => false, poseAt = time => ({ x: time * 40 }) } = {}) {
  const buffer = new SnapshotBuffer(), arrivals = [];
  for (let i = 0; i <= 210; i++) if (!drop(i)) arrivals.push({ now: 10 + i / 30 + .05, snap: packet(i * 4 + 1, i / 30, poseAt(i / 30)).decoded });
  let index = 0;
  const rows = [];
  for (let frame = 0; frame < 420; frame++) {
    const now = 10 + frame / 60;
    while (index < arrivals.length && arrivals[index].now <= now + 1e-10) { const a = arrivals[index++]; assert(buffer.push(a.snap, a.now)); }
    const info = buffer.sample(now); if (!info) continue;
    const pos = buffer.states.get(1).pos;
    rows.push({ now, cursor: buffer.renderTime, latest: buffer.latest.time, delay: now - buffer.clockOffset - buffer.renderTime, x: pos.x, y: pos.y, z: pos.z });
  }
  return { buffer, rows };
}

test('wire v2 persists uint16 pose revisions; historical v1 decodes with revision zero', () => {
  const { bytes, decoded } = packet(120, 1, { poseRevision: 65535 });
  assert.equal(new DataView(bytes).getUint8(0), 2); assert.equal(decoded.cars[0].poseRevision, 65535);
  // The independent v1 layout is exactly v2 with its two-byte car revision removed.
  const modern = new Uint8Array(bytes), legacy = new Uint8Array(modern.length - 2);
  legacy.set(modern.subarray(0, 40)); legacy.set(modern.subarray(42), 40); legacy[0] = 1;
  const old = decodeSnapshot(legacy); assert(old); assert.equal(old.cars[0].poseRevision, 0);
  assert.equal(old.cars[0].x, decoded.cars[0].x); assert.equal(old.cars[0].L.length, 4);
  const invalid = bytes.slice(0); new DataView(invalid).setUint8(0, 3); assert.equal(decodeSnapshot(invalid), null);
  const wrapped = packet(124, 1 + 1 / 30, { poseRevision: 65536 }).decoded; assert.equal(wrapped.cars[0].poseRevision, 0);
});

test('recovery never interpolates a 230-meter teleport through the void', () => {
  for (const revision of [1, 0]) {
    const b = new SnapshotBuffer(); b.push(packet(120, 1, { x: 0, y: -200, vx: 0 }).decoded, 10);
    b.clockOffset = 9; b.delay = 0; b.sample(10);
    const recovered = packet(124, 1 + 1 / 30, { x: 0, y: 30, vx: 0, poseRevision: revision }).decoded;
    b.push(recovered, 10 + 1 / 30); b.clockOffset = 9; b.delay = 0;
    b.sample(10 + 1 / 60); assert.equal(b.states.get(1).pos.y, -200, 'Old pose is held until recovery timestamp, even with omitted legacy metadata');
    b.sample(10 + 1 / 30); assert.equal(b.states.get(1).pos.y, 30);
    b.sample(10 + .05); assert.equal(b.states.get(1).pos.y, 30); assert.equal(b.states.get(1).poseRevision, revision);
  }
});

test('persistent revision survives a lost first recovery packet and a uint16 wrap', () => {
  for (const [oldRevision, nextRevision] of [[0, 1], [65535, 0]]) {
    const b = new SnapshotBuffer(); b.push(packet(120, 1, { x: 0, y: 1, vx: 0, poseRevision: oldRevision }).decoded, 10);
    b.clockOffset = 9; b.delay = 0; b.sample(10);
    // Recovery happened in lost packet124. The retained revision still travels in128.
    b.push(packet(128, 1 + 2 / 30, { x: 1, y: 2, vx: 0, poseRevision: nextRevision }).decoded, 10 + 2 / 30);
    b.clockOffset = 9; b.delay = 0; b.sample(10 + .05);
    assert.deepEqual(b.states.get(1).pos.toArray(), [0, 1, 0], 'Even small recoveries cannot smear when revision changes');
    b.sample(10 + .08); assert.deepEqual(b.states.get(1).pos.toArray(), [1, 2, 0]);
    assert.equal(b.states.get(1).poseRevision, nextRevision);
  }
});

test('explicit unflip snaps orientation at its timestamp without a half-rotated cabin', () => {
  const upsideDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
  const b = new SnapshotBuffer(); b.push(packet(120, 1, { vx: 0, x: 0, quat: upsideDown }).decoded, 10);
  b.clockOffset = 9; b.delay = 0; b.sample(10); const old = b.states.get(1).quat.clone();
  b.push(packet(124, 1 + 1 / 30, { vx: 0, x: 0, poseRevision: 1 }).decoded, 10 + 1 / 30);
  b.clockOffset = 9; b.delay = 0; b.sample(10 + 1 / 60); assert(b.states.get(1).quat.angleTo(old) < 1e-10);
  b.sample(10 + 1 / 30); assert(b.states.get(1).quat.angleTo(new THREE.Quaternion()) < 1e-10);
});

test('physical high-speed jumps and collision reversals retain continuous interpolation', () => {
  const b = new SnapshotBuffer(); const first = packet(120, 1, { x: 0, y: 1, vx: 100, vy: 20 }).decoded;
  const next = packet(124, 1 + 1 / 30, { x: 100 / 30, y: 1 + 20 / 30, vx: -100, vy: 18 }).decoded;
  b.push(first, 10); b.push(next, 10 + 1 / 30); b.clockOffset = 9; b.delay = 0;
  b.sample(10 + 1 / 60); const pos = b.states.get(1).pos;
  assert(Math.abs(pos.x - 100 / 60) < 2e-5); assert(Math.abs(pos.y - 1 - 20 / 60) < 2e-5);
  assert.equal(b.states.get(1).poseRevision, 0);
});

test('300ms packet-return correction is bounded to1.25x motion and drains its extra delay', () => {
  const { rows } = replay({ drop: i => i >= 30 && i < 39 });
  let maximumStep = 0, maximumDelay = 0;
  for (let i = 1; i < rows.length; i++) {
    maximumStep = Math.max(maximumStep, rows[i].x - rows[i - 1].x);
    maximumDelay = Math.max(maximumDelay, rows[i].delay);
    assert(rows[i].cursor >= rows[i - 1].cursor); assert(rows[i].cursor <= rows[i].latest + .1 + 1e-12);
    assert(rows[i].x >= rows[i - 1].x - 1e-4, 'A constant-speed convoy cannot reverse due to buffer correction');
  }
  assert(maximumStep <= 40 / 60 * 1.25 + 2e-4, `Largest one-frame step ${maximumStep}m`);
  assert(maximumDelay > .2 && maximumDelay < .3, 'Report the honest temporary delay, rather than extending prediction');
  assert(rows.at(-1).delay < .076, 'Normal 75ms buffering resumes after catch-up');
});

test('600ms outage retains an interpolation anchor within the twelve-packet memory bound', () => {
  const { buffer, rows } = replay({ drop: i => i >= 30 && i < 48 });
  let maximumStep = 0;
  for (let i = 1; i < rows.length; i++) maximumStep = Math.max(maximumStep, rows[i].x - rows[i - 1].x);
  assert(maximumStep <= 40 / 60 * 1.25 + 2e-4, 'Buffer pruning must not force a later correction leap');
  assert.equal(buffer.snaps.length, 12); assert(rows.at(-1).delay < .076);
});

test('a stream more than one second stale rebases to current state instead of traversing old road', () => {
  const b = new SnapshotBuffer(); b.push(packet(1, 0).decoded, 10); b.clockOffset = 10; b.delay = 0; b.sample(10.1);
  b.push(packet(181, 1.5, { y: 30 }).decoded, 11.55); b.sample(11.55);
  assert.equal(b.renderTime, b.latest.time); assert.equal(b.states.get(1).pos.y, 30); assert.equal(b.states.get(1).pos.x, 60);
  const current = b.renderTime; b.sample(11.5); assert.equal(b.renderTime, current);
});

test('spawn/despawn identities and pose objects remain bounded during catch-up', () => {
  const b = new SnapshotBuffer(); b.push(packet(1, 0, { count: 12 }).decoded, 10); b.clockOffset = 10; b.delay = 0; b.sample(10);
  const scratch = b._qE, first = b.states.get(1), pos = first.pos, quat = first.quat;
  for (let i = 1; i < 90; i++) {
    const now = 10 + i / 60; if (i % 2 === 0) b.push(packet(i * 2 + 1, i / 60, { count: i < 60 ? 12 : 1 }).decoded, now);
    b.sample(now); assert.equal(b.states.get(1), first); assert.equal(first.pos, pos); assert.equal(first.quat, quat);
    assert(b.snaps.length <= 12); assert(b.states.size <= 12);
  }
  assert.equal(b.states.size, 1); assert.equal(b._qE, scratch);
  const indexed = b.latest.carsById; b.sample(11.49); assert.equal(b.latest.carsById, indexed, 'Repeated render does not rebuild any per-car index');
  b._sampleSerial = 0xffffffff; b.sample(11.5); assert.equal(b._sampleSerial, 0); assert.equal(b.states.size, 1, 'Membership marking also survives itsuint32 wrap');
  b.push(packet(400, 1.6, { count: 0 }).decoded, 11.6); b.sample(11.8); assert.equal(b.states.size, 0);
  assert.equal(b.sample(100).hud.cars.length, 0); assert.equal(b.states.size, 0);
});

test('malformed snapshot input cannot allocate an index or poison the established receive clock', () => {
  const b = new SnapshotBuffer(); b.push(packet(1, 0).decoded, 10); const latest = b.latest, offset = b.clockOffset;
  for (const cars of [undefined, null, {}]) assert.equal(b.push({ tick: 2, time: .1, cars }, 10.1), false);
  assert.equal(b.latest, latest); assert.equal(b.clockOffset, offset); assert.equal(b.snaps.length, 1);
});
