import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';
import { VEHICLES } from '../src/data/vehicles.js';

const BASE = 10, SEND_HZ = 30, RENDER_HZ = 60, SPEED = 40;
function packet(tick, time, opts = {}) {
  const spec = VEHICLES.truck_t1;
  const cars = Array.from({ length: opts.count ?? 1 }, (_, i) => ({
    id: i + 1, spec, kind: i === 0 ? 'player' : 'enemy', hp: 400, maxHp: 400, engineHp: 100,
    dead: !!opts.dead, exploded: !!opts.exploded,
    crew: { driver: { alive: !opts.dead }, gunner: { alive: !opts.dead, aimYaw: .2, aimPitch: .1, weapon: 0 } },
    veh: {
      pos: { x: opts.x ?? time * SPEED, y: opts.y ?? 1, z: i * 4 },
      quat: opts.quat ?? { x: 0, y: 0, z: 0, w: 1 },
      vel: { x: opts.vx ?? SPEED, y: 0, z: 0 },
      angvel: opts.angvel ?? { x: 0, y: 0, z: 0 },
      wheels: spec.wheels.map(() => ({ L: .4, slip: 0, grounded: true })),
      steerAngle: 0, rpm01: .5, brakeApplied: 0,
    },
  }));
  const sim = { cars: new Map(cars.map(c => [c.id, c])), time, state: opts.state ?? 'run',
    projectiles: { rockets: [], grenades: [] }, boss: null };
  const decoded = decodeSnapshot(encodeSnapshot(sim, tick, { dist: time * SPEED, hp01: 1, dhp01: 1, ghp01: 1 }));
  assert(decoded, 'Fixture traverses actual production wire encode/decode');
  return decoded;
}
function replay({ sourceTime = real => real, lag = () => .05, drop = () => false } = {}) {
  const buffer = new SnapshotBuffer(), arrivals = [];
  // Send beyond the rendered interval; do not manufacture an end-of-stream outage.
  for (let i = 0; i <= 180; i++) {
    if (!drop(i)) arrivals.push({ now: BASE + i / SEND_HZ + lag(i), snap: packet(4 * i + 1, sourceTime(i / SEND_HZ)) });
  }
  arrivals.sort((a, b) => a.now - b.now);
  let next = 0, rejected = 0;
  const rows = [];
  for (let frame = 0; frame < 300; frame++) {
    const now = BASE + frame / RENDER_HZ;
    while (next < arrivals.length && arrivals[next].now <= now + 1e-10) {
      const arrival = arrivals[next++];
      if (!buffer.push(arrival.snap, arrival.now)) rejected++;
    }
    const sampled = buffer.sample(now); if (!sampled) continue;
    rows.push({ now, cursor: buffer.renderTime ?? now - buffer.clockOffset - buffer.delay, latest: buffer.latest.time,
      x: buffer.states.get(1).pos.x, t: sampled.t });
  }
  return { buffer, rows, rejected };
}
function assertForwardAndBounded(rows, label) {
  assert(rows.length > 200, label + ': substantial decoded trajectory');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    assert(Number.isFinite(row.cursor) && Number.isFinite(row.x) && Number.isFinite(row.t));
    assert(row.cursor <= row.latest + .1 + 1e-12, label + ': render cursor cannot forecast beyond the 100ms horizon');
    if (i) {
      assert(row.cursor >= rows[i - 1].cursor, label + ': snapshot clock/delay cannot rewind time');
      assert(row.x >= rows[i - 1].x - 1e-4, label + ': constant-speed truck cannot move backward beyond independent Float32 position/time quantization');
    }
  }
}

test('decoded stable, latency-step and reordered WAN trajectories never rewind the render cursor', () => {
  const stable = replay(); assertForwardAndBounded(stable.rows, 'stable50ms');
  const step = replay({ lag: i => i >= 31 && i < 80 ? .15 : .05 }); assertForwardAndBounded(step.rows, '50→150→50ms');
  const jitter = replay({ lag: i => .05 + [0, .02, .06, .015, .025, 0, .005][i % 7] });
  assert(jitter.rejected > 0, 'Unordered old packets exercise existing freshness guard');
  assertForwardAndBounded(jitter.rows, 'jitter/reorder');
});

