import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Sim, DT } from '../src/sim/sim.js';
import { StageEncounters, STAGE_ACTOR_LIMIT, STAGE_BARREL_LIMIT } from '../src/sim/stage_encounters.js';
import { RAPIER, GROUPS } from '../src/sim/physics.js';
import { plannedStageEncounters, stageEncounterGap } from '../src/data/stage_encounters.js';
import { seaLevel, terrainPoint } from '../src/world/terrain_gen.js';
import { SyncGround } from '../src/sim/sync_ground.js';

const V = Vector3;
const site = (kind, extra = {}) => ({ id: `fixture-${kind}`, kind, biome: 'desert', s0: 1100, s1: 1320, side: 1,
  ...stageEncounterGap(1, 1), warningS: 820, title: kind, hint: kind, ...extra });
async function harness(run, journey = { mode: 'campaign', level: 1 }) {
  const sim = await new Sim({ seed: 7, journey }).init();
  try {
    sim.director.enabled = false; sim.player = sim.spawnCar('truck_t1', { kind: 'player', s: 1000, hold: true });
    sim.state = 'run'; sim.tick = 1;
    sim.encounters?.dispose(sim);
    const manager = new StageEncounters(); manager.sim = sim; manager.plan = []; sim.encounters = manager;
    await run(manager, sim, sim.player);
    manager.dispose(sim);
  } finally { sim.dispose(); }
}
function floor(sim, y, center) {
  const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, y - .5, center.z));
  sim.world.createCollider(RAPIER.ColliderDesc.cuboid(150, .5, 150).setCollisionGroups(GROUPS.world), body);
  return body;
}
function clearArchSite(sim) {
  for (let s = 1100; s < 3300; s += 40) {
    const legs = [-8, 8].map(d => sim.road.pointAt(s, d, {}));
    if (legs.every(p => !sim.road.corridorBlocked(p.x, p.z, 1.2, s))) return site('collapse_arch', { s0: s, s1: s + 160 });
  }
  assert.fail('fixture needs one actual branch-clear arch footprint');
}
function report(actor, point, { dmg = 10, shotId = 1, dir = [0, 0, 1], zone = 'weakpoint', revision = actor.veh.poseRevision } = {}) {
  return { carId: actor.id, point: point.toArray(), localPoint: point.clone().sub(actor.pos).applyQuaternion(actor.quat.clone().invert()).toArray(),
    dir, dmg, zone, shotId, poseRevision: revision };
}
function step(manager, sim, n) {
  for (let i = 0; i < n; i++) { sim.tick++; sim.time += DT; sim.world.step(sim.eventQueue); manager.update(DT, sim); }
}

test('a real shootable gate breaks, removes physical collision and rejects repeated wire contacts', async () => {
  await harness((manager, sim, player) => {
    manager._spawnSite(sim, site('shoot_gate'));
    const gate = [...manager.targets()][0];
    assert.equal(gate.kind, 'gate'); assert.equal(gate.body.isValid(), true);
    const startHp = player.hp, first = report(gate, gate.weakpoint.pos);
    assert.equal(manager.applyHit(first, sim), true); assert.equal(gate.hp, 30);
    assert.equal(manager.applyHit(first, sim), false); assert.equal(gate.hp, 30);
    assert.equal(manager.applyHit({ ...first, dir: [.01, 0, Math.sqrt(1 - .01 ** 2)] }, sim), true, 'a distinct shotgun pellet with one shot ID remains legal');
    assert.equal(gate.status, 'broken'); assert.equal(gate.body, null); assert.equal(gate.colliders.length, 0); assert.equal(manager.colliderActors.size, 0);
    assert.equal(player.hp, startHp); assert.equal([...manager.targets()].length, 0);
    assert.equal(sim.events.filter(e => e.t === 'stageBreak').length, 1);
  });
});

