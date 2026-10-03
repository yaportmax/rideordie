import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Road, HALF_ROAD } from '../src/world/road.js';
import { RoadQuery } from '../src/sim/road_query.js';
import { branchPointAt, projectDrivingBranch, branchDrivingReserved, protectedDrivingSpan, drivingFootprintRadius, planDrivingBranches } from '../src/world/driving_plan.js';
import { TerrainStreamer } from '../src/world/terrain.js';
import { genTerrainChunk, genRoadChunk, genDrivingBranchChunk } from '../src/world/terrain_gen.js';
import { initPhysics, createWorld, RAPIER, GROUPS } from '../src/sim/physics.js';
import { Sim, DT } from '../src/sim/sim.js';
import { AIDriver } from '../src/game/ai_driver.js';
import { Run } from '../src/game/run.js';
import { InstList } from '../src/world/dressing/util.js';
import { buildDrivingBranches } from '../src/world/dressing/driving.js';
import { rng } from '../src/core/util.js';
import { loadDrivingAssets } from './helpers/driving-assets.mjs';

const SEEDS = [1, 7, 11, 31, 12345, 381442461, 561889576];
// Retain this suite's original two-stage scope. Campaign branches have separate
// qualification, scenery and physical tests rather than relabelling old results.
function initialRoad(seed) {
  const road = new Road(seed);
  road.drivingBranches = planDrivingBranches(road, ['desert', 'canyon']);
  return road;
}

function streamerFixture(world, road, s) {
  const st = Object.create(TerrainStreamer.prototype);
  Object.assign(st, { world, road, seed: road.seed, chunks: new Map(), group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(), roadMat: new THREE.MeshBasicMaterial(), pending: new Set(), stats: { built: 0 }, _sLast: s });
  st.update = function(next) { this._sLast = next; for (const [c, rec] of this.chunks) this._collision(c, rec, next); };
  st.dispose = function() { for (const [c, rec] of this.chunks) this._dispose(c, rec); this.terrainMat.dispose(); this.roadMat.dispose(); };
  return st;
}
function reply(st, chunk, lod, first = !st.chunks.has(chunk)) {
  st._onMsg2({ busy: 1 }, { type: 'chunk', key: `${chunk}:${lod}`, chunk, lod,
    t: genTerrainChunk(st.road, st.seed, chunk, lod), r: first ? genRoadChunk(st.road, st.seed, chunk) : null,
    b: first ? genDrivingBranchChunk(st.road, st.seed, chunk) : null });
}
function terrainBody(world, data) {
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...data.anchor));
  const col = world.createCollider(RAPIER.ColliderDesc.trimesh(data.positions, Uint32Array.from(data.indices)).setCollisionGroups(GROUPS.world), rb);
  return { rb, col };
}
function heightAt(col, p) {
  const hit = col?.castRayAndGetNormal(new RAPIER.Ray({ x: p.x, y: p.y + 8, z: p.z }, { x: 0, y: -1, z: 0 }), 16, true);
  return hit ? p.y + 8 - hit.timeOfImpact : null;
}
function putCarOnBranch(sim, car, branch, s, speed = 0) {
  const p = branchPointAt(sim.road, branch, s, 0, {}), v = car.veh;
  v.body.setTranslation({ x: p.x, y: p.y + v.restComHeight + .15, z: p.z }, true);
  v.body.setRotation({ x: 0, y: Math.sin(p.th / 2), z: 0, w: Math.cos(p.th / 2) }, true);
  v.body.setLinvel({ x: Math.sin(p.th) * speed, y: 0, z: Math.cos(p.th) * speed }, true);
  v.body.setAngvel({ x: 0, y: 0, z: 0 }, true); v.readState(); v.prevPos.copy(v.pos); v.prevQuat.copy(v.quat);
  const q = sim.roadQuery.projectDriving(v.pos.x, v.pos.z, s, 60, {});
  car.s = q.s; car.d = q.d; car.route = q.route; car.routeHalfWidth = q.halfWidth;
}

