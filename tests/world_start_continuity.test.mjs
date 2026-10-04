// Ordinary production graph. Focused behavioral regressions for signed chapter
// approaches and inert incidental clutter, using real emitted geometry/physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Road, DS } from '../src/world/road.js';
import { RoadQuery } from '../src/sim/road_query.js';
import { genTerrainChunk, genRoadChunk, CHUNK_LEN, COLS } from '../src/world/terrain_gen.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { Sim, DT } from '../src/sim/sim.js';
import { SyncGround } from '../src/sim/sync_ground.js';
import { Hazards, rbBarricades } from '../src/sim/hazards.js';
import { HazardMarks } from '../src/view/hazard_marks.js';
import { buildFeatures } from '../src/world/dressing/features.js';
import { removeBody } from '../src/sim/physics.js';

const journey = level => ({ mode: 'campaign', level });
function near(actual, expected, tolerance = 1e-5) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);
}
function vertex(mesh, index) {
  return Array.from(mesh.positions.slice(index * 3, index * 3 + 3), (value, axis) => value + mesh.anchor[axis]);
}
function finite(array) { for (const value of array) assert.ok(Number.isFinite(value)); }

test('all chapters keep their own signed approach frame and bounded arrays after deep reverse projection', () => {
  for (const level of TEN_LEVELS) {
    const road = new Road(31, journey(level.number)), query = new RoadQuery(road), origin = road.sample(0);
    road.sample(-100000);
    assert.ok(road.n < 40, 'analytic approach alone never allocates negative Road arrays');
    // Qualified positive branch planning is a separate bounded generation cost.
    // Freeze its actual size before asking the real driving-route projector.
    road.ensureDrivingBranches(); const plannedRows = road.n, plannedCapacity = road.cap;
    for (const s of [-.01, -DS, -96, -6000, -100000]) {
      const sm = road.sample(s);
      assert.equal(sm.s, s); assert.equal(sm.y, origin.y); assert.equal(sm.th, origin.th);
      assert.equal(road.biomeAt(s).a, level.id); assert.equal(road.journeyLevelAt(s), level.number);
      near(sm.x, origin.x + origin.fx * s); near(sm.z, origin.z + origin.fz * s);
      for (const d of [-6, 0, 6]) {
        const p = road.pointAt(s, d, {}), projected = query.projectDriving(p.x, p.z, s, 90, {});
        near(projected.s, s, .001); near(projected.d, d, .001);
        assert.equal(projected.route, null); assert.equal(projected.halfWidth, 7);
        assert.deepEqual(query.nearest(p.x, p.z, s, 90, {}), road.nearest(p.x, p.z, s, 90, {}));
      }
    }
    assert.equal(road.n, plannedRows); assert.equal(road.cap, plannedCapacity);
  }
});