test('decoded simulation slow motion cannot drive the cursor farther than 100 sim-ms ahead', () => {
  const slow = replay({ sourceTime: real => real <= 1 ? real : 1 + (real - 1) * .2 });
  assertForwardAndBounded(slow.rows, '1→0.2x simulation');
  assert(slow.rows.some(row => Math.abs(row.cursor - row.latest - .1) < 1e-8), 'Actual slow-motion offset pressure reaches the cap');
  // This intentionally does not assert a sender-rate-aware delay or seamless
  // forward corrections: neither is carried by the current wire format.
});

test('packet loss and a prolonged outage freeze at the bounded horizon then resume decoded movement', () => {
  const loss = replay({ drop: i => i % 13 === 7 || (i >= 30 && i < 42) });
  assertForwardAndBounded(loss.rows, 'loss/400ms outage');
  assert(loss.rows.some((row, i) => i && row.now > BASE + 1.1 && row.now < BASE + 1.4 && row.x === loss.rows[i - 1].x), 'Extrapolated travel freezes during the genuine outage');
  const b = new SnapshotBuffer(); b.push(packet(1, 1), 10); b.clockOffset = 9; b.delay = 0;
  b.sample(20); const held = b.states.get(1).pos.x;
  assert.equal(b.renderTime, b.latest.time + .1);
  b.sample(200); assert.equal(b.states.get(1).pos.x, held); assert.equal(b.renderTime, b.latest.time + .1);
});

test('manual clockOffset/delay tuning stays supported and correction cannot rewind an established cursor', () => {
  const b = new SnapshotBuffer(); b.push(packet(1, 1), 10); b.push(packet(5, 1.1), 10.1);
  b.clockOffset = 9; b.delay = .025; b.sample(10.075);
  assert(Math.abs(b.states.get(1).pos.x - 42) < 1e-4, 'Manual delay retains exact interpolation control');
  const cursor = b.renderTime, x = b.states.get(1).pos.x;
  b.delay = .2; b.clockOffset += .5; b.sample(10.1);
  assert.equal(b.renderTime, cursor); assert.equal(b.states.get(1).pos.x, x, 'Increased buffering holds the current pose until the target catches up');
  b.delay = 0; b.clockOffset = 9; b.sample(10.18); assert(b.renderTime > cursor);
  const resumed = b.renderTime; b.sample(10.01); assert.equal(b.renderTime, resumed, 'A backward receive-clock sample also cannot rewind');
});

test('tick wrap, duplicate/reordered packets and fresh run resets preserve cursor and newest state', () => {
  const b = new SnapshotBuffer();
  assert(b.push(packet(0xfffffffc, 1), 10)); b.sample(10.02);
  assert(b.push(packet(0xffffffff, 1 + 1 / 30), 10 + 1 / 30));
  assert(b.push(packet(0, 1 + 2 / 30), 10 + 2 / 30), 'Unsigned uint32 wrap is accepted');
  b.sample(10.08); const cursor = b.renderTime, latest = b.latest, offset = b.clockOffset;
  assert.equal(b.push(packet(0, latest.time), 10.1), false);
  assert.equal(b.push(packet(0xfffffffe, 1.02), 10.11), false);
  assert.equal(b.push(packet(1, .9), 10.12), false, 'New tick cannot lower sender sim time');
  assert.equal(b.latest, latest); assert.equal(b.clockOffset, offset); assert.equal(b.renderTime, cursor);
  const fresh = new SnapshotBuffer(); assert.equal(fresh.renderTime, null);
  fresh.push(packet(1, 0), 100); fresh.sample(100.01);
  assert(fresh.renderTime < cursor, 'New Run buffer has its own fresh cursor');
});

test('persistent death and decoded despawn survive stalled timing without resurrecting old states', () => {
  const b = new SnapshotBuffer(); b.push(packet(1, 1), 10); b.clockOffset = 9; b.delay = 0; b.sample(10.02);
  b.push(packet(5, 1.1, { dead: true, exploded: true, vx: 0, state: 'dying' }), 10.1);
  b.sample(10.25); assert.equal(b.states.get(1).dead, true); assert.equal(b.states.get(1).exploded, true);
  const over = packet(9, 1.2, { count: 0, state: 'over' }); b.push(over, 10.2); b.sample(10.4);
  assert.equal(b.states.size, 0); assert.equal(b.sample(200).hud.state, 'over'); assert.equal(b.states.size, 0);
});

