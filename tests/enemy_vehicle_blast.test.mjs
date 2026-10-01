import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, DT } from '../src/sim/sim.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { BOSS_ID } from '../src/data/boss.js';

async function withSim(check) {
  const sim = await new Sim({ seed: 7 }).init();
  try {
    sim.director.enabled = false;
    sim.director.r = () => 0.2;
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    // Rapier computes the body's configured mass on its first world step.
    // Without this, an impulse assertion could pass against a zero-mass body.
    sim.world.step(sim.eventQueue); player.veh.afterStep();
    assert.ok(player.veh.body.mass() > 0);
    sim.start(); sim.drainEvents();
    await check(sim, player);
  } finally { sim.dispose(); }
}

function place(car, point) {
  car.veh.body.setTranslation(point, true);
  car.veh.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  car.veh.afterStep();
}

function playerState(sim, player) {
  return {
    hp: player.hp, hitFlash: player.hitFlash, damageTaken: sim.stats.damageTaken,
    crew: Object.fromEntries(Object.entries(player.crew).map(([role, c]) => [role, { hp: c.hp, alive: c.alive }])),
    linear: { ...player.veh.body.linvel() }, angular: { ...player.veh.body.angvel() },
  };
}

test('enemy sedan, tanker and elite detonation protect hull, both crew and impulse at zero, touching and nearby distances', async () => {
  for (const [specId, gap, elite, cause] of [
    ['e_sedan', 0, false, 'fuel'], ['e_sedan', 1.7, false, 'fire'],
    ['e_sedan', 7, false, 'bullet'], ['e_tanker', 2, false, 'fuel'],
    ['e_tanker', 20, false, 'rocket'], ['e_sedan', 1.7, true, 'ram'],
  ]) await withSim((sim, player) => {
    const enemy = sim.spawnCar(specId, { s: 40 });
    place(enemy, player.veh.pos.clone().addScaledVector(player.veh.left, gap));
    if (elite) enemy.elite = { index: 0 };
    const before = playerState(sim, player);
    sim.explodeCar(enemy, cause, -1);
    assert.ok(enemy.exploded, `${specId} must actually detonate`);
    assert.deepEqual(playerState(sim, player), before, `${specId} at ${gap} m changed player state`);
    assert.ok(!sim.events.some(e => e.id === player.id && ['crewHit', 'crewDead'].includes(e.t)));
  });
});

test('player-credited enemy explosion chains still wreck neighbors and award kills without hidden player damage', async () => {
  await withSim((sim, player) => {
    const source = sim.spawnCar('e_sedan', { s: 40 });
    const neighbors = [sim.spawnCar('e_buggy', { s: 40 }), sim.spawnCar('e_buggy', { s: 40 })];
    place(source, player.veh.pos.clone().addScaledVector(player.veh.left, 3));
    neighbors.forEach((car, i) => place(car, source.veh.pos.clone().addScaledVector(player.veh.fwd, i ? -2 : 2)));
    source.lastHitBy = 1; source.lastHitT = sim.time;
    const before = playerState(sim, player);
    sim.explodeCar(source, 'bullet', 1);
    assert.ok(neighbors.every(car => car.exploded), 'radial damage must retain enemy chain explosions');
    assert.equal(sim.stats.kills, 3);
    assert.equal(sim.events.filter(e => e.t === 'kill').length, 3);
    assert.deepEqual(playerState(sim, player), before, 'salvage repair must not conceal player damage');
  });
});

test('delayed neighbor cook-off retains its fuse and player kill credit without radial player damage', async () => {
  await withSim((sim, player) => {
    const source = sim.spawnCar('e_sedan', { s: 40 });
    const neighbor = sim.spawnCar('e_sedan', { s: 40, spec: { ...VEHICLES.e_sedan, hp: 1000, driverHp: 1000, gunnerHp: 1000 } });
    place(source, player.veh.pos.clone().addScaledVector(player.veh.left, 3));
    place(neighbor, source.veh.pos.clone().addScaledVector(player.veh.fwd, 4));
    source.lastHitBy = 1; source.lastHitT = sim.time;
    const before = playerState(sim, player);
    sim.explodeCar(source, 'bullet', 1);
    assert.ok(!neighbor.exploded && neighbor.hp < neighbor.maxHp, 'neighbor must survive initial radial damage');
    assert.ok(neighbor.fuseT > 0);
    assert.equal(neighbor.chainFrom, source.id);
    assert.equal(neighbor.lastHitBy, 1);
    sim._burning(neighbor.fuseT + 0.01);
    assert.ok(neighbor.exploded, 'the delayed fuse must still detonate');
    assert.equal(sim.stats.kills, 2);
    assert.deepEqual(playerState(sim, player), before);
  });
});

