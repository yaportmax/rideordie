import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Sim, DT } from '../src/sim/sim.js';
import { Director, levelAt } from '../src/sim/director.js';
import { MINIBOSSES } from '../src/data/boss.js';
import { SET_PIECES } from '../src/data/enemies.js';
import { rng } from '../src/core/util.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { GhostCar } from '../src/sim/car.js';
import { makeCarState } from '../src/view/car_state.js';
import { planRamTakedown, launchRamTakedown } from '../src/sim/ram_takedown.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';

async function withSim(check, Constructor = Sim) {
  const sim = await new Constructor({ seed: 7 }).init();
  try {
    sim.world.gravity = { x: 0, y: 0, z: 0 };
    sim.director.enabled = false; sim.director.r = () => .2;
    sim.hazards.update = () => {};
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    const target = sim.spawnCar('e_sedan', { s: 60 });
    sim.world.step(sim.eventQueue);
    for (const car of sim.cars.values()) car.veh.afterStep();
    assert.ok(player.veh.body.mass() > 0 && target.veh.body.mass() > 0);
    sim.start(); sim.drainEvents();
    await check(sim, player, target);
  } finally { sim.dispose(); }
}
function place(car, { x = 0, y = 3, z = 0, yaw = 0, vx = 0, vz = 0 } = {}) {
  car.veh.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
  car.veh.body.setTranslation({ x, y, z }, true);
  car.veh.body.setLinvel({ x: vx, y: 0, z: vz }, true);
  car.veh.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  car.veh.afterStep(); car.veh.prevQuat.copy(car.veh.quat);
  car.veh.vf = car.veh.vel.dot(car.veh.fwd); car.veh.vl = car.veh.vel.dot(car.veh.left);
  car.veh.preImpactVx = car.veh.vel.x; car.veh.preImpactVz = car.veh.vel.z;
}
function collision(sim, player, target, { driverSpeed = 30, enemySpeed = 8, enemyX = 0, enemyZ = 10, driverXSpeed = 0, hp = 10 } = {}) {
  place(player, { vz: driverSpeed, vx: driverXSpeed });
  place(target, { z: enemyZ, x: enemyX, vz: enemySpeed });
  target.hp = hp;
  for (let i = 0; i < 240 && !target.exploded; i++) sim.step(DT);
  return sim.events.find(e => e.t === 'explode' && e.id === target.id);
}

test('actual forward Rapier hull contact kills once and launches along the driver heading', async () => {
  await withSim((sim, player, target) => {
    const explosion = collision(sim, player, target);
    assert.ok(explosion, 'the production contact/damage/death pipeline must kill the enemy');
    assert.equal(explosion.cause, 'ram'); assert.equal(explosion.src, 1); assert.equal(explosion.takedown, true);
    assert.ok(explosion.vel[2] > player.veh.vf + 10, JSON.stringify({ vel: explosion.vel, driverVF: player.veh.vf }));
    assert.ok(explosion.vel[1] >= 4.5 && explosion.vel[1] <= 10);
    assert.ok(Math.abs(explosion.vel[0]) <= 5);
    assert.deepEqual(explosion.vel, target.veh.vel.toArray(), 'same-step FX/debris inherit the launched chassis velocity');
    assert.ok(target.veh.angvel.length() <= 3.5 + 1e-6);
    const kill = sim.events.filter(e => e.t === 'kill' && e.id === target.id);
    assert.equal(kill.length, 1); assert.equal(kill[0].crash, true);
    assert.equal(sim.stats.kills, 1); assert.equal(sim.stats.streak, 1);
    const before = { hp: player.hp, velocity: player.veh.vel.clone(), crew: Object.values(player.crew).map(c => c.hp) };
    sim.explodeCar(target, 'ram', 1); sim.damageCar(target, 10000, { cause: 'ram', src: 1 });
    assert.equal(sim.events.filter(e => e.t === 'explode' && e.id === target.id).length, 1);
    assert.equal(sim.events.filter(e => e.t === 'kill' && e.id === target.id).length, 1);
    assert.equal(sim.stats.kills, 1); assert.equal(player.hp, before.hp);
    assert.deepEqual(player.veh.vel, before.velocity); assert.deepEqual(Object.values(player.crew).map(c => c.hp), before.crew);
    const buffer = new SnapshotBuffer();
    assert.equal(buffer.push(decodeSnapshot(encodeSnapshot(sim, sim.tick, {})), sim.time), true);
    buffer.sample(sim.time);
    const remote = buffer.states.get(target.id);
    assert.ok(remote.exploded); assert.ok(remote.vel.z > 40, 'the ordinary authoritative snapshot carries the launch, with no client-side impulse');
  });
});

