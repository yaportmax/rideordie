import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { Road, DS } from '../src/world/road.js';
import { drivingCorridorAt, branchPointAt } from '../src/world/driving_plan.js';
import { stageBoatWaterCutBounds, STAGE_BOAT_WATER_CUT } from '../src/data/stage_encounters.js';
import { CHUNK_LEN, COLS, ROAD_COLS, EDGE, terrainPoint, patrolWaterCutAt, seaLevel, genTerrainChunk, genRoadChunk } from '../src/world/terrain_gen.js';
import { RAPIER, RAY_WORLD, initPhysics, createWorld } from '../src/sim/physics.js';
import { patrolWaterFixture, createPatrolWaterScene, patrolAddMesh as addMesh, patrolNativeEye as nativeEye, patrolShot as shot, patrolHitDescription as hitDescription } from './helpers/patrol-water-scene.mjs';

const SEEDS = [7, 11, 31];
const LEVELS = [3, 6];
const fixtures = new Map();
function fixture(seed, level) {
  const key = `${seed}:${level}`;
  if (!fixtures.has(key)) {
    fixtures.set(key, patrolWaterFixture(seed, level));
  }
  return fixtures.get(key);
}
function nearly(a, b, label, epsilon = 1e-6) { assert.ok(Math.abs(a - b) <= epsilon, `${label}: ${a} versus ${b}`); }
function exactComponents(actual, expected, label) {
  // Keep exactly the strict typed-array equality criteria, but never ask Node
  // to format thousands of mesh values when a single component disagrees.
  assert.ok(actual?.constructor === expected?.constructor,
    `${label}: array type ${actual?.constructor?.name} versus ${expected?.constructor?.name}`);
  assert.ok(actual.length === expected.length, `${label}: length ${actual.length} versus ${expected.length}`);
  for (let i = 0; i < actual.length; i++) {
    assert.ok(Object.is(actual[i], expected[i]), `${label}: first mismatch at ${i}, ${actual[i]} versus ${expected[i]}`);
  }
}

test('water encounter cuts are finite, side-specific and use the actual coast/lake sea height', () => {
  for (const seed of SEEDS) for (const level of LEVELS) {
    const { road, site, bounds } = fixture(seed, level), cut = {};
    assert.equal(bounds.side, level === 3 ? 1 : -1);
    assert.equal(bounds.start, site.s0 - 200); assert.equal(bounds.end, site.s1 + 220);
    assert.equal(bounds.fade, 100);
    for (const s of [bounds.start, site.s0, site.s0 + 36, site.s1, bounds.end]) {
      assert.equal(patrolWaterCutAt(road, s, bounds.side, cut), cut);
      assert.equal(cut.weight, 1); assert.equal(cut.siteId, site.id);
      assert.equal(cut.seaY, seaLevel(road, site.biome));
      assert.equal(patrolWaterCutAt(road, s, -bounds.side, {}).weight, 0);
    }
    for (const s of [bounds.start - bounds.fade - 1, bounds.start - bounds.fade, bounds.end + bounds.fade, bounds.end + bounds.fade + 1]) {
      assert.equal(patrolWaterCutAt(road, s, bounds.side, {}).weight, 0);
    }
    nearly(patrolWaterCutAt(road, bounds.start - bounds.fade / 2, bounds.side, {}).weight, .5, 'entry blend');
    nearly(patrolWaterCutAt(road, bounds.end + bounds.fade / 2, bounds.side, {}).weight, .5, 'exit blend');
  }
  assert.equal(stageBoatWaterCutBounds({ kind: 'gun_tower', biome: 'coast', s0: 1000, s1: 1200 }), null);
  assert.equal(stageBoatWaterCutBounds({ kind: 'patrol_boat', biome: 'city', s0: 1000, s1: 1200 }), null);
});