test('every chapter emits full prestart fine collision at all LODs with exact terrain seam normals/materials', () => {
  const rows = CHUNK_LEN / DS + 1, columns = COLS.length, gridVertices = rows * columns;
  const sideStride = gridVertices + 2 * columns + rows;
  for (const level of TEN_LEVELS) {
    const road = new Road(31, journey(level.number)), fine = genTerrainChunk(road, 31, -1, 0);
    for (const lod of [0, 1, 2]) {
      const terrain = genTerrainChunk(road, 31, -1, lod);
      for (const key of ['positions', 'normals', 'colPositions', 'colIndices']) assert.deepEqual(terrain[key], fine[key]);
      assert.equal(terrain.colPositions.length, gridVertices * 2 * 3);
      finite(terrain.positions); finite(terrain.normals); finite(terrain.colPositions);
      for (let side = 0; side < 2; side++) for (let i = 0; i < gridVertices; i++) {
        const visible = (side * sideStride + i) * 3, collision = (side * gridVertices + i) * 3;
        for (let axis = 0; axis < 3; axis++) assert.equal(terrain.positions[visible + axis], terrain.colPositions[collision + axis]);
      }
      for (let i = 0; i < terrain.colIndices.length; i += 3) {
        const [a, b, c] = Array.from(terrain.colIndices.slice(i, i + 3), index => new THREE.Vector3().fromArray(terrain.colPositions, index * 3));
        assert.ok(new THREE.Vector3().crossVectors(b.sub(a), c.sub(a)).lengthSq() > 1e-8, 'no collapsed approach triangle');
      }
    }
    const after = genTerrainChunk(road, 31, 0, 0);
    for (let side = 0; side < 2; side++) for (let c = 0; c < columns; c++) {
      const a = side * sideStride + (rows - 1) * columns + c, b = side * sideStride + c;
      for (let axis = 0; axis < 3; axis++) {
        near(vertex(fine, a)[axis], vertex(after, b)[axis], .0002);
        assert.equal(fine.normals[a * 3 + axis], after.normals[b * 3 + axis]);
      }
      for (let layer = 0; layer < 3; layer++) for (let axis = 0; axis < 4; axis++) assert.equal(fine.splat[layer][a * 4 + axis], after.splat[layer][b * 4 + axis]);
    }
    const beforeRoad = genRoadChunk(road, 31, -1), afterRoad = genRoadChunk(road, 31, 0);
    assert.deepEqual(beforeRoad.positions, beforeRoad.colPositions);
    assert.deepEqual(Uint32Array.from(beforeRoad.indices), beforeRoad.colIndices);
    for (let c = 0; c < beforeRoad.cols; c++) {
      const a = (beforeRoad.rows - 1) * beforeRoad.cols + c;
      for (let axis = 0; axis < 3; axis++) {
        near(vertex(beforeRoad, a)[axis], vertex(afterRoad, c)[axis]);
        near(beforeRoad.normals[a * 3 + axis], afterRoad.normals[c * 3 + axis], .002);
      }
      for (let axis = 0; axis < 4; axis++) {
        assert.equal(beforeRoad.roadA[a * 4 + axis], afterRoad.roadA[c * 4 + axis]);
        if (axis < 3) assert.equal(beforeRoad.roadB[a * 4 + axis], afterRoad.roadB[c * 4 + axis]);
      }
    }
    assert.ok(Math.abs(vertex(beforeRoad, 5)[2] - vertex(beforeRoad, (beforeRoad.rows - 1) * beforeRoad.cols + 5)[2]) > 95);
  }
});

test('deep signed physical support and void recovery remain local without earning distance or healing', async () => {
  const sim = await new Sim({ seed: 31, journey: journey(7) }).init();
  sim.systems.length = 0; sim.state = 'run';
  const ground = new SyncGround(sim); sim.setGround(ground); const s = -6000;
  try {
    ground.update(s); assert.equal(ground.groundReady(s), true); assert.ok(ground.chunks.size <= 10);
    const p = sim.spawnCar('player_sedan_t1', { s, d: 0, kind: 'player' });
    for (let i = 0; i < 240; i++) sim.step();
    assert.ok(p.veh.grounded >= 2); assert.equal(sim.stats.distance, 0);
    const sm = sim.road.sample(p.s), bounds = ground.recoveryBoundsAt(p.s);
    near(ground.roadHeightAt(p.s, sm.x, sm.z, sm.y + 2), sm.y, .001);
    p.veh.body.setTranslation({ x: sm.x + sm.nx * 30, y: bounds.minY - 20, z: sm.z + sm.nz * 30 }, true);
    p.veh.readState(); p.d = 30; sim.stats.cash = 123;
    const hp = p.hp, distance = sim.stats.distance;
    sim._recoverOffroadFall(p);
    assert.ok(Math.abs(p.s - s) < 65); assert.ok(p.veh.pos.y > sm.y && p.veh.pos.y < sm.y + 3);
    assert.equal(p.hp, hp - p.maxHp * .04); assert.equal(sim.stats.cash, 123); assert.equal(sim.stats.distance, distance);
    assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
    sim._recoverOffroadFall(p); assert.equal(sim.events.filter(e => e.t === 'groundRecovered').length, 1);
    ground.update(-10000); assert.equal(ground.hasColliderAt(s), false); assert.equal(ground.groundReady(-10000), true);
    assert.ok(ground.chunks.size <= 10); assert.equal(sim.world.bodies.len(), ground.chunks.size * 2 + 1);
  } finally { sim.dispose(); }
});