test('gate opening sign and fixed Rapier panel agree in both side arrangements and late-level gaps', async () => {
  for (const side of [-1, 1]) for (const level of [1, 10]) await harness((manager, sim, player) => {
    const descriptor = site('shoot_gate', { side, ...stageEncounterGap(level, side) });
    manager._spawnSite(sim, descriptor);
    const gate = [...manager.targets()][0], sm = sim.road.sample(descriptor.s0);
    const safe = sim.road.pointAt(descriptor.s0, descriptor.gapD, {});
    const forward = new V(Math.sin(sm.th), 0, Math.cos(sm.th));
    sim.world.step(sim.eventQueue);
    const origin = new V(safe.x, gate.pos.y, safe.z).addScaledVector(forward, -20);
    assert.equal(gate.raycast(origin, forward, 40), null, 'the declared escape lane has no solid shootable panel');
    const ray = new RAPIER.Ray(origin, forward);
    const hit = sim.world.castRay(ray, 40, true, undefined, undefined, undefined, undefined, c => manager.ownsCollider(c.handle));
    assert.equal(hit, null, 'Rapier agrees that the safe-lane centre is clear');
    const blockedOrigin = gate.pos.clone().addScaledVector(forward, -20);
    const blocked = sim.world.castRay(new RAPIER.Ray(blockedOrigin, forward), 40, true, undefined, undefined, undefined, undefined, c => manager.ownsCollider(c.handle));
    assert.ok(blocked && manager.ownsCollider(blocked.collider.handle), 'the obstructed panel really exists in the Rapier query pipeline');
    player.held = false; sim.releaseCar(player);
    player.veh.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    player.veh.body.setTranslation({ x: origin.x, y: gate.pos.y, z: origin.z }, true);
    player.veh.body.setRotation(gate.quat, true); player.veh.body.setLinvel({ x: forward.x * 32, y: 0, z: forward.z * 32 }, true);
    sim.world.gravity = { x: 0, y: 0, z: 0 };
    const hp = player.hp;
    for (let i = 0; i < 160; i++) { sim.world.step(sim.eventQueue); player.veh.afterStep(); manager._gateContacts(gate, DT, sim); }
    assert.equal(player.hp, hp); assert.equal(gate.hp, gate.maxHp);
    assert.ok(player.veh.pos.clone().sub(new V(safe.x, gate.pos.y, safe.z)).dot(forward) > 10, 'the full truck physically clears the opening');
  });
});

test('a missed gate shot has a bounded physical ram fallback instead of trapping the driver', async () => {
  await harness((manager, sim, player) => {
    manager._spawnSite(sim, site('shoot_gate'));
    const gate = [...manager.targets()][0], forward = new V(0, 0, 1).applyQuaternion(gate.quat);
    player.held = false; player.veh.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const pos = gate.pos.clone().addScaledVector(forward, -player.spec.length / 2 + .1);
    player.veh.body.setTranslation(pos, true); player.veh.body.setLinvel({ x: forward.x * 35, y: 0, z: forward.z * 35 }, true); player.veh.afterStep();
    const hp = player.hp;
    manager._gateContacts(gate, DT, sim);
    assert.equal(gate.dead, true); assert.equal(gate.body, null);
    assert.ok(player.hp >= hp - player.maxHp * .036); assert.ok(player.veh.body.linvel().x ** 2 + player.veh.body.linvel().z ** 2 > 27 ** 2);
  });
});

test('actor reports reject stale revision, impossible contacts, unsupported zones and invalid shot IDs', async () => {
  await harness((manager, sim) => {
    manager._spawnSite(sim, site('shoot_gate')); const gate = [...manager.targets()][0], hp = gate.hp;
    const valid = report(gate, gate.weakpoint.pos);
    for (const bad of [{ ...valid, poseRevision: 1 }, { ...valid, localPoint: [50, 0, 0] }, { ...valid, zone: 'driver' },
      { ...valid, point: [NaN, 0, 0] }, { ...valid, dir: [0, 0, 2] }, { ...valid, shotId: 0 }, { ...valid, localPoint: [0, 10, 0] }]) assert.equal(manager.applyHit(bad, sim), false);
    assert.equal(gate.hp, hp); assert.equal(gate.hitContacts, undefined);
  });
});

