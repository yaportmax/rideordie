import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sim } from '../src/sim/sim.js';
import { GunnerController } from '../src/game/gunner.js';
import { localHitPoint, resolveHitPoint } from '../src/sim/hit_contact.js';

test('contacts follow a moving and rotating target while the original world tracer stays unchanged', () => {
  const car = { veh: { pos: new THREE.Vector3(0, 2, 100), quat: new THREE.Quaternion(), poseRevision: 0 }, spec: { length: 6, width: 2, height: 2 } };
  const original = [1, 2.3, 100], report = { point: original, dir: [1, 0, 0], dmg: 10, poseRevision: 0 };
  report.localPoint = localHitPoint(car, new THREE.Vector3(...original));
  car.veh.pos.z += 9; car.veh.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const hit = resolveHitPoint(car, report, new THREE.Vector3());
  assert.ok(hit.distanceTo(new THREE.Vector3(0, 2.3, 108)) < 1e-9);
  assert.deepEqual(report.point, original);
  assert.equal(resolveHitPoint(car, { ...report, localPoint: undefined }, new THREE.Vector3()), null);
  car.veh.poseRevision++;
  assert.equal(resolveHitPoint(car, report, new THREE.Vector3()), null);
});

test('invalid contact coordinates, damage and directions cannot poison an authority body', () => {
  const car = { veh: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), poseRevision: 0 } };
  const valid = { point: [1, 1, 0], localPoint: [1, 1, 0], dir: [1, 0, 0], dmg: 10, poseRevision: 0 };
  for (const patch of [{ point: [NaN, 1, 0] }, { dir: [0, Infinity, 0] }, { dir: [1e308, 0, 0] }, { dir: [0, 0, 0] }, { dmg: NaN }, { dmg: -1 }, { dmg: 1e308 }, { tireMul: Infinity }, { localPoint: [0, 0, 900] }, { localPoint: [] }, { poseRevision: 1 }, { poseRevision: 65536 }]) {
    assert.equal(resolveHitPoint(car, { ...valid, ...patch }, new THREE.Vector3()), null);
  }
});

test('actual Rapier impulses use current target contact and preserve all pellet damage while counting one shot', async () => {
  const runCase = async delay => {
    const sim = await new Sim().init();
    try {
      sim.spawnCar('truck_t1', { s: 40, kind: 'player' });
      const target = sim.spawnCar('truck_t1', { s: 100 });
      const hitPoint = target.veh.pos.clone().add(new THREE.Vector3(0, .3, 0));
      const report = { carId: target.id, zone: 'body', dmg: 1, dir: [1, 0, 0], point: hitPoint.toArray(), localPoint: localHitPoint(target, hitPoint), poseRevision: 0, shotId: 1 };
      const position = target.veh.pos.clone(); position.z += 40 * delay;
      target.veh.body.setTranslation(position, true); target.veh.readState();
      let damage = 0; sim.damageZone = (_car, _zone, amount) => { damage += amount; };
      for (let i = 0; i < 9; i++) assert.equal(sim.applyHit(report), true);
      const angular = target.veh.body.angvel(), linear = target.veh.body.linvel();
      assert.equal(sim.stats.hits, 1); assert.equal(damage, 9);
      assert.equal(sim.applyHit({ ...report, shotId: 2 }), true); assert.equal(sim.stats.hits, 2);
      const stale = { ...report, poseRevision: 1 }; assert.equal(sim.applyHit(stale), false);
      return { angular, linear };
    } finally { sim.dispose(); assert.equal(sim._landedShots.size, 0); }
  };
  const current = await runCase(0), delayed = await runCase(.225);
  for (const name of ['angular', 'linear']) for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(current[name][axis] - delayed[name][axis]) < 1e-5);
  assert.ok(Math.abs(delayed.angular.y) < 1e-6, 'forward travel must not create fictitious yaw leverage');
});

test('real shotgun fire tags all pellets with one shell identity and the next weapon gets the next identity', () => {
  const reports = [], emitted = [], target = { id: 2, veh: { pos: new THREE.Vector3(0, 0, 10), quat: new THREE.Quaternion(), poseRevision: 7 } };
  const gunner = new GunnerController({ weapons: ['shotgun', 'rifle'] }, { ownCar: () => null, emit: e => emitted.push(e), report: h => reports.push(h), targets: function* () {} });
  gunner._raycastAll = () => ({ point: new THREE.Vector3(0, 0, 10), t: 10, zone: { kind: 'body' }, car: target, world: false });
  gunner.muzzle.set(0, 0, 1);
  const camera = { position: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) };
  gunner.fire(camera);
  assert.equal(reports.length, 9); assert.equal(gunner.shots, 1);
  assert.deepEqual([...new Set(reports.map(r => r.shotId))], [1]);
  assert.ok(reports.every(r => r.poseRevision === 7 && r.localPoint.every(v => v === 0)));
  gunner.cur = 1; gunner.fire(camera);
  assert.equal(reports.at(-1).shotId, 2); assert.equal(gunner.shots, 2);
  assert.ok(emitted.some(e => e.t === 'shot'));
});

test('penetration/reordered contacts count shots once with bounded replay bookkeeping', () => {
  const sim = new Sim();
  for (const id of [1, 1, 3, 2, 3]) sim._countLandedShot(id);
  assert.equal(sim.stats.hits, 3);
  for (let id = 4; id <= 1000; id++) sim._countLandedShot(id);
  const hits = sim.stats.hits; sim._countLandedShot(1); sim._countLandedShot(999);
  assert.equal(sim.stats.hits, hits); assert.ok(sim._landedShots.size <= 128);
  sim.dispose();
});
