import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DT } from '../src/sim/sim.js';
import { EnemyBrain } from '../src/sim/ai.js';
import { planRearRamBonk, launchRearRamBonk, updateRearRamContact } from '../src/sim/ram_takedown.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';

async function fixture(check, spec = 'e_sedan') {
  const sim = await new Sim({ seed: 7 }).init();
  try {
    sim.world.gravity = { x: 0, y: 0, z: 0 };
    sim.director.enabled = false; sim.hazards.update = () => {};
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    const enemy = sim.spawnCar(spec, { s: 60 });
    sim.world.step(sim.eventQueue);
    for (const car of sim.cars.values()) {
      car.veh.afterStep(); car.hp = car.maxHp = 1e5;
      if (car.kind === 'enemy') for (const crew of Object.values(car.crew)) crew.hp = crew.max = 1e5;
    }
    sim.start(); sim.drainEvents();
    await check(sim, player, enemy);
  } finally { sim.dispose(); }
}

function place(car, { x = 0, z = 0, yaw = 0, vx = 0, vz = 0 } = {}) {
  const v = car.veh;
  v.body.setTranslation({ x, y: 3, z }, true);
  v.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  v.body.setLinvel({ x: vx, y: 0, z: vz }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  v.afterStep(); v.prevQuat.copy(v.quat); v.prevPos.copy(v.pos);
  v.preImpactVx = vx; v.preImpactVz = vz; v.vf = v.vel.dot(v.fwd);
}

function hit(sim, player, enemy, { speed = 30, enemySpeed = 8, yaw = 0, enemyYaw = yaw, enemyZ = 10, enemyX = 0, vx = 0 } = {}) {
  const x = Math.sin(yaw), z = Math.cos(yaw);
  place(player, { yaw, vx: x * speed + z * vx, vz: z * speed - x * vx });
  place(enemy, { yaw: enemyYaw, x: x * enemyZ + z * enemyX, z: z * enemyZ - x * enemyX, vx: x * enemySpeed, vz: z * enemySpeed });
  for (let i = 0; i < 240; i++) {
    sim.step(DT);
    const event = sim.events.find(e => e.id === enemy.id && e.rearBonk);
    if (event) return event;
  }
  return null;
}

test('actual high-speed nonlethal rear contact visibly launches a living enemy, without kill rewards', async () => {
  await fixture((sim, player, enemy) => {
    enemy.hp = enemy.maxHp = enemy.spec.hp; // ordinary full hull health; crew remains protected by this controlled fixture
    const bodies = sim.world.bodies.len(), hp = enemy.hp;
    const e = hit(sim, player, enemy);
    assert.ok(e, 'ordinary Rapier contact pipeline must emit the bonk');
    assert.equal(e.t, 'crash'); assert.equal(e.other, player.id);
    assert.ok(e.closing > 20 && e.closing < 23);
    assert.ok(e.vel[2] > 40 && e.vel[2] > player.veh.vel.z + 10);
    assert.ok(e.vel[1] >= 1.4 && e.vel[1] <= 6);
    assert.ok(Math.abs(e.vel[0]) < 1);
    assert.ok(enemy.veh.angvel.length() <= 3.5001);
    assert.ok(enemy.hp < hp && enemy.hp > 0, 'normal contact damage survives');
    assert.equal(enemy.exploded, false); assert.equal(enemy.crew.driver.alive, true);
    assert.equal(sim.stats.kills, 0); assert.equal(sim.stats.streak, 0); assert.equal(sim.stats.cash, 0);
    assert.ok(!sim.events.some(e => e.t === 'kill' || e.t === 'explode'));
    assert.equal(sim.world.bodies.len(), bodies); assert.equal(enemy.veh.poseRevision, 0);
    assert.deepEqual(e.vel, enemy.veh.vel.toArray());
    const buffer = new SnapshotBuffer();
    assert.equal(buffer.push(decodeSnapshot(encodeSnapshot(sim, sim.tick, {})), sim.time), true);
    buffer.sample(sim.time);
    const remote = buffer.states.get(enemy.id);
    assert.equal(remote.exploded, false); assert.ok(Math.abs(remote.vel.z - e.vel[2]) < 0.02);
    assert.ok(Math.abs(remote.vel.y - e.vel[1]) < 0.02);
    assert.equal(remote.poseRevision, 0, 'continuous physical launches never become network teleports');
  });
});

test('higher actual closing speed makes a stronger forward launch', async () => {
  const velocities = [], closings = [];
  for (const speed of [26, 45]) await fixture((sim, player, enemy) => {
    const e = hit(sim, player, enemy, { speed }); assert.ok(e);
    velocities.push(e.vel[2]); closings.push(e.closing);
  });
  assert.ok(closings[1] > closings[0] + 15);
  assert.ok(velocities[1] > velocities[0] + 12, JSON.stringify(velocities));
});

test('rotated real rear impacts launch along driver heading instead of world Z', async () => {
  for (const yaw of [0.7, -Math.PI / 2, Math.PI - 0.3]) await fixture((sim, player, enemy) => {
    const e = hit(sim, player, enemy, { yaw, speed: 35 }); assert.ok(e, 'yaw ' + yaw);
    const x = Math.sin(yaw), z = Math.cos(yaw);
    assert.ok(e.vel[0] * x + e.vel[2] * z > 45);
    assert.ok(Math.abs(e.vel[0] * z - e.vel[2] * x) < 2);
  });
});

test('asymmetric heavy and tanker hulls and multi-hull buses get one bounded real rear bonk', async () => {
  for (const spec of ['e_heavy', 'e_tanker', 'e_double_bus']) await fixture((sim, player, enemy) => {
    const e = hit(sim, player, enemy, { speed: 45, enemySpeed: 8, enemyZ: 15 });
    assert.ok(e, spec + ' actual rear contact');
    assert.ok(e.vel.every(Number.isFinite)); assert.ok(e.vel[2] > 35 && e.vel[2] <= 85);
    assert.ok(e.vel[1] >= 1.4 && e.vel[1] <= 6);
    assert.equal(sim.events.filter(e => e.id === enemy.id && e.rearBonk).length, 1);
    assert.equal(sim.stats.kills, 0);
  }, spec);
});

test('slow nudges, head-on hits, side swipes, enemy rear-ending and player reverse stay ordinary actual crashes', async () => {
  for (const options of [
    { speed: 14, enemySpeed: 8 },
    { speed: 30, enemySpeed: -8, enemyYaw: Math.PI },
    { speed: 30, enemySpeed: 30, enemyX: 3.7, enemyZ: 1.2, vx: 10 },
    { speed: 28, enemySpeed: 48, enemyZ: -10 },
    { speed: -20, enemySpeed: 0, enemyZ: -10 },
  ]) await fixture((sim, player, enemy) => {
    assert.equal(hit(sim, player, enemy, options), null, JSON.stringify(options));
    assert.ok(sim.events.some(e => e.t === 'crash' && e.id === enemy.id), 'negative control must really collide: ' + JSON.stringify(options));
    assert.equal(enemy._rearRamLocked, undefined);
  });
});

test('multiple callbacks cannot re-launch; actual separation rearms a later real collision', async () => {
  await fixture((sim, player, enemy) => {
    const first = hit(sim, player, enemy); assert.ok(first);
    const before = enemy.veh.vel.clone(), dir = { x: 0, y: 0, z: 1 };
    // Replay additional hull contact callbacks from the same physical impact.
    for (let i = 0; i < 8; i++) sim._crash(enemy, player, enemy.veh.mass * 5 / DT, dir, DT);
    assert.deepEqual(enemy.veh.vel, before);
    assert.equal(sim.events.filter(e => e.id === enemy.id && e.rearBonk).length, 1);
    assert.equal(enemy._rearRamLocked, true);
    for (let i = 0; i < 80; i++) sim.step(DT);
    assert.equal(enemy._rearRamLocked, false, 'real body separation must rearm');
    sim.drainEvents();
    assert.ok(hit(sim, player, enemy, { speed: 35 }));
    assert.equal(sim.events.filter(e => e.id === enemy.id && e.rearBonk).length, 1, 'separated second real collision gets exactly one fresh launch');
  });
});

test('resting physical hull contact cannot rearm merely because the time cooldown expires', async () => {
  await fixture((sim, player, enemy) => {
    place(player); place(enemy, { z: 4.9 });
    sim.world.step(sim.eventQueue); player.veh.afterStep(); enemy.veh.afterStep();
    enemy._rearRamLocked = true; enemy._rearRamLastLaunch = 0; enemy._rearRamClearSince = null; sim.time = 10;
    updateRearRamContact(sim, enemy);
    assert.equal(enemy._rearRamLocked, true); assert.equal(enemy._rearRamClearSince, null);
    place(enemy, { z: 30 }); sim.world.step(sim.eventQueue); enemy.veh.afterStep();
    updateRearRamContact(sim, enemy); assert.equal(enemy._rearRamLocked, true);
    sim.time += 0.16; updateRearRamContact(sim, enemy); assert.equal(enemy._rearRamLocked, false);
  });
});

test('a bonk is not canceled by stock enemy AI braking immediately after impact', async () => {
  await fixture((sim, player, enemy) => {
    const e = hit(sim, player, enemy, { speed: 35 }); assert.ok(e);
    enemy.ai = new EnemyBrain(enemy, sim, { behavior: 'flanker', skill: 0.6, level: 0.8, guns: {} });
    enemy.ai.atkCd = 99;
    const initial = enemy.veh.vel.z;
    for (let i = 0; i < 24; i++) sim.step(DT);
    assert.ok(enemy.veh.stunned > 0);
    assert.equal(enemy.veh.brakeApplied, 0);
    assert.ok(enemy.veh.vel.z > initial * 0.9, 'stock controller must not immediately erase the physical launch');
    assert.equal(sim.events.filter(e => e.id === enemy.id && e.rearBonk).length, 1);
    for (let i = 0; i < 36; i++) sim.step(DT);
    assert.equal(enemy.veh.stunned, 0);
    assert.ok(enemy.veh.vel.z > initial * 0.8, 'launch remains forward after the stun ends, under stock enemy input');
  });
});

test('a lethal first rear impact keeps one existing takedown and receives no additional living bonk', async () => {
  await fixture((sim, player, enemy) => {
    // Below the minimum damaging-contact amount: the very first qualifying
    // Rapier callback must be fatal, before a surviving-hit launch can occur.
    enemy.maxHp = 1; enemy.hp = 0.5; // 50% health avoids the unrelated low-health fire fuse
    place(player, { vz: 30 }); place(enemy, { z: 10, vz: 8 });
    for (let i = 0; i < 240 && !enemy.exploded; i++) sim.step(DT);
    const explosion = sim.events.find(e => e.t === 'explode' && e.id === enemy.id);
    assert.equal(explosion?.takedown, true);
    assert.equal(sim.events.filter(e => e.t === 'explode' && e.id === enemy.id).length, 1);
    assert.equal(sim.events.filter(e => e.t === 'kill' && e.id === enemy.id).length, 1);
    assert.equal(sim.events.filter(e => e.id === enemy.id && e.rearBonk).length, 0);
    assert.equal(sim.stats.kills, 1); assert.equal(sim.stats.streak, 1);
  });
});

test('held, tilted, terminal and dead-player contacts cannot plan a bonk; stress remains finite', async () => {
  await fixture((sim, player, enemy) => {
    place(player, { vz: 100 }); place(enemy, { z: 6, vz: -100 });
    const dir = { x: 0, y: 0, z: 1 };
    let plan = planRearRamBonk(sim, enemy, player, 1000, dir); assert.ok(plan);
    assert.equal(plan.forward, 85); assert.ok(plan.lift <= 4.2);
    enemy.held = true; assert.equal(planRearRamBonk(sim, enemy, player, 10, dir), null); enemy.held = false;
    enemy.veh.up.y = 0.3; assert.equal(planRearRamBonk(sim, enemy, player, 10, dir), null); enemy.veh.up.y = 1;
    const playerHp = player.hp; player.hp = 0; assert.equal(planRearRamBonk(sim, enemy, player, 10, dir), null); player.hp = playerHp;
    sim.state = 'dying'; assert.equal(planRearRamBonk(sim, enemy, player, 10, dir), null); sim.state = 'run';
    place(enemy, { z: 6 });
    plan = planRearRamBonk(sim, enemy, player, 1000, dir);
    enemy.veh.body.setAngvel({ x: 100, y: 100, z: 100 }, true);
    assert.equal(launchRearRamBonk(enemy, plan, sim.time), true);
    assert.ok(enemy.veh.vel.toArray().every(Number.isFinite)); assert.ok(enemy.veh.vel.z <= 32.0001);
    assert.ok(enemy.veh.angvel.length() <= 3.5001);
  });
});
