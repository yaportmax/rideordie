// SOURCE-ONLY draft. Author has not imported, parsed or executed this file.
// Materialize the two proposed source files in a complete private candidate;
// or set ROD_SHARED_HP_SIM_SOURCE to that complete candidate's actual sim.js.
// Running this same suite against the accepted, unchanged Sim/Car is the
// negative control: hidden crew death / no hull debit must fail assertions.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const simSource = process.env.ROD_SHARED_HP_SIM_SOURCE
  ? pathToFileURL(resolve(process.env.ROD_SHARED_HP_SIM_SOURCE)) : new URL('../src/sim/sim.js', import.meta.url);
const { Sim, DT } = await import(simSource.href);
const { Leviathan } = await import(new URL('./boss.js', simSource).href);
const { BOSS } = await import(new URL('../data/boss.js', simSource).href);
const { weaponStats } = await import(new URL('../data/weapons.js', simSource).href);
const { playerLive } = await import(new URL('./combat.js', simSource).href);
const { makeCarState, stateFromCar } = await import(new URL('../view/car_state.js', simSource).href);
const { buildPlayerSpec } = await import(new URL('../game/run_setup.js', simSource).href);
const { DEFAULT_PROFILE } = await import(new URL('../data/upgrades.js', simSource).href);

const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
async function withSim(check) {
  const sim = await new Sim({ seed: 7 }).init();
  try {
    sim.world.gravity = { x: 0, y: 0, z: 0 }; sim.director.enabled = false;
    sim.encounters.plan = []; sim.encounters.sim = sim; sim.hazards.update = () => {};
    const profile = DEFAULT_PROFILE(); profile.truck = 'truck_t1'; profile.trucks.push('truck_t1');
    const { spec } = buildPlayerSpec(profile);
    assert.equal(spec.id, 'truck_t1'); assert.equal(spec.hp, 400);
    assert.equal(spec.driverHp, 100); assert.equal(spec.gunnerHp, 100);
    const player = sim.spawnCar(spec.id, { kind: 'player', s: 40, spec });
    sim.world.step(sim.eventQueue); for (const car of sim.cars.values()) car.veh.afterStep();
    sim.start(); sim.configureCombat('shared-hull-life', { weapons: ['pistol'], levels: {} }); sim.drainEvents();
    await check(sim, player);
  } finally { sim.dispose(); }
}
function assertPlayable(sim, player) {
  assert.ok(player.hp > 0); assert.equal(player.dead, false); assert.equal(player.exploded, false);
  assert.equal(player.driverless, false); assert.equal(player.veh.driverAlive, true);
  for (const crew of Object.values(player.crew)) {
    assert.equal(crew.alive, true); close(crew.hp, player.hp, 'crew HP mirrors hull'); close(crew.max, player.maxHp, 'crew max mirrors hull');
  }
  sim._runState(DT); assert.equal(sim.state, 'run'); assert.equal(sim.result, null);
  assert.equal(playerLive(sim), true, 'actual combat entitlement remains open while the hull lives');
}
function hitReport(car) {
  const zone = car.zones.find(zone => zone.kind === 'body'), point = new THREE.Vector3().fromArray(zone.c);
  return { carId: car.id, weapon: 'pistol', shotId: 1, pelletIndex: 0, penetrationIndex: 0, dmg: weaponStats('pistol').dmg, tireMul: 1,
    point: point.clone().applyQuaternion(car.veh.quat).add(car.veh.pos).toArray(), localPoint: point.toArray(),
    poseRevision: car.veh.poseRevision || 0, dir: [0,0,1], zone: zone.kind, zoneIndex: -1, through: false };
}

for (const role of ['driver', 'gunner']) test(`actual Sim ${role} hit exceeding old crew HP debits hull and preserves play`, async () => {
  await withSim((sim, player) => {
    const before = player.hp; sim.damageCrew(player, role, 120, { cause: 'bullet', src: 2, point: player.veh.pos.clone() });
    close(player.hp, before - 120, 'one hull debit exceeds actual stock100 crew HP'); close(sim.stats.damageTaken, 120, 'actual hull damage statistic');
    assertPlayable(sim, player);
    assert.equal(sim.events.some(event => event.t === 'crewDead' || event.t === 'playerDown'), false);
    const event = sim.events.find(event => event.t === 'crewHit'); assert.ok(event); assert.equal(event.role, role);
    assert.equal(event.sharedHull, true); close(event.dmg, 120, 'hit feedback amount'); close(event.hp, player.hp, 'hit feedback remaining hull');
    const enemy = sim.spawnCar('e_sedan', { s: 160 }); assert.equal(sim.applyHit(hitReport(enemy)), true, 'actual shot ingress survives former hidden crew kill');
    const state = stateFromCar(player, 1, makeCarState(player.id, player.spec.id, player.kind));
    assert.equal(state.driverAlive, true); assert.equal(state.gunnerAlive, true); close(state.hp01, player.hp / player.maxHp, 'view state hull ratio');
  });
});

