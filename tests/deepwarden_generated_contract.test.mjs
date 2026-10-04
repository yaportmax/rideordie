// AUTHORED UNRUN. Root owns parsing/imports/tests/native execution. Requires
// ordinary complete current candidate and the exact closed generated-first pair.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { Road } from '../src/world/road.js';
import { VEHICLES, rideInfo } from '../src/data/vehicles.js';
import { TEN_LEVELS } from '../src/data/campaign.js';
import { resolveEliteVehicle, DEEPWARDEN_ELITE } from '../src/data/elite_vehicles.js';
import INFO from '../src/data/deepwarden_model_info.json' with { type: 'json' };
import { drillLaneFootprintFits, drillPhysicalFootprintFits } from '../src/sim/drill_corridor.js';
import { drillLaneFootprintFits as oldVisibleFootprintFits } from './fixtures/deepwarden_corridor_visual_bounds_v2.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex').toUpperCase();
const SPEC = resolveEliteVehicle(VEHICLES.e_heavy, DEEPWARDEN_ELITE);
const GROUND = { hasColliderAt: () => true };

test('exact first real export and dedicated metadata are integrated without reformatting or generic-table projection', () => {
  const metadata = readFileSync(new URL('../src/data/deepwarden_model_info.json', import.meta.url));
  const model = readFileSync(new URL('../public/models/vehicles/boss_deepwarden.glb', import.meta.url));
  assert.equal(metadata.byteLength, 9517);
  assert.equal(sha(metadata), 'FBD9B910EA0DF351DF19B0086A1298C7EC033B9C2451A87A6E01F141A9AF5CB9');
  assert.equal(model.byteLength, 1789812);
  assert.equal(sha(model), '180C7EE51D03E856BC4FB41BD93F7615BBBB87EEB4D34B759EDA1AAC5C0EE388');
  assert.equal(model.readUInt32LE(0), 0x46546c67, 'actual GLB header');
  assert.equal(model.readUInt32LE(4), 2);
  assert.equal(model.readUInt32LE(8), model.byteLength);
  assert.deepEqual(INFO.budget, { triangles: 20950, primitives: 42, meshNodes: 17 });
  assert.equal(SPEC.modelId, INFO.id); assert.equal(SPEC.requiredStandaloneModel, true);
  assert.deepEqual(SPEC.model.bbox, INFO.bbox);
  assert.deepEqual(SPEC.colliders, INFO.colliders);
  assert.deepEqual(SPEC.hitZones, INFO.hitZones);
  assert.deepEqual(SPEC.model.sockets, INFO.sockets);
  assert.deepEqual(SPEC.seats, { driver: INFO.sockets.seat_driver, gunner: INFO.sockets.seat_gunner });
});

test('retained V2 source catches the actual cutter-collider padding missed by a visible-only footprint at an actual Underground road edge', () => {
  const before = readFileSync(new URL('./fixtures/deepwarden_corridor_visual_bounds_v2.mjs', import.meta.url));
  assert.equal(sha(before), 'B7671F679FF69D49F98FB5FA2403B40F8361655A0B49A86F8B8F960871969BC3');
  const chapter = TEN_LEVELS.find(level => level.id === 'underground');
  const road = new Road(7, { version: 1, mode: 'campaign', level: chapter.number });
  road.ensureDrivingBranches();
  // Real generated road/projection, never a fake nominal-width projector. The
  // loaded-ground predicate is a declared policy fixture; this is not a driven
  // wheel/terrain/ceiling trajectory or native pixel acceptance.
  const cutter = INFO.colliders[3];
  assert.ok(cutter.center[0] + cutter.half[0] > INFO.bbox.max[0] + .05);
  assert.ok(cutter.center[2] + cutter.half[2] > INFO.bbox.max[2] + .03);
  let witness = null;
  for (let s = chapter.bossDistance + 32; s <= chapter.bossDistance + 2200 && !witness; s += 32) {
    if (Math.abs(road.sample(s, {}).k) > 1 / 220) continue;
    if (!drillLaneFootprintFits(road, GROUND, SPEC, s, 0)) continue;
    for (let lane = 4.8; lane <= 5.4; lane += .005) {
      if (oldVisibleFootprintFits(road, GROUND, SPEC, s, lane)
          && !drillLaneFootprintFits(road, GROUND, SPEC, s, lane)) {
        witness = { s, lane }; break;
      }
    }
  }
  assert.ok(witness, 'the actual road must expose the extracted visual/contact clearance mismatch; investigate if absent');
  assert.equal(oldVisibleFootprintFits(road, GROUND, SPEC, witness.s, witness.lane), true);
  assert.equal(drillLaneFootprintFits(road, GROUND, SPEC, witness.s, witness.lane), false,
    'physical padding cannot borrow the authored 0.35m road-edge clearance');
  assert.equal(drillLaneFootprintFits(road, GROUND, SPEC, witness.s, 0), true,
    'normal genuine route centre remains available; the correction does not disable the encounter');
});

test('missing or malformed matching hull metadata cannot qualify either a planned or live drill footprint', () => {
  const chapter = TEN_LEVELS.find(level => level.id === 'underground');
  const road = new Road(7, { version: 1, mode: 'campaign', level: chapter.number });
  const s = chapter.bossDistance + 64, p = road.drivingPointAt(s, 0, null, {}), restComHeight = rideInfo(SPEC).restComHeight;
  const veh = { pos: new THREE.Vector3(p.x, p.y + restComHeight, p.z),
    quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.th), restComHeight };
  assert.equal(drillPhysicalFootprintFits(road, GROUND, { spec: SPEC, s, route: null, veh }), true,
    'the same complete upright supported source-road pose qualifies with the actual matching hulls');
  for (const colliders of [undefined, [], [{ center: [0, 0, NaN], half: [1, 1, 1] }],
    [{ center: [0, 0, 0], half: [1, -1, 1] }]]) {
    const spec = { ...SPEC, colliders };
    assert.equal(drillLaneFootprintFits(road, GROUND, spec, s, 0), false);
    assert.equal(drillPhysicalFootprintFits(road, GROUND, { spec, s, route: null, veh }), false);
  }
});
