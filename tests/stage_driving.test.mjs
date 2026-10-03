import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Road } from '../src/world/road.js';
import { RoadQuery } from '../src/sim/road_query.js';
import { BIOME_ORDER, BIOMES, MINIBOSS_S, BOSS_S } from '../src/data/biomes.js';
import { stageChallenges, stageObstacleSpan, drivingLaneTarget, protectedDrivingSpan, STAGE_DRIVING, STAGE_WARNING_DISTANCE, branchGeometry, projectDrivingBranch, drivingBranchRibbon } from '../src/world/driving_plan.js';
import { buildStageChallenge, stageObstaclePlacement } from '../src/world/dressing/driving.js';
import { InstList } from '../src/world/dressing/util.js';
import { loadDrivingAssets } from './helpers/driving-assets.mjs';
import { initPhysics, createWorld, RAPIER, GROUPS, RAY_WORLD, removeBody } from '../src/sim/physics.js';
import { StructureColliders } from '../src/sim/structure_colliders.js';
import { AIDriver } from '../src/game/ai_driver.js';
import { Sim, DT } from '../src/sim/sim.js';
import { genRoadChunk } from '../src/world/terrain_gen.js';
import { EnemyBrain } from '../src/sim/ai.js';

test('all six stages get deterministic increasingly demanding lane choices outside opening and boss clear zones', () => {
  for (const seed of [1, 7, 31, -9]) {
    const plan = stageChallenges(seed);
    assert.deepEqual(plan, stageChallenges(seed));
    for (const [bi, biome] of BIOME_ORDER.entries()) {
      const rows = plan.filter(f => f.biome === biome && f.type === 'stage_challenge');
      assert.ok(rows.length >= STAGE_DRIVING[biome].rows, biome + ' has a complete challenge');
      for (const f of rows) {
        assert.equal(protectedDrivingSpan(f.group.s0, f.group.s1), false);
        assert.ok(f.group.s0 >= 650 && f.group.s1 < BOSS_S - 1400);
        for (const at of MINIBOSS_S) assert.ok(f.group.s1 <= at - 1000 || f.group.s0 >= at + 1000);
        assert.equal(f.s0 - f.row * STAGE_DRIVING[biome].spacing - f.group.s0, STAGE_WARNING_DISTANCE);
        const span = stageObstacleSpan(f);
        assert.ok(span.gap >= 6.8 && span.width > 0);
        assert.ok(Math.abs(span.d) + span.width / 2 <= 7 + 1e-9);
      }
      if (bi) {
        assert.ok(STAGE_DRIVING[biome].rows >= STAGE_DRIVING[BIOME_ORDER[bi - 1]].rows);
        assert.ok(STAGE_DRIVING[biome].gap < STAGE_DRIVING[BIOME_ORDER[bi - 1]].gap);
      }
    }
  }
});

test('incremental worker generation yields the same route/features and keeps legacy jumps and gates separate', () => {
  const a = new Road(7), b = new Road(7);
  a.extendTo(61000);
  for (let s = 96; s < 61000; s += 731) b.extendTo(s);
  b.extendTo(61000);
  assert.deepEqual(a.features, b.features);
  assert.deepEqual(a.x, b.x); assert.deepEqual(a.y, b.y); assert.deepEqual(a.z, b.z);
  assert.ok(a.features.some(f => f.type === 'ramp'));
  assert.ok(a.features.some(f => f.type === 'boost'));
  assert.ok(a.features.some(f => f.type === 'bridge' || f.type === 'tunnel' || f.type === 'overpass'));
  for (const f of a.features) {
    if (!['ramp', 'boost', 'roadblock', 'bridge', 'tunnel', 'overpass'].includes(f.type)) continue;
    for (const p of a.drivingPlan.filter(p => p.type === 'stage_warning')) assert.ok(f.s1 <= p.group.s0 || f.s0 >= p.group.s1, f.type + ' clear of ' + p.challengeId);
  }
});

