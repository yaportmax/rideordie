import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TerrainStreamer } from '../src/world/terrain.js';
import { Road } from '../src/world/road.js';
import { genTerrainChunk, genRoadChunk, seaLevel } from '../src/world/terrain_gen.js';
import { initPhysics, createWorld, addStaticBox, removeBody, RAPIER, RAY_WORLD } from '../src/sim/physics.js';
import { Vehicle } from '../src/sim/vehicle.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { Sim, DT } from '../src/sim/sim.js';
import { Run } from '../src/game/run.js';
import { MINIBOSSES } from '../src/data/boss.js';

function streamerFixture(world, road, s) {
  const st = Object.create(TerrainStreamer.prototype);
  Object.assign(st, { world, road, seed: road.seed, chunks: new Map(), group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(), roadMat: new THREE.MeshBasicMaterial(), pending: new Set(), stats: { built: 0 }, _sLast: s });
  st.update = function(next) { this._sLast = next; for (const [c, rec] of this.chunks) this._collision(c, rec, next); };
  st.dispose = function() { for (const [c, rec] of this.chunks) this._dispose(c, rec); this.terrainMat.dispose(); this.roadMat.dispose(); };
  return st;
}
function reply(st, chunk, lod, road = !st.chunks.has(chunk)) {
  st._onMsg2({ busy: 1 }, { type: 'chunk', key: `${chunk}:${lod}`, chunk, lod, t: genTerrainChunk(st.road, st.seed, chunk, lod), r: road ? genRoadChunk(st.road, st.seed, chunk) : null });
}
function roadRay(world, road, s, d = 0) {
  const sm = road.sample(s), pos = { x: sm.x + sm.nx * d, y: road.surfaceY(sm, d) + 20, z: sm.z + sm.nz * d };
  world.step();
  return world.castRay(new RAPIER.Ray(pos, { x: 0, y: -1, z: 0 }), 100, true, undefined, RAY_WORLD);
}

test('fine terrain collision survives coarse visual LOD, drop, and reversal; actual vehicle stays supported', async () => {
  await initPhysics();
  const world = createWorld(DT), road = new Road(1), c = 8, s = c * 96 + 48, st = streamerFixture(world, road, s);
  let vehicle;
  try {
    reply(st, c, 0); const cache = st.chunks.get(c).tCol;
    assert.ok(roadRay(world, road, s)); assert.ok(roadRay(world, road, s, 20));
    st._sLast = s + 280; reply(st, c, 1);
    assert.equal(st.chunks.get(c).tCol, cache, 'render replacement must retain collision data');
    st.update(s + 360); assert.equal(roadRay(world, road, s), null); assert.equal(world.bodies.len(), 0);
    st.update(s + 280); assert.ok(roadRay(world, road, s)); assert.ok(roadRay(world, road, s, 20));
    const sm = road.sample(s); vehicle = new Vehicle(world, VEHICLES.truck_t1, { x: sm.x, y: sm.y, z: sm.z, yaw: sm.th });
    for (let i = 0; i < 240; i++) { vehicle.applyForces(DT, null); world.step(); vehicle.afterStep(); }
    assert.ok(vehicle.grounded >= 2); assert.ok(vehicle.pos.y > sm.y, 'reversed tile supports the real body, not only a readiness flag');
    vehicle.destroy(); vehicle = null; st.dispose(); assert.equal(world.bodies.len(), 0); assert.equal(st.chunks.size, 0);
  } finally { vehicle?.destroy(); st.dispose(); world.free(); }
});

