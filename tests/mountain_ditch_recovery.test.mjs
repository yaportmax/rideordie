import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sim, DT } from '../src/sim/sim.js';
import { TerrainStreamer } from '../src/world/terrain.js';
import { genTerrainChunk, genRoadChunk, genDrivingBranchChunk, terrainPoint, CHUNK_LEN } from '../src/world/terrain_gen.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { HALF_ROAD } from '../src/data/biomes.js';
import { addStaticBox } from '../src/sim/physics.js';
import { Road } from '../src/world/road.js';
import { Run } from '../src/game/run.js';

function assertSharedHullCrew(car) {
  for (const crew of Object.values(car.crew)) { assert.equal(crew.hp, car.hp); assert.equal(crew.max, car.maxHp); assert.equal(crew.alive, true); }
}

// Declared current-source pocket selected by the retained candidate probe.
// The original public stuck-run seed is unknown. These coordinates are derived
// from this road's real terrain and are not an exact live reproduction claim.
// Six neutral physics seconds establish two grounded wheels and real hull
// contact above the terrain floor. No contact/timer/time is assigned.
const pocket = { seed: 804921094, s: 2800, d: 60, neutralSteps: 720 };

function supportedGround(sim, s) {
  const st = Object.create(TerrainStreamer.prototype);
  Object.assign(st, { world: sim.world, road: sim.road, seed: sim.road.seed,
    chunks: new Map(), group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(),
    roadMat: new THREE.MeshBasicMaterial(), pending: new Set(), stats: { built: 0 }, _sLast: s });
  for (let c = Math.max(0, Math.floor((s - 160) / CHUNK_LEN)); c <= Math.floor((s + 160) / CHUNK_LEN); c++) {
    st._onMsg2({ busy: 1 }, { type: 'chunk', key: `${c}:0`, chunk: c, lod: 0,
      t: genTerrainChunk(st.road, st.seed, c, 0), r: genRoadChunk(st.road, st.seed, c),
      b: genDrivingBranchChunk(st.road, st.seed, c) });
  }
  st.update = function(next) { this._sLast = next; for (const [c, rec] of this.chunks) this._collision(c, rec, next); };
  st.dispose = function() { for (const [c, rec] of this.chunks) this._dispose(c, rec); this.terrainMat.dispose(); this.roadMat.dispose(); };
  return st;
}

