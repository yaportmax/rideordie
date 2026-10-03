import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import './helpers/peer-import.mjs';
import { Sim, DT } from '../src/sim/sim.js';
import { StageEncounters } from '../src/sim/stage_encounters.js';
import { PROJECTILE_LIMITS } from '../src/sim/projectiles.js';
import { addStaticBox } from '../src/sim/physics.js';
import { stageEncounterGap } from '../src/data/stage_encounters.js';
import { GhostCar, GUNNER_ROLES } from '../src/sim/car.js';
import { makeCarState, stateFromCar } from '../src/view/car_state.js';
import { GunnerController } from '../src/game/gunner.js';
import { WorldView } from '../src/game/world_view.js';
import { NET_PROTOCOL, decodeRunPacket } from '../src/net/run_packet.js';
import { decodeSnapshot } from '../src/net/snapshot.js';
const { Session } = await import('../src/net/session.js');
const { Run } = await import('../src/game/run.js');

const V = THREE.Vector3;
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${actual} agrees with ${expected}`);
const gateSite = () => ({ id: 'integration-gate', kind: 'shoot_gate', biome: 'desert', s0: 1100, s1: 1320,
  side: 1, ...stageEncounterGap(1, 1), warningS: 820, title: 'Fuse gate', hint: 'Shoot the fuse' });

async function withSim(check) {
  const sim = await new Sim({ seed: 7, journey: { mode: 'campaign', level: 1 } }).init();
  try {
    sim.director.enabled = false;
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 1000, hold: true });
    sim.state = 'run'; sim.tick = 1; sim.time = DT;
    sim.encounters.sim = sim; sim.encounters.plan = [];
    await check(sim, sim.encounters, player);
  } finally { sim.dispose(); }
}

function spawnGate(sim) {
  sim.encounters._spawnSite(sim, gateSite());
  const gate = [...sim.encounters.targets()].find(actor => actor.kind === 'gate');
  assert.ok(gate, 'an actual authored gate exists');
  return gate;
}

function localPoint(car, point) {
  return point.clone().sub(car.pos).applyQuaternion(car.quat.clone().invert()).toArray();
}

function actorReport(actor, point, dir, extra = {}) {
  return { carId: actor.id, point: point.toArray(), localPoint: localPoint(actor, point),
    dir: dir.toArray(), dmg: 5, zone: 'weakpoint', shotId: 1, poseRevision: actor.veh.poseRevision, ...extra };
}

function state(car) { return stateFromCar(car, 1, makeCarState(car.id, car.spec.id, car.kind)); }

function fakeRun(sim, manager = sim?.encounters) {
  return Object.assign(Object.create(Run.prototype), { sim, player: sim?.player, playerId: 1,
    encounters: manager, structures: null, states: new Map(), simState: 'run', netEvents: [],
    _surfaceKind: () => 'concrete', g: { camera: new THREE.PerspectiveCamera() },
  });
}

test('actual Sim encounter reports count only accepted distinct shots and cannot replay, teleport or falsify a contact', async () => {
  await withSim((sim, manager) => {
    const gate = spawnGate(sim), forward = new V(0, 0, 1).applyQuaternion(gate.quat);
    const eye = gate.weakpoint.pos.clone().addScaledVector(forward, -25);
    const contact = gate.raycast(eye, forward, 40);
    assert.equal(contact?.zone.kind, 'weakpoint');
    const hit = actorReport(gate, contact.point, forward), hp = gate.hp;
    for (const bad of [
      { ...hit, shotId: 0 }, { ...hit, shotId: -1 }, { ...hit, shotId: 1.5 },
      { ...hit, dir: [0, 0, 2] }, { ...hit, point: [NaN, 0, 0] },
      { ...hit, localPoint: [100, 0, 0] }, { ...hit, poseRevision: gate.veh.poseRevision + 1 },
      { ...hit, zone: 'driver' }, { ...hit, dmg: Infinity },
    ]) assert.equal(sim.applyHit(bad), false);
    assert.equal(gate.hp, hp); assert.equal(sim.stats.hits, 0);
    assert.equal(sim.applyHit(hit), true); assert.equal(gate.hp, hp - 15); assert.equal(sim.stats.hits, 1);
    assert.equal(sim.applyHit(hit), false); assert.equal(gate.hp, hp - 15); assert.equal(sim.stats.hits, 1);
    const pellet = forward.clone().add(new V(.008, .005, 0)).normalize();
    assert.equal(sim.applyHit({ ...hit, dir: pellet.toArray() }), true,
      'a different pellet of one shotgun discharge still damages the target');
    assert.equal(gate.hp, hp - 30); assert.equal(sim.stats.hits, 1, 'one discharge earns one accuracy hit');
    const physicalBody = gate.body;
    assert.equal(sim.applyHit({ ...hit, shotId: 2, dmg: 10 }), true);
    assert.equal(sim.stats.hits, 2); assert.equal(gate.dead, true); assert.equal(physicalBody.isValid(), false);
    assert.equal(manager.colliderActors.size, 0); assert.equal(sim.events.filter(event => event.t === 'stageBreak').length, 1);
    assert.equal(sim.applyHit({ ...hit, shotId: 3 }), false); assert.equal(sim.stats.hits, 2);
  });
});

test('real Rapier camera rays retain a gate, shooting probes reach its fuse and breaking it opens the physical path', async () => {
  await withSim((sim, manager) => {
    const gate = spawnGate(sim), forward = new V(0, 0, 1).applyQuaternion(gate.quat);
    const eye = gate.weakpoint.pos.clone().addScaledVector(forward, -25);
    const behind = gate.weakpoint.pos.clone().addScaledVector(forward, 12);
    addStaticBox(sim.world, behind.toArray(), [4, 4, .5], gate.quat.toArray());
    sim.world.step(sim.eventQueue);
    const run = fakeRun(sim), cameraHit = run._worldRay(eye, forward, 45);
    const shotWorldHit = run._worldRay(eye, forward, 45, true);
    assert.ok(cameraHit && shotWorldHit && shotWorldHit.t > cameraHit.t + 10,
      'only shooting ignores the live target collider, while the background still stops shots');
    const controller = new GunnerController({ weapons: ['pistol'] }, run._gunnerCtx());
    controller.aimAt({ position: eye, dir: forward });
    assert.equal(controller.aimCar, gate); assert.equal(controller.aimZone, 'weakpoint');
    assert.ok(controller.aimPoint.distanceTo(eye) < shotWorldHit.t);
    const contact = gate.raycast(eye, forward, 40);
    assert.equal(sim.applyHit(actorReport(gate, contact.point, forward, { dmg: 100 })), true);
    sim.world.step(sim.eventQueue);
    const opened = run._worldRay(eye, forward, 45);
    close(opened.t, shotWorldHit.t, .001);
    assert.equal([...manager.targets()].length, 0);
    controller.aimAt({ position: eye, dir: forward });
    assert.equal(controller.aimCar, null); assert.equal(controller.aimZone, null);
    close(controller.aimPoint.distanceTo(eye), opened.t, .001);
  });
});

test('actual Sim head, body and leg hits independently damage and kill all four warwagon roof gunners', async () => {
  await withSim(sim => {
    const car = sim.spawnCar('e_warwagon', { s: 1070, kind: 'enemy', hold: true }), hullHp = car.hp;
    for (const role of GUNNER_ROLES) {
      const crew = car.crew[role], seat = car.spec.seats[role], side = Math.sign(seat[0]) || 1;
      const local = new V(seat[0] + side * 5, seat[1] + 1.62 - car.veh.restComHeight, seat[2]);
      const eye = local.applyQuaternion(car.quat).add(car.pos), dir = new V(-side, 0, 0).applyQuaternion(car.quat);
      const head = car.raycast(eye, dir, 10);
      assert.equal(head?.zone.kind, role + '_head');
      const armor = 1 - crew.armor, startHp = crew.hp;
      sim.damageZone(car, head, 2, { src: 1, point: head.point });
      close(crew.hp, startHp - 2 * 2.6 * armor);
      const torso = car.zones.find(zone => zone.kind === role), legs = car.zones.find(zone => zone.kind === role + '_legs');
      sim.damageZone(car, torso, 2, { src: 1 }); sim.damageZone(car, legs, 2, { src: 1 });
      close(crew.hp, startHp - (2 * 2.6 + 2 + 2 * .45) * armor);
      for (const other of GUNNER_ROLES) if (other !== role && car.crew[other].alive) assert.equal(car.crew[other].hp, car.crew[other].max);
      sim.damageZone(car, head, 100, { src: 1, point: head.point });
      assert.equal(crew.alive, false); assert.equal(crew.hp, 0); assert.equal(car.hp, hullHp);
      assert.equal(sim.events.filter(event => event.t === 'crewDead' && event.role === role).length, 1);
      assert.notEqual(car.raycast(eye, dir, 5.4)?.zone.role, role, 'dead crew cannot intercept later bullets');
    }
    assert.equal(car.crewAlive(), 1); assert.equal(car.crew.driver.alive, true);
    assert.equal(sim.events.filter(event => event.t === 'crewDead' && event.id === car.id).length, 4);
  });
});

test('armored reactor variants protect ordinary hull and crew contacts while actual exposed fuel shots work', async () => {
  await withSim(sim => {
    for (const id of ['e_armored', 'e_light_tank']) {
      const car = sim.spawnCar(id, { kind: 'enemy', s: 1080, hold: true });
      const before = { hp: car.hp, driver: car.crew.driver.hp, gunner: car.crew.gunner.hp,
        engine: car.engineHp, fuel: car.fuelHp, tires: car.tireHp.slice() };
      for (const zone of car.zones.filter(zone => zone.kind !== 'fuel')) sim.damageZone(car, zone, 20, { src: 1 });
      assert.equal(car.hp, before.hp); assert.equal(car.crew.driver.hp, before.driver); assert.equal(car.crew.gunner.hp, before.gunner);
      assert.equal(car.engineHp, before.engine); assert.deepEqual(car.tireHp, before.tires);
      const fuel = car.zones.find(zone => zone.kind === 'fuel'), forward = new V(0, 0, 1).applyQuaternion(car.quat);
      const exposed = new V(fuel.c[0], fuel.c[1] - car.veh.restComHeight, fuel.c[2]).applyQuaternion(car.quat).add(car.pos);
      const contact = car.raycast(exposed.clone().addScaledVector(forward, -6), forward, 10);
      assert.equal(contact?.zone.kind, 'fuel', 'the model-authored rear reactor is hittable');
      sim.damageZone(car, contact, 20, { src: 1, point: contact.point });
      assert.ok(car.fuelHp < before.fuel && car.hp < before.hp);
      assert.equal(car.crew.driver.hp, before.driver); assert.equal(car.crew.gunner.hp, before.gunner);
      const fuelDamagedHp = car.hp;
      sim.blast(car.pos, 8, 30, .1, null, 1);
      assert.equal(car.hp, fuelDamagedHp, 'splash does not replace finding the reactor');
      assert.equal(car.crew.driver.hp, before.driver); assert.equal(car.crew.gunner.hp, before.gunner);
    }
    const regular = sim.spawnCar('e_sedan', { kind: 'enemy', s: 1050, hold: true });
    const hp = regular.hp; sim.damageZone(regular, { kind: 'body' }, 12, { src: 1 });
    assert.equal(regular.hp, hp - 12, 'ordinary enemy body vulnerability is preserved');
  });
});

test('host and guest gunner contexts expose live stage targets and human assist aims at actual armored reactors', async () => {
  await withSim((sim, manager, player) => {
    const gate = spawnGate(sim), car = sim.spawnCar('e_armored', { s: 1050, kind: 'enemy', hold: true });
    const host = fakeRun(sim), hostTargets = [...host._gunnerCtx().targets()];
    assert.equal(host._gunnerCtx().ownCar(), player); assert.ok(hostTargets.includes(car) && hostTargets.includes(gate));
    const guestManager = new StageEncounters({ authoritative: false });
    try {
      assert.equal(guestManager.applySnapshot(manager.snapshot()), true);
      const ownState = state(player), enemyState = state(car);
      const guest = fakeRun(null, guestManager); guest.states.set(1, ownState); guest.states.set(car.id, enemyState);
      const own = new GhostCar(ownState), enemy = new GhostCar(enemyState); own.sync(ownState); enemy.sync(enemyState);
      guest.ghosts = new Map([[1, own], [enemy.id, enemy]]);
      const forward = new V(0, 0, 1).applyQuaternion(gate.quat);
      guest.g.camera.position.copy(gate.weakpoint.pos).addScaledVector(forward, -25);
      const ctx = guest._gunnerCtx(), receivedGate = guestManager.entities.get(gate.id);
      assert.equal(ctx.ownCar(), own); assert.deepEqual([...ctx.targets()], [enemy, receivedGate]);
      // Guest aim must agree with its actual GhostCar hit geometry. Render
      // interpolation normalizes Rapier's float quaternion, even at alpha=1;
      // a raw authority quaternion is therefore a different pose oracle.
      const fuelZone = enemy.zones.find(zone => zone.kind === 'fuel');
      const expected = new V().fromArray(fuelZone.c); expected.y -= enemy.veh.restComHeight;
      expected.applyQuaternion(enemy.veh.quat).add(enemy.veh.pos);
      const rearDirection = new V(0, 0, 1).applyQuaternion(enemy.veh.quat);
      const actualGuestContact = enemy.raycast(expected.clone().addScaledVector(rearDirection, -6), rearDirection, 10);
      assert.equal(actualGuestContact?.zone.kind, 'fuel', 'the guest target is on its actual shootable reactor geometry');
      const points = guest._assistTargets();
      assert.equal(points.length, 2, 'armor produces one reactor target, and the visible gate one fuse');
      const aimContext = { actual: points[0].p.toArray(), expected: expected.toArray(),
        vehiclePos: car.pos.toArray(), statePos: enemyState.pos.toArray(),
        vehicleQuat: car.quat.toArray(), stateQuat: enemyState.quat.toArray(),
        vehicleCom: car.veh.restComHeight, stateCom: enemyState.ride.restComHeight,
        fuelLocal: car.spec.hitZones.fuel.c, actorAim: points[1].p.toArray(),
        pointStorageAliased: points[0].p === points[1].p };
      assert.ok([...aimContext.actual, ...aimContext.expected, ...aimContext.vehiclePos, ...aimContext.statePos,
        ...aimContext.vehicleQuat, ...aimContext.stateQuat, aimContext.vehicleCom, aimContext.stateCom].every(Number.isFinite),
      'all reactor pose inputs and outputs are finite: ' + JSON.stringify(aimContext));
      assert.ok(points[0].p.distanceTo(expected) < 1e-9, 'reactor aim must match actual GhostCar geometry: ' + JSON.stringify(aimContext));
      assert.ok(points[1].p.distanceTo(receivedGate.weakpoint.pos) < 1e-9);
      assert.notEqual(points[0].p, points[1].p, 'pooled target storage cannot alias another target');
      enemyState.exploded = true;
      assert.equal(guest._assistTargets().length, 1, 'an exploded armored car no longer attracts aim');
    } finally { guestManager.dispose(); }
  });
});

test('Run sends current encounters at 10Hz inside real life-isolated Session envelopes and retires the final actor once', async () => {
  await withSim((sim, manager) => {
    const gate = spawnGate(sim), actorSnapshot = manager.snapshot();
    for (const fps of [30, 60, 120]) {
      const sent = [], fast = [];
      const session = new Session({ send(message) { sent.push(structuredClone(message)); return true; },
        sendTransientJSON(message) { sent.push(structuredClone(message)); return true; },
        sendFast(bytes) { fast.push(bytes); return true; } });
      session.activeRunId = `stage-life-${fps}`;
      const run = Object.assign(fakeRun(sim), { net: session, snapAcc: 0, encounterSendAcc: 0,
        events: [], cash: 0, medkits: 0, _bossHud: () => ({ id: 0, hp01: 0 }), });
      for (let frame = 1; frame <= fps; frame++) {
        sim.tick = frame; sim.time = frame / fps; run._sendNet(1 / fps);
      }
      const updates = sent.filter(message => message.e?.[0]?.t === 'stageState');
      assert.equal(updates.length, 10, `${fps} FPS retains encounter cadence`);
      assert.equal(fast.length, 30, 'encounters cannot disturb the existing vehicle cadence');
      updates.forEach(message => { assert.equal(message.runId, session.activeRunId); assert.equal(message.e.length, 1); assert.equal(message.e[0].state.actors.length, 1); });
      assert.equal(updates.at(-1).e[0].state.tick, fps);
      assert.equal(decodeSnapshot(decodeRunPacket(session._fastHeader, fast.at(-1))).tick, fps);
      run.events = [{ t: 'shot', src: 1 }, { t: 'shot', src: gate.id, remote: true }, { t: 'shot', localOnly: true }];
      run._sendNet(0); assert.equal(sent.at(-1).e.length, 1); assert.equal(sent.at(-1).e[0].src, 1);
      run.events = []; manager.entities.clear();
      run._sendNet(.1); assert.deepEqual(sent.at(-1).e[0].state.actors, []);
      const finalCount = sent.length;
      run._sendNet(.1); run._sendNet(.1); assert.equal(sent.length, finalCount, 'empty retirement is not spammed every tick');
      // Restore the existing real body owner for subsequent schedules/disposal.
      manager.entities.set(gate.id, gate); assert.equal(actorSnapshot.actors[0].id, gate.id);
    }
  });
});

test('actual Session and Run reject old-life, stale and malformed stage snapshots without leaking state messages into FX', async () => {
  await withSim((sim, manager) => {
    spawnGate(sim); const baseline = manager.snapshot(), guestManager = new StageEncounters({ authoritative: false });
    const guest = fakeRun(null, guestManager);
    const session = new Session({ send: () => true, sendFast: () => true });
    session.activeRunId = 'stage-new-life'; session._peerProtocol = NET_PROTOCOL; session.on({ run: message => guest.onNet(message) });
    const deliver = (snapshot, runId = session.activeRunId) => session._onMsg({ t: 'events', runId, e: [{ t: 'stageState', state: snapshot }] });
    try {
      deliver(baseline, 'stage-old-life'); assert.equal(guestManager.entities.size, 0);
      deliver(baseline); assert.equal(guestManager.entities.size, 1); assert.deepEqual(guest.netEvents, []);
      const actor = [...guestManager.entities.values()][0], position = actor.pos.toArray(), hp = actor.hp;
      const malformed = structuredClone(baseline); malformed.tick++; malformed.actors[0].pos[1] = NaN;
      deliver(malformed); deliver(baseline);
      assert.equal(guestManager.lastSnapshotTick, baseline.tick); assert.equal(actor.hp, hp); assert.deepEqual(actor.pos.toArray(), position);
      assert.deepEqual(guest.netEvents, [], 'received stageState never reaches visual shot/event handlers');
      const empty = { tick: baseline.tick + 2, time: baseline.time + .2, actors: [] };
      deliver(empty); assert.equal(guestManager.entities.size, 0);
      deliver(baseline); assert.equal(guestManager.entities.size, 0, 'a stale actor cannot resurrect after retirement');
      session._onMsg({ t: 'events', runId: session.activeRunId, e: [{ t: 'shot', src: 50001 }] });
      assert.deepEqual(guest.netEvents, [{ t: 'shot', src: 50001 }], 'ordinary valid FX still reaches the existing route');
      session.activeRunId = 'stage-next-life'; deliver({ ...baseline, tick: 1000 }, 'stage-new-life');
      assert.equal(guestManager.entities.size, 0, 'even a newer tick from the previous life is rejected before Run');
    } finally { guestManager.dispose(); }
  });
});

test('global live projectile caps reject extra traffic before Rapier allocations and expired grenades release every owned body', async () => {
  await withSim(sim => {
    const projectiles = sim.projectiles, origin = new V(100000, 20, 100000), direction = new V(0, 0, 1);
    const before = sim.world.bodies.len(), bodies = [];
    for (let index = 0; index < PROJECTILE_LIMITS.bullets; index++) assert.equal(projectiles.addBullet(origin, direction, 100, 0, 99, 'mg', .01), true);
    for (let index = 0; index < PROJECTILE_LIMITS.rockets; index++) assert.equal(projectiles.addRocket(origin, direction, { speed: 100, blast: 1, blastDmg: 0 }, 99), true);
    for (let index = 0; index < PROJECTILE_LIMITS.grenades; index++) {
      assert.equal(projectiles.addGrenade(sim, origin, new V(), { fuse: .01, blast: 1, dmg: 0 }, 99), true);
      bodies.push(projectiles.grenades.at(-1).body);
    }
    assert.equal(sim.world.bodies.len(), before + PROJECTILE_LIMITS.grenades);
    const nextId = projectiles.nextId;
    for (let index = 0; index < 32; index++) {
      assert.equal(projectiles.addBullet(origin, direction, 100, 0, 99), false);
      assert.equal(projectiles.addRocket(origin, direction, { speed: 100, blast: 1, blastDmg: 0 }, 99), false);
      assert.equal(projectiles.addGrenade(sim, origin, new V(), { fuse: 1, blast: 1, dmg: 0 }, 99), false);
    }
    assert.equal(projectiles.nextId, nextId); assert.equal(sim.world.bodies.len(), before + PROJECTILE_LIMITS.grenades);
    projectiles.update(.02, sim);
    assert.equal(projectiles.bullets.length, 0); assert.equal(projectiles.grenades.length, 0);
    assert.equal(sim.world.bodies.len(), before); assert.ok(bodies.every(body => !body.isValid()));
    projectiles.update(4.1, sim); assert.equal(projectiles.rockets.length, 0); assert.equal(sim.world.bodies.len(), before);
    assert.equal(sim.player.hp, sim.player.maxHp, 'remote projectile expiry cannot damage the player');
  });
});

test('actual WorldView keeps a native tank operator and authored muzzle without a duplicate handheld RPG, flash or grenade', async () => {
  await withSim(sim => {
    const tank = sim.spawnCar('e_light_tank', { kind: 'enemy', s: 1050, hold: true });
    tank.gunName = 'rpg'; tank.gunNames = { gunner: 'rpg' };
    const tankState = state(tank), playerState = state(sim.player), states = new Map([[tank.id, tankState], [1, playerState]]);
    const view = new WorldView({ scene: new THREE.Scene() });
    try {
      const record = view.ensure(tankState), operator = record.crew.gunner;
      assert.ok(operator); assert.equal(operator.nativeEnemyGun, true); assert.equal(operator.weapon, null);
      assert.deepEqual(operator.root.position.toArray(), tank.spec.seats.gunner);
      const player = view.ensure(playerState).crew.gunner; assert.ok(player.weapon); assert.equal(player.nativeEnemyGun, false);
      operator.setWeapon('rpg'); operator.setWeapon('rifle'); assert.equal(operator.weapon, null);
      const muzzle = new V().fromArray(tank.spec.gunMuzzles.gunner); muzzle.y -= tank.veh.restComHeight;
      muzzle.applyQuaternion(tank.quat).add(tank.pos);
      view.handleEvent({ t: 'shot', src: tank.id, role: 'gunner', weapon: 'cannon', origin: muzzle.toArray(), rays: [] }, states);
      assert.equal(operator.shots, 1); assert.equal(operator.kick, 1); assert.equal(operator.weapon, null);
      assert.equal(player.shots, 0, 'native cannon shots do not animate the player gun');
      view.handleEvent({ t: 'grenadeThrow', src: tank.id, role: 'gunner' }, states);
      assert.equal(operator.nade, undefined); assert.equal(operator.throwT, 0);
      tankState.gunner.yaw = .3; tankState.gunner.pitch = .1; tankState.gunner.fire = true;
      view.update(DT, states, [], { playerId: 1 });
      assert.equal(operator.weapon, null); assert.equal(operator.alive, true);
      const firstYaw = operator.body.rotation.y;
      tankState.gunner.yaw += 1; view.update(DT, states, [], { playerId: 1 });
      assert.ok(Number.isFinite(operator.body.rotation.y) && operator.body.rotation.y !== firstYaw,
        'normal operator aim still updates without a held weapon');
      view.handleEvent({ t: 'crewDead', id: tank.id, role: 'gunner', cause: 'bullet' }, states);
      assert.equal(operator.alive, false); assert.equal(operator.deadT, 0); assert.equal(operator.weapon, null);
      assert.equal(player.alive, true);
    } finally { view.dispose(); }
  });
});
