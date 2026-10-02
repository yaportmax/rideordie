import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Road } from '../src/world/road.js';
import { RoadQuery } from '../src/sim/road_query.js';
import { BIOME_ORDER, BOSS_S } from '../src/data/biomes.js';
import { BRANCH_DRIVING, DRIVING_ROUTE_VERSION, planDrivingBranches, branchPointAt, protectedDrivingSpan, drivingReserved, branchFeatureObstructs } from '../src/world/driving_plan.js';
import { genTerrainChunk, genDrivingBranchChunk, seaLevel } from '../src/world/terrain_gen.js';
import { TerrainStreamer } from '../src/world/terrain.js';
import { ChunkGround, InstList } from '../src/world/dressing/util.js';
import { buildCity, cityItems, CITY_GLB, CITY_PROPS } from '../src/world/dressing/city.js';
import { buildGalleries, galleriesNear } from '../src/world/dressing/gallery.js';
import { buildMoments } from '../src/world/dressing/moments.js';
import { buildDamRoad } from '../src/world/dressing/damroad.js';
import { buildDrivingBranches } from '../src/world/dressing/driving.js';
import { buildFurniture } from '../src/world/dressing/furniture.js';
import { Hazards } from '../src/sim/hazards.js';
import { initPhysics, createWorld, RAPIER, GROUPS, removeBody, COLLIDER_LABELS } from '../src/sim/physics.js';
import { Sim, DT } from '../src/sim/sim.js';
import { AIDriver } from '../src/game/ai_driver.js';
import { loadGeometryAssets } from './helpers/driving-assets.mjs';

const SEEDS = [1, 7, 11, 31, 12345, 381442461, 561889576];
let cases;
function representatives() {
  if (cases) return cases;
  const byBiome = new Map();
  for (const seed of SEEDS) {
    const road = new Road(seed);
    for (const branch of road.ensureDrivingBranches()) if (!byBiome.has(branch.biome)) byBiome.set(branch.biome, { seed, road, branch });
  }
  for (const biome of BIOME_ORDER) assert.ok(byBiome.has(biome), `${biome}: no qualified branch in the documented seed scope`);
  return cases = BIOME_ORDER.map(biome => byBiome.get(biome));
}
function body(world, data, visual = false) {
  const anchor = data.anchor || [0, 0, 0], positions = data.positions || data.pos, indices = data.indices || data.idx;
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...anchor));
  const col = world.createCollider(RAPIER.ColliderDesc.trimesh(positions, Uint32Array.from(indices)).setCollisionGroups(GROUPS.world), rb);
  col.userData = visual ? 'visible surface' : 'authored collision';
  return { rb, col };
}
function heightAt(col, p) {
  const hit = col.castRayAndGetNormal(new RAPIER.Ray({ x: p.x, y: p.y + 8, z: p.z }, { x: 0, y: -1, z: 0 }), 16, true);
  return hit ? p.y + 8 - hit.timeOfImpact : null;
}
function streamerFixture(world, road, s) {
  const st = Object.create(TerrainStreamer.prototype);
  Object.assign(st, { world, road, seed: road.seed, chunks: new Map(), group: new THREE.Group(), terrainMat: new THREE.MeshBasicMaterial(), roadMat: new THREE.MeshBasicMaterial(), pending: new Set(), stats: { built: 0 }, _sLast: s });
  st.update = function(next) { this._sLast = next; for (const [c, rec] of this.chunks) this._collision(c, rec, next); };
  st.dispose = function() { for (const [c, rec] of this.chunks) this._dispose(c, rec); this.terrainMat.dispose(); this.roadMat.dispose(); };
  return st;
}
function reply(st, c) {
  // Supply the actual first-reply and near LOD0 data. A CPU fixture has no worker
  // scheduler and must not mistake an ordinary safe readiness hold for a fall.
  st._onMsg2({ busy: 1 }, { type: 'chunk', key: `${c}:0`, chunk: c, lod: 0,
    t: genTerrainChunk(st.road, st.seed, c, 0), r: genRoadData(st.road, st.seed, c), b: genDrivingBranchChunk(st.road, st.seed, c) });
}
// Imported separately below only to keep the physical worker reply explicit.
import { genRoadChunk as genRoadData } from '../src/world/terrain_gen.js';
function putCar(sim, car, branch, s, speed) {
  const p = branchPointAt(sim.road, branch, s, 0, {}), v = car.veh;
  v.body.setTranslation({ x: p.x, y: p.y + v.restComHeight + .15, z: p.z }, true);
  v.body.setRotation({ x: 0, y: Math.sin(p.th / 2), z: 0, w: Math.cos(p.th / 2) }, true);
  v.body.setLinvel({ x: Math.sin(p.th) * speed, y: 0, z: Math.cos(p.th) * speed }, true); v.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  v.readState(); v.prevPos.copy(v.pos); v.prevQuat.copy(v.quat);
  const q = sim.roadQuery.projectDriving(v.pos.x, v.pos.z, s, 60, {});
  car.s = q.s; car.d = q.d; car.route = q.route; car.routeHalfWidth = q.halfWidth;
}