test('qualified shortcuts are bounded, deterministic and physically shorter without changing the original main-road geometry or boss clear zones', () => {
  const counts = [];
  for (const seed of SEEDS) {
    const a = initialRoad(seed), b = initialRoad(seed), c = new Road(seed);
    const branches = a.ensureDrivingBranches();
    assert.ok(a.sEnd <= 20256, 'planning stops in the first two stages');
    b.extendTo(61000); assert.deepEqual(branches, b.ensureDrivingBranches(), 'planning does not depend on prior request order');
    c.extendTo(a.sEnd);
    for (const key of ['x', 'y', 'z', 'th', 'k', 'bank']) assert.deepEqual(a[key], c[key], key + ' remains the original route');
    assert.ok(branches.length > 0 && branches.length <= 2, `seed ${seed} has conservative qualified coverage`);
    counts.push(branches.length);
    for (const branch of branches) {
      assert.ok(['desert', 'canyon'].includes(branch.biome));
      assert.ok(branch.saved >= 4); assert.ok(branch.maxGrade <= .085); assert.ok(branch.maxCurvature <= 1 / 70);
      assert.equal(protectedDrivingSpan(branch.s0 - 200, branch.s1 + 200), false);
      assert.equal(branchDrivingReserved(a.drivingPlan, branch.s0, branch.s1, 100), false);
      assert.equal(a.featuresIn(branch.s0 - 100, branch.s1 + 100).some(f => ['bridge', 'tunnel', 'overpass', 'roadblock', 'ramp', 'guard'].includes(f.type)), false);
    }
  }
  assert.ok(counts.includes(1), 'a nonqualifying desert bend is honestly absent rather than forced');
  assert.ok(counts.includes(2), 'both initial stages have tested qualifying seeds');
});

test('accelerated branch projection exactly matches the full polyline search, including reversed nodes, distant positions and endpoint ties', () => {
  const road = initialRoad(7), random = rng(71291);
  for (const branch of road.ensureDrivingBranches()) {
    assert.equal(branch.monotonicZ, true);
    const full = { ...branch, monotonicZ: false };
    for (let i = 0; i < 1600; i++) {
      const p = branchPointAt(road, branch, random.range(branch.s0 - 50, branch.s1 + 50), random.range(-250, 250), {});
      assert.deepEqual(projectDrivingBranch(branch, p.x, p.z, {}), projectDrivingBranch(full, p.x, p.z, {}));
    }
    for (const node of branch.nodes) assert.deepEqual(projectDrivingBranch(branch, node.x, node.z, {}), projectDrivingBranch(full, node.x, node.z, {}));
    const reversed = { ...branch, nodes: [...branch.nodes].reverse(), monotonicZ: false };
    for (const node of reversed.nodes) assert.ok(Math.abs(projectDrivingBranch(reversed, node.x, node.z, {}).s - node.s) < .0001);
  }
});

test('cached main projection stays in use while branch progress is continuous both ways, and reusing the output cannot leak the previous route', () => {
  const road = initialRoad(7), query = new RoadQuery(road), out = {};
  const original = road.nearest;
  road.nearest = () => { throw new Error('route queries bypassed the accepted accelerated nearest'); };
  try {
    for (const branch of road.ensureDrivingBranches()) for (const nodes of [branch.nodes, [...branch.nodes].reverse()]) {
      let last;
      for (const node of nodes) {
        query.projectDriving(node.x, node.z, node.s, 60, out);
        assert.ok(Math.abs(out.s - node.s) < .04, 'mapped original progress is continuous');
        if (last != null) assert.ok(Math.abs(out.s - last) <= 3.05);
        if (node.s > branch.s0 + 65 && node.s < branch.s1 - 65) assert.equal(out.route, branch.id);
        last = out.s;
      }
    }
    const p = road.pointAt(600, 2, {}); query.projectDriving(p.x, p.z, 600, 60, out);
    assert.equal(out.route, null); assert.equal(out.halfWidth, HALF_ROAD); assert.equal(out.arc, out.s);
    assert.ok(Math.abs(out.x - road.sample(out.s, {}).x) < .0001); assert.ok(Math.abs(out.z - road.sample(out.s, {}).z) < .0001);
  } finally { road.nearest = original; }
});

