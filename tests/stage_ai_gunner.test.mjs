import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AIGunner } from '../src/game/ai_gunner.js';
import { GunnerController } from '../src/game/gunner.js';
import { Run } from '../src/game/run.js';
import { StageEncounters } from '../src/sim/stage_encounters.js';
import { buildZones, raycastZones } from '../src/sim/car.js';
import { carPoint } from '../src/sim/ai.js';
import { RAPIER, GROUPS, initPhysics, createWorld } from '../src/sim/physics.js';

const V3 = THREE.Vector3, Q = THREE.Quaternion;
const eye = () => new V3(0, 2, 0);

// Logical fixtures retain the actual zone/ray/hit/aim pipeline. The occlusion
// regression also uses Run's real world-shot query against a Rapier collider.
function actor(id, kind, pos = new V3(0, 2, 30)) {
  const a = {
    id, kind, isStageEncounter: true, shootable: true, dead: false, exploded: false,
    pos: pos.clone(), quat: new Q(), half: { x: .8, y: 1, z: .3 }, hp: 60, maxHp: 60,
    zones: [{ kind: 'weakpoint', shape: 'sphere', c: [0, 0, -.8], r: .4 }, { kind: 'body', shape: 'box', c: [0, 0, 0], h: [.8, 1, .3] }],
    weakpoint: { pos: pos.clone().add(new V3(0, 0, -.8)), radius: .4 },
    crew: {}, spec: { id: `stage_${kind}`, mass: 600, seats: {}, width: 1.6, length: .6 },
    bodies: [], colliders: [], siteId: 'test-site', zoneMul: { weakpoint: 3 },
  };
  a.veh = { pos: a.pos, quat: a.quat, restComHeight: 0, vel: new V3(), poseRevision: 0 };
  a.raycast = (o, d, max) => raycastZones(a, o, d, max);
  return a;
}
function enemy(id = 2, z = 30, armored = false) {
  const spec = {
    id: armored ? 'fixture_armored' : 'fixture_enemy', mass: armored ? 3400 : 1800, length: 5.4, width: 2.2,
    seats: { driver: [-.4, .7, 1.4], gunner: [.4, .75, -.8] }, wheels: [],
    colliders: [{ center: [0, 1, 0], half: [1, .45, 2.7] }],
    ...(armored ? { weakpoint: { zone: 'fuel', mul: 2.5 }, hitZones: { fuel: { c: [0, 1, -2.7], h: [.46, .35, .24] } } } : {}),
  };
  const car = { id, kind: 'enemy', exploded: false, spec, crew: { driver: { alive: true }, gunner: { alive: true } },
    veh: { pos: new V3(0, 1, z), quat: new Q(), restComHeight: .7 }, ai: { behavior: 'chaser' } };
  car.zones = buildZones(spec); car.raycast = (o, d, max) => raycastZones(car, o, d, max);
  if (armored) { car.weakPoint = { zone: 'fuel', c: [99, 99, 99] }; car.zoneMul = { fuel: 2.5, body: 0, driver: 0, gunner: 0 }; }
  return car;
}
function setup(actors = [], cars = []) {
  const encounters = new StageEncounters();
  for (const a of actors) encounters.entities.set(a.id, a);
  const events = [];
  const player = { id: 1, spec: { width: 2 }, veh: { pos: new V3(), fwd: new V3(0, 0, 1), vel: new V3(), quat: new Q() },
    crew: { gunner: { alive: true, hp: 100, max: 100 }, driver: { alive: true, hp: 100, max: 100 } } };
  const sim = { state: 'run', cars: new Map(cars.map(c => [c.id, c])), boss: null, encounters, player, time: 0, playerDamageMul: 1,
    emit: e => events.push(e) };
  encounters.sim = sim;
  const run = { player, sim };
  return { encounters, player, sim, run, ai: new AIGunner(run), events };
}
function controller(setup, weapons = ['pistol'], reports = []) {
  const gunner = new GunnerController({ weapons }, {
    emit: e => setup.events.push(e), ownCar: () => setup.player,
    targets: function* () { yield* setup.sim.cars.values(); yield* setup.encounters.targets(); }, raycastWorld: () => null,
    report: hit => { reports.push(hit); if (setup.encounters.entities.has(hit.carId)) setup.encounters.applyHit(hit, setup.sim); },
  });
  setup.run.gunner = gunner; return gunner;
}