test('the water cut preserves the exact asphalt seam, submerges its real shore and preserves qualified branch floors', () => {
  for (const seed of SEEDS) for (const level of LEVELS) {
    const { road, site, bounds } = fixture(seed, level), sea = seaLevel(road, site.biome), branches = road.ensureDrivingBranches();
    let submerged = 0;
    for (const s of [bounds.start, site.s0 - 55, site.s0, site.s0 + 36, site.s1, bounds.end]) {
      for (const side of [-1, 1]) {
        const seam = terrainPoint(road, seed, s, side * EDGE, {}), sm = road.sample(s);
        const corridor = drivingCorridorAt(road, branches, seam.x, seam.z, s, {});
        const roadY = road.surfaceY(sm, side * EDGE);
        const expectedY = corridor.weight > 0 ? roadY + (corridor.y - roadY) * corridor.weight : roadY;
        if (side === -bounds.side) assert.equal(patrolWaterCutAt(road, s, side, {}).weight, 0, 'landward merge receives no new water carving');
        nearly(seam.y, expectedY, `${seed}:${level}:${s}:${side}: unchanged asphalt/corridor seam`);
        const expected = road.pointAt(s, side * EDGE, {});
        nearly(seam.x, expected.x, `${seed}:${level}:${s}:${side}: seam x`); nearly(seam.z, expected.z, `${seed}:${level}:${s}:${side}: seam z`);
      }
      for (const offset of [1, 6, 30, 150, 220]) {
        const p = terrainPoint(road, seed, s, bounds.side * (EDGE + offset), {});
        const corridor = drivingCorridorAt(road, branches, p.x, p.z, s, {});
        if (corridor.weight === 0) {
          assert.ok(p.y <= sea - STAGE_BOAT_WATER_CUT.floorDepth + 1e-6,
            `${seed}:${level}:${s}:${offset}: exposed shore must really be below its water`);
          submerged++;
        }
      }
    }
    assert.ok(submerged >= 24, 'the encounter needs a substantial real water opening, not only one sampled point');
    for (const branch of branches) for (let s = Math.max(branch.s0, bounds.start); s <= Math.min(branch.s1, bounds.end); s += 12) {
      const p = branchPointAt(road, branch, s, 0, {}), projection = road.nearest(p.x, p.z, s, 320, {});
      const ground = terrainPoint(road, seed, projection.s, projection.d, {});
      nearly(ground.y, p.y, `${seed}:${level}:${s}:${branch.id}: landward shortcut floor survives the local water cut`, .2);
    }
  }
});

test('first distant water-cut replies retain the same fine visual and physical meshes at every LOD', () => {
  for (const level of LEVELS) {
    const { road, site } = fixture(7, level), chunk = Math.floor(site.s0 / CHUNK_LEN);
    const meshes = [0, 1, 2].map(lod => genTerrainChunk(road, road.seed, chunk, lod));
    for (const [lod, mesh] of meshes.entries()) {
      assert.ok(mesh.colPositions && mesh.colIndices, 'a first distant reply already has the matching fine collider');
      assert.equal(mesh.colPositions.length, 2 * (CHUNK_LEN / DS + 1) * COLS.length * 3);
      exactComponents(mesh.positions, meshes[0].positions, `${level}:LOD${lod}: visible positions`);
      exactComponents(mesh.indices, meshes[0].indices, `${level}:LOD${lod}: visible indices`);
      exactComponents(mesh.colPositions, meshes[0].colPositions, `${level}:LOD${lod}: collider positions`);
      exactComponents(mesh.colIndices, meshes[0].colIndices, `${level}:LOD${lod}: collider indices`);
    }
    const independentWorkerRoad = new Road(7, { mode: 'campaign', level });
    independentWorkerRoad.ensureDrivingBranches(); // actual terrain_worker init -> ready sequence
    const workerReply = genTerrainChunk(independentWorkerRoad, 7, chunk, 2);
    exactComponents(workerReply.positions, meshes[0].positions, `${level}: independent worker generation/order visible cut`);
    exactComponents(workerReply.colPositions, meshes[0].colPositions, `${level}: authority and worker physical cut`);
    const strip = genRoadChunk(road, road.seed, chunk);
    exactComponents(strip.positions, strip.colPositions, `${level}: supported asphalt visible/physical strip`);
    for (let row = 0; row <= CHUNK_LEN / DS; row++) for (let col = 0; col < ROAD_COLS.length; col++) {
      const sm = road.sample(chunk * CHUNK_LEN + row * DS), y = strip.positions[(row * ROAD_COLS.length + col) * 3 + 1] + strip.anchor[1];
      nearly(y, road.surfaceY(sm, ROAD_COLS[col]), `${level}:row${row}:col${col}: unchanged banked road height`, 1e-5);
    }
  }
});