test('moving side swipes use real closing contact and launch forward rather than sideways', async () => {
  await withSim((sim, player, target) => {
    const explosion = collision(sim, player, target, { enemyX: 3.7, enemyZ: 1.2, enemySpeed: 30, driverXSpeed: 10 });
    assert.equal(explosion?.takedown, true);
    assert.ok(explosion.vel[2] > 40); assert.ok(Math.abs(explosion.vel[0]) <= 5);
  });
});

test('rotated driver takedowns launch along the actual heading, not world +Z or the road', async () => {
  for (const yaw of [.7, -Math.PI / 2, Math.PI - .3]) await withSim((sim, player, target) => {
    const x = Math.sin(yaw), z = Math.cos(yaw);
    place(player, { yaw, vx: x * 35, vz: z * 35 });
    place(target, { yaw: yaw + .13, x: x * 10, z: z * 10, vx: x * 8, vz: z * 8 });
    target.hp = 10;
    for (let i = 0; i < 240 && !target.exploded; i++) sim.step(DT);
    const e = sim.events.find(e => e.t === 'explode' && e.id === target.id);
    assert.equal(e?.takedown, true, 'yaw ' + yaw);
    const forward = e.vel[0] * x + e.vel[2] * z, lateral = e.vel[0] * z - e.vel[2] * x;
    assert.ok(forward > 40); assert.ok(Math.abs(lateral) < 6);
  });
});

test('tankers, heavy enemies and elites use the same real-contact launch without giant explosive lift', async () => {
  for (const [specId, elite] of [['e_tanker', false], ['e_heavy', false], ['e_muscle', true]]) await withSim((sim, player, original) => {
    sim.removeCar(original);
    const target = sim.spawnCar(specId, { s: 70 });
    if (elite) target.elite = { index: 0 };
    sim.world.step(sim.eventQueue); target.veh.afterStep();
    const e = collision(sim, player, target, { driverSpeed: 45, enemySpeed: 2, enemyZ: 10, hp: 10 });
    assert.equal(e?.takedown, true, specId);
    assert.ok(e.vel[2] > player.veh.vf + 9 && e.vel[2] <= 75);
    assert.ok(e.vel[1] <= 10, 'tanker explosive multiplier must not exaggerate this launch');
    assert.ok(!sim.stats.damageBy?.blast);
  });
});

test('rear rams, parked truck hits, reversing and nonlethal contact do not become directional takedowns', async () => {
  for (const options of [
    { driverSpeed: 28, enemySpeed: 48, enemyZ: -10 },
    { driverSpeed: 0, enemySpeed: -30, enemyZ: 10 },
    { driverSpeed: -20, enemySpeed: 0, enemyZ: -10 },
    { driverSpeed: 30, enemySpeed: 8, hp: 1e6 },
  ]) await withSim((sim, player, target) => {
    const explosion = collision(sim, player, target, options);
    assert.ok(!explosion?.takedown, JSON.stringify(options));
    if (options.hp) assert.equal(target.exploded, false); else assert.ok(explosion, 'negative launch control must still register actual collision death');
  });
});

test('generic ram label and weapon deaths never receive a contact takedown', async () => {
  const record = async (Constructor, cause) => {
    let result;
    await withSim((sim, player, target) => {
      place(player, { vz: 35 }); place(target, { z: 5, vz: 10 });
      target.lastHitBy = 1; target.lastHitT = sim.time;
      const random = Math.random; Math.random = () => .3;
      try { sim.damageCar(target, 10000, { cause, src: 1 }); } finally { Math.random = random; }
      result = structuredClone({ linear: target.veh.body.linvel(), angular: target.veh.body.angvel(), events: sim.events, stats: sim.stats });
      assert.ok(!sim.events.find(e => e.t === 'explode' && e.id === target.id).takedown);
    }, Constructor);
    return result;
  };
  for (const cause of ['ram', 'bullet', 'blast', 'crash']) {
    const result = await record(Sim, cause);
    assert.equal(result.stats.kills, 1);
    assert.equal(result.stats.streak, 1);
    assert.equal(result.events.filter(e => e.t === 'kill').length, 1);
    assert.ok(Object.values(result.linear).every(Number.isFinite));
  }
});

test('all mass classes and truck tiers get finite bounded forward speed and mild tumble', async () => {
  for (const truck of ['truck_t1', 'truck_t4']) for (const specId of ['e_buggy', 'e_sedan', 'e_muscle', 'e_van', 'e_heavy', 'e_tanker']) {
    await withSim((sim, player, original) => {
      sim.removeCar(original); sim.removeCar(player);
      player = sim.spawnCar(truck, { kind: 'player', s: 40 });
      const target = sim.spawnCar(specId, { s: 70 });
      sim.world.step(sim.eventQueue); player.veh.afterStep(); target.veh.afterStep();
      place(player, { vz: 100 }); place(target, { z: 5, vx: 100, vz: -100 }); target.hp = 1;
      const plan = planRamTakedown(sim, target, player, 1, 1000);
      assert.ok(plan); assert.equal(plan.forward, 75);
      assert.equal(launchRamTakedown(target, plan), true);
      const v = target.veh.vel;
      assert.ok(v.toArray().every(Number.isFinite)); assert.ok(v.z <= 75.0001 && v.z >= 22);
      assert.ok(Math.abs(v.x) <= 5.0001 && v.y <= 10);
      assert.ok(target.veh.angvel.length() <= 3.50001);
    });
  }
});