test('a partially exposed weakpoint remains eligible through its real front contact when its centre is occluded', async () => {
  await harness((manager, sim) => {
    manager._spawnSite(sim, site('shoot_gate')); const gate = [...manager.targets()][0];
    const forward = new V(0, 0, 1).applyQuaternion(gate.quat);
    const eye = gate.weakpoint.pos.clone().addScaledVector(forward, -20);
    const front = gate.raycast(eye, forward, 22); assert.equal(front.zone.kind, 'weakpoint');
    // This real thin WORLD surface covers the centre/back of the sphere while
    // leaving its nearer front cap exposed. Shots hit that cap before the wall.
    const center = gate.weakpoint.pos.clone().addScaledVector(forward, -.13);
    const wall = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z).setRotation(gate.quat));
    sim.world.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, .02).setCollisionGroups(GROUPS.world), wall);
    sim.world.step(sim.eventQueue);
    assert.equal(manager._shooterLineOfSight(gate, eye, gate.weakpoint.pos, sim), false);
    assert.ok(manager.aimPoint(gate, eye, new V()), 'eligibility uses the first actual visible sphere contact');
    assert.equal(manager.applyHit(report(gate, front.point, { dir: forward.toArray() }), sim), true);
    assert.equal(gate.hp, 30);
  });
});

test('arch support is physically exposed after passing, has an open underpass and falls only behind the cleared truck', async () => {
  await harness((manager, sim, player) => {
    manager._spawnSite(sim, clearArchSite(sim));
    const arch = [...manager.targets()][0]; assert.equal(arch.bodies.length, 3);
    floor(sim, arch.groundY, arch.pos);
    const forward = new V(0, 0, 1).applyQuaternion(arch.quat), eye = arch.weakpoint.pos.clone().addScaledVector(forward, 25);
    const aim = manager.aimPoint(arch, eye, new V()); assert.ok(aim);
    const hit = arch.raycast(eye, aim.clone().sub(eye).normalize(), 30);
    assert.equal(hit.zone.kind, 'weakpoint');
    const under = arch.pos.clone(); under.y = arch.groundY + 1.4; under.addScaledVector(forward, -15);
    assert.equal(arch.raycast(under, forward, 30), null, 'the visible underpass is not an invisible wall');
    const nearEye = arch.weakpoint.pos.clone().addScaledVector(forward, -25);
    assert.equal(manager.aimPoint(arch, nearEye, new V()), null, 'the armored approach face cannot impersonate the rear fuse');
    assert.equal(manager.applyHit(report(arch, hit.point, { dmg: 100, dir: forward.clone().negate().toArray() }), sim), true);
    player.s = arch.s + 17; manager._arch(arch, DT, sim); assert.equal(arch.status, 'armed'); assert.equal(arch.bodies.length, 3);
    player.s = arch.s + 25; manager._arch(arch, DT, sim); assert.equal(arch.status, 'falling'); assert.equal(arch.bodies.length, 1);
    const startY = arch.pos.y, playerHp = player.hp;
    step(manager, sim, 180);
    assert.ok(arch.pos.y < startY - 3); assert.ok(['falling', 'rubble'].includes(arch.status)); assert.equal(player.hp, playerHp);
    assert.ok(arch.body.isValid(), 'falling rubble is a genuine owned Rapier body');
  });
});

