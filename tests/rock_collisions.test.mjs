import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { loadRockAssets, ROCK_IDS } from './helpers/rock-assets.mjs';
import { isSolidRock, rockCollisionMesh, RockCollisionBatch } from '../src/world/dressing/rock_collisions.js';
import { InstList, ChunkGround, CHUNK_LEN } from '../src/world/dressing/util.js';
import { runScatter } from '../src/world/dressing/scatter.js';
import { SCATTER, tierOf } from '../src/world/dressing/types.js';
import { Dressing } from '../src/world/dressing.js';
import { Road } from '../src/world/road.js';
import { StructureColliders } from '../src/sim/structure_colliders.js';
import { Sim, DT } from '../src/sim/sim.js';
import { Run } from '../src/game/run.js';
import { initPhysics, createWorld, RAPIER, GROUPS, RAY_SHOT, RAY_WORLD, COLLIDER_LABELS, getColliderLabel, removeBody } from '../src/sim/physics.js';

const entryOf = id => SCATTER.find(e => e.id === id);
function putRock(asset, scale = 1.8, x = 12, y = 0, z = 20, yaw = 0, normal = [0, 1, 0]) {
  const entry = entryOf(asset.name), list = new InstList(), batch = new RockCollisionBatch();
  list.push(x, y - entry.sink * asset.height * scale, z, yaw, scale * .95, scale, scale * 1.05, ...normal, entry.align, asset.sphere.radius * scale);
  batch.add(entry, asset, scale, list.m, 0);
  const requests = [], chunk = { c: 0, hooks: [] };
  batch.flush({ hook: r => requests.push(r) }, chunk, tierOf(entry));
  return { entry, list, batch, requests, chunk };
}

test('actual shipped boulders retain disconnected gaps and pillars retain their concave exact surface', async () => {
  const assets = await loadRockAssets();
  for (const id of ROCK_IDS) {
    const asset = assets.get(id), mesh = rockCollisionMesh(asset);
    assert.strictEqual(rockCollisionMesh(asset), mesh, id + ' cache');
    assert.ok(mesh.length, id + ' collision geometry');
    if (/rock_0[56]|boulder/.test(id)) assert.equal(mesh.length, 3, id + ' separate stones');
    if (id.startsWith('canyon_pillar')) assert.equal(mesh[0].idx.length / 3, asset.tris, id + ' exact concave surface');
    else for (const c of mesh) {
      assert.ok(c.idx.length / 3 < asset.tris, id + ' reduced collision surface');
      for (let i = 0; i < c.pos.length; i += 3) assert.ok(c.box.containsPoint(new THREE.Vector3(c.pos[i], c.pos[i + 1], c.pos[i + 2])), id + ' vertices stay inside real component');
    }
    assert.ok(mesh.every(c => [...c.pos].every(Number.isFinite)));
  }
});

test('car-sized rock selection excludes pebbles and vegetation and exact matrices retain yaw, slope, scale and sink', async () => {
  const assets = await loadRockAssets(), pebble = assets.get('rock_01'), big = assets.get('boulder_03');
  assert.equal(isSolidRock(entryOf('rock_01'), pebble, 1.7), false);
  assert.equal(isSolidRock(entryOf('rock_01'), pebble, 3.8), true);
  assert.equal(isSolidRock({ ...entryOf('boulder_03'), cat: 'cactus' }, big, 2), false);
  const { entry, list, batch } = putRock(big, 2.1, 1042, 14, -901, 1.2, [.2, .96, -.1]);
  const m = new THREE.Matrix4().fromArray(list.m), v = new THREE.Vector3(); let j = 0;
  for (const c of rockCollisionMesh(big)) {
    if ((c.box.max.y - entry.sink * big.height) * 2.1 < .6 || Math.max(c.box.max.x - c.box.min.x, c.box.max.z - c.box.min.z) * 2.1 < 1.2) continue;
    for (let i = 0; i < c.pos.length; i += 3) {
      v.fromArray(c.pos, i).applyMatrix4(m);
      assert.equal(batch.pos[j++], v.x); assert.equal(batch.pos[j++], v.y); assert.equal(batch.pos[j++], v.z);
    }
  }
  assert.equal(j, batch.pos.length);
});

