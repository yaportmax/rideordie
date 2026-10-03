import { Vector3 } from 'three';
import './peer-import.mjs';
import { Road } from '../../src/world/road.js';
import { plannedStageEncounters, stageBoatWaterCutBounds } from '../../src/data/stage_encounters.js';
import { CHUNK_LEN, genTerrainChunk, genRoadChunk, genDrivingBranchChunk } from '../../src/world/terrain_gen.js';
import { RAPIER, GROUPS, RAY_SHOT, initPhysics, createWorld } from '../../src/sim/physics.js';
import { StageEncounters } from '../../src/sim/stage_encounters.js';
import { makeCarState } from '../../src/view/car_state.js';

const { Run } = await import('../../src/game/run.js');

export function patrolWaterFixture(seed, level) {
  const road = new Road(seed, { mode: 'campaign', level });
  const site = plannedStageEncounters(road).find(e => e.kind === 'patrol_boat');
  if (!site) throw new Error(`${seed}:${level}: the real chapter has no planned boat encounter`);
  return { road, site, bounds: stageBoatWaterCutBounds(site) };
}

export function patrolAddMesh(world, data, visible = false, label = 'mesh') {
  const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(...data.anchor));
  const col = world.createCollider(RAPIER.ColliderDesc.trimesh(visible ? data.positions : data.colPositions || data.positions,
    Uint32Array.from(visible ? data.indices : data.colIndices || data.indices)).setCollisionGroups(GROUPS.world), rb);
  col.userData = label;
  return col;
}

export function patrolShot(world, origin, target) {
  const direction = new Vector3().copy(target).sub(origin), distance = direction.length();
  direction.divideScalar(distance);
  return world.castRay(new RAPIER.Ray(origin, direction), distance - .25, true, undefined, RAY_SHOT);
}

export function patrolHitDescription(hit) {
  return hit ? JSON.stringify({ timeOfImpact: hit.timeOfImpact, handle: hit.collider?.handle, mesh: hit.collider?.userData }) : 'clear';
}

export function patrolNativeEye(road, s, specId) {
  // Actual source eye and vehicle dimensions in a controlled level pose.
  const state = makeCarState(1, specId, 'player'), p = road.pointAt(s, 0, {});
  state.pos.set(p.x, p.y + state.ride.restComHeight, p.z);
  state.quat.setFromAxisAngle(new Vector3(0, 1, 0), p.th);
  return Run.prototype._gunnerEye.call({}, state, new Vector3());
}

export async function createPatrolWaterScene(seed, level, suppliedFixture) {
  await initPhysics();
  const { road, site, bounds } = suppliedFixture || patrolWaterFixture(seed, level);
  const world = createWorld(), sim = { seed, road, world }, manager = new StageEncounters();
  manager.sim = sim;
  try {
    // Actual worker/SyncGround terrain, asphalt and authored branch triangles.
    // No collision group exception, target replacement or visibility mock.
    for (let chunk = Math.floor((site.s0 - 180) / CHUNK_LEN); chunk <= Math.floor((site.s0 + 180) / CHUNK_LEN); chunk++) {
      patrolAddMesh(world, genTerrainChunk(road, seed, chunk, 0), false, `terrain:${chunk}`);
      patrolAddMesh(world, genRoadChunk(road, seed, chunk), false, `road:${chunk}`);
      for (const branch of genDrivingBranchChunk(road, seed, chunk)) patrolAddMesh(world, branch, false, `branch:${branch.route}:${chunk}`);
    }
    manager._spawnSite(sim, site); world.step();
    return { road, site, bounds, world, sim, manager, boats: [...manager.targets()].filter(actor => actor.kind === 'boat'),
      dispose() { manager.dispose(sim); world.free(); } };
  } catch (error) { manager.dispose(sim); world.free(); throw error; }
}