test('actual fine branch asphalt and carved terrain remain continuous and unobstructed across chunks at every visual LOD', async () => {
  await initPhysics();
  for (const seed of [7, 31]) {
    const road = initialRoad(seed);
    for (const branch of road.ensureDrivingBranches()) {
      const world = createWorld(DT);
      try {
        for (let c = Math.floor((branch.s0 - 4) / 96); c <= Math.floor((branch.s1 + 4) / 96); c++) {
          const bs = genDrivingBranchChunk(road, seed, c).find(b => b.route === branch.id);
          assert.ok(bs);
          const b = terrainBody(world, bs), original = genTerrainChunk(road, seed, c, 0);
          for (const lod of [0, 1, 2]) {
            const t = lod ? genTerrainChunk(road, seed, c, lod) : original;
            assert.deepEqual(t.positions, original.positions, 'every branch tile keeps fine terrain triangles');
            assert.ok(t.colPositions, 'first distant reply includes fine terrain support');
            const terrain = terrainBody(world, t);
            for (let s = Math.max(bs.s0, c * 96) + .15; s < Math.min(bs.s1, (c + 1) * 96); s += 9) for (const d of [-4.7, -2, 0, 2, 4.7]) {
              const p = branchPointAt(road, branch, s, d, {}), y = heightAt(b.col, p), ground = heightAt(terrain.col, p);
              assert.ok(y != null && Math.abs(y - p.y) < .035, `seed ${seed}, ${branch.id}, s${s}, d${d}, lod${lod}: fine strip support`);
              assert.ok(ground == null || ground < y - .015, `seed ${seed}, ${branch.id}, s${s}, d${d}, lod${lod}: terrain must not protrude through asphalt`);
            }
            world.removeRigidBody(terrain.rb);
          }
          world.removeRigidBody(b.rb);
        }
      } finally { world.free(); }
    }
  }
});

test('first coarse branch reply creates route-specific support and retains it through visual replacement, collision drop, reversal and disposal', async () => {
  await initPhysics();
  const road = initialRoad(7), branch = road.ensureDrivingBranches()[1], s = (branch.s0 + branch.s1) / 2;
  const world = createWorld(DT), st = streamerFixture(world, road, s);
  try {
    for (let c = Math.floor((s - 100) / 96); c <= Math.floor((s + 100) / 96); c++) reply(st, c, 2);
    const c = Math.floor(s / 96), rec = st.chunks.get(c), data = rec.branchData.get(branch.id), col = rec.colB.get(branch.id);
    const p = branchPointAt(road, branch, s, 0, {});
    assert.equal(st.groundReady(s, branch.id), true); assert.equal(st.hasColliderAt(s, branch.id), true);
    assert.ok(Math.abs(st.roadHeightAt(s, p.x, p.z, p.y + 2, branch.id) - p.y) < .035);
    assert.equal(st.roadHeightAt(s, p.x, p.z, p.y + 2, 'missing-route'), null);
    reply(st, c, 0); reply(st, c, 1);
    assert.equal(rec.branchData.get(branch.id), data); assert.equal(rec.colB.get(branch.id), col);
    st.update(s + 600); assert.equal(st.groundReady(s, branch.id), false); assert.equal(world.bodies.len(), 0);
    st.update(s); assert.equal(st.groundReady(s, branch.id), true);
    assert.ok(Math.abs(st.roadHeightAt(s, p.x, p.z, p.y + 2, branch.id) - p.y) < .035);
    st.dispose(); assert.equal(world.bodies.len(), 0); assert.equal(st.group.children.length, 0);
  } finally { st.dispose(); world.free(); }
});