test('preserved road geometry remains forward and accelerated projection agrees with reference through every stage', () => {
  const road = new Road(31), q = new RoadQuery(road);
  road.extendTo(61000);
  for (let i = 1; i < road.n; i++) assert.ok(road.z[i] > road.z[i - 1], 'forward Z sample ' + i);
  for (let s = 0; s < 61000; s += 317) {
    const p = road.pointAt(s, (s % 13) - 6, {});
    assert.deepEqual(q.nearest(p.x, p.z, s, 60, {}), road.nearest(p.x, p.z, s, 60, {}));
  }
  for (const s of [...MINIBOSS_S, BOSS_S - 1000, BOSS_S]) {
    const bio = s >= 50000 ? 'dam' : s < 10000 ? 'desert' : s < 20000 ? 'canyon' : s < 30000 ? 'coast' : s < 41000 ? 'mountain' : 'city';
    assert.equal(road.params(s).kmax, BIOMES[bio].road.kmax);
  }
});

test('shared AI lane target commits early and does not change sides until the complete body clears a slice', () => {
  const road = new Road(7), first = road.drivingPlan.find(f => f.biome === 'city' && f.type === 'stage_challenge');
  const length = 9;
  assert.equal(drivingLaneTarget(road, first.s0 - 270, length), null);
  const early = drivingLaneTarget(road, first.s0 - 240, length, 265, {});
  assert.equal(early.d, stageObstacleSpan(first).gapD);
  assert.ok(early.speed >= 24 && early.speed <= 38);
  const overlap = drivingLaneTarget(road, first.s1 + length / 2, length, 265, {});
  assert.equal(overlap.row, first.row); assert.equal(overlap.d, early.d);
  const cleared = drivingLaneTarget(road, first.s1 + length / 2 + 4, length, 265, {});
  assert.equal(cleared.row, first.row + 1); assert.equal(cleared.d, -early.d);
});

test('actual enemy brain cancels attack weaving, stops boost and converges on the clear gap before a solid slice', async () => {
  const sim = await new Sim({ seed: 7 }).init();
  try {
    sim.director.enabled = false;
    const f = sim.road.drivingPlan.find(p => p.biome === 'dam' && p.type === 'stage_challenge');
    sim.spawnCar('truck_t1', { kind: 'player', s: f.s0 - 20, d: 0, speed: 25 });
    const car = sim.spawnCar('e_sedan', { s: f.s0 - 70, d: -3, speed: 45 });
    sim.start();
    // Vehicle.afterStep refreshes pose; real speed telemetry is computed by
    // applyForces in Sim.step. Use that path rather than a pose-only world step.
    sim.step(DT);
    assert.ok(car.veh.vf > 40, 'actual incoming speed remains above the approach cap');
    const brain = new EnemyBrain(car, sim, { behavior: 'chaser', skill: .7, level: .5, guns: {} });
    brain.atk = { kind: 'brake', phase: 'recover', t: 0 };
    for (let i = 0; i < 90; i++) brain.update(1 / 60);
    assert.equal(brain.atk, null);
    assert.equal(car.veh.input.nitro, false);
    assert.equal(brain.drivingSlice, true);
    assert.ok(Math.abs(brain._lastDT - stageObstacleSpan(f).gapD) < .001);
    assert.ok(car.veh.input.brake > 0, 'actual speed command brakes the approach');
  } finally { sim.dispose(); }
});

test('actual Director never materializes an enemy on a stage obstacle footprint and keeps clear road spawning', async () => {
  const sim = await new Sim({ seed: 7 }).init();
  try {
    const f = sim.road.drivingPlan.find(p => p.biome === 'city' && p.type === 'stage_challenge');
    const player = sim.spawnCar('truck_t1', { kind: 'player', s: f.s0 - 200, speed: 25 });
    sim.director.playerVmax = player.spec.engine.vmax;
    const before = sim.cars.size;
    assert.equal(sim.director.spawn(sim, 'e_sedan', .4, { at: { s: f.s0, d: stageObstacleSpan(f).d, speed: 20 } }), false);
    assert.equal(sim.cars.size, before);
    assert.ok(sim.director.spawn(sim, 'e_sedan', .4, { at: { s: f.s0 - 70, d: 0, speed: 20 } }));
    assert.equal(sim.cars.size, before + 1);
  } finally { sim.dispose(); }
});

