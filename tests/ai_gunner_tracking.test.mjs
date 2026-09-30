import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AIGunner } from '../src/game/ai_gunner.js';
import { GunnerController } from '../src/game/gunner.js';

function enemy(id, z = 30) {
  return {
    id, kind: 'enemy', exploded: false, elite: true, weakPoint: { c: [0.8, 1.4, -0.9] },
    veh: { pos: new THREE.Vector3(id * 0.7, 0.8, z), quat: new THREE.Quaternion(), restComHeight: 0.7 },
    crew: { gunner: { alive: true }, driver: { alive: true } },
    spec: { seats: { gunner: [0.5, 1.1, -0.8], driver: [-0.5, 0.9, 0.3] }, explosive: true, mass: 4500, length: 5 },
    ai: { behavior: 'flanker' },
  };
}
function setup(cars = [enemy(2)]) {
  const run = {
    player: { veh: { pos: new THREE.Vector3() }, crew: { gunner: { alive: true, hp: 100, max: 100 }, driver: { alive: true, hp: 100, max: 100 } } },
    sim: { state: 'run', cars: new Map(cars.map((car) => [car.id, car])), boss: null },
  };
  return { run, ai: new AIGunner(run), eye: new THREE.Vector3(0, 2, 0) };
}

test('selected car points match full target enumeration for every supported target after movement', () => {
  const car = enemy(2), { ai, eye } = setup([car]);
  const points = ai._targets(eye);
  car.veh.pos.set(8, 1.4, 52);
  car.veh.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.65);
  car.veh.restComHeight = 1.05;
  for (const target of points) {
    const expected = ai._targets(eye).find((t) => t.car === car && t.kind === target.kind);
    const reused = target.p;
    ai._refreshTarget(target, eye);
    assert.equal(target.p, reused, 'tracking must reuse the existing vector');
    assert.ok(target.p.distanceTo(expected.p) < 1e-10, target.kind);
  }
  assert.deepEqual(points.map((t) => t.kind), ['gunner', 'driver', 'fuel', 'body', 'weak']);
});

test('tracking preserves the last point for unavailable, removed, out-of-range and too-near targets', () => {
  const mutations = [
    (car) => { car.exploded = true; },
    (car, run) => { run.sim.cars.delete(car.id); },
    (car) => { car.veh.pos.z = 171; },
    (car) => { car.crew.gunner.alive = false; },
    (car) => { car.veh.pos.set(-0.5, 1.05, 0.8); },
  ];
  for (const mutate of mutations) {
    const car = enemy(2), { ai, run, eye } = setup([car]);
    const target = ai._targets(eye).find((t) => t.kind === 'gunner'), before = target.p.clone();
    mutate(car, run);
    assert.equal(ai._targets(eye).some((t) => t.car === car && t.kind === target.kind), false);
    ai._refreshTarget(target, eye);
    assert.ok(target.p.equals(before));
  }
});

test('moving-car AI commands match the former full-scan tracking path across reaction and burst cycles', () => {
  const cars = Array.from({ length: 12 }, (_, i) => enemy(i + 2, 20 + i * 8));
  const { run, ai, eye } = setup(cars), reference = new AIGunner(run);
  // The old tracking path rebuilt all candidates on every update, then found the current selection.
  reference._refreshTarget = function (target, from) {
    const fresh = this._targets(from).find((t) => t.car === target.car && t.kind === target.kind);
    if (fresh) target.p = fresh.p;
  };
  const gunner = new GunnerController({ weapons: ['smg', 'shotgun', 'rifle'] }, { emit: () => {} });
  const random = Math.random;
  try {
    Math.random = () => 0.5;
    for (let frame = 0; frame < 300; frame++) {
      for (const [index, car] of cars.entries()) {
        car.veh.pos.x = Math.sin(frame * 0.04 + index) * 5;
        car.veh.pos.z = 24 + index * 8 + Math.cos(frame * 0.025) * 9;
        car.veh.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(frame * 0.02) * 0.3);
      }
      if (frame === 120) cars[0].crew.gunner.alive = false;
      if (frame === 180) cars[0].exploded = true;
      const expected = { ...reference.update(1 / 60, gunner, eye) };
      assert.deepEqual({ ...ai.update(1 / 60, gunner, eye) }, expected, `frame ${frame}`);
      assert.ok(ai.target.p.distanceTo(reference.target.p) < 1e-10);
    }
  } finally { Math.random = random; }
});

test('steady target tracking enumerates candidates only on retarget ticks', () => {
  const { ai, eye } = setup(Array.from({ length: 12 }, (_, i) => enemy(i + 2, 20 + i * 7)));
  const gunner = new GunnerController({ weapons: ['smg'] }, { emit: () => {} });
  const targets = ai._targets.bind(ai); let scans = 0;
  ai._targets = (from) => { scans++; return targets(from); };
  for (let frame = 0; frame < 120; frame++) ai.update(1 / 60, gunner, eye);
  assert.ok(scans >= 2 && scans <= 5, `expected retarget scans, observed ${scans}`);
});