test('campaign shortcut planning is deterministic, preserves both initial descriptors and exact main-road samples, and retains strict qualification in all six stages', () => {
  assert.equal(DRIVING_ROUTE_VERSION, 3);
  const covered = new Set();
  for (const seed of SEEDS) {
    const road = new Road(seed), branches = road.ensureDrivingBranches(), old = new Road(seed), before = planDrivingBranches(old, ['desert', 'canyon']);
    assert.ok(road.sEnd <= BOSS_S + 288, 'bounded full-route planning occurs during loading');
    assert.deepEqual(branches.filter(b => ['desert', 'canyon'].includes(b.biome)), before, 'new scope preserves the original two-stage descriptors');
    const reordered = new Road(seed); reordered.extendTo(65000);
    assert.deepEqual(reordered.ensureDrivingBranches(), branches, 'worker request order cannot alter route selection');
    old.extendTo(road.sEnd);
    for (const key of ['x', 'y', 'z', 'th', 'k', 'bank']) assert.deepEqual(road[key].slice(0, road.n), old[key].slice(0, old.n), key + ' main geometry unchanged');
    assert.equal(new Set(branches.map(b => b.biome)).size, branches.length, 'at most one bounded branch per stage');
    for (const b of branches) {
      covered.add(b.biome); const cfg = BRANCH_DRIVING[b.biome];
      assert.equal(b.width, cfg.width); assert.equal(b.offset, cfg.offset); assert.ok(cfg.spans.includes(b.s1 - b.s0));
      assert.ok(b.saved >= 4 && b.maxGrade <= .085 && b.maxCurvature <= 1 / 70);
      assert.equal(protectedDrivingSpan(b.s0 - 200, b.s1 + 200), false); assert.equal(drivingReserved(road.drivingPlan, b.s0, b.s1, 100), false);
      const features = road.featuresIn(b.s0 - 100, b.s1 + 100);
      assert.equal(features.some(f => ['bridge', 'tunnel', 'overpass', 'roadblock', 'ramp'].includes(f.type)), false);
      // The sea-bank rail remains solid and visible on its original bank. A
      // guard on the landward or both banks is still disqualifying.
      const opposite = cfg.landSide === -1 ? 'L' : cfg.landSide === 1 ? 'R' : null;
      assert.equal(features.some(f => f.type === 'guard' && (!opposite || f.side !== opposite)), false);
      if (cfg.landSide) assert.equal(b.side, cfg.landSide, 'water stages use the landward bend');
      const mid = (b.s0 + b.s1) / 2, p = branchPointAt(road, b, mid, 0, {}), q = new RoadQuery(road).projectDriving(p.x, p.z, mid, 60, {});
      assert.equal(q.route, b.id); assert.ok(Math.abs(q.s - mid) < .04);
    }
  }
  assert.deepEqual([...covered].sort(), [...BIOME_ORDER].sort(), 'all six stages have qualified examples in this explicit seed scope');
});

test('actual full-campaign fine strips and all-LOD terrain give continuous support across both joins and every streaming seam', async () => {
  await initPhysics();
  for (const { seed, road, branch } of representatives()) {
    const world = createWorld(DT);
    try {
      for (let c = Math.floor((branch.s0 - 4) / 96); c <= Math.floor((branch.s1 + 4) / 96); c++) {
        const strip = genDrivingBranchChunk(road, seed, c).find(b => b.route === branch.id); assert.ok(strip);
        const b = body(world, strip), fine = genTerrainChunk(road, seed, c, 0);
        for (const lod of [0, 1, 2]) {
          const t = lod ? genTerrainChunk(road, seed, c, lod) : fine;
          assert.deepEqual(t.positions, fine.positions); assert.ok(t.colPositions);
          const g = body(world, { anchor: t.anchor, positions: t.colPositions, indices: t.colIndices });
          for (let s = strip.s0 + .18; s < strip.s1 - .01; s += 7) for (const d of [-branch.width / 2 + .25, 0, branch.width / 2 - .25]) {
            const p = branchPointAt(road, branch, s, d, {}), y = heightAt(b.col, p), gy = heightAt(g.col, p), tag = `${seed}/${branch.biome}/s${s}/d${d}/lod${lod}`;
            assert.ok(y != null && Math.abs(y - p.y) < .04, tag + ': physical asphalt is present');
            assert.ok(gy == null || gy < y - .012, tag + ': terrain does not protrude through the strip');
          }
          world.removeRigidBody(g.rb);
        }
        world.removeRigidBody(b.rb);
      }
    } finally { world.free(); }
  }
});

