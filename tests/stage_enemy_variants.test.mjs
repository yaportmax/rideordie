import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Sim, DT } from '../src/sim/sim.js';
import { Director } from '../src/sim/director.js';
import { Vehicle } from '../src/sim/vehicle.js';
import { carPoint } from '../src/sim/ai.js';
import { ENEMIES, ENEMY_GUNS, ENCOUNTERS } from '../src/data/enemies.js';
import { VEHICLES, rideInfo, vehicleModelURL } from '../src/data/vehicles.js';
import { createEnemyVariantSpecs, ENEMY_VARIANT_IDS } from '../src/data/enemy_variants.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { rng } from '../src/core/util.js';
import { initPhysics, createWorld, addStaticBox } from '../src/sim/physics.js';

async function fixture(level, check) {
  const sim = await new Sim({ seed: 7, journey: { mode: 'campaign', level } }).init();
  try {
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: 40 });
    sim.director = new Director({ journey: sim.journey }); sim.director.r = rng(222);
    sim.ground = { hasColliderAt: () => true, roadHeightAt: s => sim.road.sample(s).y };
    sim.start(); sim.drainEvents();
    await check(sim, player, sim.director);
  } finally { sim.dispose(); }
}

test('new enemy catalogue identities append after the bus and retain independent geometry/crew contracts', () => {
  const ids = Object.keys(VEHICLES), variants = createEnemyVariantSpecs();
  assert.deepEqual(ids.slice(16, 23), ['e_double_bus', ...ENEMY_VARIANT_IDS]);
  assert.deepEqual(ids.slice(23), ['player_hummer_t1', 'player_tank_t1']);
  assert.equal(VEHICLES.player_tank_t1.kind, 'player');
  assert.equal(VEHICLES.player_tank_t1.family, 'tank');
  assert.equal(VEHICLES.player_tank_t1.driveMode, 'tracks');
  for (const id of ENEMY_VARIANT_IDS) {
    const spec = variants[id];
    assert.equal(spec.id, id); assert.equal(vehicleModelURL(spec), `/models/vehicles/${id}.glb`);
    assert.ok(spec.colliderModelFrame && spec.model && spec.model !== VEHICLES[id].model);
    assert.ok(spec.model.bbox.min[1] >= -.01 && spec.model.bbox.min[1] <= .01, id + ' tyres rest on the authored ground');
    assert.ok(spec.wheels.length === 4 && spec.wheelRadius > .35);
    assert.ok(spec.colliders.every(c => c.center.every(Number.isFinite) && c.half.every(n => n > 0)));
    assert.equal(spec.gunners, Object.keys(spec.seats).filter(role => role.startsWith('gunner') && spec.seats[role]).length);
  }
  assert.ok(variants.e_monster.wheelRadius > .75 && variants.e_monster.width > 3.1);
  assert.ok(variants.e_light_tank.mass > variants.e_monster.mass);
  assert.equal(variants.e_warwagon.gunners, 4);
});

test('each thematic encounter is affordable by the bounded budget and references a stage-compatible archetype', () => {
  for (const key of ['cindertrail', 'canyonlobbers', 'monstercharge', 'ironescort', 'siegepatrol', 'warparty']) {
    const encounter = ENCOUNTERS[key];
    assert.ok(encounter.biomes.length > 0);
    const cost = encounter.cars.reduce((sum, car) => sum + ENEMIES[car.k].cost * .85, 0);
    assert.ok(cost <= 14 && encounter.cars.length <= 2, key + ' does not bypass pacing/traffic limits');
    for (const car of encounter.cars) {
      const archetype = ENEMIES[car.k];
      assert.ok(VEHICLES[archetype.spec]);
      if (archetype.biomes) assert.ok(encounter.biomes.every(biome => archetype.biomes.includes(biome)));
      assert.ok(archetype.minLevel <= encounter.minLevel);
    }
  }
});

