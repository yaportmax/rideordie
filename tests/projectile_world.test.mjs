import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sim, DT } from '../src/sim/sim.js';
import { SyncGround } from '../src/sim/sync_ground.js';
import { RAPIER, GROUPS, RAY_SHOT } from '../src/sim/physics.js';
import { rng } from '../src/core/util.js';

test('TOI-only projectile queries preserve real world impacts, damage, whizzes and rocket blasts', async () => {
  const originalRandom = Math.random;
  const worlds = [];
  const create = async (reference) => {
    const random = rng(8871); Math.random = random;
    const sim = await new Sim({ seed: 11 }).init(); worlds.push(sim);
    const ground = new SyncGround(sim); ground.update(45000); sim.setGround(ground);
    const p = sim.spawnCar('truck_t1', { kind: 'player', s: 45000, speed: 15 });
    p.hp = p.maxHp = p.engineHp = p.fuelHp = 1e9;
    for (const crew of Object.values(p.crew)) crew.hp = crew.max = 1e9;
    sim.director.enabled = false;
    // A prop between the firing lane and the truck must mask damage, while CAR
    // collision-group shapes remain excluded from the world query.
    const sm = sim.road.sample(45000, {});
    const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(sm.x + sm.nx * 3, sm.y + 2, sm.z));
    const prop = sim.world.createCollider(RAPIER.ColliderDesc.cuboid(.8, 2, 6).setCollisionGroups(GROUPS.prop), body);
    const rec = { sim, p, random, propHits: 0 };
    // Independent Rapier API supplies the former collision oracle with the
    // exact filter, solid and segment length chosen by projectile logic.
    const query = (reference ? sim.world.castRayAndGetNormal : sim.world.castRay).bind(sim.world);
    sim.world.castRay = (...args) => {
      const hit = query(...args);
      if (hit?.collider.handle === prop.handle) rec.propHits++;
      return hit;
    };
    sim.start(); sim.drainEvents();
    return rec;
  };
  const state = ({ sim }) => ({
    time: sim.time, stats: sim.stats, bullets: sim.projectiles.bullets, rockets: sim.projectiles.rockets,
    cars: [...sim.cars.values()].map(c => ({ hp: c.hp, crew: c.crew, engineHp: c.engineHp, fuelHp: c.fuelHp,
      tires: c.tireHp, pos: c.veh.pos.toArray(), rot: c.veh.quat.toArray(), vel: c.veh.vel.toArray(),
      s: c.s, d: c.d, exploded: c.exploded, wheels: c.veh.wheels })),
  });
  const o = new THREE.Vector3(), d = new THREE.Vector3(), totals = { hit: 0, world: 0, whizz: 0, boom: 0 };
  try {
    const a = await create(false), b = await create(true);
    for (let tick = 0; tick < 600; tick++) {
      const advance = (rec) => {
        const { sim, p } = rec; Math.random = rec.random;
        p.veh.setInput({ throttle: .45, steer: Math.sin(tick / 100) * .1 });
        p.crew.gunner.crouch = tick % 120 > 60;
        p.crew.gunner.x = Math.sin(tick / 90) * .5;
        if (tick % 8 === 0) {
          for (let i = 0; i < 8; i++) {
            o.copy(p.veh.pos).addScaledVector(p.veh.fwd, -12).addScaledVector(p.veh.left, i - 4);
            o.y += i % 3;
            d.copy(p.veh.pos).addScaledVector(p.veh.left, i % 2 ? 1.7 : 0).sub(o).normalize();
            sim.projectiles.addBullet(o, d, 215, 2, 2);
          }
          // A close parallel miss guarantees the whizz branch gets coverage.
          o.copy(p.veh.pos).addScaledVector(p.veh.fwd, -4).addScaledVector(p.veh.up, 2.9);
          d.copy(p.veh.fwd); sim.projectiles.addBullet(o, d, 215, 2, 2);
        }
        if (tick % 40 === 0) {
          o.copy(p.veh.pos).addScaledVector(p.veh.left, 8); o.y += 2;
          d.copy(p.veh.up).negate();
          sim.projectiles.addRocket(o, d, { speed: 58, blast: 8, blastDmg: 4, direct: 2 }, 2);
        }
        sim.step(DT);
        return sim.drainEvents();
      };
      const events = advance(a), referenceEvents = advance(b);
      assert.deepEqual(events, referenceEvents, 'events tick ' + tick);
      for (const e of events) {
        if (e.t === 'hit') { if (e.carId === 1) totals.hit++; else totals.world++; }
        if (e.t === 'whizz') totals.whizz++;
        if (e.t === 'boom') totals.boom++;
      }
      if (tick % 60 === 0) assert.deepEqual(state(a), state(b), 'state tick ' + tick);
    }
    assert.deepEqual(state(a), state(b));
    assert.ok(a.propHits > 0, 'props must mask projectile damage');
    assert.equal(a.propHits, b.propHits);
    for (const [kind, count] of Object.entries(totals)) assert.ok(count > 0, kind + ' must be exercised');
  } finally {
    for (const sim of worlds) sim.dispose();
    Math.random = originalRandom;
  }
});

test('real Rapier TOI queries agree at segment boundaries, inside props and with shot filters', async () => {
  const sim = await new Sim({ seed: 77 }).init();
  try {
    const ground = new SyncGround(sim); ground.update(45000); sim.setGround(ground);
    const sm = sim.road.sample(45000, {});
    for (const [x, group] of [[0, GROUPS.prop], [4, GROUPS.car]]) {
      const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(sm.x + x, sm.y + 4, sm.z));
      sim.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 1).setCollisionGroups(group), body);
    }
    sim.world.step();
    const random = rng(43017);
    let hits = 0, misses = 0;
    for (let i = 0; i < 2000; i++) {
      const origin = i < 10 ? { x: sm.x, y: sm.y + 4, z: sm.z } : { x: sm.x + random.range(-100, 100), y: sm.y + random.range(-2, 20), z: sm.z + random.range(-150, 150) };
      const dir = i % 2 ? { x: 0, y: -1, z: 0 } : { x: random.range(-1, 1), y: random.range(-1, 1), z: random.range(-1, 1) };
      const n = Math.hypot(dir.x, dir.y, dir.z); dir.x /= n; dir.y /= n; dir.z /= n;
      const ray = new RAPIER.Ray(origin, dir), max = [0, 1e-8, 1, 2, 25, 500][i % 6], solid = i % 3 !== 0;
      const a = sim.world.castRay(ray, max, solid, undefined, RAY_SHOT), b = sim.world.castRayAndGetNormal(ray, max, solid, undefined, RAY_SHOT);
      assert.equal(a?.timeOfImpact, b?.timeOfImpact, 'TOI ' + i);
      assert.equal(a?.collider.handle, b?.collider.handle, 'collider ' + i);
      if (a) hits++; else misses++;
    }
    assert.ok(hits > 100 && misses > 100, 'both real impacts and misses must be exercised');
  } finally { sim.dispose(); }
});