test('first coarse reply creates asphalt independently; startup waits for both actual negative tile colliders', async () => {
  await initPhysics();
  const world = createWorld(DT), road = new Road(1), st = streamerFixture(world, road, 30);
  try {
    reply(st, 0, 1); assert.ok(st.chunks.get(0).colR); assert.equal(st.chunks.get(0).colT, null);
    assert.ok(roadRay(world, road, 30));
    reply(st, 0, 0); reply(st, 1, 0);
    assert.equal(st.groundReady(30), false, 'positive tiles cannot authorize an unseen approach behind the truck');
    reply(st, -1, 2);
    const approach = st.chunks.get(-1);
    assert.ok(approach.colR); assert.ok(approach.colT, 'negative coarse visuals already carry real fine terrain');
    assert.equal(st.groundReady(30), true);
    assert.ok(roadRay(world, road, -30)); assert.ok(roadRay(world, road, -30, 20));
    removeBody(world, approach.colR.rb); approach.colR = null;
    assert.equal(st.groundReady(30), false, 'terrain alone cannot stand in for asphalt support');
    assert.equal(roadRay(world, road, -30), null);
    st._collision(-1, approach, 30); assert.ok(approach.colR);
    assert.equal(st.groundReady(30), true);
    removeBody(world, approach.colT.rb); approach.colT = null;
    assert.equal(st.groundReady(30), false, 'asphalt alone cannot authorize the adjacent visible terrain');
    assert.ok(roadRay(world, road, -30)); assert.equal(roadRay(world, road, -30, 20), null);
    st._collision(-1, approach, 30); assert.ok(approach.colT);
    assert.equal(st.groundReady(30), true);
    st._dispose(-1, approach); assert.equal(st.groundReady(30), false);
    st.dispose(); assert.equal(world.bodies.len(), 0);
  } finally { st.dispose(); world.free(); }
});

async function liveFixture() {
  const sim = await new Sim({ seed: 381442461 }).init(); sim.systems.length = 0; sim.state = 'run';
  const s = 21043.870359, st = streamerFixture(sim.world, sim.road, s); sim.setGround(st);
  for (let c = 218; c <= 220; c++) reply(st, c, 0);
  const player = sim.spawnCar('truck_t1', { s, d: -4.53554, kind: 'player' });
  for (let i = 0; i < 240; i++) sim.step();
  assert.ok(player.veh.grounded >= 2); assert.equal(player._roadGrounded, true);
  sim.events.length = 0;
  return { sim, st, player };
}

test('delayed next tile holds the on-road car and resumes its saved actual Rapier velocity without healing', async () => {
  const { sim, st, player: p } = await liveFixture();
  try {
    sim.damageCar(p, 80, { cause: 'test' }); const hp = p.hp, damage = sim.stats.damageTaken;
    const missing = Math.floor((p.s + 80) / 96); st._dispose(missing, st.chunks.get(missing));
    p.veh.body.setLinvel({ x: 4, y: 0, z: 30 }, true); p.veh.body.setAngvel({ x: 0, y: .2, z: 0 }, true); p.veh.readState();
    const pose = p.veh.pos.toArray(); sim.step();
    assert.equal(p.held, true); assert.ok(p._groundHold); assert.deepEqual(p._groundHold.velocity, { x: 4, y: 0, z: 30 });
    assert.deepEqual(p.veh.prevPos.toArray(), p.veh.pos.toArray()); assert.deepEqual(p.veh.prevQuat.toArray(), p.veh.quat.toArray());
    for (let i = 0; i < 120; i++) sim.step();
    assert.deepEqual({ ...p.veh.body.translation() }, { x: pose[0], y: pose[1], z: pose[2] });
    assert.equal(p.hp, hp); assert.equal(sim.stats.damageTaken, damage);
    reply(st, missing, 0); sim.releaseCar(p);
    assert.equal(p.held, false); assert.equal(p._groundHold, null); assert.deepEqual({ ...p.veh.body.linvel() }, { x: 4, y: 0, z: 30 });
    assert.ok(Math.abs(p.veh.body.angvel().y - .2) < 1e-6);
    sim.step(); assert.ok(p.veh.pos.z > pose[2]); assert.equal(p.hp, hp);
  } finally { sim.dispose(); }
});