test('water stage branches stay above real water with landward cores, and the strip retains authored sea, biome and mountain-snow shading attributes', () => {
  for (const { seed, road, branch } of representatives()) {
    const cfg = BRANCH_DRIVING[branch.biome], water = cfg.landSide ? seaLevel(road, branch.biome) : -1e4;
    for (let c = Math.floor(branch.s0 / 96); c <= Math.floor(branch.s1 / 96); c++) {
      const data = genDrivingBranchChunk(road, seed, c).find(b => b.route === branch.id); assert.ok(data);
      for (let i = 0; i < data.positions.length / 3; i++) {
        assert.ok(Math.abs(data.aux[i * 4 + 3] - water) < .001, 'real water height is carried into the material');
        if (cfg.landSide) assert.ok(data.positions[i * 3 + 1] + data.anchor[1] > water + 3, 'road remains above the sea/lake');
        if (branch.biome === 'mountain') assert.ok(data.roadA[i * 4 + 3] > .999 && data.roadB[i * 4 + 2] >= 0 && data.roadB[i * 4 + 2] <= 1);
        if (branch.biome === 'city') assert.ok(data.roadB[i * 4] > .999);
        if (branch.biome === 'dam') assert.ok(data.roadB[i * 4 + 1] > .999);
      }
    }
    if (cfg.landSide) for (const node of branch.nodes.slice(8, -8)) {
      const main = road.sample(node.s, {}), d = (node.x - main.x) * main.nx + (node.z - main.z) * main.nz;
      assert.ok(d * cfg.landSide > 0, 'no offshore floating shortcut core');
    }
  }
});