function putBody(sim, car, pos, quat) {
  const v = car.veh, q = new THREE.Quaternion(...quat).normalize();
  v.body.setTranslation({ x: pos[0], y: pos[1], z: pos[2] }, true); v.body.setRotation(q, true);
  v.body.setLinvel({ x: 0, y: 0, z: 0 }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  v.readState(); v.prevPos.copy(v.pos); v.prevQuat.copy(v.quat);
  const n = sim.roadQuery.projectDriving(v.pos.x, v.pos.z, car.s, 60, {});
  car.s = n.s; car.d = n.d; car.route = n.route; car.routeHalfWidth = n.halfWidth;
}

async function currentDitch() {
  const sim = await new Sim({ seed: pocket.seed, journey: { mode: 'campaign', level: 4 } }).init();
  sim.systems.length = 0; sim.state = 'run';
  const st = supportedGround(sim, pocket.s); sim.setGround(st);
  const car = sim.spawnCar('truck_t3', { s: pocket.s, kind: 'player', spec: { ...VEHICLES.truck_t3, hp: 1368 } });
  const p = terrainPoint(sim.road, sim.seed, pocket.s, pocket.d, {}), yaw = sim.road.sample(pocket.s).th - Math.sign(pocket.d) * Math.PI / 2;
  putBody(sim, car, [p.x, p.y + car.veh.restComHeight + .15, p.z], [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]);
  for (let i = 0; i < pocket.neutralSteps; i++) sim.step(DT);
  return { sim, st, car };
}

const recovered = sim => sim.events.filter(e => e.t === 'groundRecovered');
function assertRealDitch(sim, st, car) {
  const v = car.veh, n = sim.roadQuery.projectDriving(v.pos.x, v.pos.z, car.s, 60, {});
  const sm = sim.road.sample(n.s), asphalt = st.roadHeightAt(n.s, sm.x, sm.z, sm.y + 2);
  const diagnostic = JSON.stringify({ seed: sim.seed, time: sim.time, pos: v.pos.toArray(), vel: v.body.linvel(), s: n.s, d: n.d,
    grounded: v.grounded, upY: v.up.y, asphalt, bounds: st.recoveryBoundsAt(n.s), recoveries: recovered(sim) });
  assert.ok(v.grounded >= 1, `production suspension must establish actual wheel contact: ${diagnostic}`);
  assert.ok(v.body.linvel().y > -.5 && v.body.linvel().y < .5, diagnostic);
  assert.ok(v.vel.length() < 1.2, `declared current-source pocket must settle, not be an airborne fall: ${diagnostic}`);
  assert.ok(n.dist > n.halfWidth + 2.5, 'the occupied surface is outside every accepted driving corridor');
  assert.ok(asphalt > v.pos.y - v.restComHeight + 3, 'real asphalt sits above the ditch');
  assert.ok(v.pos.y > st.recoveryBoundsAt(n.s).minY - 12, 'the existing void recovery cannot explain this case');
  assert.equal(car._roadGrounded, false);
  assert.equal(recovered(sim).length, 0);
  return n;
}

test('explicit neutral reset returns the real grounded mountain beach to asphalt without repairing damage, gear, cash or progress', async () => {
  const { sim, st, car } = await currentDitch();
  try {
    assertRealDitch(sim, st, car);
    let actualHullContacts = 0;
    for (const own of car.veh.colliders) sim.world.contactPairsWith(own, other => sim.world.contactPair(own, other, m => { actualHullContacts += m.numContacts(); }));
    assert.ok(actualHullContacts > 0, 'the selected real terrain pocket must physically contact the hull');
    const v = car.veh, originalS = car.s;
    car.hp -= 15; sim.damageCrew(car, 'gunner', 7, { cause: 'shot' }); car.engineHp = 61; car.fuelHp = 22;
    car.tireHp[0] = -1; v.wheels[0].flat = true; v.engineDamage = .39;
    v.nitro = .4; v.nitroRechargeLocked = true; v.nitroNeedsRelease = true; v.poseRevision = 65535;
    const hp = car.hp, tires = [...car.tireHp];
    sim.stats.cash = 789; sim.stats.distance = originalS + 80;
    assert.equal(v.input.throttle, 0); assert.equal(v.input.brake, 0);
    assert.equal(sim.requestDitchRecovery(car), true, 'explicit reset needs no accelerator or automatic interval');
    assert.equal(car.hp, hp - car.maxHp * .04); assertSharedHullCrew(car);
    assert.deepEqual(car.tireHp, tires); assert.equal(v.wheels[0].flat, true);
    assert.equal(car.engineHp, 61); assert.equal(car.fuelHp, 22); assert.equal(v.engineDamage, .39);
    assert.equal(v.nitro, .4); assert.equal(v.nitroRechargeLocked, true); assert.equal(v.nitroNeedsRelease, true);
    assert.equal(sim.stats.cash, 789); assert.equal(sim.stats.distance, originalS + 80);
    assert.ok(Math.abs(car.s - originalS) <= 60 && Math.abs(car.d) <= 2.7);
    const gy = st.roadHeightAt(car.s, v.pos.x, v.pos.z, v.pos.y + 2);
    assert.ok(gy != null && Math.abs(v.pos.y - gy - v.restComHeight - .15) < .001);
    assert.equal(v.poseRevision, 0); assert.deepEqual(v.prevPos.toArray(), v.pos.toArray()); assert.deepEqual(v.prevQuat.toArray(), v.quat.toArray());
    assert.equal(car.route, null); assert.equal(car.routeHalfWidth, HALF_ROAD);
    assert.equal(recovered(sim).length, 1); assert.equal(recovered(sim)[0].manual, true); assert.equal(recovered(sim)[0].reason, 'ditch');
    assert.equal(sim.requestDitchRecovery(car), false, 'a successful placement cannot charge a second rescue penalty');
    assert.equal(car.hp, hp - car.maxHp * .04);
  } finally { sim.dispose(); }
});

test('actual Run reset hold uses the real Sim recovery after one continuous second and does not repeatedly charge on the road', async () => {
  const { sim, st, car } = await currentDitch();
  try {
    assertRealDitch(sim, st, car);
    const run = Object.create(Run.prototype); Object.assign(run, { player: car, sim, effects: {} });
    const originalS = car.s, revision = car.veh.poseRevision;
    sim.stats.cash = 123; sim.stats.distance = originalS + 80;
    const frame = reset => { run._driverActions(DT, { reset }); sim.step(DT); };
    for (let i = 0; i < 119; i++) frame(true);
    assert.equal(recovered(sim).length, 0, 'a sub-second hold must not request rescue');
    frame(false);
    for (let i = 0; i < 119; i++) frame(true);
    assert.equal(recovered(sim).length, 0, 'release must discard the earlier partial hold');
    const hp = car.hp;
    for (let i = 0; i < 4 && !recovered(sim).length; i++) {
      run._driverActions(DT, { reset: true });
      if (!recovered(sim).length) sim.step(DT);
    }
    assert.equal(recovered(sim).length, 1); assert.equal(recovered(sim)[0].reason, 'ditch'); assert.equal(recovered(sim)[0].manual, true);
    assert.equal(sim.events.filter(e => e.t === 'unflip').length, 0, 'upright beached contact must use recovery, not the rolled-car path');
    assert.equal(car.hp, hp - car.maxHp * .04); assertSharedHullCrew(car);
    assert.equal(sim.stats.cash, 123); assert.equal(sim.stats.distance, originalS + 80);
    assert.equal(car.veh.poseRevision, (revision + 1) & 0xffff);
    const gy = st.roadHeightAt(car.s, car.veh.pos.x, car.veh.pos.z, car.veh.pos.y + 2);
    assert.ok(gy != null && Math.abs(car.veh.pos.y - gy - car.veh.restComHeight - .15) < .001);
    for (let i = 0; i < 360; i++) frame(true);
    assert.equal(recovered(sim).length, 1, 'continued reset on supported road must not charge repeated recovery penalties');
    assert.equal(sim.stats.damageBy.fall, car.maxHp * .04);
  } finally { sim.dispose(); }
});

test('declared current-source Stage 4 beach above the void bound recovers only after sustained failed driving onto verified asphalt', async () => {
  const { sim, st, car } = await currentDitch();
  try {
    assertRealDitch(sim, st, car);
    const v = car.veh, start = v.pos.clone(), originalS = car.s, hp = car.hp, priorFall = sim.stats.damageBy?.fall || 0;
    const revision = v.poseRevision;
    sim.stats.cash = 456; sim.stats.distance = originalS + 80;
    v.input.throttle = 1;
    // Production fixed steps establish the failed drive interval. Stop at the
    // first receipt so normal road acceleration cannot affect relocation checks.
    let waited = 0;
    for (; waited < 1440 && recovered(sim).length === 0; waited++) sim.step(DT);
    const receipt = recovered(sim);
    assert.equal(receipt.length, 1, 'the real beached vehicle must regain the road');
    assert.equal(receipt[0].reason, 'ditch'); assert.equal(receipt[0].penalty, true); assert.equal(receipt[0].manual, false);
    assert.ok(waited * DT >= 4, 'brief off-road contact is not enough');
    assert.ok(start.y < v.pos.y - 3);
    assert.ok(Math.abs(car.s - originalS) <= 60 && Math.abs(car.d) <= 2.7);
    assert.equal(car.route, null); assert.equal(car.routeHalfWidth, HALF_ROAD);
    const gy = st.roadHeightAt(car.s, v.pos.x, v.pos.z, v.pos.y + 2);
    assert.ok(gy != null && Math.abs(v.pos.y - gy - v.restComHeight - .15) < .001);
    assert.equal(v.poseRevision, (revision + 1) & 0xffff);
    assert.deepEqual(v.prevPos.toArray(), v.pos.toArray()); assert.deepEqual(v.prevQuat.toArray(), v.quat.toArray());
    assert.ok(car.hp <= hp - car.maxHp * .04, 'recovery must not repair any actual prior contact damage');
    assert.equal(sim.stats.damageBy.fall - priorFall, car.maxHp * .04); assertSharedHullCrew(car);
    assert.equal(sim.stats.cash, 456); assert.equal(sim.stats.distance, originalS + 80);
    assert.equal(car._ditchRecovery, null);
    for (let i = 0; i < 240; i++) sim.step(DT);
    assert.equal(recovered(sim).length, 1); assert.ok(v.grounded >= 1, 'the recovered car remains physically supported');
  } finally { sim.dispose(); }
});

test('neutral or Space-held actual mountain ditch contact is not a request for automatic relocation', async () => {
  const { sim, st, car } = await currentDitch();
  try {
    assertRealDitch(sim, st, car);
    const revision = car.veh.poseRevision;
    for (let i = 0; i < 600; i++) sim.step(DT);
    assert.equal(recovered(sim).length, 0); assert.equal(car._ditchRecovery, null);
    car.veh.input.throttle = 1; car.veh.input.handbrake = true;
    for (let i = 0; i < 600; i++) sim.step(DT);
    assert.equal(recovered(sim).length, 0); assert.equal(car.veh.poseRevision, revision);
    assert.equal(car._ditchRecovery, null);
  } finally { sim.dispose(); }
});

test('actual qualified legacy mountain fork remains free even though it is far outside the main strip', async () => {
  let representative;
  for (const seed of [1, 7, 11, 31, 12345, 381442461, 561889576]) {
    const road = new Road(seed), branch = road.ensureDrivingBranches().find(b => b.biome === 'mountain');
    if (branch) { representative = { seed, id: branch.id }; break; }
  }
  assert.ok(representative, 'the bounded seed set must contain an actual qualified legacy mountain fork');
  const sim = await new Sim({ seed: representative.seed }).init();
  sim.systems.length = 0; sim.state = 'run';
  try {
    const branch = sim.road.drivingBranch(representative.id); assert.ok(branch, 'the independently qualified branch must exist in this actual simulation');
    const s = (branch.s0 + branch.s1) / 2, st = supportedGround(sim, s); sim.setGround(st);
    const car = sim.spawnCar('truck_t1', { s, kind: 'player' }), p = sim.road.drivingPointAt(s, 0, branch.id);
    putBody(sim, car, [p.x, p.y + car.veh.restComHeight + .15, p.z], [0, Math.sin(p.th / 2), 0, Math.cos(p.th / 2)]);
    for (let i = 0; i < 240; i++) sim.step(DT);
    assert.ok(car.veh.grounded >= 2); assert.equal(car.route, branch.id);
    assert.ok(sim.roadQuery.nearest(car.veh.pos.x, car.veh.pos.z, s, 60, {}).dist > HALF_ROAD + 6);
    assert.equal(sim.requestDitchRecovery(car), false, 'explicit reset cannot relocate a healthy authored fork');
    const distance = car.spec.length / 2 + .8;
    // A real solid keeps commanded driving slow long enough to exceed the
    // entire interval. The qualified paved fork remains an authored route.
    addStaticBox(sim.world, [p.x + Math.sin(p.th) * distance, p.y + 1.5, p.z + Math.cos(p.th) * distance],
      [car.spec.width / 2 + .5, 1.5, .6], [0, Math.sin(p.th / 2), 0, Math.cos(p.th / 2)]);
    car.veh.input.throttle = .5;
    let supportedSlow = 0;
    for (let i = 0; i < 720; i++) {
      sim.step(DT);
      if (car.veh.grounded >= 1 && car.veh.body.linvel().x ** 2 + car.veh.body.linvel().y ** 2 + car.veh.body.linvel().z ** 2 < 1.44) supportedSlow++;
      assert.equal(car._ditchRecovery, null);
    }
    assert.ok(supportedSlow * DT > 4, 'actual supported, commanded slow driving must outlast the rescue interval');
    assert.equal(car.route, branch.id);
    assert.equal(recovered(sim).length, 0); assert.equal(car._ditchRecovery, null);
  } finally { sim.dispose(); }
});

test('a new ramp launch reads actual body velocity and discards an eligible ditch interval before cached grounding refreshes', async () => {
  const { sim, st, car } = await currentDitch();
  try {
    assertRealDitch(sim, st, car); car.veh.input.throttle = 1;
    // Build the interval through real wheel/physics steps, never by assigning a
    // timer or grounded count. The final call models step's post-ramp ordering.
    for (let i = 0; i < 180; i++) sim.step(DT);
    assert.ok(car._ditchRecovery, 'a commanded low-motion ditch must start monitoring');
    assert.ok(car.veh.grounded >= 1);
    car.veh.body.setLinvel({ x: 0, y: 4, z: 0 }, true);
    sim._recoverOffroadFall(car);
    assert.equal(car._ditchRecovery, null); assert.equal(recovered(sim).length, 0);
    assert.equal(sim.requestDitchRecovery(car), false);
    car.veh.body.setLinvel({ x: 4, y: 0, z: 0 }, true);
    sim._recoverOffroadFall(car);
    assert.equal(car._ditchRecovery, null); assert.equal(recovered(sim).length, 0, 'ordinary moving off-road travel remains free');
    assert.equal(sim.requestDitchRecovery(car), false);
  } finally { sim.dispose(); }
});

test('an actual grounded bridge ravine below the mountain deck remains playable instead of becoming a ditch rescue', async () => {
  const sim = await new Sim({ seed: 7, journey: { mode: 'campaign', level: 4 } }).init();
  sim.systems.length = 0; sim.state = 'run';
  try {
    const s = 1500;
    // A declared bridge descriptor drives the unchanged terrain dip and actual
    // deck collision. This avoids relying on a random seed containing a bridge.
    sim.road.features.push({ type: 'bridge', s0: s - 60, s1: s + 60, depth: 20 });
    const st = supportedGround(sim, s); sim.setGround(st);
    const car = sim.spawnCar('truck_t1', { s, kind: 'player' });
    let p;
    for (const d of [-13, 13, -16, 16]) {
      const candidate = terrainPoint(sim.road, sim.seed, s, d, {});
      const n = sim.roadQuery.projectDriving(candidate.x, candidate.z, s, 60, {});
      if (n.dist > n.halfWidth + 2.5) { p = candidate; break; }
    }
    assert.ok(p, 'bridge-side terrain must lie outside any accepted driving strip');
    const sm = sim.road.sample(s);
    putBody(sim, car, [p.x, p.y + car.veh.restComHeight + .15, p.z], [0, Math.sin(sm.th / 2), 0, Math.cos(sm.th / 2)]);
    for (let i = 0; i < 240; i++) sim.step(DT);
    assert.ok(car.veh.grounded >= 1, 'real generated ravine collision must support the car');
    assert.ok(car.veh.pos.y < sm.y - 3, 'the occupied underpass is genuinely below the deck');
    assert.ok(car.veh.pos.y > st.recoveryBoundsAt(car.s).minY - 12);
    assert.equal(car._roadGrounded, false);
    car.veh.input.throttle = .5;
    sim._recoverOffroadFall(car);
    assert.equal(car._ditchRecovery, null, 'actual supported, slow contact below a bridge deck is excluded immediately');
    assert.equal(sim.requestDitchRecovery(car), false, 'explicit reset preserves playable bridge terrain');
    for (let i = 0; i < 180; i++) sim.step(DT);
    assert.equal(car._ditchRecovery, null); assert.equal(recovered(sim).length, 0);
  } finally { sim.dispose(); }
});
