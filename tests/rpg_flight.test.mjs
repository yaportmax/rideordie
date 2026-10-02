import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WEAPONS } from '../src/data/weapons.js';
import { Projectiles } from '../src/sim/projectiles.js';
import { RAPIER, GROUPS, initPhysics } from '../src/sim/physics.js';

test('RPG reaches a thin obstacle at combat distance in under a second without tunnelling', async () => {
  await initPhysics();
  for (const dt of [1 / 120, 1 / 60, 1 / 30]) {
    const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    try {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 5, 100));
      world.createCollider(RAPIER.ColliderDesc.cuboid(2, 2, .02).setCollisionGroups(GROUPS.prop), body);
      world.step();
      const events = [], blasts = [], p = new Projectiles();
      const sim = { world, cars: new Map(), emit: e => events.push(e), blast: (...args) => blasts.push(args) };
      p.addRocket(new THREE.Vector3(0, 5, 0), new THREE.Vector3(0, 0, 1), { ...WEAPONS.rpg.rocket, direct: WEAPONS.rpg.dmg }, 1);
      let elapsed = 0;
      while (p.rockets.length && elapsed < 2) { p.update(dt, sim); elapsed += dt; }
      assert.equal(p.rockets.length, 0); assert.ok(elapsed < .8, `100m took ${elapsed}s at dt=${dt}`);
      assert.equal(events.length, 1); assert.equal(events[0].t, 'boom');
      assert.ok(Math.abs(events[0].pos[2] - 99.98) < .002, 'swept segment hits the thin front face');
      assert.equal(blasts.length, 1); assert.equal(blasts[0][1], WEAPONS.rpg.rocket.blast);
      assert.equal(blasts[0][2], WEAPONS.rpg.rocket.blastDmg);
    } finally { world.free(); }
  }
});

test('player launch tuning leaves unspecified enemy and boss launch speeds unchanged', () => {
  const p = new Projectiles(), origin = new THREE.Vector3(), dir = new THREE.Vector3(1, 0, 0);
  p.addRocket(origin, dir, WEAPONS.rpg.rocket, 1);
  p.addRocket(origin, dir, { speed: 58 }, 2);
  p.addRocket(origin, dir, { speed: 150 }, 99);
  assert.equal(p.rockets[0].vx, 90); assert.equal(p.rockets[0].speed, 180);
  assert.equal(p.rockets[1].vx, 25); assert.equal(p.rockets[2].vx, 25);
});