test('AI enumerates actual shootable gates, towers, drones, boats and barrels outside the enemy-car map', () => {
  const kinds = ['gate', 'tower', 'drone', 'boat', 'barrel'];
  const actors = kinds.map((kind, index) => actor(50000 + index, kind, new V3(index * 2, 2 + index, 30)));
  const disabled = actor(50020, 'vent'); disabled.shootable = false;
  const dead = actor(50021, 'tower'); dead.dead = true;
  const far = actor(50022, 'drone', new V3(0, 2, 171));
  const passed = actor(50023, 'gate', new V3(0, 2, -15));
  const { ai, encounters } = setup([...actors, disabled, dead, far, passed]);
  const targets = ai._targets(eye());
  assert.deepEqual(targets.map(t => t.kind), kinds);
  for (const target of targets) {
    const expected = encounters.aimPoint(target.encounter, eye(), new V3());
    assert.ok(target.p.distanceTo(expected) < 1e-10);
    assert.equal(target.car, undefined);
  }
});

test('approaching path gates and rolling barrels outrank generic body fire while elevated shooters remain useful targets', () => {
  const car = enemy(), actors = ['gate', 'barrel', 'tower', 'drone', 'boat'].map((kind, index) => actor(50000 + index, kind));
  const { ai } = setup(actors, [car]);
  const targets = ai._targets(eye()), body = targets.find(t => t.car === car && t.kind === 'body');
  for (const candidate of targets.filter(t => t.encounter)) assert.ok(candidate.score > body.score, candidate.kind);
  const gate = targets.find(t => t.kind === 'gate'), nearBarrel = targets.find(t => t.kind === 'barrel');
  actors[1].pos.x = 20; actors[1].weakpoint.pos.x = 20;
  assert.ok(ai._targets(eye()).find(t => t.kind === 'barrel').score < nearBarrel.score);
  assert.ok(gate.score > targets.find(t => t.kind === 'tower').score);
});

test('offshore boats remain eligible to 260 metres without extending other target or weapon firing ranges', () => {
  const boat = actor(50000, 'boat', new V3(0, 2, 240));
  const farBoat = actor(50001, 'boat', new V3(0, 2, 261)), farDrone = actor(50002, 'drone', new V3(0, 2, 171));
  const farTower = actor(50003, 'tower', new V3(0, 2, 240)), s = setup([boat, farBoat, farDrone, farTower]), gunner = controller(s);
  const candidates = s.ai._targets(eye());
  assert.deepEqual(candidates.map(t => t.encounter), [boat]);
  s.ai.update(1 / 60, gunner, eye()); s.ai.pauseT = 0; s.ai.retargetT = 10;
  const command = s.ai.update(1 / 60, gunner, eye());
  assert.equal(s.ai.target.encounter, boat); assert.ok(s.ai.target.p.distanceTo(eye()) > gunner.weapon.range * .95);
  assert.equal(command.fire, false); assert.equal(command.firePressed, false);
});

test('selected moving encounter follows its live aim point in place without rescanning the roster each frame', () => {
  const drone = actor(50000, 'drone'), s = setup([drone]), gunner = controller(s);
  const enumerate = s.encounters.targets.bind(s.encounters); let scans = 0;
  s.encounters.targets = function* () { scans++; yield* enumerate(); };
  s.ai.update(1 / 60, gunner, eye());
  const selected = s.ai.target, point = selected.p; assert.equal(selected.encounter, drone);
  for (let frame = 0; frame < 20; frame++) {
    drone.pos.set(frame * .1, 2 + frame * .04, 30 + frame * .2);
    drone.quat.setFromAxisAngle(new V3(0, 1, 0), frame * .01); s.encounters._refreshWeak(drone);
    s.ai.update(1 / 60, gunner, eye());
    assert.equal(s.ai.target, selected); assert.equal(selected.p, point);
    assert.ok(point.distanceTo(drone.weakpoint.pos) < 1e-10);
  }
  assert.equal(scans, 1, 'moving target refresh must not enumerate other encounter actors');
});