test('route-aware actual simulation supports the car, holds a late branch tile, and recovers a below-strip fall once without changing health, cash or horizontal position', async () => {
  const sim = await new Sim({ seed: 7 }).init(); sim.systems.length = 0; sim.director.enabled = false;
  const branch = sim.road.ensureDrivingBranches()[1], s = (branch.s0 + branch.s1) / 2, st = streamerFixture(sim.world, sim.road, s);
  try {
    sim.setGround(st);
    for (let c = Math.floor((s - 100) / 96); c <= Math.floor((s + 150) / 96); c++) reply(st, c, 2);
    const car = sim.spawnCar('player_sedan_t1', { s, kind: 'player' }); putCarOnBranch(sim, car, branch, s); sim.start();
    for (let i = 0; i < 240; i++) sim.step(DT);
    assert.equal(car.route, branch.id); assert.equal(car.routeHalfWidth, branch.width / 2); assert.ok(car.veh.grounded >= 2);
    assert.ok(Math.abs(sim.roadQuery.nearest(car.veh.pos.x, car.veh.pos.z, car.s, 60, {}).d) > HALF_ROAD + 6, 'actual branch is physically separated from main asphalt');
    const hp = car.hp, cash = sim.stats.cash, damage = sim.stats.damageTaken;
    const missing = Math.floor((car.s + 80) / 96); st._dispose(missing, st.chunks.get(missing));
    car.veh.body.setLinvel({ x: 4, y: 0, z: 20 }, true); car.veh.readState(); sim._protectGround(car);
    assert.equal(car.held, true); assert.deepEqual(car._groundHold.velocity, { x: 4, y: 0, z: 20 });
    for (let i = 0; i < 30; i++) sim.step(DT);
    assert.equal(car.held, true); assert.equal(car.hp, hp);
    reply(st, missing, 2); sim.step(DT); assert.equal(car.held, false); assert.equal(car._groundHold, null);
    car.veh.body.setLinvel({ x: 0, y: 0, z: 0 }, true); car.veh.readState();
    for (let i = 0; i < 120; i++) sim.step(DT);
    assert.equal(car._roadGroundedRoute, branch.id);
    const p = car.veh.pos.clone(), roadY = sim.road.drivingPointAt(car.s, car.d, car.route).y;
    car.veh.body.setTranslation({ x: p.x, y: roadY - 12, z: p.z }, true);
    car.veh.body.setLinvel({ x: 5, y: -40, z: 20 }, true); car.veh.readState(); sim.events.length = 0;
    sim._recoverRoadFall(car);
    assert.ok(car.veh.pos.y > roadY); assert.equal(car.veh.pos.x, p.x); assert.equal(car.veh.pos.z, p.z);
    assert.deepEqual({ ...car.veh.body.linvel() }, { x: 5, y: 0, z: 20 });
    assert.equal(car.hp, hp); assert.equal(sim.stats.cash, cash); assert.equal(sim.stats.damageTaken, damage);
    assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
    sim._recoverRoadFall(car); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
  } finally { sim.dispose(); }
});

test('actual friendly AI follows the branch and its merge on sedan and truck chassis without a flip, terrain contact or progress skip', async () => {
  for (const id of ['player_sedan_t1', 'truck_t4']) {
    const sim = await new Sim({ seed: 7 }).init(); sim.systems.length = 0; sim.director.enabled = false;
    const branch = sim.road.ensureDrivingBranches()[1], start = branch.s0 + 90, st = streamerFixture(sim.world, sim.road, start);
    try {
      sim.setGround(st);
      // This static CPU fixture does not run a worker LOD scheduler. Supply
      // the fine continuation a real near-field worker would have delivered;
      // otherwise the correct ordinary-main readiness hold ends the fixture.
      for (let c = Math.floor((branch.s0 - 40) / 96); c <= Math.floor((branch.s1 + 180) / 96); c++) reply(st, c, 0);
      const car = sim.spawnCar(id, { s: start, kind: 'player' }); putCarOnBranch(sim, car, branch, start, 22);
      let flips = 0, reached = false, last = car.s, maxStep = 0;
      const ai = new AIDriver({ sim, player: car, _unflip() { flips++; } }); sim.start();
      for (let i = 0; i < 7000; i++) {
        car.veh.setInput(ai.update(DT)); sim.step(DT);
        maxStep = Math.max(maxStep, Math.abs(car.s - last)); last = car.s;
        if (car.s > branch.s1 + 60) { reached = true; break; }
      }
      assert.equal(reached, true, `${id}: physical branch and merge finish ${JSON.stringify({ s: car.s, d: car.d, route: car.route, hp: car.hp, state: sim.state, held: car.held, speed: car.veh.speed, pos: car.veh.pos.toArray(), end: branch.s1 + 60, grounded: car.veh.grounded, flips, cmd: ai.cmd })}`); assert.equal(flips, 0);
      assert.equal(car.hp, car.maxHp, `${id}: no terrain/hull damage`); assert.ok(maxStep < 1.5, 'original progress remains continuous');
      assert.equal(car.route, null); assert.equal(car.held, false);
    } finally { sim.dispose(); }
  }
});