function fixture(road, assets) {
  const lists = new Map(), requests = [];
  const kit = { get: id => id === 'road_cone' ? assets.get('jersey_barrier') : assets.get(id), state: id => id === 'road_cone' || assets.has(id) ? 'ready' : 'missing' };
  const ctx = { road, seed: road.seed, kit, pool: { register() {} }, hook: r => requests.push(r) };
  const chunk = { hooks: [], list(id) { if (!lists.has(id)) lists.set(id, new InstList()); return lists.get(id); } };
  return { ctx, chunk, lists, requests };
}

test('real shipped obstacle models and collision use identical matrices, retain the clear corridor and retire through chunk hooks', async () => {
  const assets = await loadDrivingAssets();
  const road = new Road(7);
  for (const biome of BIOME_ORDER) {
    const f = road.drivingPlan.find(p => p.biome === biome && p.type === 'stage_challenge'), asset = assets.get(STAGE_DRIVING[biome].asset);
    const { ctx, chunk, lists, requests } = fixture(road, assets);
    assert.equal(buildStageChallenge(ctx, chunk, f), true);
    assert.equal(requests.length, 1); assert.equal(chunk.hooks.length, 1);
    const placement = stageObstaclePlacement(road, f, asset), actual = new THREE.Matrix4().fromArray(lists.get(asset.name).m);
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(actual.elements[i] - placement.matrix.elements[i]) < .002, biome + ' same view/collision transform');
    const req = requests[0], sm = road.sample(f.s0, {}), gapStart = placement.span.gapD - f.gap / 2, gapEnd = placement.span.gapD + f.gap / 2;
    for (let i = 0; i < req.collision.pos.length; i += 3) {
      const d = (req.collision.pos[i] - sm.x) * sm.nx + (req.collision.pos[i + 2] - sm.z) * sm.nz;
      assert.ok(d < gapStart + .15 || d > gapEnd - .15, biome + ' no collision inside promised corridor');
    }
    assert.equal(req.type, 'static'); assert.ok(req.collision.idx.length > 0);
  }
});

test('actual Rapier blocks each stage obstacle while truck-width rays traverse its indicated lane and cleanup releases it', async () => {
  await initPhysics();
  const assets = await loadDrivingAssets(), road = new Road(7);
  for (const biome of BIOME_ORDER) {
    const f = road.drivingPlan.find(p => p.biome === biome && p.type === 'stage_challenge');
    const { ctx, chunk, requests } = fixture(road, assets);
    buildStageChallenge(ctx, chunk, f);
    const world = createWorld(1 / 60), structures = new StructureColliders(world);
    try {
      structures.hook(requests[0]); world.step();
      const span = stageObstacleSpan(f);
      const cast = d => {
        const p = road.pointAt(f.s0 - 12, d, {}), target = road.pointAt((f.s0 + f.s1) / 2, d, {});
        const delta = new THREE.Vector3(target.x - p.x, target.y - p.y, target.z - p.z).normalize();
        return world.castRay(new RAPIER.Ray({ x: p.x, y: p.y + Math.min(.5, STAGE_DRIVING[biome].height / 2), z: p.z }, { x: delta.x, y: delta.y, z: delta.z }), 30, true, undefined, RAY_WORLD);
      };
      assert.ok(cast(span.d), biome + ' real obstacle blocks approach');
      for (const d of [span.gapD - 1.75, span.gapD, span.gapD + 1.75]) assert.equal(cast(d), null, biome + ' clear vehicle-width approach');
      structures.hook({ type: 'remove', id: chunk.hooks[0] });
      assert.equal(structures.bodies.size, 0); assert.equal(world.bodies.len(), 0);
    } finally { structures.dispose(); world.free(); }
  }
});