test('rockfall has a readable tell, a real gravity fall, a clear escape lane and one bounded contact hit', async () => {
  await harness((manager, sim, player) => {
    const descriptor = site('rockfall', { biome: 'canyon' }); manager._spawnSite(sim, descriptor);
    const rocks = [...manager.targets()]; assert.equal(rocks.length, 3);
    const rock = rocks[0]; floor(sim, rock.groundY, rock.pos);
    player.s = descriptor.warningS - 1; step(manager, sim, 180); assert.equal(rock.status, 'armed'); assert.equal(rock.body, null);
    player.s = descriptor.warningS + 1; step(manager, sim, 120); assert.equal(rock.status, 'armed', 'no instant rockfall at the warning');
    step(manager, sim, 230); assert.ok(['falling', 'rubble'].includes(rock.status)); assert.ok(rock.pos.y < rock.groundY + 8);
    const sm = sim.road.sample(rock.s), lateral = (rock.pos.x - sm.x) * sm.nx + (rock.pos.z - sm.z) * sm.nz;
    assert.ok(lateral - rock.half.x >= -7 + descriptor.gap - .01, 'rocks do not fill the marked safe corridor');
    player.held = false; player.veh.pos.copy(rock.pos); const hp = player.hp;
    manager._dangerContacts(rock, sim, 24, 'crash'); manager._dangerContacts(rock, sim, 24, 'crash');
    assert.equal(player.hp, hp - 24); assert.equal(rock.contactT.size, 1);
  });
});

test('rolling barrels carry real backward relative velocity, can be shot safely and remain capped', async () => {
  await harness((manager, sim, player) => {
    const car = sim.spawnCar('e_sedan', { s: 1050, speed: 28 });
    const barrel = manager.dropBarrel(sim, car); assert.ok(barrel); assert.ok(barrel.body.isValid());
    const relative = new V().copy(barrel.body.linvel()).sub(new V().copy(car.veh.body.linvel())).dot(car.veh.fwd);
    assert.ok(relative < -13); assert.ok(barrel.body.angvel().x ** 2 + barrel.body.angvel().z ** 2 > 100);
    const hp = player.hp; manager.applyHit(report(barrel, barrel.pos, { dmg: 20, zone: 'body' }), sim);
    assert.equal(barrel.dead, true); assert.equal(barrel.body, null); assert.equal(player.hp, hp, 'shooting an enemy weapon does not hurt the player');
    for (let i = 0; i < STAGE_BARREL_LIMIT + 10; i++) manager.dropBarrel(sim, car);
    assert.equal([...manager.entities.values()].filter(a => a.kind === 'barrel' && !a.dead).length, STAGE_BARREL_LIMIT);
  });
});

test('authority and viewer share a bounded, transactional, monotonic state including idle sites and muzzle direction', async () => {
  await harness((manager, sim) => {
    manager._spawnSite(sim, site('gun_tower')); const actor = [...manager.targets()][0]; actor.age = 601;
    const guest = new StageEncounters({ authoritative: false }), snapshot = manager.snapshot();
    assert.equal(guest.applySnapshot(snapshot), true); assert.equal(guest.entities.size, 2);
    assert.deepEqual(guest.entities.get(actor.id).muzzle.toArray(), actor.muzzle.toArray());
    assert.deepEqual(guest.entities.get(actor.id).aimDirection.toArray(), actor.aimDirection.toArray());
    assert.equal(guest.applySnapshot(snapshot), false);
    for (const patch of [{ pos: [Infinity, 0, 0] }, { quat: [0, 0, 0, 2] }, { poseRevision: 65535 }, { weapon: 'remote-code' }, { muzzle: [NaN, 0, 0] }, { age: 1e8 }]) {
      const bad = structuredClone(snapshot); bad.tick++; Object.assign(bad.actors[0], patch);
      assert.equal(guest.applySnapshot(bad), false); assert.equal(guest.entities.size, 2); assert.equal(guest.lastSnapshotTick, snapshot.tick);
    }
    const crowded = structuredClone(snapshot); crowded.tick++; crowded.actors = Array.from({ length: STAGE_ACTOR_LIMIT + 1 }, (_, i) => ({ ...crowded.actors[0], id: 50000 + i }));
    assert.equal(guest.applySnapshot(crowded), false);
    guest.dispose(); assert.equal(guest.entities.size, 0);
  });
});