test('genuine fractional authority queries cannot change worker mesh bytes or fresh-cache replay', () => {
  for (const level of LEVELS) {
    const worker = patrolWaterFixture(7, level), authority = patrolWaterFixture(7, level);
    worker.road.ensureDrivingBranches(); // actual worker init -> ready
    const chunk = Math.floor(worker.site.s0 / CHUNK_LEN);
    const expected = genTerrainChunk(worker.road, 7, chunk, 2);
    // Authority may compute water and scenery before a worker asks for a
    // chunk. Both use actual authored fractional site positions, not altered
    // reservations or artificial terrain inputs.
    seaLevel(authority.road, authority.site.biome);
    authority.road.ensureDrivingBranches();
    for (const s of [authority.bounds.start, authority.site.s0 - 55, authority.site.s0,
      authority.site.s0 + 36, authority.site.s1, authority.bounds.end]) {
      for (const side of [-1, 1]) for (const offset of [0, 1, 6, 30, 150, 220]) {
        terrainPoint(authority.road, 7, s, side * (EDGE + offset), {});
      }
    }
    const fraction = authority.site.s0 - Math.floor(authority.site.s0);
    assert.ok(fraction > 0 && fraction < .125, 'the real seed has a quarter-key-colliding authored fractional distance');
    for (const side of [-1, 1]) terrainPoint(authority.road, 7, chunk * CHUNK_LEN + 18 * DS + fraction, side * (EDGE + COLS[26]), {});
    const primed = genTerrainChunk(authority.road, 7, chunk, 2);
    exactComponents(primed.positions, expected.positions, `${level}: fractional-authority versus first worker visible bytes`);
    exactComponents(primed.colPositions, expected.colPositions, `${level}: fractional-authority versus first worker collider bytes`);
    // Another worker/road must clear only the bounded cache, never change the
    // geometry that a later reply for the first road produces.
    const anotherWorker = patrolWaterFixture(7, level);
    anotherWorker.road.ensureDrivingBranches();
    const independent = genTerrainChunk(anotherWorker.road, 7, chunk, 2);
    const replay = genTerrainChunk(authority.road, 7, chunk, 2);
    exactComponents(independent.positions, expected.positions, `${level}: independent worker visible bytes`);
    exactComponents(independent.colPositions, expected.colPositions, `${level}: independent worker collider bytes`);
    exactComponents(replay.positions, primed.positions, `${level}: authority fresh-cache replay visible bytes`);
    exactComponents(replay.colPositions, primed.colPositions, `${level}: authority fresh-cache replay collider bytes`);
  }
});

