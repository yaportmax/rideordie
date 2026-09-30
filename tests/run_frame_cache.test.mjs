import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Run } from '../src/game/run.js';
import { GunnerController } from '../src/game/gunner.js';
import { makeCarState, SPEC_IDS } from '../src/view/car_state.js';

function targetsBefore(run) {
  const points = [];
  for (const st of run.states.values()) {
    if (st.kind !== 'enemy' || st.exploded) continue;
    const up = st.ride.restComHeight;
    if (st.gunnerAlive && st.spec.seats.gunner) { const s = st.spec.seats.gunner; points.push({ p: new THREE.Vector3(s[0], s[1] + 1.2 - up, s[2]).applyQuaternion(st.quat).add(st.pos), v: st.vel }); }
    if (st.driverAlive) { const s = st.spec.seats.driver; points.push({ p: new THREE.Vector3(s[0], s[1] + 0.5 - up, s[2]).applyQuaternion(st.quat).add(st.pos), v: st.vel }); }
    points.push({ p: st.pos, v: st.vel });
    const car = run.sim?.cars.get(st.id);
    if (car?.elite && car.weakPoint) { const c = car.weakPoint.c; points.push({ p: new THREE.Vector3(c[0], c[1] - up, c[2]).applyQuaternion(st.quat).add(st.pos), v: st.vel }); }
  }
  const boss = run.bossState;
  if (boss && !boss.dead) points.push({ p: new THREE.Vector3(0, 5, -8).applyQuaternion(boss.quat).add(boss.pos), v: boss.vel });
  return points;
}

function fixture() {
  const run = Object.assign(Object.create(Run.prototype), { states: new Map(), sim: { cars: new Map() } });
  SPEC_IDS.forEach((id, i) => {
    const state = makeCarState(i + 1, id, i ? 'enemy' : 'player'); run.states.set(state.id, state);
    run.sim.cars.set(state.id, { elite: i % 3 ? null : {}, weakPoint: { c: [0.3, 1.1, -0.2] } });
  });
  run.bossState = { pos: new THREE.Vector3(5, 1, 49080), quat: new THREE.Quaternion(), vel: new THREE.Vector3(0, 0, 22), dead: false };
  return run;
}

test('pooled assist points retain exact selection and real controller commands for moving crew, elites and bosses', () => {
  const run = fixture(), before = new GunnerController({ weapons: ['smg'] }, {}), after = new GunnerController({ weapons: ['smg'] }, {});
  const camera = { position: new THREE.Vector3(0, 2, 49000), dir: new THREE.Vector3(0, 0, 1) }, ownVel = new THREE.Vector3(0, 0, 26);
  for (let frame = 0; frame < 300; frame++) {
    for (const state of run.states.values()) {
      state.pos.set(Math.sin(frame * 0.03 + state.id) * 12, 1, 49015 + state.id * 13 + frame * 0.01);
      state.quat.setFromEuler(new THREE.Euler(frame * 0.001, state.id * 0.13 + frame * 0.01, -state.id * 0.015));
      state.vel.set(state.id * 0.2, frame * 0.001, 24 + state.id);
      state.exploded = (frame + state.id) % 23 === 0;
      state.driverAlive = (frame + state.id) % 9 !== 0; state.gunnerAlive = (frame + state.id) % 11 !== 0;
    }
    run.bossState.dead = frame % 19 === 0;
    const expected = targetsBefore(run), actual = run._assistTargets();
    assert.equal(actual.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
      assert.deepEqual(actual[i].p.toArray(), expected[i].p.toArray()); assert.equal(actual[i].v, expected[i].v);
    }
    const a = { dYaw: 0.004, dPitch: -0.002, ads: frame % 20 < 10 }, b = { ...a };
    before.assist(a, 1 / 60, camera, expected, ownVel); after.assist(b, 1 / 60, camera, actual, ownVel);
    assert.deepEqual(b, a);
    before.yaw += a.dYaw; after.yaw += b.dYaw; before.pitch += a.dPitch; after.pitch += b.dPitch;
  }
});

test('assist targets reuse their vectors and records after warm-up, and clear departed or dead targets', () => {
  const run = fixture(), list = run._assistTargets(), records = [...list], vectors = records.map(point => point.p), size = run._assistPool.length;
  for (let frame = 0; frame < 100; frame++) {
    for (const state of run.states.values()) state.pos.x += 0.1;
    assert.equal(run._assistTargets(), list); assert.equal(run._assistPool.length, size);
    records.forEach((point, i) => { assert.equal(list[i], point); assert.equal(list[i].p, vectors[i]); });
  }
  const states = run.states; run.states = new Map(); run.bossState.dead = true;
  assert.equal(run._assistTargets().length, 0); assert.equal(run._assistPool.length, size);
  run.states = new Map([...states].reverse());
  const refreshed = run._assistTargets(), expected = targetsBefore(run);
  assert.equal(refreshed.length, expected.length);
  refreshed.forEach((point, i) => { assert.deepEqual(point.p.toArray(), expected[i].p.toArray()); assert.equal(point.v, expected[i].v); });
});

test('projectile view records reuse storage without stale coordinates across movement, count or kind changes', () => {
  const run = Object.assign(Object.create(Run.prototype), { proj: [], sim: { projectiles: { rockets: [], grenades: [] } } });
  const projectiles = run.sim.projectiles, grenadePos = { x: 5, y: 6, z: 7 };
  projectiles.rockets.push({ x: 1, y: 2, z: 3 }); projectiles.grenades.push({ body: { translation: () => ({ ...grenadePos }) } });
  const list = run._projectileViews(), first = list[0], second = list[1];
  assert.deepEqual(list, [{ k: 1, x: 1, y: 2, z: 3 }, { k: 2, x: 5, y: 6, z: 7 }]);
  projectiles.rockets[0].x = 10; grenadePos.z = 9;
  assert.equal(run._projectileViews(), list); assert.equal(list[0], first); assert.equal(list[1], second);
  assert.deepEqual(list, [{ k: 1, x: 10, y: 2, z: 3 }, { k: 2, x: 5, y: 6, z: 9 }]);
  projectiles.rockets.length = 0; run._projectileViews();
  assert.deepEqual(list, [{ k: 2, x: 5, y: 6, z: 9 }]); assert.equal(list[0], first);
  projectiles.grenades.length = 0; run._projectileViews(); assert.deepEqual(list, []);
  projectiles.rockets.push({ x: 20, y: 21, z: 22 }); run._projectileViews();
  assert.deepEqual(list, [{ k: 1, x: 20, y: 21, z: 22 }]); assert.equal(list[0], first); assert.equal(run._projectilePool.length, 2);
});

test('run frustum preparation updates camera ancestors while leaving the weapon subtree to the render', () => {
  const scene = new THREE.Scene(), rig = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500), weapon = new THREE.Group();
  scene.add(rig); rig.add(camera); camera.add(weapon); rig.position.set(3, 2, 1); camera.position.z = 4;
  let walks = 0; const update = weapon.updateMatrixWorld;
  weapon.updateMatrixWorld = function(...args) { walks++; return update.apply(this, args); };
  const run = Object.assign(Object.create(Run.prototype), { g: { camera } }); run._updateFrustum();
  assert.equal(walks, 0); assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld).toArray(), [3, 2, 5]);
  assert.equal(run._frustum.containsPoint(new THREE.Vector3(3, 2, -20)), true);
  assert.equal(run._frustum.containsPoint(new THREE.Vector3(3, 2, 20)), false);
  scene.updateMatrixWorld(); assert.equal(walks, 1);
});