test('guest dynamic interpolation is bounded and weakpoint/muzzle follow the same rendered pose', async () => {
  await harness((manager, sim) => {
    manager._spawnSite(sim, site('flying_drone')); const actor = [...manager.targets()][0];
    const guest = new StageEncounters({ authoritative: false }); guest.applySnapshot(manager.snapshot());
    const start = guest.entities.get(actor.id).pos.clone(); actor.pos.x += 5; manager._refreshWeak(actor); manager._refreshMuzzle(actor); sim.tick++;
    assert.equal(guest.applySnapshot(manager.snapshot()), true); guest.updateGuest(1 / 60);
    const ghost = guest.entities.get(actor.id); assert.ok(ghost.pos.x > start.x && ghost.pos.x < actor.pos.x);
    assert.ok(ghost.weakpoint.pos.distanceTo(ghost.pos.clone().add(new V().fromArray(ghost.zones[0].c).applyQuaternion(ghost.quat))) < 1e-8);
    assert.ok(ghost.muzzle.distanceTo(ghost.pos.clone().add(new V(0, -.4, 0).applyQuaternion(ghost.quat)).addScaledVector(ghost.aimDirection, .6)) < 1e-8);
    actor.veh.poseRevision++; actor.pos.x += 40; manager._refreshWeak(actor); manager._refreshMuzzle(actor); sim.tick++;
    assert.equal(guest.applySnapshot(manager.snapshot()), true); assert.deepEqual(ghost.pos.toArray(), actor.pos.toArray(), 'recovery revisions snap rather than smearing a discontinuity');
    guest.dispose();
  });
});

test('coastal patrol boats spawn on real water above submerged terrain, not hovering on land', async () => {
  await harness((manager, sim) => {
    const descriptor = site('patrol_boat', { biome: 'coast' }); manager._spawnSite(sim, descriptor);
    const boats = [...manager.targets()]; assert.ok(boats.length > 0);
    const water = seaLevel(sim.road, 'coast');
    for (const boat of boats) {
      assert.equal(boat.kind, 'boat'); assert.ok(Math.abs(boat.pos.y - water - .45) < 1e-8);
      const ground = terrainPoint(sim.road, sim.seed, boat.baseS, boat.d, {}); assert.ok(ground.y < water - 1.5);
      assert.equal(boat.body, null, 'boats do not install an invisible land collider');
    }
  }, { mode: 'campaign', level: 3 });
});

test('stationary outpost colliders move away from branch ribbons or skip placement', async () => {
  await harness((manager, sim) => {
    const original = sim.road.corridorBlocked.bind(sim.road); let checked = 0;
    sim.road.corridorBlocked = () => { checked++; return true; };
    manager._spawnSite(sim, site('gun_tower')); assert.ok(checked > 5); assert.equal(manager.entities.size, 0);
    manager._spawnSite(sim, site('collapse_arch')); assert.equal(manager.entities.size, 0);
    sim.road.corridorBlocked = original;
  });
});

test('bounded encounter cleanup removes each owned body and collider label over repeated lives', async () => {
  await harness((manager, sim) => {
    manager._spawnSite(sim, site('shoot_gate')); manager._spawnSite(sim, clearArchSite(sim)); manager._spawnSite(sim, site('gun_tower'));
    const bodies = [...manager.entities.values()].flatMap(a => a.bodies), count = manager.colliderActors.size;
    assert.ok(count > 3);
    manager.dispose(sim); assert.equal(manager.entities.size, 0); assert.equal(manager.colliderActors.size, 0); assert.equal(manager.sites.size, 0);
    for (const body of bodies) assert.equal(body.isValid(), false);
    manager.dispose(sim);
  });
});

test('natural finite route planning cannot allocate encounters in the endless boss road', async () => {
  await harness((manager, sim, player) => {
    manager.plan = plannedStageEncounters(sim.road); const length = manager.plan.length;
    player.s = 900000; sim.tick = 15; manager.update(DT, sim);
    assert.equal(manager.entities.size, 0); assert.equal(manager.plan.length, length); assert.ok(length <= 12);
  });
});