test('new variants reject wrong stages, duplicate live chassis and real physical overlapping spawns', async () => {
  for (const id of ENEMY_VARIANT_IDS) {
    const def = ENEMIES[id], level = TEN_LEVELS.findIndex(stage => stage.id === def.biomes[0]) + 1;
    await fixture(level, (sim, player, director) => {
      const at = { s: player.s + 200, d: 0, speed: 12 };
      const enemy = director.spawn(sim, id, .65, { at }); assert.ok(enemy, id + ' valid stage spawn');
      assert.equal(director.spawn(sim, id, .65, { at: { ...at, s: at.s + 80 } }), false, 'one live special per chassis');
      sim.removeCar(enemy, 'test live cap released');
      const obstruction = sim.spawnCar('e_heavy', { s: at.s, d: 0 });
      sim.world.step(sim.eventQueue); obstruction.veh.afterStep();
      const before = sim.cars.size;
      assert.equal(director.spawn(sim, id, .65, { at }), false, 'occupied actual hull rejected');
      assert.equal(sim.cars.size, before, 'rejected special frees its body/entity');
    });
    const wrong = TEN_LEVELS.findIndex(stage => !def.biomes.includes(stage.id)) + 1;
    await fixture(wrong, (sim, player, director) => {
      assert.equal(director.spawn(sim, id, .65, { at: { s: player.s + 200, d: 0, speed: 12 } }), false, 'stage restriction');
    });
  }
});

for (const id of ENEMY_VARIANT_IDS) test(`${id} settles, propels, steers and brakes its actual configured mass`, async () => {
  await initPhysics();
  const spec = VEHICLES[id], world = createWorld(DT), ground = addStaticBox(world, [0, -1, 0], [200, 1, 200], null, { friction: 1 });
  let vehicle;
  try {
    vehicle = new Vehicle(world, spec);
    const advance = (input, seconds) => {
      vehicle.setInput(input);
      for (let tick = 0; tick < seconds / DT; tick++) {
        vehicle.applyForces(DT, null); world.step(); vehicle.afterStep();
        assert.ok(vehicle.pos.toArray().every(Number.isFinite) && vehicle.quat.toArray().every(Number.isFinite));
        assert.ok(vehicle.up.y > .70, 'bounded manoeuvre remains upright');
      }
    };
    advance({}, 3);
    assert.equal(vehicle.grounded, 4);
    assert.ok(Math.abs(vehicle.pos.y - rideInfo(spec).restComHeight) < .06);
    assert.ok(Math.abs(vehicle.body.mass() - spec.mass) < .01);
    const initialZ = vehicle.pos.z;
    advance({ throttle: 1 }, 4);
    assert.ok(vehicle.pos.z > initialZ + 6 && vehicle.speed > 3);
    const yaw = Math.atan2(vehicle.fwd.x, vehicle.fwd.z);
    advance({ throttle: .5, steer: .20 }, 1.5);
    assert.ok(Math.atan2(vehicle.fwd.x, vehicle.fwd.z) > yaw + .01);
    const speed = vehicle.speed;
    advance({ brake: 1 }, 2);
    assert.ok(vehicle.speed < speed * .55);
    assert.equal(vehicle.poseRevision, 0);
  } finally {
    vehicle?.destroy(); world.removeRigidBody(ground.rb);
    assert.equal(world.bodies.len(), 0); assert.equal(world.colliders.len(), 0); world.free();
  }
});

test('warwagon arms four independent shooters and emits seat-connected role-specific shots', async () => {
  await fixture(5, (sim, player, director) => {
    const car = director.spawn(sim, 'e_warwagon', .65, { at: { s: player.s + 200, d: 0, speed: 12 } });
    assert.ok(car); assert.deepEqual(car.ai.gunRoles, ['gunner', 'gunner2', 'gunner3', 'gunner4']);
    assert.deepEqual(car.gunNames, { gunner: 'rifle', gunner2: 'smg', gunner3: 'shotgun', gunner4: 'mg' });
    const origins = [];
    for (const role of car.ai.gunRoles) {
      const seat = car.spec.seats[role], muzzle = carPoint(car, [seat[0], seat[1] + 1.35, seat[2]], new Vector3());
      car.ai.shoot(muzzle, role, car.ai.guns[role], car.ai.state[role]);
      const event = sim.events.findLast(event => event.t === 'shot');
      assert.equal(event.role, role); assert.equal(event.src, car.id); assert.deepEqual(event.origin, muzzle.toArray());
      origins.push(event.origin.map(value => value.toFixed(3)).join(','));
    }
    assert.equal(new Set(origins).size, 4); assert.equal(sim.projectiles.bullets.length, 10);
    assert.ok(sim.projectiles.bullets.every(bullet => bullet.owner === car.id && [bullet.vx, bullet.vy, bullet.vz].every(Number.isFinite)));
  });
});

