// AUTHORED UNRUN. Setup requires fresh actual exported metadata/GLB, no mock art.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const load = path => import(pathToFileURL(resolve(root, path)).href);
const base = await load('src/data/tank_base.js');
const info = JSON.parse(await readFile(resolve(root, 'src/data/tank_model_info.json'), 'utf8'));
const bytes = await readFile(resolve(root, 'public/models/vehicles/player_tank_t1.glb'));
const { VEHICLES, rideInfo } = await load('src/data/vehicles.js');
const families = await load('src/data/vehicle_families.js');
const { SPEC_IDS } = await load('src/view/car_state.js');
const { vehicleUpgradeMounts } = await load('src/view/car_upgrade_mounts.js');
const { buildUpgradePlan } = await load('src/view/car_upgrade_plan.js');
const { appendTankTensionerPlan } = await load('src/view/tank_upgrade_mounts.js');
const id = base.TANK_BASE_ID;
const OLD_IDS = ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4', 'e_sedan', 'e_muscle', 'e_buggy', 'e_technical', 'e_van', 'e_heavy', 'e_tanker',
  'player_sedan_t1', 'player_sedan_t2', 'player_buggy_t1', 'player_buggy_t2', 'player_buggy_t3', 'e_double_bus', 'e_barrel_carrier',
  'e_grenadier', 'e_armored', 'e_monster', 'e_light_tank', 'e_warwagon', 'player_hummer_t1'];

test('actual exported tank bytes and authored/round-trip measured poses are required', () => {
  assert.equal(bytes.length, info.glb.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), info.glb.sha256);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
  assert.equal(base.validateTankBaseMetadata(info), info);
  for (const mutation of [v => { v.authoringStatus = 'target'; }, v => { delete v.authoredPose.preExport; },
    v => { v.sockets.mirror_R[2] += .03; }, v => { v.socketBasis.mirror_L.z = [0, 0, 1]; },
    v => { delete v.parts.part_track_R; }, v => { delete v.parts.part_roadwheel_L3; },
    v => { v.wheels.EXTRA = v.wheels.FL; }, v => { v.trackContract.contactRadius = v.wheels.FL.r; }]) {
    const bad = structuredClone(info); mutation(bad); assert.throws(() => base.validateTankBaseMetadata(bad));
  }
});

test('single expensive tank specialization appends every prior ID and keeps existing index identities', () => {
  assert.equal(base.TANK_BASE_CATALOGUE.cost, 250000);
  assert.deepEqual(families.VEHICLE_FAMILIES.tank.stageIDs, [id]);
  assert.equal(families.PLAYER_VEHICLE_PROTOCOL, 3);
  assert.deepEqual(SPEC_IDS, [...OLD_IDS, id]); assert.ok(SPEC_IDS.length <= 256);
  assert.deepEqual(families.PLAYER_VEHICLE_CATALOGUE.slice(-2).map(v => [v.id, v.cost]), [['player_hummer_t1', 100000], [id, 250000]]);
  assert.equal(VEHICLES.player_hummer_t1.mass, 3100); assert.equal(VEHICLES.player_hummer_t1.width, 2.62);
  assert.equal(VEHICLES[id].driveMode, 'tracks'); assert.equal(VEHICLES[id].wheels.length, 4);
  assert.equal(VEHICLES[id].trackedDrive.contactRadius, .39); assert.equal(VEHICLES[id].wheelRadius, info.wheels.FL.r);
  assert.notEqual(VEHICLES[id].wheelRadius, VEHICLES[id].trackedDrive.contactRadius);
  const ride = rideInfo(VEHICLES[id]);
  assert.equal(ride.restComHeight, ride.restLen + .39 - ride.mountY);
});

test('all 27 family purchases have actual owned anchors; track equipment is not generic inflated tires', () => {
  const spec = VEHICLES[id], mounts = vehicleUpgradeMounts(spec), seen = new Set();
  assert.deepEqual(mounts.wheels, []); assert.deepEqual(mounts.suspension, []);
  assert.equal(Object.values(base.TANK_BASE_CAPS).reduce((a, n) => a + n, 0), 27);
  for (const [upgrade, cap] of Object.entries(base.TANK_BASE_CAPS)) for (let level = 1; level <= cap; level++) {
    const plan = appendTankTensionerPlan(buildUpgradePlan(mounts, { [upgrade]: level }), mounts);
    assert.deepEqual(plan.ids, [upgrade]); assert.ok(plan.parts.length > 0);
    for (const part of plan.parts) {
      assert.ok([...part.p, ...part.size, ...part.rotation].every(Number.isFinite)); assert.ok(part.size.every(n => n > 0));
      assert.ok(part.anchor === 'body' || spec.model.sockets[part.anchor] || spec.model.parts[part.anchor] || part.anchor.startsWith('wheel_'), part.anchor);
    }
    if (upgrade === 'tires') assert.ok(plan.parts.every(p => p.anchor.startsWith('wheel_') && p.shape !== 'torus'));
    if (upgrade === 'glass') assert.ok(plan.parts.every(p => p.shape === 'box' && p.anchor === 'panel_windshield'));
    seen.add(upgrade);
  }
  assert.deepEqual([...seen].sort(), Object.keys(base.TANK_BASE_CAPS).sort());
  const combined = appendTankTensionerPlan(buildUpgradePlan(mounts, base.TANK_BASE_CAPS), mounts);
  assert.ok(combined.parts.some(p => p.upgrade === 'armor' && p.anchor === 'panel_door_L'));
  assert.ok(combined.parts.some(p => p.upgrade === 'spikes' && p.anchor === 'panel_door_R'));
  assert.ok(combined.parts.some(p => p.upgrade === 'engine' && p.anchor === 'panel_hood'));
});