test('tower front fuse and visible gunner head are genuine ray targets in authority and guest state', async () => {
  await harness((manager, sim) => {
    manager._spawnSite(sim, site('gun_tower')); const tower = [...manager.targets()][0];
    const forward = new V(0, 0, 1).applyQuaternion(tower.quat), eye = tower.weakpoint.pos.clone().addScaledVector(forward, -24);
    const weakHit = tower.raycast(eye, tower.weakpoint.pos.clone().sub(eye).normalize(), 30);
    assert.equal(weakHit.zone.kind, 'weakpoint');
    const back = tower.weakpoint.pos.clone().addScaledVector(forward, 24);
    assert.equal(tower.raycast(back, tower.weakpoint.pos.clone().sub(back).normalize(), 30).zone.kind, 'body', 'the fuse cannot be hit through a solid back slab');
    const headZone = tower.zones.find(z => z.kind === 'gunner_head');
    const head = new V().fromArray(headZone.c).applyQuaternion(tower.quat).add(tower.pos), headEye = head.clone().addScaledVector(forward, -20);
    const headHit = tower.raycast(headEye, forward, 30); assert.equal(headHit.zone.kind, 'gunner_head');
    const hp = tower.hp; assert.equal(manager.applyHit(report(tower, headHit.point, { zone: 'gunner_head', dmg: 10, dir: forward.toArray() }), sim), true); assert.equal(tower.hp, hp - 26);
    const guest = new StageEncounters({ authoritative: false }); assert.equal(guest.applySnapshot(manager.snapshot()), true);
    const ghost = guest.entities.get(tower.id); assert.equal(ghost.raycast(headEye, forward, 30).zone.kind, 'gunner_head');
    assert.equal(ghost.raycast(eye, tower.weakpoint.pos.clone().sub(eye).normalize(), 30).zone.kind, 'weakpoint'); guest.dispose();
  });
});

test('barrel convoy consumes budget only after an actual bounded carrier spawn and cleanup clears pending work', async () => {
  await harness((manager, sim, player) => {
    const descriptor = site('barrel_convoy'); manager._spawnSite(sim, descriptor);
    assert.equal(manager.pendingConvoys.size, 1); assert.equal(sim.cars.size, 1);
    sim.director.enabled = true; sim.director.budget = 0; player.s = descriptor.warningS + 5;
    manager._tryConvoys(sim); assert.equal(sim.cars.size, 1); assert.equal(manager.pendingConvoys.size, 1);
    sim.director.budget = 5; sim.time += .6; manager._tryConvoys(sim);
    const carrier = [...sim.cars.values()].find(c => c.spec.id === 'e_barrel_carrier');
    assert.ok(carrier); assert.equal(carrier.ai.behavior, 'dropper'); assert.equal(manager.pendingConvoys.size, 0);
    assert.equal(sim.director.budget, 2.8); assert.equal(sim.events.filter(e => e.t === 'stageConvoy').length, 1);
    manager._tryConvoys(sim); assert.equal(sim.cars.size, 2, 'one authored convoy does not allocate another car on repeated sync');
    manager.dispose(sim); assert.equal(manager.pendingConvoys.size, 0);
  });
});

test('only hostile shooter kills reward the player, once; scenery and dropped barrels cannot farm rewards', async () => {
  await harness((manager, sim) => {
    manager._spawnSite(sim, site('gun_tower')); const tower = [...manager.targets()][0];
    manager.damageActor(tower, 1000, { src: 1, zone: 'weakpoint', cause: 'bullet' }, sim);
    manager.damageActor(tower, 1000, { src: 1, zone: 'weakpoint', cause: 'bullet' }, sim);
    assert.equal(sim.stats.kills, 1); assert.equal(sim.events.filter(e => e.t === 'kill' && e.id === tower.id).length, 1);
    manager._spawnSite(sim, site('shoot_gate')); const gate = [...manager.targets()].find(a => a.kind === 'gate');
    manager.damageActor(gate, 1000, { src: 1, cause: 'bullet' }, sim);
    assert.equal(sim.stats.kills, 1); assert.equal(sim.events.filter(e => e.t === 'kill' && e.id === gate.id).length, 0);
  });
});