test('grenadier throws a real bounded Rapier body with finite ballistic motion and a readable fuse', async () => {
  await fixture(2, (sim, player, director) => {
    const car = director.spawn(sim, 'e_grenadier', .65, { at: { s: player.s + 200, d: 0, speed: 12 } });
    assert.ok(car); car.ai.tgt.copy(player.veh.pos);
    const muzzle = carPoint(car, car.spec.seats.gunner.map((value, axis) => value + (axis === 1 ? 1.35 : 0)), new Vector3());
    car.ai.shoot(muzzle, 'gunner', ENEMY_GUNS.grenade, car.ai.state.gunner);
    assert.equal(sim.projectiles.grenades.length, 1);
    const grenade = sim.projectiles.grenades[0], event = sim.events.findLast(e => e.t === 'grenadeThrow');
    assert.ok(grenade.body.isValid()); assert.ok(grenade.fuse >= 1.6 && grenade.fuse === event.fuse);
    assert.equal(grenade.owner, car.id); assert.equal(event.src, car.id); assert.equal(event.role, 'gunner');
    assert.ok(Object.values(grenade.body.linvel()).every(Number.isFinite));
    assert.ok(grenade.body.linvel().y > 0, 'genuine arc rather than a hitscan grenade');
    for (let count = 0; count < 20; count++) car.ai.shoot(muzzle, 'gunner', ENEMY_GUNS.grenade, car.ai.state.gunner);
    assert.equal(sim.projectiles.grenades.length, 12, 'enemy throw cap bounds body growth');
    for (let tick = 0; tick < 2.5 / DT; tick++) { sim.world.step(sim.eventQueue); sim.projectiles.update(DT, sim); }
    assert.equal(sim.projectiles.grenades.length, 0);
    assert.equal(sim.events.filter(e => e.t === 'boom').length, 12, 'each physical fuse explodes once');
  });
});

test('cannon launches from the authored visible muzzle and preserves its real shell configuration and role', async () => {
  await fixture(5, (sim, player, director) => {
    const car = director.spawn(sim, 'e_light_tank', .65, { at: { s: player.s + 200, d: 0, speed: 12 } });
    assert.ok(car);
    const muzzle = carPoint(car, car.spec.gunMuzzles.gunner, new Vector3());
    car.ai.shoot(muzzle, 'gunner', ENEMY_GUNS.cannon, car.ai.state.gunner);
    const shell = sim.projectiles.rockets[0], event = sim.events.findLast(e => e.t === 'shot');
    assert.equal(shell.owner, car.id); assert.equal(shell.speed, 150); assert.equal(shell.gravity, 3.5);
    assert.deepEqual([shell.x, shell.y, shell.z], muzzle.toArray());
    assert.equal(event.role, 'gunner'); assert.equal(event.weapon, 'cannon'); assert.equal(event.launchSpeed, 150);
  });
});

test('fixed forward cannon never winds up at the player behind the barrel and tells before shooting ahead', async () => {
  await fixture(5, (sim, player, director) => {
    const car = director.spawn(sim, 'e_light_tank', .65, { at: { s: player.s + 200, d: 0, speed: 12 } });
    assert.ok(car); director.fireToken = () => true;
    car.veh.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    car.veh.body.setTranslation({ x: 0, y: car.veh.restComHeight, z: 0 }, true); car.veh.afterStep();
    player.veh.body.setTranslation({ x: 0, y: player.veh.restComHeight, z: -35 }, true); player.veh.afterStep();
    car.ai.state.gunner.t = 0; car.ai.gunnery(.1);
    assert.equal(car.ai.state.gunner.mode, 'idle'); assert.equal(sim.projectiles.rockets.length, 0);
    player.veh.body.setTranslation({ x: 0, y: player.veh.restComHeight, z: 35 }, true); player.veh.afterStep();
    car.ai.gunnery(.1);
    assert.equal(car.ai.state.gunner.mode, 'aim');
    const tell = sim.events.findLast(event => event.t === 'enemyTell');
    assert.equal(tell.kind, 'cannon'); assert.ok(tell.delay >= 1.6 && tell.delay <= 2.7);
    assert.equal(sim.projectiles.rockets.length, 0, 'readable wind-up precedes the shell');
    for (let tick = 0; tick < 150; tick++) car.ai.gunnery(.02);
    assert.equal(sim.projectiles.rockets.length, 1, 'real gunnery sends the authored forward shell');
  });
});