test('decoded world angular velocity extrapolates from the latest pose and stops after 100ms', () => {
  const b = new SnapshotBuffer(), snap = packet(1, 1, { angvel: { x: 0, y: 2, z: 0 } });
  b.push(snap, 10); b.clockOffset = 9; b.delay = 0;
  b.sample(10.05); const expected50 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .1);
  assert(b.states.get(1).quat.angleTo(expected50) < 1e-7);
  b.sample(100); const expected100 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .2);
  assert(b.states.get(1).quat.angleTo(expected100) < 1e-7);
  const once = b.states.get(1).quat.clone(); b.sample(200);
  assert(b.states.get(1).quat.angleTo(once) < 1e-7, 'Every sample starts from decoded pose, never accumulates extrapolation');
  assert(Math.abs(b.states.get(1).quat.length() - 1) < 1e-12);
});

test('angular extrapolation uses world axes rather than rotating around the car local axis', () => {
  const initial = new THREE.Quaternion().setFromEuler(new THREE.Euler(.47, -.31, .82));
  const b = new SnapshotBuffer(), snap = packet(1, 2, { quat: initial, angvel: { x: .7, y: -1.2, z: .4 } });
  b.push(snap, 12); b.clockOffset = 10; b.delay = 0; b.sample(12.075);
  const c = snap.cars[0], axis = new THREE.Vector3(c.wx, c.wy, c.wz), angle = axis.length() * .075; axis.normalize();
  const base = new THREE.Quaternion(c.qx, c.qy, c.qz, c.qw).normalize();
  // Independent Rodrigues rotation of world-space basis vectors distinguishes
  // the required world delta from a local-space quaternion multiplication.
  for (const local of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
    const world = local.clone().applyQuaternion(base);
    const expected = world.clone().multiplyScalar(Math.cos(angle))
      .addScaledVector(new THREE.Vector3().crossVectors(axis, world), Math.sin(angle))
      .addScaledVector(axis, axis.dot(world) * (1 - Math.cos(angle)));
    const actual = local.clone().applyQuaternion(b.states.get(1).quat);
    assert(actual.distanceTo(expected) < 1e-10, 'World-axis Rodrigues trajectory');
  }
});

test('in-window quaternion interpolation stays exact and zero-angular loss keeps orientation unchanged', () => {
  const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(.1, .4, -.2));
  const qb = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.3, .7, .2));
  const b = new SnapshotBuffer(), a = packet(1, 1, { quat: qa, angvel: { x: 8, y: 2, z: 1 } }), z = packet(5, 1.1, { quat: qb });
  b.push(a, 10); b.push(z, 10.1); b.clockOffset = 9; b.delay = 0; const info = b.sample(10.05);
  const ca = a.cars[0], cz = z.cars[0], expected = new THREE.Quaternion(ca.qx, ca.qy, ca.qz, ca.qw).normalize()
    .slerp(new THREE.Quaternion(cz.qx, cz.qy, cz.qz, cz.qw).normalize(), info.t);
  assert(b.states.get(1).quat.angleTo(expected) < 1e-7, 'Angular extrapolation never modifies bracket interpolation');
  b.sample(200); assert(b.states.get(1).quat.angleTo(new THREE.Quaternion(cz.qx, cz.qy, cz.qz, cz.qw).normalize()) < 1e-7);
});

test('multi-car extrapolation reuses one scratch quaternion and stable per-car pose objects', () => {
  const b = new SnapshotBuffer(), snap = packet(1, 1, { count: 12, angvel: { x: .5, y: 1, z: -.25 } });
  b.push(snap, 10); b.clockOffset = 9; b.delay = 0; b.sample(10.01);
  const scratch = b._qE, poses = [...b.states.values()].map(st => ({ st, pos: st.pos, quat: st.quat }));
  assert(scratch instanceof THREE.Quaternion, 'Buffer owns one extrapolation scratch quaternion');
  let deltaSets = 0; const set = scratch.set; scratch.set = function (...args) { deltaSets++; return set.apply(this, args); };
  for (let i = 0; i < 20; i++) b.sample(10.02 + i / 120);
  assert.equal(deltaSets, 12 * 20, 'Exactly one reusable delta preparation per extrapolated moving car');
  assert.equal(b._qE, scratch);
  poses.forEach(({ st, pos, quat }) => { assert.equal(b.states.get(st.id), st); assert.equal(st.pos, pos); assert.equal(st.quat, quat); });
});