test('enemy vehicle cook-offs remain harmless through a barrel chain, while an actual enemy barrel weapon can hurt', async () => {
  await harness((manager, sim, player) => {
    const enemy = sim.spawnCar('e_sedan', { s: 1050, speed: 28 });
    const barrel = manager.dropBarrel(sim, enemy); barrel.pos.copy(player.veh.pos);
    const hp = player.hp, crew = Object.values(player.crew).map(c => c.hp), velocity = player.veh.body.linvel();
    manager.blast(barrel.pos, 8, 100, enemy.id, sim, enemy);
    assert.equal(barrel.dead, true); assert.equal(player.hp, hp); assert.deepEqual(Object.values(player.crew).map(c => c.hp), crew); assert.deepEqual(player.veh.body.linvel(), velocity);
    const weapon = manager.dropBarrel(sim, enemy); weapon.pos.copy(player.veh.pos);
    manager.damageActor(weapon, 12, { src: enemy.id, cause: 'contact' }, sim);
    assert.ok(player.hp < hp, 'a rolling barrel is an actual dodgeable enemy weapon, not an invulnerable decoration');
  });
});

test('stationary shooters telegraph, emit real traveling rounds from the visible muzzle and hit the truck through the existing projectile pipeline', async () => {
  await harness((manager, sim, player) => {
    manager._spawnSite(sim, site('gun_tower')); const tower = [...manager.targets()][0];
    const hp = player.hp, crewHp = Object.values(player.crew).map(c => c.hp);
    tower.fireT = 0; manager._shooter(tower, DT, sim);
    assert.equal(tower.firePhase, 1); assert.equal(sim.projectiles.bullets.length, 0);
    assert.ok(sim.events.some(e => e.t === 'stageAim' && e.id === tower.id));
    // Run the actual fixed-tick age/cooldown and traveling-projectile paths.
    // Individual readable burst rounds can legitimately miss; the complete
    // stationary firing window must still produce real truck damage.
    let first = null;
    for (let i = 0; i < 1200; i++) {
      sim.tick++; sim.time += DT; sim.world.step(sim.eventQueue); manager.update(DT, sim);
      if (!first) {
        first = sim.events.find(e => e.t === 'shot' && e.src === tower.id);
        if (first) { assert.equal(first.rays.length, 3); assert.deepEqual(first.origin, tower.muzzle.toArray()); }
      }
      sim.projectiles.update(DT, sim);
    }
    assert.ok(first, 'the telegraph resolves into a genuine burst');
    assert.ok(player.hp < hp || Object.values(player.crew).some((c, i) => c.hp < crewHp[i]), 'the rounds are authoritative damage, not only tracer art');
    assert.ok(sim.events.some(e => e.t === 'hit' && e.carId === player.id));
  });
});

test('terrain-hidden shooters cancel their tell and fire, then resume the real projectile pipeline after the obstruction clears', async () => {
  await harness((manager, sim, player) => {
    manager._spawnSite(sim, site('gun_tower')); const tower = [...manager.targets()][0];
    for (const actor of [...manager.entities.values()]) if (actor !== tower) manager._remove(actor.id, sim);
    // A genuine WORLD collider obstructs the entire sight line, including the
    // weak-point ray used by friendly AI; no custom target may bypass it.
    const midpoint = tower.muzzle.clone().lerp(player.veh.pos, .5);
    const barrier = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(midpoint.x, midpoint.y, midpoint.z));
    sim.world.createCollider(RAPIER.ColliderDesc.cuboid(3, 8, 3).setCollisionGroups(GROUPS.world), barrier);
    sim.world.step(sim.eventQueue);
    tower.firePhase = 1; tower.fireT = 0;
    manager._shooter(tower, DT, sim);
    assert.equal(tower.firePhase, 0); assert.equal(sim.projectiles.bullets.length, 0);
    assert.equal(sim.events.filter(e => e.t === 'stageAim' || e.t === 'shot').length, 0);
    assert.equal(manager.aimPoint(tower, player.veh.pos.clone().add(new V(0, 1.5, 0)), new V()), null);
    const hp = player.hp, crew = Object.values(player.crew).map(c => c.hp);
    for (let i = 0; i < 240; i++) {
      sim.tick++; sim.time += DT; sim.world.step(sim.eventQueue); manager.update(DT, sim); sim.projectiles.update(DT, sim);
    }
    assert.equal(sim.projectiles.bullets.length, 0); assert.equal(player.hp, hp);
    assert.deepEqual(Object.values(player.crew).map(c => c.hp), crew);
    sim.world.removeRigidBody(barrier); sim.world.step(sim.eventQueue);
    for (let i = 0; i < 1200; i++) {
      sim.tick++; sim.time += DT; sim.world.step(sim.eventQueue); manager.update(DT, sim); sim.projectiles.update(DT, sim);
    }
    assert.ok(sim.events.some(e => e.t === 'stageAim' && e.id === tower.id));
    assert.ok(sim.events.some(e => e.t === 'shot' && e.src === tower.id));
    assert.ok(player.hp < hp || Object.values(player.crew).some((c, i) => c.hp < crew[i]));
  });
});