test('flip during a terrain hold refreshes upright pose immediately and does not restore old spin or charge repeatedly', async () => {
  const { sim, st, player: p } = await liveFixture();
  try {
    const missing = Math.floor((p.s + 80) / 96); st._dispose(missing, st.chunks.get(missing));
    p.veh.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true); p.veh.body.setAngvel({ x: 2, y: 0, z: 1 }, true); p.veh.readState();
    sim._protectGround(p); assert.equal(p.held, true);
    const run = Object.create(Run.prototype); run.player = p; run.sim = sim; run.effects = {};
    const hp = p.hp; run._unflip(); assert.ok(p.veh.up.y > .99); assert.equal(p.hp, hp - p.maxHp * .04);
    assert.deepEqual(p.veh.prevPos.toArray(), p.veh.pos.toArray()); assert.deepEqual(p._groundHold.angularVelocity, { x: 0, y: 0, z: 0 });
    for (let i = 0; i < 240; i++) run._driverActions(DT, { reset: true });
    assert.equal(p.hp, hp - p.maxHp * .04); reply(st, missing, 0); sim.releaseCar(p); assert.deepEqual({ ...p.veh.body.angvel() }, { x: 0, y: 0, z: 0 });
  } finally { sim.dispose(); }
});

test('a player killed during a terrain hold releases before wreck launch, preserving dying/explosion physics', async () => {
  const { sim, st, player: p } = await liveFixture();
  try {
    const missing = Math.floor((p.s + 80) / 96); st._dispose(missing, st.chunks.get(missing));
    sim.step(); assert.equal(p.held, true); assert.ok(p._groundHold);
    sim.damageCar(p, p.hp + 1, { cause: 'test' }); assert.equal(p.held, false); assert.ok(p.veh.body.linvel().y > 2);
    sim.step(); assert.equal(sim.state, 'dying');
    reply(st, missing, 0); sim.step(); assert.equal(p.held, false); assert.equal(p._groundHold, null);
    assert.equal(p.veh.body.bodyType(), RAPIER.RigidBodyType.Dynamic);
  } finally { sim.dispose(); }
});

test('exact live coastal below-asphalt state recovers once onto actual collision, preserving damage and horizontal velocity', async () => {
  const { sim, st, player: p } = await liveFixture();
  try {
    sim.damageCar(p, 80, { cause: 'test' }); const hp = p.hp, damage = sim.stats.damageTaken;
    p.veh.body.setTranslation({ x: 5019.75439453125, y: -235.38490295410156, z: 18390.88671875 }, true);
    p.veh.body.setLinvel({ x: 5.64601898, y: -88.05062866, z: 31.69244003 }, true); p.veh.readState();
    sim._recoverRoadFall(p);
    const groundY = st.roadHeightAt(p.s, p.veh.pos.x, p.veh.pos.z, 30.807824);
    assert.ok(groundY > 28 && groundY < 29); assert.ok(p.veh.pos.y > groundY); assert.ok(p.veh.pos.y < groundY + 2);
    assert.equal(p.veh.body.linvel().y, 0); assert.ok(Math.abs(p.veh.body.linvel().z - 31.69244003) < 1e-6);
    assert.equal(p.hp, hp); assert.equal(sim.stats.damageTaken, damage); assert.deepEqual(p.veh.prevPos.toArray(), p.veh.pos.toArray());
    assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
    sim._recoverRoadFall(p); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
  } finally { sim.dispose(); }
});