test('actual Rapier truck hits a shipped rock with real crash response and world/projectile rays are blocked', async () => {
  const assets = await loadRockAssets();
  for (const enabled of [false, true]) {
    const sim = await new Sim({ seed: 7 }).init(), structures = new StructureColliders(sim.world);
    try {
      sim.director.enabled = false;
      const floor = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -.5, 25));
      sim.world.createCollider(RAPIER.ColliderDesc.cuboid(70, .5, 90).setCollisionGroups(GROUPS.world), floor);
      const { requests } = putRock(assets.get('boulder_03'), 1.8);
      if (enabled) for (const r of requests) structures.hook(r);
      sim.structures = structures;
      const player = sim.spawnCar('truck_t1', { kind: 'player', s: 0, speed: 0 });
      player.veh.body.setTranslation({ x: 12, y: player.veh.restComHeight + .05, z: 0 }, true);
      player.veh.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      player.veh.body.setLinvel({ x: 0, y: 0, z: 28 }, true);
      player.veh.afterStep(); player.veh.setInput({ throttle: .5 });
      structures.updateRocks(sim.cars.values(), 100);
      sim.start(); sim.drainEvents(); sim.world.step(sim.eventQueue); player.veh.afterStep();
      assert.ok(player.veh.body.mass() > 0);
      const ray = new RAPIER.Ray({ x: 12, y: 1.4, z: 0 }, { x: 0, y: 0, z: 1 });
      const hit = sim.world.castRay(ray, 50, true, undefined, RAY_SHOT);
      assert.equal(!!hit, enabled);
      if (enabled) {
        assert.equal(getColliderLabel(sim.world, hit.collider.handle), 'scatter-rocks');
        const wheelRay = sim.world.castRay(new RAPIER.Ray({ x: 12, y: 8, z: 20 }, { x: 0, y: -1, z: 0 }), 20, true, undefined, RAY_WORLD);
        assert.ok(wheelRay && wheelRay.timeOfImpact < 8, 'actual rock supports world wheel rays');
        sim.projectiles.addBullet(new THREE.Vector3(12, 1.4, 8), new THREE.Vector3(0, 0, 1), 200, 10, 2);
        for (let i = 0; i < 30; i++) sim.projectiles.update(DT, sim);
        assert.equal(sim.projectiles.bullets.length, 0);
        assert.ok(sim.events.some(e => e.t === 'hit' && e.carId === -1), 'real travelling bullet hits rock');
        sim.drainEvents();
      }
      const hp = player.hp; let crashes = 0, grounded = 0, maxZ = -Infinity;
      for (let i = 0; i < 220; i++) {
        structures.updateRocks(sim.cars.values()); sim.step(DT); maxZ = Math.max(maxZ, player.veh.pos.z); grounded += player.veh.grounded > 0 ? 1 : 0;
        crashes += sim.drainEvents().filter(e => e.t === 'crash' && e.id === 1).length;
      }
      assert.ok(grounded > 100, 'suspension stays active on actual Rapier ground');
      if (enabled) { assert.ok(crashes > 0 && player.hp < hp, 'real rock impact causes ordinary crash damage'); assert.ok(maxZ < 21, 'truck must not pass through boulder'); }
      else assert.ok(maxZ > 35, 'old decorative-rock control drives through it');
      removeBody(sim.world, floor);
    } finally { structures.dispose(); sim.dispose(); }
  }
});

function scatterFixture(assets, road, seed, c, quality, sliced = false) {
  const lists = new Map(), requests = [], ground = new ChunkGround(road, seed, c, []); ground.build();
  const chunk = { c, s0: c * CHUNK_LEN, hooks: [], done: new Set(['f:fences', 'f:wrecks', 'cover']), seaY: -1e9, ground,
    list(id) { let l = lists.get(id); if (!l) lists.set(id, l = new InstList()); return l; } };
  const ctx = { road, seed, quality, kit: { state: id => assets.has(id) ? 'loaded' : 'missing', get: id => assets.get(id), request() {} }, pool: { register() {} },
    exclusions: () => [], tunnelsNear: () => [], hook: r => requests.push(r) };
  for (const tier of [1, 2, 3]) {
    let complete = false, calls = 0;
    do { complete = runScatter(ctx, chunk, tier, sliced ? 0 : Infinity); assert.ok(++calls < SCATTER.length + 2); } while (!complete);
  }
  return { ctx, chunk, lists, requests };
}

