import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SnapshotBuffer, encodeSnapshot, decodeSnapshot } from '../src/net/snapshot.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { GunnerController } from '../src/game/gunner.js';
import { GunnerCam } from '../src/view/camera_rig.js';
import { BOSS_PARTS } from '../src/data/boss.js';

const neutral = { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1 };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
function packet(tick, time, yaw, revision = 0, boss = null) {
  const spec = VEHICLES.truck_t1;
  const car = { id: 1, spec, kind: 'player', hp: 400, maxHp: 400, engineHp: 100,
    crew: { driver: { alive: true }, gunner: { alive: true, aimYaw: 0, aimPitch: 0, weapon: 0 } },
    veh: { pos: { x: 0, y: 1, z: time * 20 }, quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      vel: { x: 0, y: 0, z: 0 }, angvel: { x: 0, y: 0, z: 0 }, poseRevision: revision,
      wheels: spec.wheels.map(() => ({ L: .4, slip: 0, grounded: true })), steerAngle: 0, rpm01: .5, brakeApplied: 0 } };
  const decoded = decodeSnapshot(encodeSnapshot({ cars: new Map([[1, car]]), time, state: 'run', projectiles: { rockets: [], grenades: [] }, boss }, tick, { dist: time * 20, hp01: 1 }));
  assert.ok(decoded); return decoded;
}
function gunner(weapon = 'pistol') { return new GunnerController({ weapons: [weapon] }, { emit() {}, ownCar: () => null, targets: function* () {}, raycastWorld: () => null }); }
function update(g, st, cmd = neutral) {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(st.quat), before = g.yaw;
  g.update(0, cmd, null, Math.atan2(f.x, f.z), { carQuat: st.quat, poseRevision: st.poseRevision, streamPoseGeneration: st.streamPoseGeneration });
  return wrap(g.yaw - before);
}
function sample(b, now) { b.sample(now); return b.states.get(1); }

for (const [weapon, ads, multiplier] of [['pistol', false, 1], ['rifle', true, .6], ['sniper', true, .28]]) {
  test(`${weapon}: actual wire outage/rebase does not inherit49.5deg and preserves current mouse input`, () => {
    const b = new SnapshotBuffer(), g = gunner(weapon); g.ads = ads ? 1 : 0;
    const camera = new THREE.PerspectiveCamera(), rig = new GunnerCam(camera), eye = new THREE.Vector3(0, 3, 40);
    b.push(packet(30, 1, 0), 10); const first = sample(b, 10.1);
    update(g, first, { ...neutral, ads }); rig.update(1 / 60, eye, g.yaw, g.pitch, ads, { truckQuat: first.quat });
    const previousCamera = camera.quaternion.clone();
    b.push(packet(90, 3, Math.PI / 2), 12); const returned = sample(b, 12.01);
    assert.equal(returned.poseRevision, 0); assert.equal(returned.streamPoseGeneration, 1);
    assert.ok(Math.abs(update(g, returned, { ...neutral, ads, dYaw: .02 }) - .02 * multiplier) < 1e-12);
    rig.update(1 / 60, eye, g.yaw, g.pitch, ads, { truckQuat: returned.quat });
    assert.ok(Math.abs(previousCamera.angleTo(camera.quaternion) - .02 * multiplier) < 1e-7, 'whole view follows only player input');
    sample(b, 12.02); assert.equal(b.streamPoseGeneration, 1, 'rebase generation is stable on following frames');
    b.push(packet(93, 3.1, Math.PI / 2 + .04), 12.1);
    const next = sample(b, 12.2), before = g._lastCarQuat.clone();
    const expected = new THREE.Quaternion().copy(before).conjugate().premultiply(next.quat);
    assert.ok(Math.abs(update(g, next, { ...neutral, ads }) - wrap(2 * Math.atan2(expected.y, expected.w)) * .55) < 1e-12, 'normal steering resumes');
  });
}

test('boot and normal interpolation preserve stable generation and authored carrier inheritance', () => {
  const b = new SnapshotBuffer(), g = gunner();
  b.push(packet(30, 1, 0), 10); update(g, sample(b, 10.1));
  assert.equal(b.streamPoseGeneration, 0);
  b.push(packet(33, 1.1, .04), 10.1);
  const st = sample(b, 10.2);
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(st.quat);
  assert.ok(Math.abs(update(g, st) - Math.atan2(f.x, f.z) * .55) < 1e-12);
  assert.equal(st.streamPoseGeneration, 0);
});

test('explicit stream clear changes generation without changing wire recovery revision; new Run buffer starts fresh', () => {
  const b = new SnapshotBuffer(), g = gunner();
  const boss = { pos: { x: 20, y: 2, z: 80 }, quat: new THREE.Quaternion(), v: 20, phase: 1, dead: false, exploded: false,
    alive: Object.fromEntries(Object.keys(BOSS_PARTS).map(id => [id, true])), hp: Object.fromEntries(Object.entries(BOSS_PARTS).map(([id, part]) => [id, part.hp])) };
  b.push(packet(30, 1, 0, 0, boss), 10); update(g, sample(b, 10.1));
  assert.ok(b.boss && b.boss.pos.x === 20 && b.boss.pos.z >= 80, 'actual decoded/predicted boss is cached before stream reset');
  b.clear(); assert.equal(b.states.size, 0); assert.equal(b.snaps.length, 0); assert.equal(b.latest, null);
  assert.equal(b.boss, null, 'explicit reset must remove stale boss before any next packet');
  assert.equal(b.renderTime, null); assert.equal(b.clockOffset, null);
  b.push(packet(1, 0, 2.3), 100);
  assert.equal(update(g, sample(b, 100.1)), 0);
  assert.equal(b.streamPoseGeneration, 1);
  assert.equal(new SnapshotBuffer().streamPoseGeneration, 0);
});

test('generation wrap, vehicle recovery and legacy callers preserve current mouse turn', () => {
  const g = gunner(), st = { quat: new THREE.Quaternion(), poseRevision: 65535, streamPoseGeneration: 0xffffffff };
  update(g, st);
  st.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.8); st.poseRevision = 0; st.streamPoseGeneration = 0;
  assert.ok(Math.abs(update(g, st, { ...neutral, dYaw: -.03 }) + .03) < 1e-12);
  const legacy = gunner(); legacy.update(0, neutral, null, .2); const before = legacy.yaw;
  legacy.update(0, neutral, null, .4);
  assert.ok(Math.abs(wrap(legacy.yaw - before) - .2 * .55) < 1e-12);
});