test('normal airborne motion, off-road cliffs and road-underpass travel do not trigger a hold or a teleport', async () => {
  const { sim, st, player: p } = await liveFixture();
  try {
    const sm = sim.road.sample(p.s), roadY = sim.road.surfaceY(sm, p.d), original = p.veh.pos.clone();
    const missing = Math.floor((p.s + 80) / 96); st._dispose(missing, st.chunks.get(missing));
    // Ramp launch writes body velocity after the cached telemetry/grounded count.
    p.veh.vel.y = 0; p.veh.body.setLinvel({ x: 0, y: 4, z: 20 }, true);
    sim._protectGround(p); assert.equal(p.held, false, 'actual upward launch must override stale grounded telemetry');
    p.veh.body.setTranslation({ x: original.x, y: roadY + 20, z: original.z }, true);
    p.veh.body.setLinvel({ x: 0, y: 5, z: 20 }, true); p.veh.readState(); p.veh.grounded = 0;
    sim._protectGround(p); assert.equal(p.held, false); sim._recoverRoadFall(p); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 0);
    p.d = -20; sim._recoverRoadFall(p); assert.equal(p._roadGrounded, false);
    p.d = 0; p.veh.body.setTranslation({ x: sm.x, y: roadY - 25, z: sm.z }, true); p.veh.readState();
    sim._recoverRoadFall(p); assert.equal(p.veh.pos.y, Math.fround(roadY - 25)); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 0);
    // A roof/terrain hit cannot satisfy recovery when the road collider itself is absent.
    p._roadGrounded = true; p._roadGroundedS = p.s; st._dropCol(st.chunks.get(Math.floor(p.s / 96)));
    sim._recoverRoadFall(p); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 0);
  } finally { sim.dispose(); }
});

async function coastalFixture() {
  const sim = await new Sim({ seed: 561889576 }).init(); sim.systems.length = 0; sim.state = 'run';
  const s = 22155.7795, st = streamerFixture(sim.world, sim.road, s); sim.setGround(st);
  for (let c = 229; c <= 233; c++) reply(st, c, 0);
  const player = sim.spawnCar('truck_t1', { s, d: 0, kind: 'player' });
  for (let i = 0; i < 180; i++) sim.step(); sim.events.length = 0;
  return { sim, st, player };
}

test('exact live sea-side submerged car returns to solid clear asphalt with one fall penalty and no progress/cash reset', async () => {
  const { sim, st, player: p } = await coastalFixture();
  try {
    p.s = 22155.7795; p.d = 123.51995; p.hp = 347.844;
    p.veh.body.setTranslation({ x: -307.025, y: -19.7048, z: 20196.2715 }, true);
    p.veh.body.setLinvel({ x: 8.3295, y: -.9453, z: 15.7317 }, true); p.veh.readState();
    sim.stats.cash = 654; sim.stats.distance = p.s + 12;
    const hp = p.hp, progress = p.s, damage = sim.stats.damageTaken;
    const bounds = st.recoveryBoundsAt(p.s); assert.ok(bounds.waterY > -13 && bounds.waterY < -11);
    sim._recoverOffroadFall(p);
    assert.ok(Math.abs(p.d) <= 2.7); assert.ok(Math.abs(p.s - progress) <= 60); assert.ok(p.veh.pos.y > 23);
    assert.equal(p.hp, hp - p.maxHp * .04); assert.equal(sim.stats.damageTaken, damage + p.maxHp * .04);
    assert.equal(sim.stats.cash, 654); assert.equal(sim.stats.distance, progress + 12);
    assert.ok(p.veh.vel.length() <= 12.001); assert.deepEqual(p.veh.prevPos.toArray(), p.veh.pos.toArray());
    assert.equal(sim.events.filter(e => e.t === 'groundRecovered' && e.reason === 'water').length, 1);
    for (let i = 0; i < 120; i++) sim.step(); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
    assert.ok(p.veh.pos.y > 20); assert.ok(p.veh.grounded >= 2);
  } finally { sim.dispose(); }
});

