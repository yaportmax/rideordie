import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Road } from '../src/world/road.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { plannedStageEncounters, stageBoatWaterCutBounds, STAGE_BOAT_WATER_CUT } from '../src/data/stage_encounters.js';
import { stageActorReservationBounds, stageActorReservations, stageActorReserved, sceneryFootprint, stageSceneryReserved } from '../src/world/scenery_gen.js';
import { cityItems, buildCity, CITY_GLB, CITY_PROPS } from '../src/world/dressing/city.js';
import { ChunkGround, InstList } from '../src/world/dressing/util.js';
import { terrainPoint } from '../src/world/terrain_gen.js';
import { loadGeometryAssets } from './helpers/driving-assets.mjs';
import { initPhysics, createWorld, RAPIER, GROUPS } from '../src/sim/physics.js';

test('authored elevated shooters reserve their complete last-station retry footprint on both sides without extending the road', () => {
  for (const kind of ['gun_tower', 'grenade_nest', 'cliff_riflemen']) for (const side of [-1, 1]) {
    const b = stageActorReservationBounds({ id: kind, kind, s0: 1000, s1: 1210, side });
    assert.deepEqual([b.s0, b.s1, b.d0, b.d1], side > 0 ? [880, 1196, 9, 93] : [880, 1196, -93, -9]);
    assert.ok(Object.isFrozen(b));
  }
  for (const level of TEN_LEVELS) {
    const road = new Road(31, { mode: 'campaign', level: level.number }), before = road.sEnd;
    const bounds = stageActorReservations(road);
    assert.equal(road.sEnd, before, 'scenery planning does not sample/extend the route');
    assert.equal(stageActorReservations(road), bounds);
    assert.ok(Object.isFrozen(bounds));
    for (const b of bounds) {
      const sm = (b.s0 + b.s1) * .5, dm = (b.d0 + b.d1) * .5;
      assert.equal(stageActorReserved(road, sm, dm), true);
      assert.equal(stageActorReserved(road, b.s1 + 2, dm), false, 'origin lies outside');
      assert.equal(stageActorReserved(road, b.s1 + 2, dm, 3, .1), true, 'full structure edge overlaps');
      assert.equal(stageActorReserved(road, sm, b.d1 + 2, .1, 3), true, 'lateral wall overlaps despite outside origin');
      assert.equal(stageActorReserved(road, sm, 0, .1, .1), false, 'this extra scenery reservation preserves the main deck');
    }
  }
});

test('both patrol-water cuts reserve the full longitudinal fade and offshore reach while preserving the pavement-side rail', () => {
  for (const [level, side] of [[3, 1], [6, -1]]) {
    const road = new Road(7, { mode: 'campaign', level }), site = plannedStageEncounters(road).find(s => s.kind === 'patrol_boat');
    assert.ok(site);
    const cut = stageBoatWaterCutBounds(site), bounds = stageActorReservationBounds(site), far = 9.5 + STAGE_BOAT_WATER_CUT.lateralEnd;
    assert.equal(bounds.s0, cut.start - cut.fade); assert.equal(bounds.s1, cut.end + cut.fade);
    assert.equal(stageActorReserved(road, bounds.s0 + .1, side * (far - .1)), true, 'near fade and far offshore footprint is cleared');
    assert.equal(stageActorReserved(road, bounds.s1 - .1, side * 10), true, 'departure fade still excludes solid shore props');
    assert.equal(stageActorReserved(road, site.s0, side * 9), false, 'original rail at the asphalt edge remains available');
    assert.equal(stageActorReserved(road, site.s0, -side * 100), false, 'opposite land bank remains dressed');
    assert.equal(stageActorReserved(road, bounds.s0 - 20, side * 100, 2), false, 'quiet shore before the fade remains available');
  }
});

test('rotated and off-center scenery uses its actual exported visible and collision bounds rather than its origin', () => {
  const road = new Road(1, { mode: 'campaign', level: 5 }), site = plannedStageEncounters(road).find(s => s.kind === 'gun_tower');
  const s = site.s0 + 25, frame = road.sample(s, {}), origin = road.pointAt(s, site.side * 105, {});
  // The visible origin is outside the actor area, but a real rear collision
  // wing extends 24 m into the shooting lane. +X points along the road here.
  const asset = { box: new THREE.Box3(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 8, 2)),
    collision: { pos: Float32Array.from([-2, 0, -2, 2, 8, 24]), idx: Uint32Array.from([0, 1, 0]) }, radius: 2 };
  const yaw = frame.th - Math.PI / 2 * site.side;
  assert.equal(stageActorReserved(road, s, site.side * 105), false);
  const p = sceneryFootprint(road, s, origin.x, origin.z, yaw, asset, 1);
  assert.ok(p.halfD > 12 && p.halfS >= 2 - 1e-10, 'collision wing contributes to the actual projection');
  assert.equal(stageSceneryReserved(road, s, origin.x, origin.z, yaw, asset), true);
  const outside = road.pointAt(s, site.side * 150, {});
  assert.equal(stageSceneryReserved(road, s, outside.x, outside.z, yaw, asset), false);
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
  const ground = new ChunkGround(road, road.seed, c); ground.build();
  return { c, s0: c * 96, ground, done: new Set(), lists: new Map(), hooks: [], extras: [],
    addExtra(m) { this.extras.push(m); }, list(name) { if (!this.lists.has(name)) this.lists.set(name, new InstList()); return this.lists.get(name); } };
}
function buildingBounds(b) {
  const d = b.arch ? 0 : b.side * (b.dFront + b.D / 2);
  return { s: b.s, d, halfS: b.arch ? 85 : b.W / 2 + 6, halfD: b.arch ? 85 : b.D / 2 + 6 };
}