test('actual streamed scatter batches remain bounded, quality-consistent and disappear with their chunk', async () => {
  const assets = await loadRockAssets(); await initPhysics();
  const world = createWorld(), structures = new StructureColliders(world), road = new Road(731), seed = 731;
  road.extendTo(61000);
  const windows = [0, 10400, 21400, 35400, 45400, 55400]; let totalRocks = 0;
  const labelsBefore = COLLIDER_LABELS.size;
  try {
    for (const s of windows) {
      const dress = Object.assign(Object.create(Dressing.prototype), { chunks: new Map(), ctx: { hook: r => structures.hook(r) }, extraGroup: { remove() {} }, water: { dropChunk() {} } });
      for (let c = Math.floor(s / CHUNK_LEN); c < Math.floor(s / CHUNK_LEN) + 7; c++) {
        const high = scatterFixture(assets, road, seed, c, 3), low = scatterFixture(assets, road, seed, c, 0);
        assert.ok(high.requests.length <= 3, 'one batched body per generated tier');
        assert.deepEqual(low.requests, high.requests, 'collision-bearing placements match across quality');
        for (const r of high.requests) {
          assert.ok(r.cells.every(c => c.idx.length / 3 <= 2848), 'dense outcrops cannot create an unbounded BVH batch');
          structures.hook(r); totalRocks += r.rocks;
        }
        high.chunk.extras = []; dress.chunks.set(c, high.chunk);
      }
      for (let i = 0; i < 60; i++) structures.updateRocks([{ pos: road.pointAt(s + 250, 0, {}), vel: { x: 0, z: 40 } }]);
      assert.ok(structures.bodies.size < 250 && world.bodies.len() < 250 && world.colliders.len() < 250, 'near spatial batches bounded by live chunks rather than prop count');
      assert.ok(structures.rocks.cells.size > structures.bodies.size, 'far surfaces retained without a Rapier body');
      world.step();
      const sample = road.sample(s + 100, {});
      const clear = world.castRay(new RAPIER.Ray({ x: sample.x, y: sample.y + 1.2, z: sample.z }, { x: sample.fx, y: 0, z: sample.fz }), 5, true, undefined, RAY_WORLD);
      assert.equal(clear, null, 'rock collisions do not enclose the normal road spawn');
      for (const c of [...dress.chunks.keys()]) { dress.onChunkDrop(c); dress.onChunkDrop(c); }
      assert.equal(structures.bodies.size, 0); assert.equal(world.bodies.len(), 0); assert.equal(world.colliders.len(), 0);
      assert.equal(structures.rocks.groups.size, 0); assert.equal(structures.rocks.cells.size, 0); assert.equal(structures.rocks.index.size, 0);
      assert.equal(COLLIDER_LABELS.size, labelsBefore, 'all streamed diagnostic labels removed');
    }
    assert.ok(totalRocks > 100, 'real campaign rock placements exercised');
  } finally { structures.dispose(); structures.dispose(); world.free(); }
});

test('distant inactive rocks block live run hitscan and ground probes before near bodies exist, with consistent surface type', async () => {
  const assets = await loadRockAssets(); await initPhysics();
  const world = createWorld(), structures = new StructureColliders(world);
  try {
    const { requests } = putRock(assets.get('boulder_03'), 1.8, -96, 0, 321);
    for (const r of requests) structures.hook(r);
    assert.equal(structures.bodies.size, 0, 'far rocks do not synchronously create Rapier bodies');
    const run = Object.assign(Object.create(Run.prototype), { qworld: world, structures, _surfaceKind: () => 'sand' });
    const o = new THREE.Vector3(-96, 1.4, 0), d = new THREE.Vector3(0, 0, 1);
    const far = run._worldRay(o, d, 400);
    assert.ok(far && far.t > 300 && far.t < 321); assert.equal(far.kind, 'rock');
    const high = run._groundY(-96, 8, 321); assert.ok(high > 0 && high < 8);
    structures.updateRocks([{ pos: { x: -96, z: 305 }, vel: { x: 0, z: 75 } }], 100);
    world.step(); assert.ok(structures.bodies.size > 0);
    const near = run._worldRay(o, d, 400);
    assert.ok(Math.abs(near.t - far.t) < 1e-4); assert.equal(near.kind, 'rock');
    structures.updateRocks([{ pos: { x: 2000, z: -2000 } }]);
    assert.equal(structures.bodies.size, 0);
    assert.ok(Math.abs(run._worldRay(o, d, 400).t - far.t) < 1e-4, 'weapon cover survives physics deactivation');
    for (const r of requests) structures.hook({ type: 'remove', id: r.id });
    assert.equal(run._worldRay(o, d, 400), null); assert.equal(run._groundY(-96, 8, 321), null);
  } finally { structures.dispose(); world.free(); }
});