test('real friendly AI drives solid canyon, city and dam chicanes without hull contact or flip on two different chassis', async () => {
  const assets = await loadDrivingAssets();
  for (const biome of ['canyon', 'city', 'dam']) for (const id of ['player_sedan_t1', 'truck_t4']) {
    const sim = await new Sim({ seed: 7 }).init();
    const structures = new StructureColliders(sim.world), roadBodies = [];
    try {
      sim.director.enabled = false;
      // This fixture proves the existing solid chicane with real car/road
      // physics. New armed encounters have separate damage/escape coverage.
      sim.encounters.plan = [];
      const first = sim.road.drivingPlan.find(f => f.biome === biome && f.type === 'stage_challenge');
      const rows = sim.road.drivingPlan.filter(f => f.challengeId === first.challengeId && f.type === 'stage_challenge');
      const start = first.s0 - 240, end = rows.at(-1).s1 + 70;
      for (let c = Math.floor((start - 50) / 96); c <= Math.ceil((end + 130) / 96); c++) {
        const r = genRoadChunk(sim.road, sim.seed, c);
        const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...r.anchor));
        sim.world.createCollider(RAPIER.ColliderDesc.trimesh(r.positions, Uint32Array.from(r.indices)).setCollisionGroups(GROUPS.world).setFriction(.9), body);
        roadBodies.push(body);
      }
      for (const row of rows) {
        const { ctx, chunk, requests } = fixture(sim.road, assets);
        buildStageChallenge(ctx, chunk, row);
        for (const req of requests) structures.hook(req);
      }
      const player = sim.spawnCar(id, { s: start, d: 0, speed: 25, kind: 'player' });
      let flips = 0, minHp = player.hp, reached = false;
      const ai = new AIDriver({ sim, player, _unflip() { flips++; } });
      sim.start();
      for (let i = 0; i < 7000; i++) {
        player.veh.setInput(ai.update(DT)); sim.step(DT);
        minHp = Math.min(minHp, player.hp);
        if (player.s >= end) { reached = true; break; }
      }
      assert.equal(reached, true, `${biome}/${id}: completes real physical chicane`);
      assert.equal(flips, 0, `${biome}/${id}: no corrective flip`);
      assert.equal(minHp, player.maxHp, `${biome}/${id}: avoids authored solid slices`);
    } finally {
      structures.dispose();
      for (const body of roadBodies) removeBody(sim.world, body);
      sim.dispose();
    }
  }
});

test('explicit branch mapping stays continuous forward/backward and its fine ribbon supports centre and wheel lanes', async () => {
  await initPhysics();
  const road = new Road(7), branch = branchGeometry(road, { id: 'test-service', s0: 2500, s1: 2980, side: 1, offset: 22, width: 8 });
  const ribbon = drivingBranchRibbon(road, branch), world = createWorld(1 / 60);
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.trimesh(ribbon.pos, ribbon.idx).setCollisionGroups(GROUPS.world), body); world.step();
  try {
    for (const order of [branch.nodes, [...branch.nodes].reverse()]) {
      let last = null;
      for (const node of order) {
        const p = projectDrivingBranch(branch, node.x, node.z, {});
        assert.ok(Math.abs(p.s - node.s) < .01); assert.ok(p.dist < .001);
        if (last != null) assert.ok(Math.abs(p.s - last) <= 3.01);
        last = p.s;
        const nx = Math.cos(node.heading), nz = -Math.sin(node.heading);
        for (const d of [-1.75, 0, 1.75]) {
          const hit = world.castRay(new RAPIER.Ray({ x: node.x + nx * d, y: node.y + 10, z: node.z + nz * d }, { x: 0, y: -1, z: 0 }), 20, true, undefined, RAY_WORLD);
          assert.ok(hit && hit.timeOfImpact < 12, 'ribbon physically supports s ' + node.s);
        }
      }
    }
  } finally { world.free(); }
});