test('dead, removed, replaced, disabled, distant and passed encounter targets stop receiving cached fire immediately', () => {
  const mutations = [
    a => { a.dead = true; },
    (a, s) => s.encounters.entities.delete(a.id),
    (a, s) => { const replacement = actor(a.id, a.kind); replacement.shootable = false; s.encounters.entities.set(a.id, replacement); },
    a => { a.shootable = false; },
    a => { a.pos.z = 171; a.weakpoint.pos.z = 170.2; },
    a => { a.pos.z = -15; a.weakpoint.pos.z = -15.8; },
  ];
  for (const mutate of mutations) {
    const a = actor(50000, 'gate'), s = setup([a]), gunner = controller(s);
    s.ai.update(1 / 60, gunner, eye()); assert.equal(s.ai.target.encounter, a);
    s.ai.retargetT = 10; s.ai.pauseT = 0; mutate(a, s);
    const command = s.ai.update(1 / 60, gunner, eye());
    assert.equal(s.ai.target, null); assert.equal(command.fire, false); assert.equal(command.firePressed, false);
  }
});

test('real world-shot occlusion rejects a hidden boat and redirects normal gun-controller fire to a visible enemy', async () => {
  await initPhysics();
  const s = setup([], [enemy(2, 48)]), world = createWorld(), reports = [], random = Math.random;
  s.sim.world = world;
  const boat = s.encounters._create(s.sim, 'boat', { id: 'shore-test', biome: 'coast', s0: 38 }, new V3(22, -4, 38), { x: 1.7, y: .8, z: 4.3 }, 180);
  s.encounters._weak(boat, [0, .9, -2], .48); // actual boat weak-zone bounds below the firing lane
  const shore = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(11, -.6, 18));
  world.createCollider(RAPIER.ColliderDesc.cuboid(3, 3, 2).setCollisionGroups(GROUPS.world), shore);
  world.step();
  Object.assign(s.run, {
    encounters: s.encounters, _worldRay: Run.prototype._worldRay, _surfaceKind: () => 'rock',
    _localEvent: event => s.events.push(event), hitsLanded: 0,
    gcam: { addRecoil() {}, shake: { add() {} } },
  });
  s.sim.applyHit = hit => { reports.push(hit); if (s.encounters.entities.has(hit.carId)) s.encounters.applyHit(hit, s.sim); };
  const gunner = new GunnerController({ weapons: ['pistol'] }, Run.prototype._gunnerCtx.call(s.run));
  s.run.gunner = gunner;
  const from = eye(), point = boat.weakpoint.pos.clone(), direction = point.clone().sub(from).normalize();
  const contact = boat.raycast(from, direction, 160);
  try {
    assert.ok(contact, 'the actual boat zone faces the gunner');
    assert.equal(s.encounters.aimPoint(boat, from, new V3()), null, 'authority aim eligibility rejects the actual world-blocked boat');
    const worldHit = gunner.ctx.raycastWorld(from, direction, contact.t);
    assert.ok(worldHit && worldHit.t < contact.t, 'real Run/Rapier query hits the shore before the boat');
    assert.equal(gunner._raycastAll(from, direction, 160, null).world, true, 'the real gun-controller ray confirms the negative shot path');
    assert.equal(s.ai._targets(from).some(t => t.encounter === boat), false);

    Math.random = () => .5;
    const cam = { position: from, dir: new V3(0, 0, 1) };
    for (let frame = 0; frame < 360; frame++) {
      const dt = 1 / 60; s.sim.time += dt;
      const command = s.ai.update(dt, gunner, from);
      assert.equal(s.ai.target.car, s.sim.cars.get(2), 'visible regular enemy replaces the higher-priority hidden boat');
      gunner.update(dt, command, cam, 0, { deferFire: true });
      cam.dir.set(Math.sin(gunner.yaw) * Math.cos(gunner.pitch), Math.sin(gunner.pitch), Math.cos(gunner.yaw) * Math.cos(gunner.pitch));
      gunner.finishFire(cam);
    }
    assert.ok(gunner.shots > 0 && reports.some(hit => hit.carId === 2));
    assert.equal(reports.some(hit => hit.carId === boat.id), false);
    assert.equal(gunner.dbg.rayWorld, 0, 'the AI does not spend its magazine hitting the hidden boat shore');
    assert.equal(boat.hp, boat.maxHp);

    // A world surface behind the boat's front contact does not hide it.
    const behind = from.clone().addScaledVector(direction, contact.t + 8);
    shore.setTranslation({ x: behind.x, y: behind.y, z: behind.z }, true); world.step();
    assert.ok(s.ai._targets(from).some(t => t.encounter === boat));
    s.ai.retargetT = 0; s.ai.update(1 / 60, gunner, from);
    assert.equal(s.ai.target.encounter, boat);
    // The same live actor becomes occluded between normal roster scans.
    shore.setTranslation({ x: 11, y: -.6, z: 18 }, true); world.step();
    s.ai.retargetT = 10; s.ai.pauseT = 0;
    s.ai.update(1 / 60, gunner, from);
    assert.equal(s.ai.target.car, s.sim.cars.get(2));
  } finally { Math.random = random; world.free(); }
});