test('an inactive rock detonates a rocket before the car or boss behind it, without leaking direct damage', async () => {
  const assets = await loadRockAssets();
  for (const type of ['car', 'boss']) {
    const sim = await new Sim({ seed: 7 }).init(), structures = new StructureColliders(sim.world);
    try {
      sim.structures = structures; sim.director.enabled = false;
      for (const r of putRock(assets.get('boulder_03'), 1.8).requests) structures.hook(r);
      const d = new THREE.Vector3(0, 0, 1), start = new THREE.Vector3(12, 1.4, 0);
      const first = structures.raycastRocks(start, d, 50); assert.ok(first);
      const o = start.clone().addScaledVector(d, first.timeOfImpact - .5), target = o.clone().addScaledVector(d, 1);
      let direct = 0;
      if (type === 'car') sim.cars.set(99, { id: 99, exploded: false, veh: { pos: target }, raycast: () => ({ t: 1, point: target.clone() }) });
      else sim.boss = { id: 999, dead: false, pos: target, raycast: () => ({ t: 1, point: target.clone(), zone: { kind: 'core' } }), damage: () => direct++ };
      // Observe direct damage independently of intentional radial blast damage.
      sim.damageCar = () => direct++; sim.blast = () => {};
      sim.projectiles.addRocket(o, d, { speed: 58, blast: 1, blastDmg: 0, direct: 30 }, 1);
      sim.projectiles.update(.05, sim);
      assert.equal(sim.projectiles.rockets.length, 0); assert.equal(direct, 0);
      const boom = sim.events.find(e => e.t === 'boom'); assert.ok(boom && boom.pos[2] < target.z);
      assert.equal(structures.bodies.size, 0, 'actual fallback shield tested without a near body');
    } finally { structures.dispose(); sim.cars.delete(99); sim.boss = null; sim.dispose(); }
  }
});

test('interrupted scatter generation publishes each placed rock once and never duplicates retired batches', async () => {
  const assets = await loadRockAssets(), road = new Road(731); road.extendTo(12000);
  const full = scatterFixture(assets, road, 731, 109, 3), sliced = scatterFixture(assets, road, 731, 109, 3, true);
  const combined = requests => {
    const triangles = [];
    for (const r of requests) for (const cell of r.cells) for (let i = 0; i < cell.idx.length; i += 3) {
      const points = [];
      for (let j = 0; j < 3; j++) { const k = cell.idx[i + j] * 3; points.push(`${cell.pos[k]},${cell.pos[k + 1]},${cell.pos[k + 2]}`); }
      triangles.push(points.sort().join(';'));
    }
    return { count: triangles.length, hash: createHash('sha256').update(triangles.sort().join('\n')).digest('hex') };
  };
  assert.ok(full.requests.length > 0 && sliced.requests.length > full.requests.length, 'real entry/time-slice boundaries exercised');
  assert.deepEqual(combined(sliced.requests), combined(full.requests), 'all collision-bearing surfaces identical');
  assert.equal(new Set(sliced.chunk.hooks).size, sliced.chunk.hooks.length);
  assert.ok(sliced.requests.length <= SCATTER.filter(e => e.cat === 'rock' || e.cat === 'pillar').length, 'batches bounded by entries, never individual rocks');
  const before = sliced.requests.length;
  for (let i = 0; i < 60; i++) for (const tier of [1, 2, 3]) assert.equal(runScatter(sliced.ctx, sliced.chunk, tier), true);
  assert.equal(sliced.requests.length, before, 'finished chunks never accumulate bodies');
});