test('armored normal enemies block protected zones and radial/credited cook-off blasts while rear reactor shots damage and kill once', async () => {
  for (const id of ['e_armored', 'e_light_tank']) await fixture(5, (sim, player, director) => {
    const car = director.spawn(sim, id, .65, { at: { s: player.s + 200, d: 0, speed: 12 } });
    assert.ok(car);
    const before = {
      hp: car.hp, fuel: car.fuelHp, engine: car.engineHp, tires: car.tireHp.slice(),
      crew: Object.fromEntries(Object.entries(car.crew).map(([role, crew]) => [role, { hp: crew.hp, alive: crew.alive }])),
    };
    for (const zone of car.zones.filter(zone => zone.kind !== 'fuel')) sim.damageZone(car, { zone, throughBody: false }, 1000, { src: 1, cause: 'bullet' });
    assert.equal(car.hp, before.hp); assert.equal(car.engineHp, before.engine); assert.equal(car.fuelHp, before.fuel);
    assert.deepEqual(car.tireHp, before.tires);
    assert.deepEqual(Object.fromEntries(Object.entries(car.crew).map(([role, crew]) => [role, { hp: crew.hp, alive: crew.alive }])), before.crew);
    // A player's rocket splash and an attributed enemy cook-off both take the
    // real radial pipeline, including its different cause/credit rules.
    sim.world.step(sim.eventQueue); car.veh.afterStep();
    sim.blast(car.veh.pos.clone(), 8, 5000, 0, null, 1);
    const source = sim.spawnCar('e_sedan', { s: car.s + 30 });
    source.lastHitBy = 1; source.lastHitT = sim.time;
    sim.blast(car.veh.pos.clone(), 8, 5000, 0, source, source.id);
    assert.equal(car.hp, before.hp); assert.equal(car.exploded, false);
    assert.deepEqual(Object.fromEntries(Object.entries(car.crew).map(([role, crew]) => [role, { hp: crew.hp, alive: crew.alive }])), before.crew);
    const center = car.spec.hitZones.fuel.c;
    const origin = carPoint(car, [center[0], center[1], center[2] - 4], new Vector3());
    const direction = new Vector3(0, 0, 1).applyQuaternion(car.veh.quat);
    const hit = car.raycast(origin, direction, 6);
    assert.equal(hit?.zone.kind, 'fuel', id + ' real rear ray reaches its visible reactor');
    assert.equal(hit.throughBody, false, 'rear socket is outside the protected hull');
    sim.damageZone(car, hit, 30, { cause: 'bullet', src: 1, point: hit.point });
    assert.ok(car.hp < before.hp && car.hp > 0);
    assert.equal(car.lastHitBy, 1); assert.equal(sim.stats.kills, 0);
    sim.damageZone(car, hit, 10000, { cause: 'bullet', src: 1, point: hit.point });
    assert.ok(car.exploded); assert.equal(sim.events.filter(event => event.t === 'kill' && event.id === car.id).length, 1);
    sim.damageZone(car, hit, 10000, { cause: 'bullet', src: 1, point: hit.point });
    assert.equal(sim.events.filter(event => event.t === 'kill' && event.id === car.id).length, 1, 'never duplicate attribution/rewards');
  });
});

test('ordinary dropper telegraphs a bounded rolling-barrel attack and cancels when the player changes route', async () => {
  await fixture(1, (sim, player, director) => {
    const car = director.spawn(sim, 'e_barrel_carrier', .25, { at: { s: player.s + 200, d: 0, speed: 12 } });
    assert.ok(car); const drops = [], dropBarrel = sim.encounters.dropBarrel.bind(sim.encounters);
    sim.encounters.dropBarrel = (ownerSim, owner) => {
      const actor = dropBarrel(ownerSim, owner);
      if (actor) drops.push({ ownerSim, owner, actor });
      return actor;
    };
    car.s = player.s + 45; car.d = player.d; car.veh.up.set(0, 1, 0);
    car.ai.t = 5; car.ai.update(.01);
    assert.equal(drops.length, 0); assert.equal(sim.events.findLast(e => e.t === 'enemyTell').kind, 'barrel');
    car.ai.update(.60); assert.equal(drops.length, 0);
    car.ai.update(.11); assert.equal(drops.length, 1); assert.equal(drops[0].owner, car); assert.equal(drops[0].ownerSim, sim);
    assert.ok(drops[0].actor.body.isValid(), 'the telegraphed attack creates an actual rolling-barrel body');
    car.ai.update(.70); assert.equal(drops.length, 1, 'never drops every physics tick');
    car.ai.t += 4.3; car.ai.update(.01); player.route = 'other-route'; car.ai.update(.8);
    assert.equal(drops.length, 1, 'route-separated player cannot receive an invisible barrel attack');
  });
});