test('an arch support hidden by its actual actor hull is not an eligible aim point', () => {
  const s = setup(), site = { id: 'arch-test', biome: 'desert', s0: 30 };
  const arch = s.encounters._create(s.sim, 'arch', site, new V3(0, 2, 30), { x: .8, y: 1, z: .3 }, 70);
  s.encounters._weak(arch, [0, 0, .8], .4);
  assert.deepEqual(s.ai._targets(eye()), [], 'body-only ray cannot damage an arch support');
  arch.zones.find(z => z.kind === 'weakpoint').c[2] = -.8; s.encounters._refreshWeak(arch);
  assert.equal(s.ai._targets(eye()).find(t => t.encounter === arch)?.kind, 'arch');
});

test('armored cars offer only the real exposed authored weak zone and track its transform rather than stale metadata', () => {
  const car = enemy(2, 30, true), s = setup([], [car]);
  let targets = s.ai._targets(new V3(0, 1.3, 0));
  assert.equal(targets.length, 1); assert.equal(targets[0].kind, 'weak'); assert.equal(targets[0].protected, true);
  assert.ok(targets[0].p.distanceTo(carPoint(car, car.zones.find(z => z.kind === 'fuel').c, new V3())) < 1e-10);
  const point = targets[0].p;
  car.veh.pos.set(5, 2, 42); car.veh.quat.setFromAxisAngle(new V3(0, 1, 0), .6);
  const expected = carPoint(car, car.zones.find(z => z.kind === 'fuel').c, new V3());
  const rearEye = expected.clone().addScaledVector(new V3(0, 0, -1).applyQuaternion(car.veh.quat), 30);
  assert.equal(s.ai._refreshTarget(targets[0], rearEye), true); assert.equal(targets[0].p, point); assert.ok(point.distanceTo(expected) < 1e-10);
  car.zones = car.zones.filter(z => z.kind !== 'fuel');
  assert.deepEqual(s.ai._targets(rearEye), [], 'missing weak zone must never fall back to crew or hull');
});

test('protected front/through-body rays do not make an armored fuel target eligible or select rockets', () => {
  const car = enemy(2, 30, true), s = setup([], [car]), gunner = controller(s, ['rpg', 'rifle']);
  assert.deepEqual(s.ai._targets(new V3(0, 1.3, 65)), [], 'protected front cannot expose the rear fuel point');
  s.ai.update(1 / 60, gunner, new V3(0, 1.3, 0));
  assert.equal(s.ai.target.protected, true); assert.equal(s.ai.cmd.slot, 1, 'an armored weak zone uses the aimed gun, not hull splash');
  s.ai.retargetT = 10; s.ai.pauseT = 0;
  assert.equal(s.ai.update(1 / 60, gunner, new V3(0, 1.3, 65)).fire, false);
  assert.equal(s.ai.target, null);
});