test('actual generated city descriptors remove intersecting complete building boxes and retain unrelated street walls and skyline', () => {
  for (const seed of [1, 7, 31]) {
    const road = new Road(seed, { mode: 'campaign', level: 5 }), site = plannedStageEncounters(road).find(s => s.kind === 'gun_tower');
    const ctx = { road, seed }, start = site.s0 - 260, end = site.s0 + 360, result = cityItems(ctx, start, end);
    const raw = [...ctx.cityCache.values()].flatMap(block => [...block.lots, ...block.back, ...block.sky]).filter(b => b.s >= start && b.s < end);
    const removed = raw.filter(b => { const q = buildingBounds(b); return stageActorReserved(road, q.s, q.d, q.halfS, q.halfD); });
    assert.ok(removed.length > 0, `${seed}: the fixture actually generated obstructing city structures`);
    assert.ok(removed.some(b => Math.abs(b.side * (b.dFront + b.D / 2)) > 93 || b.s < site.s0 - 120 || b.s > site.s0 + 196), 'at least one real box edge overlaps while its origin is outside');
    for (const b of removed) assert.equal(result.b.includes(b), false, 'whole visual/collision descriptor is removed');
    assert.ok(result.b.some(b => b.side === -site.side && !b.arch), 'opposite city street wall survives');
    assert.ok(result.b.some(b => b.row === 'C'), 'distant skyline survives');
    for (const b of result.b) { const q = buildingBounds(b); assert.equal(stageActorReserved(road, q.s, q.d, q.halfS, q.halfD), false); }
    assert.deepEqual(cityItems(ctx, start, end), result, 'cached generation produces the same accepted structures');
  }
});

test('actual city facade and physical boxes leave native tower weakpoint approach rays clear while outside concrete remains shootable', async () => {
  await initPhysics();
  const assets = await loadGeometryAssets([...CITY_GLB, ...CITY_PROPS.filter(n => n !== 'barrel' && n !== 'dead_tree_c')].map(n => [n, 'structures']).concat([['barrel', 'props'], ['dead_tree_c', 'props']]));
  const previous = globalThis.document; globalThis.document = { createElement: canvasStub };
  try {
    for (const seed of [1, 31]) {
      const road = new Road(seed, { mode: 'campaign', level: 5 }), site = plannedStageEncounters(road).find(s => s.kind === 'gun_tower');
      const world = createWorld(), chunks = [], recorded = [];
      const ctx = { road, seed, kit: { get: n => assets.get(n) || null, state: n => assets.has(n) ? 'ready' : 'missing' }, pool: { register() {} }, hook(e) { recorded.push(e); } };
      try {
        for (let c = Math.floor((site.s0 - 160) / 96); c <= Math.floor((site.s0 + 230) / 96); c++) {
          const chunk = chunkFixture(road, c); chunks.push(chunk);
          let attempts = 0; while (!buildCity(ctx, chunk) && attempts++ < 8) {} assert.ok(attempts < 8);
        }
        for (const event of recorded) {
          const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
          world.createCollider(RAPIER.ColliderDesc.trimesh(event.collision.pos, event.collision.idx).setCollisionGroups(GROUPS.world), body);
        }
        world.step();
        let tested = 0;
        for (const eyeS of [site.s0 - 50, site.s0 + 126]) for (const ds of [0, 38, 76]) for (const d of [17, 49, 85]) {
          const target = terrainPoint(road, seed, site.s0 + ds, site.side * d, {});
          target.y += 1.7; // authored tower weakpoint: ground +5 -3.3
          const eye = road.pointAt(eyeS, 0, {}); eye.y += 2.2;
          const direction = new THREE.Vector3(target.x - eye.x, target.y - eye.y, target.z - eye.z), distance = direction.length(); direction.normalize();
          const hit = world.castRay(new RAPIER.Ray(eye, direction), distance - .02, true);
          assert.ok(hit === null, `${seed}: CONCRETE covers tower retry eyeS=${eyeS}, s+${ds}/d${d}; TOI=${hit?.timeOfImpact}, handle=${hit?.collider?.handle}`); tested++;
        }
        assert.equal(tested, 18);
        const outside = cityItems(ctx, site.s0 - 160, site.s0 + 230).b.find(b => !b.arch && !b.glb && !b.rubble && b.dFront < 130 && b.side === -site.side);
        assert.ok(outside, 'an unrelated real solid building survives');
        const center = road.pointAt(outside.s, outside.side * (outside.dFront + outside.D / 2), {});
        const concrete = world.castRay(new RAPIER.Ray({ x: center.x, y: center.y + 150, z: center.z }, { x: 0, y: -1, z: 0 }), 220, true);
        assert.ok(concrete, 'retained city collision remains physical');
        assert.ok(chunks.some(chunk => chunk.extras.some(mesh => mesh.geometry.attributes.position.count > 100)), 'accepted facade geometry is still emitted');
      } finally {
        world.free();
        for (const chunk of chunks) for (const mesh of chunk.extras) mesh.geometry.dispose();
      }
    }
  } finally { globalThis.document = previous; }
});