test('ordinary Rapier rays reach actual planned boats across multiple coast and dam seeds, while pavement remains solid', async () => {
  await initPhysics();
  for (const seed of SEEDS) for (const level of LEVELS) {
    const scene = await createPatrolWaterScene(seed, level, fixture(seed, level));
    const { road, site, world, manager, boats } = scene;
    try {
      // Same generator/collider groups as the real worker and SyncGround; no
      // terrain exclusion, visibility mock, custom query filter or raised mast.
      assert.equal(boats.length, 2, `${seed}:${level}: both actual authored boats must fit underwater`);
      for (const specId of ['player_sedan_t1', 'truck_t1']) {
        const eye = nativeEye(road, site.s0 - 55, specId);
        for (const boat of boats) {
          assert.ok(boat.groundY === seaLevel(road, site.biome));
          assert.ok(boat.weakpoint?.pos, 'a real exposed target is required');
          const blocked = shot(world, eye, boat.weakpoint.pos);
          assert.ok(blocked === null, `${seed}:${level}:${specId}:${boat.id}: real terrain must not obscure the visible boat target; ${hitDescription(blocked)}; eye=${eye.toArray()} target=${boat.weakpoint.pos.toArray()}`);
          assert.ok(manager.aimPoint(boat, eye, new Vector3()), 'ordinary authority LOS must permit the actual reciprocal target');
        }
        const below = eye.clone(); below.y = road.sample(site.s0 - 55).y - 2;
        assert.ok(shot(world, eye, below), 'downward shots still hit the unchanged asphalt');
      }
      const roadPoint = road.pointAt(site.s0, 0, {});
      const down = world.castRay(new RAPIER.Ray({ x: roadPoint.x, y: roadPoint.y + 8, z: roadPoint.z }, { x: 0, y: -1, z: 0 }), 16, true, undefined, RAY_WORLD);
      assert.ok(down, 'the viaduct deck has genuine physical support');
      nearly(roadPoint.y + 8 - down.timeOfImpact, roadPoint.y, 'supported road deck', .02);
    } finally { scene.dispose(); }
  }
});

test('the physical water face and visible water face agree under direct Rapier downcasts', async () => {
  await initPhysics();
  for (const level of LEVELS) {
    const { road, site, bounds } = fixture(7, level), chunk = Math.floor(site.s0 / CHUNK_LEN), data = genTerrainChunk(road, 7, chunk, 2);
    const collisionWorld = createWorld(), visibleWorld = createWorld();
    try {
      const collider = addMesh(collisionWorld, data), visible = addMesh(visibleWorld, data, true);
      collisionWorld.step(); visibleWorld.step();
      const row = Math.min(CHUNK_LEN / DS - 1, Math.round((site.s0 - chunk * CHUNK_LEN) / DS));
      const verticesPerSide = (CHUNK_LEN / DS + 1) * COLS.length;
      const sideBase = bounds.side > 0 ? 0 : verticesPerSide;
      for (const column of [1, 5, 15, 25, 28]) {
        // An interior barycentre of the actual collision triangle. Smooth
        // procedural terrain interpolation is not the rendered triangle.
        const cell = (row * (COLS.length - 1) + column) * 6;
        const sideIndexBase = bounds.side > 0 ? 0 : (CHUNK_LEN / DS) * (COLS.length - 1) * 6;
        const ids = Array.from(data.colIndices.subarray(sideIndexBase + cell, sideIndexBase + cell + 3));
        assert.ok(ids.every(id => id >= sideBase && id < sideBase + verticesPerSide), 'chosen triangle belongs to the real water-facing mesh');
        const p = { x: data.anchor[0], y: data.anchor[1], z: data.anchor[2] };
        for (const id of ids) { p.x += data.colPositions[id * 3] / 3; p.y += data.colPositions[id * 3 + 1] / 3; p.z += data.colPositions[id * 3 + 2] / 3; }
        const ray = new RAPIER.Ray({ x: p.x, y: p.y + 20, z: p.z }, { x: 0, y: -1, z: 0 });
        const a = collider.castRay(ray, 40, true), b = visible.castRay(ray, 40, true);
        assert.ok(Number.isFinite(a) && Number.isFinite(b), 'both actual meshes must cover the sampled water floor');
        nearly(a, b, `${level}:row${row}:col${column}: visible/physical seabed downcast`, 2e-4);
        nearly(p.y + 20 - a, p.y, `${level}:row${row}:col${column}: actual triangle barycentre height`, .005);
      }
    } finally { collisionWorld.free(); visibleWorld.free(); }
  }
});