test('a lethal ram preserves enemy chain credit and never adds radial player damage or shove', async () => {
  await withSim((sim, player, target) => {
    const neighbor = sim.spawnCar('e_buggy', { s: 90 });
    sim.world.step(sim.eventQueue); neighbor.veh.afterStep();
    place(player, { vz: 30 }); place(target, { z: 10, vz: 8 }); place(neighbor, { x: 4, z: 9, vz: 8 });
    target.hp = 10; neighbor.hp = 10;
    for (let i = 0; i < 240 && !target.exploded; i++) sim.step(DT);
    assert.equal(sim.events.find(e => e.t === 'explode' && e.id === target.id)?.takedown, true);
    assert.ok(neighbor.exploded); assert.equal(sim.stats.kills, 2);
    assert.equal(sim.events.filter(e => e.t === 'kill').length, 2);
    assert.ok(!sim.events.find(e => e.t === 'explode' && e.id === neighbor.id).takedown);
    assert.ok(!sim.stats.damageBy?.blast, 'truck damage still comes from actual contact');
    assert.ok(!sim.events.some(e => e.t === 'crewHit' && e.id === 1), 'enemy cook-off keeps crew immunity');
  });
});

test('launching does not extend wreck cleanup lifetime or allocate additional bodies', async () => {
  await withSim((sim, player, target) => {
    const beforeBodies = sim.world.bodies.len();
    assert.equal(collision(sim, player, target)?.takedown, true);
    assert.equal(sim.world.bodies.len(), beforeBodies);
    target.wreckT = 15; target.s = player.s - 31;
    sim.director._cleanup(sim, player);
    assert.equal(sim.cars.has(target.id), false);
    assert.equal(sim.world.bodies.len(), beforeBodies - 1);
    assert.ok(![...sim.colMap.values()].includes(target));
  });
});

test('actual Scrapjaw spawn retains HP and one MG crew on the larger matching chassis', async () => {
  await withSim((sim, player, target) => {
    sim.removeCar(target);
    const M = MINIBOSSES[0], L = 0.3;
    sim.director.spawnElite(sim, 0, M, L);
    const boss = sim.director.activeElite?.cars[0];
    assert.ok(boss, 'the ordinary director must spawn the authored boss');
    assert.equal(boss.spec.id, 'e_heavy');
    assert.ok(boss.spec.length > VEHICLES.e_technical.length * 1.5);
    assert.ok(boss.spec.width > VEHICLES.e_technical.width * 1.3);
    assert.equal(boss.hp, Math.round(150 * (1 + 1.9 * L) * 5.5));
    assert.equal(boss.maxHp, boss.hp);
    assert.deepEqual(Object.keys(boss.crew), ['driver', 'gunner']);
    assert.equal(boss.crew.driver.max, Math.round(Math.round(45 * (1 + 0.7 * L)) * 6));
    assert.equal(boss.crew.gunner.max, Math.round(Math.round(50 * (1 + 0.7 * L)) * 2.5));
    assert.equal(boss.veh.wheels.length, 6);
    assert.equal(boss.veh.colliders.length, VEHICLES.e_heavy.colliders.length);
    assert.equal(boss.spec.mass, VEHICLES.e_heavy.mass);
    assert.equal(boss.gunName, 'hmg');
    assert.deepEqual(boss.ai.gunRoles, ['gunner']);
    assert.equal(boss.zoneMul.fuel, 5);
    assert.equal(boss.ai.pattern.summon, 24);
    sim.world.step(sim.eventQueue); boss.veh.afterStep();
    const state = makeCarState(boss.id, boss.spec.id, boss.kind);
    state.pos.copy(boss.veh.pos); state.quat.copy(boss.veh.quat);
    state.gunner2Alive = false;
    const ghost = new GhostCar(state);
    ghost.sync(state);
    const fuel = boss.zones.find(z => z.kind === 'fuel');
    assert.deepEqual(ghost.zones.find(z => z.kind === 'fuel'), fuel);
    assert.deepEqual(fuel.c, [0, 1, boss.spec.model.bbox.min[2] + 0.3]);
    assert.deepEqual(boss.weakPoint.c, fuel.c);
    const aim = new Vector3(...fuel.c);
    aim.y -= boss.veh.restComHeight;
    aim.applyQuaternion(boss.veh.quat).add(boss.veh.pos);
    const dir = new Vector3(0, 0, 1).applyQuaternion(boss.veh.quat);
    const rearOrigin = aim.clone().addScaledVector(dir, -8);
    assert.equal(boss.raycast(rearOrigin, dir, 20)?.zone.kind, 'fuel');
    assert.equal(ghost.raycast(rearOrigin, dir, 20)?.zone.kind, 'fuel');
    // No phantom body zone for the heavy chassis' unused second gunner seat.
    const rearSeat = boss.spec.seats.gunner2;
    const emptyOrigin = new Vector3(rearSeat[0], rearSeat[1] + 1 - boss.veh.restComHeight, -9)
      .applyQuaternion(boss.veh.quat).add(boss.veh.pos);
    const actualEmpty = boss.raycast(emptyOrigin, dir, 20);
    const ghostEmpty = ghost.raycast(emptyOrigin, dir, 20);
    assert.notEqual(actualEmpty?.zone.role, 'gunner2');
    assert.equal(actualEmpty?.zone.kind, ghostEmpty?.zone.kind);
    const before = boss.hp;
    sim.damageZone(boss, { kind: 'fuel' }, 10, { cause: 'bullet', src: 1 });
    assert.ok(boss.hp < before, 'the actual rear weak zone must accept damage');
  });
});