function canvasStub() {
  const context = new Proxy({}, { get: (_target, key) => {
    if (key === 'measureText') return t => ({ width: t.length * 20 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  }, set: () => true });
  return { getContext: () => context };
}
function chunkFixture(road, c) {
  const extras = [], ground = new ChunkGround(road, road.seed, c); ground.build();
  return { c, s0: c * 96, ground, done: new Set(), lists: new Map(), hooks: [], extras,
    addExtra(m) { extras.push(m); }, list(name) { if (!this.lists.has(name)) this.lists.set(name, new InstList()); return this.lists.get(name); } };
}
function addVisual(world, geometry, matrix) {
  const attr = geometry.attributes.position, positions = new Float32Array(attr.count * 3), p = new THREE.Vector3();
  for (let i = 0; i < attr.count; i++) p.fromBufferAttribute(attr, i).applyMatrix4(matrix).toArray(positions, i * 3);
  return body(world, { positions, indices: geometry.index?.array || Uint32Array.from({ length: attr.count }, (_, i) => i) }, true);
}

test('real city buildings, galleries, village/cable-car moments and dam set pieces reserve the same full physical/visible route envelope', async () => {
  await initPhysics();
  const assets = await loadGeometryAssets([...CITY_GLB, ...CITY_PROPS.filter(n => n !== 'barrel' && n !== 'dead_tree_c')].map(n => [n, 'structures']).concat([['barrel', 'props'], ['dead_tree_c', 'props']]));
  const previous = globalThis.document; globalThis.document = { createElement: canvasStub };
  try {
    for (const { seed, road, branch } of representatives().filter(c => !['desert', 'canyon'].includes(c.branch.biome))) {
      const world = createWorld(DT), chunks = [], recorded = [];
      const ctx = { road, seed, kit: { get: n => assets.get(n) || null, state: n => assets.has(n) ? 'ready' : 'missing' }, pool: { register() {} }, hook(e) { recorded.push(e); } };
      try {
        for (let c = Math.floor((branch.s0 - 250) / 96); c <= Math.floor((branch.s1 + 250) / 96); c++) {
          const chunk = chunkFixture(road, c); chunks.push(chunk);
          let attempts = 0; while (!buildCity(ctx, chunk) && attempts++ < 30) {} assert.ok(attempts < 30);
          buildGalleries(ctx, chunk); buildMoments(ctx, chunk); buildDamRoad(ctx, chunk);
          for (const mesh of chunk.extras) { mesh.updateMatrixWorld(true); addVisual(world, mesh.geometry, mesh.matrixWorld); }
          for (const [name, list] of chunk.lists) {
            const asset = assets.get(name); if (!asset) continue;
            for (let i = 0; i < list.n; i++) for (const part of asset.parts) addVisual(world, part.geometry, new THREE.Matrix4().fromArray(list.m, i * 16));
          }
        }
        for (const e of recorded) if (e.collision) body(world, e.collision);
        world.step();
        for (let s = branch.s0 - 3; s <= branch.s1 + 3; s += 3) for (const d of [-branch.width / 2 + 1.7, 0, branch.width / 2 - 1.7]) {
          const p = branchPointAt(road, branch, s, d, {}), hit = world.intersectionWithShape({ x: p.x, y: p.y + 2.35, z: p.z }, { x: 0, y: Math.sin(p.th / 2), z: 0, w: Math.cos(p.th / 2) }, new RAPIER.Cuboid(1.45, 2.1, 3.1));
          assert.equal(hit, null, `${seed}/${branch.biome}/s${s}/d${d}: usable car/gunner envelope intersects scenery ${hit?.userData}`);
        }
        for (const g of galleriesNear(ctx, branch.s0 - 100, branch.s1 + 100)) assert.ok(g.s1 <= branch.s0 - 80 || g.s0 >= branch.s1 + 80, 'entire gallery moves outside fork and merge');
        if (branch.biome === 'city') {
          const items = cityItems(ctx, branch.s0 - 100, branch.s1 + 100);
          for (const b of items.b) {
            const p = road.pointAt(b.s, b.arch ? 0 : b.side * (b.dFront + b.D / 2), {}), r = b.arch ? 85 : Math.hypot(b.W, b.D) / 2 + 6;
            assert.equal(road.corridorBlocked(p.x, p.z, r, b.s), false, 'whole city descriptor is clear');
          }
        }
      } finally { for (const chunk of chunks) for (const mesh of chunk.extras) mesh.geometry.dispose(); world.free(); }
    }
  } finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
});

test('each qualified stage has correctly directed stage-specific entry signs, merge warning and markers without duplication', () => {
  for (const { seed, road, branch } of representatives()) {
    const kit = { get() { return {}; } }, pool = { register() {} }; let entries = 0, merge = 0;
    const kind = ['desert', 'canyon'].includes(branch.biome) ? 'shortcut' : `shortcut_${branch.biome}`;
    for (let c = Math.floor((branch.s0 - 120) / 96); c <= Math.floor(branch.s1 / 96); c++) {
      const chunk = chunkFixture(road, c);
      buildDrivingBranches({ road, seed, kit, pool }, chunk);
      const count = [...chunk.lists.values()].reduce((n, list) => n + list.n, 0);
      buildDrivingBranches({ road, seed, kit, pool }, chunk); assert.equal([...chunk.lists.values()].reduce((n, list) => n + list.n, 0), count);
      entries += chunk.lists.get(`driving_${kind}_${branch.side > 0 ? 'left' : 'right'}`)?.n || 0;
      merge += chunk.lists.get(`driving_merge_${branch.side > 0 ? 'right' : 'left'}`)?.n || 0;
    }
    assert.equal(entries, 2); assert.equal(merge, 1);
  }
});

test('actual sedan and truck AI can physically drive and rejoin every qualified stage without fall, flip, hull damage or skipped original progress', async () => {
  for (const { seed, branch: planned } of representatives()) for (const id of ['player_sedan_t1', 'truck_t4']) {
    const sim = await new Sim({ seed }).init(); sim.systems.length = 0; sim.director.enabled = false;
    const branch = sim.road.drivingBranch(planned.id), start = branch.s0 + 90, st = streamerFixture(sim.world, sim.road, start);
    try {
      sim.setGround(st);
      for (let c = Math.floor((branch.s0 - 50) / 96); c <= Math.floor((branch.s1 + 180) / 96); c++) reply(st, c);
      const car = sim.spawnCar(id, { s: start, kind: 'player' }); putCar(sim, car, branch, start, 22);
      let flips = 0, last = car.s, reached = false, largestStep = 0, recoveries = 0;
      const ai = new AIDriver({ sim, player: car, _unflip() { flips++; } }); sim.start();
      for (let i = 0; i < 9000; i++) {
        car.veh.setInput(ai.update(DT)); sim.step(DT);
        largestStep = Math.max(largestStep, Math.abs(car.s - last)); last = car.s;
        recoveries += sim.events.filter(e => e.t === 'groundRecovered').length; sim.events.length = 0;
        if (car.s > branch.s1 + 60) { reached = true; break; }
      }
      const tag = `${seed}/${branch.biome}/${id}: ${JSON.stringify({ s: car.s, route: car.route, d: car.d, hp: car.hp, held: car.held, speed: car.veh.speed, flips, recoveries })}`;
      assert.equal(reached, true, tag); assert.equal(flips, 0, tag); assert.equal(recoveries, 0, tag); assert.equal(car.hp, car.maxHp, tag);
      assert.equal(car.route, null, tag); assert.equal(car.held, false, tag); assert.ok(largestStep < 1.5, tag);
    } finally { sim.dispose(); }
  }
});

test('opposite-bank coast/dam rails remain rendered and physically solid without entering the landward fork, while same-side and both-side guards still reject it', async () => {
  await initPhysics();
  const assets = await loadGeometryAssets([['guardrail_4m', 'props']]); let checked = 0;
  for (const seed of SEEDS) {
    const road = new Road(seed);
    for (const branch of road.ensureDrivingBranches().filter(b => ['coast', 'dam'].includes(b.biome))) {
      const opposite = branch.side === -1 ? 'L' : 'R', same = opposite === 'L' ? 'R' : 'L';
      assert.equal(branchFeatureObstructs({ type: 'guard', side: same }, branch.biome), true);
      assert.equal(branchFeatureObstructs({ type: 'guard', side: 'both' }, branch.biome), true);
      assert.equal(branchFeatureObstructs({ type: 'guard', side: undefined }, branch.biome), true);
      const guards = road.featuresIn(branch.s0 - 100, branch.s1 + 100, 'guard').filter(f => f.side === opposite);
      if (!guards.length) continue;
      checked++;
      const labelsBefore = COLLIDER_LABELS.size, owned = [];
      const world = createWorld(DT), hazards = new Hazards(), rendered = new Map(assets), kit = { assets: rendered, get: n => rendered.get(n) || null, state: n => rendered.has(n) ? 'ready' : 'missing' };
      let visible = 0, physical = 0;
      try {
        for (const f of guards) {
          const bodies = hazards._build({ world, road }, f).bodies;
          owned.push(...bodies); physical += bodies.length;
        }
        for (let c = Math.floor((branch.s0 - 20) / 96); c <= Math.floor((branch.s1 + 20) / 96); c++) {
          const chunk = chunkFixture(road, c);
          assert.equal(buildFurniture({ road, seed, kit, pool: { register() {} }, hook() {} }, chunk), true);
          const list = chunk.lists.get('guardrail_4m'); if (!list) continue;
          visible += list.n;
          for (let i = 0; i < list.n; i++) for (const part of assets.get('guardrail_4m').parts) addVisual(world, part.geometry, new THREE.Matrix4().fromArray(list.m, i * 16));
        }
        assert.ok(visible > 0 && physical > 0, 'the ocean-side rail was not removed to force qualification');
        world.step();
        for (let s = branch.s0 - 3; s <= branch.s1 + 3; s += 3) for (const d of [-branch.width / 2 + 1.7, 0, branch.width / 2 - 1.7]) {
          const p = branchPointAt(road, branch, s, d, {}), hit = world.intersectionWithShape({ x: p.x, y: p.y + 2.35, z: p.z }, { x: 0, y: Math.sin(p.th / 2), z: 0, w: Math.cos(p.th / 2) }, new RAPIER.Cuboid(1.45, 2.1, 3.1));
          assert.equal(hit, null, `${seed}/${branch.biome}/s${s}/d${d}: actual opposite rail must not touch the passage`);
        }
      } finally {
        // Hazards owns labelled physics bodies. Retire them through the real
        // ownership API before freeing this CPU-only world, just as _sync does.
        for (const rb of owned) removeBody(world, rb);
        world.free();
      }
      assert.equal(COLLIDER_LABELS.size, labelsBefore, 'fixture must retire every real guard label without leaking into later lives or worlds');
    }
  }
  assert.ok(checked >= 2, 'both water stages include actual opposite-bank guard examples');
});