test('off-map live Bonecrusher returns ahead with health, attack phase and credit intact, then the encounter can finish normally', async () => {
  const { sim, player: p } = await coastalFixture();
  try {
    const M = MINIBOSSES[1]; sim.nextId = 85;
    const elite = sim.director.spawn(sim, 'e_muscle', .4, { behavior: M.behavior, side: -1, at: { s: 22269, d: -2, speed: 12 }, elite: { index: 1, name: M.name, hpMul: M.hpMul, massMul: M.massMul, armor: M.armor, weak: M.weak }, pattern: { ...M.pattern } });
    assert.ok(elite); assert.equal(elite.id, 85); elite.hp = 2088.3; elite.lastHitBy = 1; elite.lastHitT = sim.time;
    elite.ai.atk = { kind: 'crush', phase: 'line', t: .37 }; const atk = elite.ai.atk;
    elite.ai.dTs = -73; elite.ai._lastDT = -73;
    sim.director.minibossDone = new Set([0, 1]); sim.director.activeElite = { index: 1, name: M.name, cars: [elite], maxHp: elite.maxHp, hp01: elite.hp / elite.maxHp };
    elite.s = 22269; elite.d = -73;
    elite.veh.body.setTranslation({ x: -515.5297, y: -15392.7197, z: 20239 }, true);
    elite.veh.body.setLinvel({ x: -.707, y: -339.77, z: 1.648 }, true); elite.veh.readState();
    sim.director._cleanup(sim, p); assert.ok(sim.cars.has(85), 'the old retain-live-elite path demonstrates why void cars gated the run');
    sim._recoverOffroadFall(elite);
    assert.ok(elite.s > p.s + 60 && elite.s < p.s + 230); assert.ok(Math.abs(elite.d) <= 2.7); assert.ok(elite.veh.pos.y > 20);
    assert.equal(elite.hp, 2088.3); assert.equal(elite.lastHitBy, 1); assert.equal(elite.ai.atk, atk); assert.equal(elite.ai.atk.phase, 'line');
    assert.equal(elite.ai.dTs, elite.d); assert.equal(elite.ai._lastDT, elite.d);
    assert.equal(sim.director.activeElite.cars[0], elite); assert.equal(sim.stats.kills, 0); assert.equal(sim.events.filter(e => e.t === 'minibossDown').length, 0);
    const M0 = [...sim.director.minibossDone]; sim.director._bosses(sim, p, .4); assert.deepEqual([...sim.director.minibossDone], M0); assert.ok(sim.director.activeElite);
    sim.damageCar(elite, elite.hp + 1, { cause: 'test', src: 1 }); sim.director._bosses(sim, p, .4);
    assert.equal(sim.director.activeElite, null); assert.equal(sim.events.filter(e => e.t === 'minibossDown' && e.index === 1).length, 1); assert.equal(sim.stats.kills, 1);
  } finally { sim.dispose(); }
});

test('clear-road recovery rejects static obstacles and nearby cars, while playable dry terrain and airborne cliff travel remain free', async () => {
  const { sim, st, player: p } = await coastalFixture();
  try {
    const sm = sim.road.sample(p.s), original = p.veh.pos.toArray();
    p.d = 30; p.veh.body.setTranslation({ x: sm.x + sm.nx * 30, y: sm.y + 6, z: sm.z + sm.nz * 30 }, true); p.veh.readState();
    sim._recoverOffroadFall(p); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 0, 'airborne above water and physical terrain is valid');
    const gy = st.roadHeightAt(p.s, sm.x, sm.z, sm.y + 2);
    addStaticBox(sim.world, [sm.x, gy + 1.5, sm.z], [4, 1.5, 7]); sim.world.step();
    p.veh.body.setTranslation({ x: original[0], y: st.recoveryBoundsAt(p.s).minY - 50, z: original[2] }, true); p.veh.readState();
    const s = p.s; sim._recoverOffroadFall(p); assert.ok(Math.abs(p.s - s) >= 18, 'full hull query must reject the covered current-road location');
    assert.ok(p.veh.pos.y > 20); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
  } finally { sim.dispose(); }
});

test('the incoming dam transition carries the same physical water level as the visible lake and road strip', () => {
  const road = new Road(561889576), chunk = 519;
  const t = genTerrainChunk(road, road.seed, chunk, 0), r = genRoadChunk(road, road.seed, chunk), y = seaLevel(road, 'dam');
  assert.ok(y > -1000); assert.ok(Math.abs(t.aux[3] - y) < 1e-4); assert.ok(Math.abs(r.aux[3] - y) < 1e-4);
});