test('ready grenades remain available against protected armor but still fire at ordinary clustered enemies', () => {
  for (const protectedArmor of [true, false]) {
    const selected = enemy(2, 30, protectedArmor), neighbor = enemy(3, 33, protectedArmor);
    const s = setup([], [selected, neighbor]), gunner = controller(s), from = new V3(0, 1.3, 0);
    s.ai.nadeCd = 0;
    const command = s.ai.update(1 / 60, gunner, from);
    assert.equal(s.ai.target.car, selected, 'normal target selection chooses the nearer member of the real cluster');
    assert.equal(Boolean(s.ai.target.protected), protectedArmor);
    assert.ok(s.ai.target.p.distanceTo(from) > 12 && s.ai.target.p.distanceTo(from) < 38);
    assert.ok(selected.veh.pos.distanceTo(neighbor.veh.pos) < 9);
    assert.ok(gunner.grenades > 0);
    assert.equal(command.grenade, !protectedArmor);
    assert.equal(s.ai.nadeCd, protectedArmor ? -1 / 60 : 9, 'protected targeting does not consume the ready grenade cooldown');
  }
});

test('extra live enemy gunners remain real candidates after the primary shooter dies', () => {
  const car = enemy(); car.crew.gunner.alive = false;
  car.spec.seats.gunner2 = [-.5, .9, -1.4]; car.crew.gunner2 = { alive: true, x: .2, z: -.1, crouch: true };
  const { ai } = setup([], [car]);
  const candidate = ai._targets(eye()).find(t => t.kind === 'gunner2'); assert.ok(candidate);
  const reused = candidate.p; car.crew.gunner2.x = -.3; car.veh.pos.x = 2;
  ai._refreshTarget(candidate, eye()); assert.equal(candidate.p, reused);
  const expected = new V3(-.5 - .3, .9 + 1.25 - .7 - .42, -1.4 - .1).add(car.veh.pos);
  assert.ok(candidate.p.distanceTo(expected) < 1e-10);
  car.crew.gunner2.alive = false;
  assert.equal(ai._targets(eye()).some(t => t.kind.startsWith('gunner')), false);
});

test('normal AI command settling and real GunnerController shots can break a shootable gate through real hit reports', () => {
  const s = setup(), reports = [], gunner = controller(s, ['pistol'], reports);
  const gate = s.encounters._create(s.sim, 'gate', { id: 'gate-test', biome: 'desert', s0: 18 }, new V3(0, 1.25, 18), { x: 3.2, y: 1.25, z: .22 }, 60);
  s.encounters._weak(gate, [0, .15, -.32], .4); // actual authored gate/fuse bounds
  const random = Math.random; const cam = { position: eye(), dir: new V3(0, 0, 1) };
  try {
    Math.random = () => .5; // deterministic settling/spread, without overriding aim or trigger commands
    for (let frame = 0; frame < 600 && !gate.dead; frame++) {
      const dt = 1 / 60; s.sim.time += dt;
      const command = s.ai.update(dt, gunner, cam.position);
      gunner.update(dt, command, cam, 0, { deferFire: true });
      cam.dir.set(Math.sin(gunner.yaw) * Math.cos(gunner.pitch), Math.sin(gunner.pitch), Math.cos(gunner.yaw) * Math.cos(gunner.pitch));
      gunner.finishFire(cam);
    }
  } finally { Math.random = random; }
  assert.ok(gunner.shots > 0); assert.ok(reports.some(hit => hit.carId === gate.id && hit.zone === 'weakpoint'));
  assert.equal(gate.dead, true); assert.equal(gate.hp, 0); assert.ok(s.events.some(e => e.t === 'stageBreak' && e.id === gate.id));
  s.ai.update(1 / 60, gunner, cam.position); assert.equal(s.ai.target, null);
});