test('incidental generated barriers are inert reservations while deliberate driving content survives', () => {
  const road = new Road(31); road.extendTo(80500);
  const records = road.features.filter(f => f.type === 'roadblock');
  assert.ok(records.length > 0); assert.ok(records.every(f => f.disabledClutter));
  assert.deepEqual(road.featuresIn(0, 80500, 'roadblock'), []);
  assert.ok(road.ensureDrivingBranches().length > 0, 'qualified shortcuts still exist');
  assert.equal(road._planningFeatures, false, 'planning-only reservations cannot leak into runtime');
  assert.ok(road.featuresIn(0, 80500).some(f => f.type === 'ramp'));
  assert.ok(road.drivingPlan.some(f => f.type === 'stage_encounter_reservation'));
  for (const record of records) assert.notEqual(road.featureAt(record.s0 + 1)?.type, 'roadblock');
  const deliberate = { type: 'roadblock', s0: 80, s1: 92, gap: 1, seed: 9 };
  road.features.push(deliberate);
  assert.ok(road.featuresIn(75, 95, 'roadblock').includes(deliberate));
});

test('an inert barrier creates no bodies/markers/hooks/damage, while the same deliberate barrier really damages', async () => {
  const sim = await new Sim({ seed: 31 }).init(); sim.systems.length = 0; sim.state = 'run';
  const f = { type: 'roadblock', s0: 500, s1: 512, gap: 0, seed: 9, disabledClutter: true };
  sim.road.features = [f]; sim.road.ensureDrivingBranches = () => [];
  const p = sim.spawnCar('truck_t1', { s: f.s0 + 3.5, d: rbBarricades(f)[0].d, speed: 35, kind: 'player' });
  sim.events.length = 0; // begin observation after the genuine spawn event
  const hazards = new Hazards(), marks = new HazardMarks(new THREE.Scene(), sim.road);
  try {
    const hp = p.hp, bodies = sim.world.bodies.len();
    assert.equal(hazards._build(sim, f), null); hazards._sync(sim, f.s0); hazards.update(DT, sim);
    assert.equal(hazards.active.size, 0); assert.equal(p.hp, hp); assert.equal(sim.events.length, 0);
    assert.equal(sim.world.bodies.len(), bodies);
    marks.update(DT, f.s0 - 80); assert.equal(marks.sites.size, 0); assert.equal(marks.group.children.length, 0);
    const hooks = [], chunk = { s0: 480, done: new Set(), extras: [], lists: new Map() };
    assert.equal(buildFeatures({ road: sim.road, seed: 31, hook: event => hooks.push(event) }, chunk), true);
    assert.equal(hooks.length, 0); assert.equal(chunk.extras.length, 0); assert.equal(chunk.lists.size, 0);
    const intentional = { ...f }; delete intentional.disabledClutter;
    const record = hazards._build(sim, intentional);
    assert.ok(record?.barricades.length > 0, 'positive control must have real damaging geometry');
    hazards.active.set(intentional, record); sim.tick = 2; hazards.update(DT, sim);
    const breaks = sim.events.filter(e => e.t === 'barrierBreak' && e.s0 === f.s0 && e.id === p.id);
    assert.ok(breaks.length > 0); assert.equal(new Set(breaks.map(e => e.i)).size, breaks.length);
    assert.equal(breaks.length, record.barricades.filter(barrier => barrier.broken).length);
    assert.equal(p.hp, hp - p.maxHp * .03 * breaks.length); assert.equal(sim.stats.damageBy.crash, hp - p.hp);
  } finally {
    for (const record of hazards.active.values()) for (const body of record.bodies) removeBody(sim.world, body);
    hazards.active.clear(); marks.dispose(); sim.dispose();
  }
});