test('readable directional entry/merge signs and per-chunk edge posts never stand in the main usable lane or duplicate on retries', () => {
  const road = initialRoad(7), branches = road.ensureDrivingBranches(), kit = { get() { return {}; } }, pool = { register() {} };
  for (const branch of branches) {
    let shortcuts = 0, merges = 0, posts = 0;
    for (let c = Math.floor((branch.s0 - 120) / 96); c <= Math.floor(branch.s1 / 96); c++) {
      const chunk = { s0: c * 96, done: new Set(), lists: new Map(), list(name) { if (!this.lists.has(name)) this.lists.set(name, new InstList()); return this.lists.get(name); } };
      assert.equal(buildDrivingBranches({ road, seed: road.seed, kit, pool }, chunk), true);
      const count = [...chunk.lists.values()].reduce((n, l) => n + l.n, 0);
      buildDrivingBranches({ road, seed: road.seed, kit, pool }, chunk);
      assert.equal([...chunk.lists.values()].reduce((n, l) => n + l.n, 0), count);
      for (const [name, list] of chunk.lists) {
        if (name.startsWith('driving_shortcut')) { shortcuts += list.n; assert.equal(name.endsWith(branch.side > 0 ? 'left' : 'right'), true); }
        if (name.startsWith('driving_merge')) { merges += list.n; assert.equal(name.endsWith(branch.side > 0 ? 'right' : 'left'), true); }
        if (name !== 'delineator') continue;
        posts += list.n;
        for (let i = 0; i < list.n; i++) {
          const x = list.m[i * 16 + 12], z = list.m[i * 16 + 14], q = road.nearest(x, z, c * 96 + 48, 180, {});
          assert.ok(Math.abs(q.d) > HALF_ROAD + .5, 'joins stay free of decorative posts');
        }
      }
    }
    assert.equal(shortcuts, 2); assert.equal(merges, 1); assert.ok(posts > 25);
  }
});

test('airborne branch travel retains its actual tangent, and an outboard shoulder receives inward correction relative to that branch', async () => {
  const sim = await new Sim({ seed: 7 }).init(); sim.director.enabled = false;
  try {
    const branch = sim.road.ensureDrivingBranches()[1], s = branch.s0 + 130, car = sim.spawnCar('truck_t1', { s, kind: 'player' });
    putCarOnBranch(sim, car, branch, s, 30);
    const p = sim.road.drivingPointAt(car.s, 0, car.route), main = sim.road.sample(car.s, {});
    assert.ok(Math.abs(p.th - main.th) > .08, 'test uses a branch heading meaningfully different from main');
    car.veh.body.setLinvel({ x: Math.sin(p.th) * 30, y: 0, z: Math.cos(p.th) * 30 }, true);
    const before = { ...car.veh.body.linvel() };
    car.veh.body.setLinvel({ x: before.x, y: 4, z: before.z }, true); sim._airSteer(car, 1 / 60);
    const aligned = { ...car.veh.body.linvel() };
    assert.ok(Math.abs(aligned.x - before.x) < .0001 && Math.abs(aligned.z - before.z) < .0001, 'legitimate flight is not pulled toward the other road');
    assert.equal(aligned.y, 4);
    car.d = branch.width / 2 - 1; sim._airSteer(car, 1 / 60);
    const corrected = car.veh.body.linvel(), lateralChange = (corrected.x - aligned.x) * Math.cos(p.th) - (corrected.z - aligned.z) * Math.sin(p.th);
    assert.ok(lateralChange < -.01, 'actual narrow-branch shoulder nudges inward'); assert.equal(corrected.y, 4);
  } finally { sim.dispose(); }
});

