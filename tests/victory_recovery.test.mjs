// Controlled actual-source recovery boundaries. No browser/device input or renderer.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { Sim, DT } from '../src/sim/sim.js';
import { TerrainStreamer } from '../src/world/terrain.js';
import { CHUNK_LEN, genTerrainChunk, genRoadChunk, genDrivingBranchChunk, terrainPoint } from '../src/world/terrain_gen.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { BIOMES, HALF_ROAD } from '../src/data/biomes.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { celebrationActive, verifiedBossClear } from '../src/sim/victory_presentation.js';

// Immutable actual pre-amendment methods retain the old over-phase exclusion.
// All imports are rebased to canonical live dependencies, never a WORK mirror.
const originalSimURL = new URL('../src/sim/sim.js', import.meta.url);
const beforeSource = await readFile(new URL('./fixtures/victory_before/sim_recovery.js.txt', import.meta.url), 'utf8');
const beforeImports = beforeSource.replace(/from (['"])([^'"\n]+)\1/g,
  (_match, quote, specifier) => `from ${quote}${specifier.startsWith('.') ? new URL(specifier, originalSimURL).href : import.meta.resolve(specifier)}${quote}`);
const { Sim: BeforeSim } = await import('data:text/javascript;base64,' + Buffer.from(beforeImports).toString('base64'));

function supportedGround(sim) {
  const stream = Object.create(TerrainStreamer.prototype);
  Object.assign(stream, { world: sim.world, road: sim.road, seed: sim.seed, chunks: new Map(),
    group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(), roadMat: new THREE.MeshBasicMaterial(),
    pending: new Set(), stats: { built: 0 }, _sLast: 0 });
  stream.update = function(s) {
    this._sLast = s;
    for (let c = Math.max(0, Math.floor((s - 330) / CHUNK_LEN)); c <= Math.floor((s + 400) / CHUNK_LEN); c++) {
      if (!this.chunks.has(c)) this._onMsg2({ busy: 1 }, { type: 'chunk', key: `${c}:0`, chunk: c, lod: 0,
        t: genTerrainChunk(sim.road, sim.seed, c, 0), r: genRoadChunk(sim.road, sim.seed, c),
        b: genDrivingBranchChunk(sim.road, sim.seed, c) });
    }
    for (const [c, rec] of this.chunks) {
      if ((c + .5) * CHUNK_LEN < s - 600 || (c + .5) * CHUNK_LEN > s + 700) this._dispose(c, rec);
      else this._collision(c, rec, s);
    }
  };
  stream.dispose = function() {
    for (const [c, rec] of this.chunks) this._dispose(c, rec);
    this.chunks.clear(); this.terrainMat.dispose(); this.roadMat.dispose();
  };
  return stream;
}

async function acceptedOver(level, seed = 7, spec = VEHICLES.truck_t1) {
  const sim = await new Sim({ seed, journey: { mode: 'campaign', level } }).init();
  try {
    const s = TEN_LEVELS[level - 1].bossDistance, ground = supportedGround(sim);
    ground.update(s); sim.setGround(ground);
    const car = sim.spawnCar(spec.id, { spec, s, kind: 'player', speed: 0 });
    car.veh.setInput({ throttle: 0, brake: 1, steer: 0, nitro: false, handbrake: false });
    sim.start(); sim.director._journeyBosses(sim, car, .3);
    if (level === 10) {
      const boss = sim.boss;
      assert.ok(boss?.body && boss.isBoss && !boss.dead);
      boss._die();
      for (let step = 0; step < 600 && !boss.exploded; step++) boss.update(DT);
      assert.equal(boss.exploded, true); assert.ok(boss.deathT > 4);
    } else {
      const elite = sim.director.activeElite;
      assert.ok(elite?.cars.length && elite.cars.every(boss => sim.cars.get(boss.id) === boss));
      for (const boss of elite.cars) sim.explodeCar(boss, 'bullet', 1);
    }
    sim.director._journeyBosses(sim, car, .3); sim._runState(DT);
    assert.equal(verifiedBossClear(sim), true); assert.equal(sim.state, 'run'); assert.equal(sim.won, false);
    const trace = [];
    for (let step = 0; step < 600 && sim.state !== 'over'; step++) {
      sim.step(DT);
      if (step % 60 === 0) trace.push({ step, tick: sim.tick, state: sim.state, why: sim.result?.why,
        s: car.s, d: car.d, pos: car.veh.pos.toArray(), hp: car.hp, alive: [car.crew.driver.alive, car.crew.gunner.alive] });
    }
    assert.equal(sim.state, 'over', JSON.stringify(trace)); assert.equal(sim.won, true); assert.equal(celebrationActive(sim), true);
    assert.ok(sim.wonT > 3, 'the authored delay advances naturally, never by assigning over or won');
    sim.drainEvents();
    return { sim, ground, car, trace };
  } catch (error) { sim.dispose(); throw error; }
}

function putBody(sim, car, position, yaw = sim.road.sample(car.s).th) {
  const vehicle = car.veh, quat = new THREE.Quaternion(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  vehicle.body.setTranslation({ x: position.x, y: position.y, z: position.z }, true);
  vehicle.body.setRotation(quat, true); vehicle.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  vehicle.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  vehicle.readState(); vehicle.prevPos.copy(vehicle.pos); vehicle.prevQuat.copy(vehicle.quat);
  const near = sim.roadQuery.projectDriving(vehicle.pos.x, vehicle.pos.z, car.s, 60, {});
  car.s = near.s; car.d = near.d; car.route = near.route; car.routeHalfWidth = near.halfWidth;
  car._roadGrounded = false; car._ditchRecovery = null;
}
const recoveries = sim => sim.events.filter(event => event.t === 'groundRecovered');
function protectedState(sim, car) {
  return structuredClone({ hp: car.hp, crew: car.crew, engine: car.engineHp, fuel: car.fuelHp, tires: car.tireHp,
    nitro: car.veh.nitro, nitroLocked: car.veh.nitroRechargeLocked, stats: sim.stats, frozen: sim.victoryStats });
}
function assertReturned(sim, ground, car, before, reason, revision) {
  const receipt = recoveries(sim).filter(event => event.id === car.id);
  const pavement = ground.roadHeightAt(car.s, car.veh.pos.x, car.veh.pos.z, car.veh.pos.y + 2);
  const diagnostic = JSON.stringify({ reason, pos: car.veh.pos.toArray(), s: car.s, d: car.d, revision: car.veh.poseRevision,
    pavement, receipt, bounds: ground.recoveryBoundsAt(car.s) });
  assert.equal(receipt.length, 1, diagnostic); assert.equal(receipt[0].reason, reason); assert.equal(receipt[0].penalty, false);
  assert.ok(pavement != null && Math.abs(car.veh.pos.y - pavement - car.veh.restComHeight - .15) < .001, diagnostic);
  assert.ok(Math.abs(car.d) <= 2.7 && car.route === null && car.routeHalfWidth === HALF_ROAD, diagnostic);
  assert.equal(car.veh.poseRevision, (revision + 1) & 0xffff);
  assert.deepEqual(protectedState(sim, car), before, 'protected recovery cannot charge, heal, refuel, change role gear or farm frozen statistics');
}

for (const [level, reason] of [[3, 'water'], [6, 'water'], [8, 'void'], [10, 'void']]) {
  test(`accepted chapter${level} natural-over ${reason} boundary returns to actual asphalt; old over guard remains a negative`, async () => {
    const { sim, ground, car, trace } = await acceptedOver(level);
    try {
      const s = car.s, bounds = ground.recoveryBoundsAt(s), bio = TEN_LEVELS[level - 1].id;
      assert.ok(bounds);
      let point;
      if (reason === 'water') {
        assert.ok(bounds.waterY != null, 'actual generated chapter carries water');
        for (let d = 60; d <= 240; d += 30) {
          const candidate = terrainPoint(sim.road, sim.seed, s, d * BIOMES[bio].terrain.seaSide, {});
          if (candidate.y + car.veh.restComHeight + .15 < bounds.waterY - 2) { point = candidate; break; }
        }
        assert.ok(point, 'bounded actual seaside terrain must lie beneath the authored water plane');
        point.y = bounds.waterY - 3;
      } else {
        point = terrainPoint(sim.road, sim.seed, s, 35, {}); point.y = bounds.minY - 14;
      }
      // Declared controlled boundary injection into the real rigid body, not a
      // natural earned fall. Both source methods query real authored bounds,
      // road triangles, shape/vehicle obstruction and placement eligibility.
      putBody(sim, car, point);
      const submergedPosition = car.veh.pos.toArray(), revision = car.veh.poseRevision;
      const before = protectedState(sim, car);
      BeforeSim.prototype._recoverOffroadFall.call(sim, car);
      assert.deepEqual(car.veh.pos.toArray(), submergedPosition, JSON.stringify(trace));
      assert.equal(recoveries(sim).length, 0, 'immutable old actual method excludes every over-phase rescue');
      sim._recoverOffroadFall(car); assertReturned(sim, ground, car, before, reason, revision);

      for (const policy of ['dying', 'ordinary-over', 'incomplete-proof']) {
        sim.drainEvents(); putBody(sim, car, point);
        const terminalPosition = car.veh.pos.toArray(), terminalRevision = car.veh.poseRevision;
        sim.state = policy === 'dying' ? 'dying' : 'over';
        sim.result = { why: policy === 'incomplete-proof' ? 'victory' : 'gunner' };
        const complete = sim.director.campaignComplete, finaleExploded = sim.boss?.exploded;
        if (policy === 'incomplete-proof') {
          if (level === 10) sim.boss.exploded = false;
          else sim.director.campaignComplete = false;
        }
        assert.equal(celebrationActive(sim), false, policy); sim._recoverOffroadFall(car);
        assert.deepEqual(car.veh.pos.toArray(), terminalPosition, policy); assert.equal(car.veh.poseRevision, terminalRevision, policy);
        assert.equal(recoveries(sim).length, 0, policy);
        sim.director.campaignComplete = complete;
        if (sim.boss) sim.boss.exploded = finaleExploded;
      }
      // Ordinary live driving retains its actual four-percent charge and
      // truthful receipt, while the same accepted presentation paid nothing.
      sim.state = 'run'; sim.victoryPresentation = false; sim.result = null;
      const hp = car.hp; sim._recoverOffroadFall(car);
      assert.equal(car.hp, hp - car.maxHp * .04);
      assert.equal(recoveries(sim).filter(event => event.id === car.id).at(-1)?.penalty, true);
    } finally { sim.dispose(); assert.equal(sim.world, null); assert.equal(sim.cars.size, 0); }
  });
}

test('accepted natural-over Stage4 actual grounded mountain beach retains real ditch eligibility and penalty-free bounded recovery', async () => {
  const pocket = { seed: 804921094, s: 2800, d: 60 };
  const { sim, ground, car } = await acceptedOver(4, pocket.seed, { ...VEHICLES.truck_t3, hp: 1368 });
  try {
    ground.update(pocket.s); car.s = pocket.s;
    const point = terrainPoint(sim.road, sim.seed, pocket.s, pocket.d, {});
    point.y += car.veh.restComHeight + .15;
    putBody(sim, car, point, sim.road.sample(pocket.s).th - Math.sign(pocket.d) * Math.PI / 2);
    car.veh.setInput({ throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false });
    const trace = [];
    for (let step = 0; step < 720; step++) {
      sim.step(DT);
      if (step % 60 === 0) trace.push({ stage: 'settle', step, tick: sim.tick, pos: car.veh.pos.toArray(),
        velocity: car.veh.body.linvel(), grounded: car.veh.grounded, up: car.veh.up.y, recovery: recoveries(sim) });
    }
    const near = sim.roadQuery.projectDriving(car.veh.pos.x, car.veh.pos.z, car.s, 60, {});
    const sample = sim.road.sample(near.s), pavement = ground.roadHeightAt(near.s, sample.x, sample.z, sample.y + 2);
    assert.ok(car.veh.grounded >= 1 && car.veh.vel.length() < 1.2 && Math.abs(car.veh.body.linvel().y) < .5, JSON.stringify(trace));
    assert.ok(near.dist > near.halfWidth + 2.5 && pavement > car.veh.pos.y - car.veh.restComHeight + 3, JSON.stringify(trace));
    assert.ok(car.veh.pos.y > ground.recoveryBoundsAt(car.s).minY - 12);
    assert.equal(recoveries(sim).length, 0, 'neutral real contact never requests relocation');
    let contacts = 0;
    for (const own of car.veh.colliders) sim.world.contactPairsWith(own, other => sim.world.contactPair(own, other, manifold => { contacts += manifold.numContacts(); }));
    assert.ok(contacts > 0, 'actual terrain physically contacts the hull');
    assert.equal(BeforeSim.prototype._mountainDitchSite.call(sim, car), null, 'immutable over-phase guard rejects the actual beach');
    assert.ok(sim._mountainDitchSite(car), 'candidate retains every actual physical/corridor/support qualification');
    const before = protectedState(sim, car), revision = car.veh.poseRevision, startTime = sim.time;
    car.veh.input.throttle = 1;
    for (let step = 0; step < 1440 && !recoveries(sim).length; step++) {
      sim.step(DT);
      if (step % 60 === 0) trace.push({ stage: 'failed-drive', step, tick: sim.tick, time: sim.time,
        pos: car.veh.pos.toArray(), velocity: car.veh.body.linvel(), grounded: car.veh.grounded, recovery: recoveries(sim) });
    }
    assert.ok(sim.time - startTime >= 4, 'real fixed steps establish the original sustained failed-drive threshold');
    assertReturned(sim, ground, car, before, 'ditch', revision);
    assert.equal(recoveries(sim)[0].manual, false);
    assert.ok(Number.isFinite(car.veh.pos.x + car.veh.pos.y + car.veh.pos.z), JSON.stringify(trace));
  } finally { sim.dispose(); assert.equal(sim.world, null); assert.equal(sim.cars.size, 0); }
});