test('water encounters keep real deck occlusion but can aim at the actual exposed gunner head through shared terrain meshes', async () => {
  for (const level of [3, 6]) await harness((manager, sim, oldPlayer) => {
    const descriptor = plannedStageEncounters(sim.road).find(s => s.kind === 'patrol_boat');
    assert.ok(descriptor, 'each water chapter has an authored boat encounter');
    sim.removeCar(oldPlayer);
    const player = sim.player = sim.spawnCar('player_sedan_t1', { kind: 'player', s: descriptor.s0 - 55, hold: true });
    sim.setGround(new SyncGround(sim)); sim.ground.update(descriptor.s0); sim.world.step(sim.eventQueue);
    manager._spawnSite(sim, descriptor);
    const boats = [...manager.targets()].filter(a => a.kind === 'boat'); assert.equal(boats.length, 2);
    const head = player.zones.find(z => z.kind === 'gunner_head');
    const exposed = new V().fromArray(head.c); exposed.y -= player.veh.restComHeight;
    exposed.applyQuaternion(player.veh.quat).add(player.veh.pos);
    const pavement = sim.road.pointAt(player.s, 0, {});
    const underside = new V(pavement.x, pavement.y - .2, pavement.z);
    for (const boat of boats) {
      assert.equal(boat.s, boat.baseS);
      assert.ok(Math.abs(boat.d) >= (level === 6 ? 195 : 180));
      assert.ok(Math.abs(boat.d) <= 225, 'submerged placement retries remain inside the measured reachable rifle envelope');
      const lowHull = player.veh.pos.clone().add(new V(0, .65, 0));
      // The preserved geometry probe proves the held coast sedan's COM+.65
      // point is already visible (pavement24.117, target25.437). Dam geometry
      // still blocks that low shot. Test the actual below-pavement endpoint in
      // both chapters instead of declaring every nominal hull point hidden.
      assert.equal(manager._shooterLineOfSight(boat, boat.muzzle, underside, sim), false, 'the real road/terrain remains a solid obstruction below its pavement');
      if (level === 6) assert.equal(manager._shooterLineOfSight(boat, boat.muzzle, lowHull, sim), false, 'the dam deck still blocks the low hull shot');
      boat.fireT = 0; manager._shooter(boat, DT, sim);
      assert.equal(boat.firePhase, 1, 'the real exposed crew target permits a readable threat');
      assert.equal(manager._shooterLineOfSight(boat, boat.muzzle, exposed, sim), true);
      const hit = player.raycast(boat.muzzle, boat.aimDirection, 260, null);
      assert.equal(hit?.zone.kind, 'gunner_head', 'the trajectory points to an actual player damage zone');
      assert.ok(manager.aimPoint(boat, exposed, new V()), 'the gunner can also see the actual exposed boat weak point');
      boat.fireT = 0; manager._shooter(boat, DT, sim);
      const shot = sim.events.find(e => e.t === 'shot' && e.src === boat.id);
      assert.ok(shot); assert.deepEqual(shot.origin, boat.muzzle.toArray());
    }
  }, { mode: 'campaign', level });
});