test('enemy RPG and grenade blasts still damage truck and crew, even when their owner is already a wreck', async () => {
  for (const weapon of ['rpg', 'grenade']) await withSim((sim, player) => {
    const enemy = sim.spawnCar('e_sedan', { s: 40 });
    place(enemy, player.veh.pos.clone().addScaledVector(player.veh.left, 6));
    sim.explodeCar(enemy, 'bullet', -1);
    const before = playerState(sim, player);
    if (weapon === 'rpg') sim.projectiles._explode(sim, player.veh.pos.clone(), 8, 30, enemy.id, player, 5);
    else {
      sim.projectiles.addGrenade(sim, player.veh.pos.clone(), { x: 0, y: 0, z: 0 }, { fuse: 0, blast: 8, dmg: 30 }, enemy.id);
      sim.projectiles.update(DT, sim);
    }
    assert.ok(player.hp < before.hp, weapon + ' must retain hull damage');
    for (const [role, c] of Object.entries(player.crew)) assert.ok(c.hp < before.crew[role].hp, weapon + ' must retain ' + role + ' damage');
    assert.ok(sim.stats.damageTaken > 0);
    assert.ok(player.veh.body.linvel().y > before.linear.y, weapon + ' must retain blast impulse');
  });
});

test('enemy bullets still damage crew after the firing car is destroyed', async () => {
  await withSim((sim, player) => {
    const enemy = sim.spawnCar('e_sedan', { s: 40 });
    place(enemy, player.veh.pos.clone().addScaledVector(player.veh.left, 6));
    sim.explodeCar(enemy, 'bullet', -1);
    const before = player.crew.driver.hp;
    const zone = player.zones.find(z => z.kind === 'driver');
    const target = player.veh.pos.clone().set(...zone.c);
    target.y -= player.veh.restComHeight;
    target.applyQuaternion(player.veh.quat).add(player.veh.pos);
    const origin = target.clone().addScaledVector(player.veh.left, 5);
    sim.projectiles.addBullet(origin, player.veh.left.clone().negate(), 200, 10, enemy.id);
    sim.projectiles.update(0.05, sim);
    assert.ok(player.crew.driver.hp < before);
    assert.ok(sim.events.some(e => e.t === 'hit' && e.carId === player.id && e.enemy));
  });
});

test('an existing enemy mine remains dangerous after its owner detonates', async () => {
  await withSim((sim, player) => {
    const enemy = sim.spawnCar('e_sedan', { s: 40 });
    place(enemy, player.veh.pos.clone().addScaledVector(player.veh.left, 6));
    sim.hazards.enemyMines.push({ pos: player.veh.pos.clone(), arm: 0, blast: 8, dmg: 30, owner: enemy.id, life: 20 });
    sim.explodeCar(enemy, 'fuel', -1);
    const before = playerState(sim, player);
    sim.tick = 1; // No unrelated road-feature streaming in this blast control.
    sim.hazards.update(0, sim);
    assert.equal(sim.hazards.enemyMines.length, 0);
    assert.ok(player.hp < before.hp);
    for (const [role, c] of Object.entries(player.crew)) assert.ok(c.hp < before.crew[role].hp);
  });
});

test('boss-owned blasts retain hull, crew and impulse damage; player weapon friendly fire stays disabled', async () => {
  await withSim((sim, player) => {
    const before = playerState(sim, player);
    sim.blast(player.veh.pos.clone(), 30, 30, 1.5, null, 1);
    assert.deepEqual(playerState(sim, player), before);
    sim.blast(player.veh.pos.clone(), 30, 30, 1.5, null, BOSS_ID);
    assert.ok(player.hp < before.hp);
    for (const [role, c] of Object.entries(player.crew)) assert.ok(c.hp < before.crew[role].hp);
    assert.ok(player.veh.body.linvel().y > before.linear.y);
  });
});

test('real Rapier contact still damages the player from living enemies, wrecks and boss blockade wrecks', async () => {
  for (const kind of ['living', 'wreck', 'boss-wreck']) await withSim((sim, player) => {
    const enemy = sim.spawnCar('e_muscle', { s: 40, spec: { ...VEHICLES.e_muscle, hp: 10000 } });
    place(enemy, player.veh.pos.clone().addScaledVector(player.veh.fwd, 6));
    if (kind !== 'living') { enemy.exploded = enemy.dead = true; enemy.hp = 0; }
    if (kind === 'boss-wreck') enemy.bossProp = true;
    const velocity = player.veh.fwd.clone().multiplyScalar(-30);
    enemy.veh.body.setLinvel(velocity, true);
    const before = player.hp;
    for (let i = 0; i < 60 && player.hp === before; i++) {
      sim.world.step(sim.eventQueue);
      for (const car of sim.cars.values()) car.veh.afterStep();
      sim._contacts(DT);
    }
    assert.ok(player.hp < before, kind + ' must retain physical contact damage');
    assert.ok(sim.stats.damageBy.ram > 0, kind + ' damage must come from contact, not radial blast');
    assert.ok(sim.events.some(e => e.t === 'crash' && e.id === player.id && e.other === enemy.id));
  });
});