test('reinforcements fill only one leftover slot and obey affordability, disabled keys and backoff', () => {
  const d = new Director(); d.r = () => 0.5; d.simTime = 50; d.encounters = 1; d.budget = 10;
  assert.equal(d._pickEncounter(0.6, 0, true), null);
  const pick = d._pickEncounter(0.6, 1, false);
  assert.equal(pick?.key, 'fill_rammer');
  assert.equal(pick.cost, 1.6 * 0.85);
  d.budget = 0;
  assert.equal(d._pickEncounter(0.6, 1, false), null);
  d.budget = 10; d.disabled.add('fill_rammer');
  assert.equal(d._pickEncounter(0.6, 1, false), null);
  d.disabled.clear(); d.failT = { fill_rammer: 51 };
  assert.equal(d._pickEncounter(0.6, 1, false), null);
  d.simTime = 51;
  assert.equal(d._pickEncounter(0.6, 1, false)?.key, 'fill_rammer');
  d.encounters = 0;
  assert.equal(d._pickEncounter(0.6, 1, true), null, 'first encounter remains the full opening ambush');
});

test('the actual director never fills a full cap and consumes only the final normal slot', async () => {
  await withSim((sim, player, target) => {
    sim.time = 50; player.s = 35000;
    const L = levelAt(player.s, sim.time), cap = Math.round(3 + 6.8 * Math.pow(L, 0.8));
    target.s = player.s;
    for (let i = 1; i < cap; i++) sim.spawnCar('e_sedan', { s: player.s, d: 0 });
    const d = sim.director = new Director();
    d.r = rng(19); d.playerVmax = player.spec.engine.vmax;
    d.setDone = new Set(SET_PIECES.map(s => s.key));
    d.budget = 14; d.cooldown = 0; d.encounters = 1; d.lastEngaged = sim.time;
    const before = sim.cars.size;
    d.update(DT, sim);
    assert.equal(sim.cars.size, before, 'a full cap cannot receive a reinforcement');
    sim.removeCar(target);
    d.update(DT, sim);
    assert.equal(sim.cars.size, before, 'only the freed normal slot is filled');
    assert.equal(d.lastEnc, 'fill_rammer');
    assert.equal(d.spawnQ?.length ?? 0, 0, 'a filler queues no extra bodies');
    assert.ok(d.cooldown > 0, 'ordinary encounter pacing applies');
    assert.ok(d.budget < 14, 'ordinary budget is paid');
    assert.equal([...sim.cars.values()].filter(c => c.kind === 'enemy' && !c.exploded).length, cap);
  });
});

test('dead driver, tilted truck and nonclosing contacts cannot plan a takedown', async () => {
  await withSim((sim, player, target) => {
    place(player, { vz: 30 }); place(target, { z: 5, vz: 40 }); target.hp = 1;
    assert.equal(planRamTakedown(sim, target, player, 1, 3), null);
    target.veh.preImpactVz = 0;
    player.crew.driver.alive = false;
    assert.equal(planRamTakedown(sim, target, player, 1, 3), null);
    player.crew.driver.alive = true; player.veh.up.y = 0.3;
    assert.equal(planRamTakedown(sim, target, player, 1, 3), null);
    player.veh.up.y = 1; sim.state = 'death';
    assert.equal(planRamTakedown(sim, target, player, 1, 3), null);
  });
});

