import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Car, rayBox, raySphere } from '../src/sim/car.js';
import { Projectiles } from '../src/sim/projectiles.js';
import { VEHICLES, rideInfo } from '../src/data/vehicles.js';

const vec = (x, y, z) => new THREE.Vector3(x, y, z);
const makeCar = (spec) => new Car(null, 1, spec, {
  pos: vec(10, 2, -30), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(.16, .7, -.1)),
  restComHeight: rideInfo(spec).restComHeight,
}, 'player');

test('shot intersections retain inside, parallel, tangent and reverse-ray behavior', () => {
  const c = [0, 0, 0], h = [1, 2, 3];
  assert.equal(rayBox(vec(-5, 0, 0), vec(1, 0, 0), c, h), 4);
  assert.equal(rayBox(vec(5, 0, 0), vec(-1, 0, 0), c, h), 4);
  assert.equal(rayBox(vec(0, 0, 0), vec(0, 0, -1), c, h), 0);
  assert.equal(rayBox(vec(-5, 2, 3), vec(1, 0, 0), c, h), 4);
  assert.equal(rayBox(vec(-5, 2.01, 0), vec(1, 0, 0), c, h), -1);
  assert.equal(rayBox(vec(-5, 0, 0), vec(-1, 0, 0), c, h), -1);
  assert.equal(rayBox(vec(-5, 0, 0), vec(1, 1, 0).normalize(), c, h), -1);
  assert.equal(raySphere(vec(-5, 0, 0), vec(1, 0, 0), c, 1), 4);
  assert.equal(raySphere(vec(-5, 1, 0), vec(1, 0, 0), c, 1), 5);
  assert.equal(raySphere(vec(0, 0, 0), vec(1, 0, 0), c, 1), 0);
});

test('bullet rejection sphere encloses every vehicle zone even with rotated, moving and crouched crew', () => {
  for (const spec of Object.values(VEHICLES)) {
    const car = makeCar(spec);
    for (const role in car.crew) Object.assign(car.crew[role], { x: 3.5, z: -4.5, crouch: true });
    const radius = car.raycastRadius();
    for (const zone of car.zones) {
      const crew = zone.role ? car.crew[zone.role] : null;
      const center = vec(...zone.c);
      if (crew) {
        center.x += crew.x; center.z += crew.z;
        if (!zone.lowerBody) center.y -= zone.shape === 'sphere' ? .55 : .42;
      }
      center.y -= car.veh.restComHeight;
      if (zone.shape === 'sphere') assert.ok(center.length() + zone.r <= radius, spec.id + ':' + zone.kind);
      else for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        const corner = center.clone().add(vec(x * zone.h[0], y * zone.h[1], z * zone.h[2]));
        assert.ok(corner.length() <= radius, spec.id + ':' + zone.kind);
      }
    }
  }
});

test('enemy bullet broad phase keeps exact damage, world collisions and whizzes for mobile crew', () => {
  let seed = 90210;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const simFor = (player) => ({
    player, enemyDamageMul: 1, cars: new Map(), boss: null, events: [], hits: [],
    world: { castRay: (ray) => ray.origin.z > -25 ? { timeOfImpact: .7 } : null },
    emit(e) { this.events.push(e); },
    damageZone(car, hit, dmg, info) { this.hits.push({ zone: hit.zone.kind, throughBody: hit.throughBody, dmg, cause: info.cause, point: hit.point.toArray() }); },
  });
  for (const spec of Object.values(VEHICLES).filter((s) => s.kind === 'player')) for (const posture of [0, 1, 2]) {
    const optimized = makeCar(spec), reference = makeCar(spec);
    for (const car of [optimized, reference]) {
      Object.assign(car.crew.gunner, { x: posture === 2 ? 3 : 0, z: posture === 2 ? -4 : 0, crouch: posture === 1 });
    }
    reference.raycastRadius = undefined; // Exhaustive zone tests provide the independent collision oracle.
    const a = new Projectiles(), b = new Projectiles(), sa = simFor(optimized), sb = simFor(reference);
    const target = vec(spec.seats.gunner[0] + optimized.crew.gunner.x, spec.seats.gunner[1] + 1.62 - (optimized.crew.gunner.crouch ? .55 : 0) - optimized.veh.restComHeight, spec.seats.gunner[2] + optimized.crew.gunner.z).applyQuaternion(optimized.veh.quat).add(optimized.veh.pos);
    for (let i = 0; i < 400; i++) {
      const origin = optimized.veh.pos.clone().add(vec((random() - .5) * 100, (random() - .5) * 50, (random() - .5) * 100));
      if (i % 10 === 0) origin.copy(target).add(vec(0, 3, 0));
      const dir = i % 3 === 0 || i % 10 === 0 ? target.clone().sub(origin).normalize() : vec(random() - .5, random() - .5, random() - .5).normalize();
      a.addBullet(origin, dir, 250, 5, 2); b.addBullet(origin, dir, 250, 5, 2);
    }
    // Advance enough ticks to exercise successive swept segments and whizz timing.
    for (let i = 0; i < 8; i++) { a.update(1 / 60, sa); b.update(1 / 60, sb); }
    assert.deepEqual(sa.hits, sb.hits, spec.id + ' posture ' + posture);
    assert.deepEqual(sa.events, sb.events, spec.id + ' posture ' + posture);
    assert.deepEqual(a.bullets, b.bullets, spec.id + ' posture ' + posture);
    assert.ok(sa.hits.length > 0, 'scenario must include actual hits');
  }
});