test('actual crew zones keep their existing head, lower-body, through-body and crew-armour multipliers on the hull', async () => {
  await withSim((sim, player) => {
    player.armor = .25; player.crew.driver.armor = .1; player.crew.gunner.armor = .2;
    for (const [kind, throughBody, expected] of [
      ['driver', false, 10*.9], ['driver_head', true, 10*2.6*(1-.25*.6)*.9],
      ['gunner', true, 10*.8], ['gunner_head', false, 10*2.6*.8], ['gunner_legs', false, 10*.45*.8],
    ]) {
      const zone = player.zones.find(zone => zone.kind === kind); assert.ok(zone);
      const before = player.hp; sim.damageZone(player, { zone, throughBody }, 10, { cause: 'bullet', src: 2 });
      close(before-player.hp, expected, kind); assertPlayable(sim, player);
    }
  });
});

test('actual Projectiles sweeps a player head zone, lowers hull and preserves flesh/crew-hit feedback', async () => {
  await withSim((sim, player) => {
    const zone = player.zones.find(zone => zone.kind === 'driver_head');
    const center = new THREE.Vector3().fromArray(zone.c); center.y -= player.veh.restComHeight;
    center.applyQuaternion(player.veh.quat).add(player.veh.pos);
    const dir = new THREE.Vector3(1,0,0).applyQuaternion(player.veh.quat), origin = center.clone().addScaledVector(dir, -1);
    const before = player.hp; assert.equal(sim.projectiles.addBullet(origin, dir, 300, 100, 2, 'mg', .05), true);
    sim.projectiles.update(.01, sim);
    const hit = sim.events.find(event => event.t === 'hit'); assert.ok(hit); assert.equal(hit.zone, 'driver_head'); assert.equal(hit.surface, 'flesh');
    close(before-player.hp, 100*2.6, 'real stock-lethal head hit damages hull'); assert.equal(sim.projectiles.bullets.length, 0);
    assert.ok(sim.events.some(event => event.t === 'crewHit' && event.sharedHull && event.head));
    assert.equal(player.hitFlash, .12); assertPlayable(sim, player);
  });
});

test('actual enemy-weapon blast debits player hull once while enemy crew retains independent splash damage', async () => {
  await withSim((sim, player) => {
    const enemy = sim.spawnCar('e_heavy', { s: 41 }), before = player.hp, enemyBefore = enemy.hp;
    const crewBefore = Object.fromEntries(Object.entries(enemy.crew).map(([role, crew]) => [role, crew.hp]));
    sim.blast(player.veh.pos.clone(), 10, 40, 0, null, 2);
    close(before-player.hp, 40*.6, 'player splash charged once'); assertPlayable(sim, player);
    const fraction = 1-Math.max(0, Math.min(1, (enemy.veh.pos.distanceTo(player.veh.pos)-2)/10));
    close(enemyBefore-enemy.hp, 40*fraction, 'enemy hull splash unchanged');
    for (const [role, crew] of Object.entries(enemy.crew)) close(crewBefore[role]-crew.hp, 40*fraction*.5*(1-crew.armor), role+' independent enemy injury');
  });
});

test('actual enemy crew death remains independent and disables an enemy driver with a healthy hull', async () => {
  await withSim((sim) => {
    const enemy = sim.spawnCar('e_sedan', { s: 160 }), before = enemy.hp;
    sim.damageCrew(enemy, 'driver', enemy.crew.driver.hp+1, { cause: 'bullet', src: 1 });
    assert.equal(enemy.hp, before); assert.equal(enemy.exploded, false); assert.equal(enemy.crew.driver.alive, false);
    assert.equal(enemy.veh.driverAlive, false); assert.equal(enemy.driverless, true); assert.equal(sim.stats.crewKills, 1);
    assert.ok(sim.events.some(event => event.t === 'crewDead' && event.id === enemy.id && event.role === 'driver'));
    const gunnerBefore = enemy.crew.gunner.hp; sim.damageCrew(enemy, 'gunner', 1, { cause: 'bullet', src: 1 });
    close(enemy.crew.gunner.hp, gunnerBefore-1, 'enemy gunner still owns its own health'); assert.equal(enemy.hp, before);
  });
});