test('real driver unflip returns a fallen branch car above its solid strip facing the merge, preserves X/Z and charges only the requested flip penalty', async () => {
  const sim = await new Sim({ seed: 7 }).init(); sim.director.enabled = false;
  const branch = sim.road.ensureDrivingBranches()[1], s = branch.s0 + 130, st = streamerFixture(sim.world, sim.road, s);
  try {
    sim.setGround(st); for (let c = Math.floor((s - 80) / 96); c <= Math.floor((s + 100) / 96); c++) reply(st, c, 2);
    const car = sim.spawnCar('truck_t1', { s, kind: 'player' }); putCarOnBranch(sim, car, branch, s);
    const point = sim.road.drivingPointAt(car.s, car.d, car.route);
    car.veh.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    car.veh.body.setTranslation({ x: car.veh.pos.x, y: point.y - 6, z: car.veh.pos.z }, true);
    car.veh.body.setAngvel({ x: 3, y: 2, z: 1 }, true); car.veh.readState();
    const before = car.veh.pos.clone(), hp = car.hp, run = Object.create(Run.prototype); run.player = car; run.sim = sim;
    run._unflip();
    const actualRoad = st.roadHeightAt(car.s, car.veh.pos.x, car.veh.pos.z, car.veh.pos.y + 2, car.route);
    assert.ok(actualRoad != null && car.veh.pos.y > actualRoad + car.veh.restComHeight);
    assert.equal(car.veh.pos.x, before.x); assert.equal(car.veh.pos.z, before.z); assert.ok(car.veh.up.y > .99);
    assert.ok(Math.abs(car.veh.fwd.x - Math.sin(point.th)) < .00001 && Math.abs(car.veh.fwd.z - Math.cos(point.th)) < .00001);
    assert.deepEqual({ ...car.veh.body.angvel() }, { x: 0, y: 0, z: 0 }); assert.equal(car.hp, hp - car.maxHp * .04);
    assert.deepEqual(car.veh.prevPos.toArray(), car.veh.pos.toArray()); assert.deepEqual(car.veh.prevQuat.toArray(), car.veh.quat.toArray());
    run._unflip(true); assert.equal(car.hp, hp - car.maxHp * .04, 'free AI correction adds no extra penalty');
  } finally { sim.dispose(); }
});

test('whole asset reservation covers real shipped model corners, off-centre geometry and collision extending beyond the visible box', async () => {
  const assets = await loadDrivingAssets();
  for (const asset of assets.values()) {
    const radius = drivingFootprintRadius(asset, 1.6);
    for (const part of asset.parts) {
      const pos = part.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) assert.ok(Math.hypot(pos[i], pos[i + 2]) * 1.6 <= radius + .0001);
    }
    const pos = asset.collision?.pos;
    if (pos) for (let i = 0; i < pos.length; i += 3) assert.ok(Math.hypot(pos[i], pos[i + 2]) * 1.6 <= radius + .0001);
  }
  const road = initialRoad(7), branch = road.ensureDrivingBranches()[1], s = (branch.s0 + branch.s1) / 2;
  const p = branchPointAt(road, branch, s, 15, {});
  const offCentre = { radius: 1, box: new THREE.Box3(new THREE.Vector3(-1, 0, 5), new THREE.Vector3(1, 2, 7)), collision: { pos: Float32Array.from([0, 0, 9]) } };
  assert.equal(road.corridorBlocked(p.x, p.z, offCentre.radius, s), false, 'asset origin alone misses the physically overlapping model');
  assert.equal(road.corridorBlocked(p.x, p.z, drivingFootprintRadius(offCentre), s), true, 'the complete model is removed before view and collision are emitted');
});