test('hull health remains authoritative across legacy crew repairs, medkit, max upgrades and zero-damage writes', async () => {
  await withSim((sim, player) => {
    player.hp = 200;
    for (const crew of Object.values(player.crew)) { crew.hp = 0; crew.max = 1; crew.alive = false; }
    player.veh.driverAlive = false; player.driverless = true; assertPlayable(sim, player);
    assert.equal(sim.useMedkit(), true); close(player.hp, 200+player.maxHp*.12, 'medkit heals shared pool once');
    player.hp += player.maxHp*.06; const afterHullRepair = player.hp;
    for (const crew of Object.values(player.crew)) crew.hp = Math.min(crew.max, crew.hp + crew.max*.3);
    close(player.hp, afterHullRepair, 'legacy boss crew repair cannot double-heal hull');
    player.maxHp = 800; for (const crew of Object.values(player.crew)) assert.equal(crew.max, 800);
    sim.drainEvents(); const before = player.hp;
    for (const damage of [0, -5, NaN, Infinity]) sim.damageCrew(player, 'gunner', damage, { cause: 'bullet', src: 2 });
    assert.equal(player.hp, before); assert.equal(sim.events.length, 0);
    player.hp = player.maxHp; assert.equal(sim.useMedkit(), false); assert.equal(sim.events.length, 0);
  });
});

test('actual boss phase and part-salvage repairs apply only their original hull amount', async () => {
  await withSim((sim, player) => {
    player.hp = 100;
    const boss = Object.create(Leviathan.prototype);
    Object.assign(boss, { sim, t: 0, turrets: [], cd: { pods: 0, cannon: 0, ramp: 0 }, dropQ: [],
      hp: { panel_armor_rear_1: 1 }, alive: { panel_armor_rear_1: true }, zones: [], pos: player.veh.pos.clone().add(new THREE.Vector3(0,0,100)) });
    boss._setPhase(3); close(player.hp, 100+player.maxHp*.2, 'actual phase reward hull amount');
    let repair = sim.events.filter(event => event.t === 'repair'); assert.equal(repair.length, 1); close(repair[0].amount, player.maxHp*.2, 'phase repair receipt');
    const before = player.hp; sim.drainEvents(); boss._destroyPart('panel_armor_rear_1');
    close(player.hp, before+player.maxHp*.06, 'actual part salvage hull amount');
    repair = sim.events.filter(event => event.t === 'repair'); assert.equal(repair.length, 1); close(repair[0].amount, player.maxHp*.06, 'part repair receipt');
    assertPlayable(sim, player);
  });
});

test('actual lethal player crew contact destroys hull, emits terminal crew deaths once and defeats as car', async () => {
  await withSim((sim, player) => {
    const before = player.hp; sim.damageCrew(player, 'gunner', before+100, { cause: 'bullet', src: 2 });
    assert.equal(player.hp, 0); assert.equal(player.exploded, true); assert.equal(player.dead, true);
    assert.equal(player.crew.driver.alive, false); assert.equal(player.crew.gunner.alive, false); assert.equal(player.veh.driverAlive, false);
    close(sim.stats.damageTaken, before, 'overkill statistics count consumed hull');
    const deaths = sim.events.filter(event => event.t === 'crewDead' && event.id === player.id);
    assert.deepEqual(deaths.map(event => event.role).sort(), Object.keys(player.crew).sort()); assert.ok(deaths.every(event => event.cause === 'explosion'));
    const terminalCount = sim.events.length; sim.damageCrew(player, 'driver', 100, { cause: 'bullet', src: 2 }); sim.explodeCar(player, 'bullet', 2);
    assert.equal(sim.events.length, terminalCount, 'terminal retries do not emit or charge again');
    sim._runState(DT); assert.equal(sim.state, 'dying'); assert.deepEqual(sim.result, { why: 'car' });
    assert.equal(sim.events.filter(event => event.t === 'playerDown').length, 1);
    sim.stateT = 3.3; sim._runState(DT); assert.equal(sim.state, 'over'); assert.ok(sim.events.some(event => event.t === 'runOver' && event.why === 'car'));
  });
});

// This regression intentionally requires root's adjacent boss.js edit. The
// accepted method adds random crew injuries after already damaging the hull.
// Retain the continuous jet DPS, remove the redundant hidden-crew pulse loop.
test('actual Leviathan flame applies one continuous player hull debit per active jet', { concurrency: false }, async () => {
  await withSim((sim, player) => {
    const boss = Object.create(Leviathan.prototype);
    Object.assign(boss, { sim, id: 60000, quat: new THREE.Quaternion(), alive: { part_tank_L: true, part_tank_R: false }, flameOn: { L: false, R: false } });
    boss.socket = (_name, target) => target.copy(player.veh.pos).add(new THREE.Vector3(-2,0,0));
    const before = player.hp, originalRandom = Math.random;
    try { Math.random = () => 0; boss._flames(DT, player); } finally { Math.random = originalRandom; }
    close(before-player.hp, BOSS.flame.dps*(1-2/BOSS.flame.range)*DT*.6, 'one real jet hull damage');
    assert.equal(sim.events.some(event => event.t === 'crewHit'), false, 'same jet cannot add a hidden crew pulse'); assertPlayable(sim, player);
  });
});
