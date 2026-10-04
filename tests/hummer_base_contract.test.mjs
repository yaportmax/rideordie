// Portable real-asset contract. Resolve the integrated repository from this test.
// No environment override or ignored WORK baseline is required.
// Missing metadata/GLB fails setup; no synthetic positive geometry fixture.
// These data/plan checks do not prove native crew, collision, camera or co-op fit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const load = name => import(pathToFileURL(resolve(root, name)).href);
const base = await load('src/data/hummer_base.js');
const families = await load('src/data/vehicle_families.js');
const economy = await load('src/data/upgrades.js');
const profile = await load('src/meta/profile.js');
const { VEHICLES } = await load('src/data/vehicles.js');
const { SPEC_IDS } = await load('src/view/car_state.js');
const { encodeSnapshot, decodeSnapshot, SnapshotBuffer } = await load('src/net/snapshot.js');
const { vehicleUpgradeMounts } = await load('src/view/car_upgrade_mounts.js');
const { buildUpgradePlan } = await load('src/view/car_upgrade_plan.js');
const metadata = JSON.parse(await readFile(resolve(root, 'src/data/hummer_model_info.json'), 'utf8'));
const glb = await readFile(resolve(root, 'public/models/vehicles/player_hummer_t1.glb'));
const glbDocument = () => {
  assert.equal(glb.readUInt32LE(0), 0x46546c67); assert.equal(glb.readUInt32LE(4), 2);
  assert.equal(glb.readUInt32LE(8), glb.length); assert.equal(glb.readUInt32LE(16), 0x4e4f534a);
  return JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
};
const id = base.HUMMER_BASE_ID;
const BASELINE_SPEC_IDS = [
  'truck_t1', 'truck_t2', 'truck_t3', 'truck_t4', 'e_sedan', 'e_muscle', 'e_buggy', 'e_technical', 'e_van', 'e_heavy', 'e_tanker',
  'player_sedan_t1', 'player_sedan_t2', 'player_buggy_t1', 'player_buggy_t2', 'player_buggy_t3', 'e_double_bus',
  'e_barrel_carrier', 'e_grenadier', 'e_armored', 'e_monster', 'e_light_tank', 'e_warwagon',
];
const EXPECTED_CAPS = { engine: 4, armor: 5, tires: 4, nitro: 3, ram: 3, spikes: 2, glass: 2, fueltank: 2, oil: 2, mines: 2 };
const fresh = extra => profile.normalizeProfile({ campaignId: 'hummer-contract', cash: 1000000, ...extra });
const rejectUnchanged = (p, action, reason) => {
  const before = structuredClone(p);
  assert.deepEqual(action(), { ok: false, reason });
  assert.deepEqual(p, before);
};
const legacyCatalogue = [
  ['player_sedan_t1', 0], ['player_sedan_t2', 6500], ['truck_t1', 3125], ['truck_t2', 8125],
  ['truck_t3', 21250], ['truck_t4', 45000], ['player_buggy_t1', 12500],
  ['player_buggy_t2', 22500], ['player_buggy_t3', 37500],
];

test('one new base preserves the existing catalogue and explicit caps', () => {
  assert.equal(id, 'player_hummer_t1');
  assert.deepEqual(economy.TRUCKS.map(t => [t.id, t.cost]), [...legacyCatalogue, [id, 100000], ['player_tank_t1', 250000]]);
  assert.deepEqual(Object.keys(families.VEHICLE_FAMILIES), ['sedan', 'rustbucket', 'buggy', 'hummer', 'tank']);
  assert.deepEqual(families.VEHICLE_FAMILIES.hummer.stageIDs, [id]);
  assert.deepEqual(base.HUMMER_BASE_CAPS, EXPECTED_CAPS);
  assert.deepEqual(families.VEHICLE_FAMILIES.hummer.caps, EXPECTED_CAPS);
  assert.equal(families.PLAYER_VEHICLE_PROTOCOL, 3);
  assert.equal(economy.DEFAULT_PROFILE().truck, 'player_sedan_t1');
});

test('base purchase is affordable at exactly 100k, once-only and grants no paid gear', () => {
  const poor = fresh({ cash: 99999 });
  rejectUnchanged(poor, () => profile.buyTruck(poor, id), 'cash');
  const p = fresh({ cash: 100000 });
  const equipment = structuredClone({ upgrades: p.upgrades, vehicleUpgrades: p.vehicleUpgrades,
    weapons: p.weapons, loadout: p.loadout, weaponOptics: p.weaponOptics });
  assert.deepEqual(profile.buyTruck(p, id), { ok: true });
  assert.equal(p.cash, 0); assert.equal(p.truck, id); assert.ok(p.trucks.includes(id));
  assert.deepEqual({ upgrades: p.upgrades, vehicleUpgrades: p.vehicleUpgrades,
    weapons: p.weapons, loadout: p.loadout, weaponOptics: p.weaponOptics }, equipment);
  rejectUnchanged(p, () => profile.buyTruck(p, id), 'owned');
  rejectUnchanged(p, () => profile.buyTruck(p, 'player_hummer_forged'), 'invalid');
});

test('legacy driver purchases migrate once to Rustbucket, with an empty new family', () => {
  const p = profile.normalizeProfile({ cash: 4567, truck: 'truck_t3', trucks: ['truck_t3'],
    upgrades: { engine: 3, nitro: 2, medkit: 1 } });
  assert.equal(p.cash, 4567); assert.equal(p.truck, 'truck_t3');
  assert.equal(p.vehicleUpgradeSchema, 2);
  assert.equal(p.vehicleUpgrades.rustbucket.engine, 3);
  assert.equal(p.vehicleUpgrades.rustbucket.nitro, 2);
  assert.ok(Object.values(p.vehicleUpgrades.hummer).every(v => v === 0));
  assert.equal(p.upgrades.medkit, 1);
  assert.deepEqual(profile.normalizeProfile(JSON.parse(JSON.stringify(p))), p);
});

test('all 10 purchases stay in the selected family and stop at declared caps', () => {
  const p = fresh({ truck: id, trucks: [id], vehicleUpgradeSchema: 2,
    vehicleUpgrades: { rustbucket: { engine: 2, armor: 1 } } });
  const legacy = structuredClone(p.vehicleUpgrades.rustbucket);
  for (const [track, cap] of Object.entries(EXPECTED_CAPS)) {
    for (let level = 0; level < cap; level++) {
      const before = p.cash, cost = economy.UPGRADE_BY_ID[track].costs[level];
      assert.deepEqual(profile.buyUpgrade(p, track), { ok: true });
      assert.equal(p.cash, before - cost);
      assert.equal(economy.upgradeLevel(p, track), level + 1);
    }
    rejectUnchanged(p, () => profile.buyUpgrade(p, track), 'max');
  }
  assert.deepEqual(p.vehicleUpgrades.rustbucket, legacy);
  const e = economy.effects(p);
  assert.equal(e.truck, id); assert.equal(e.engineMul, 1 + .07 * 4);
  assert.equal(e.hpMul, 1 + .16 * 5); assert.equal(e.gripMul, 1 + .04 * 4);
  assert.equal(e.runFlat, true);
  assert.ok(Math.abs(e.nitroCap - (VEHICLES[id].nitro.capacity + (.4 + .8 * 3))) < 1e-10);
  for (const track of ['ram', 'spikes', 'glass', 'fueltank', 'oil', 'mines']) {
    assert.equal(e[track === 'ram' ? 'ramLevel' : track], EXPECTED_CAPS[track]);
  }
  assert.equal(e.gunnerHp, 100); assert.equal(e.gunnerArmor, 0);
});

test('actual exported metadata creates independent ground-frame spec records', () => {
  const a = base.createHummerBaseVehicleSpecs(metadata)[id];
  const b = base.createHummerBaseVehicleSpecs(metadata)[id];
  assert.equal(a.mass, 3100); assert.equal(a.driveMode, 'wheels'); assert.equal(a.gunners, 1);
  assert.equal(a.hp, 460); assert.equal(a.width, 2.62);
  assert.equal(a.colliderModelFrame, true); assert.equal(a.nitro.capacity, 1.54);
  assert.deepEqual(metadata.sockets.seat_driver, [.44, .84, .24]);
  assert.deepEqual(metadata.sockets.seat_gunner, [0, 1.02, -1.50]);
  assert.deepEqual(metadata.sockets.mounted_deck, [0, 1.02, -.92]);
  assert.deepEqual(a.seats.gunner, metadata.sockets.seat_gunner);
  assert.deepEqual(a.colliders, metadata.collisionProxies);
  for (const key of ['mass', 'hp', 'driveMode', 'gunners', 'colliderModelFrame', 'nitro', 'seats', 'colliders', 'engine', 'susp', 'inertia']) {
    assert.deepEqual(VEHICLES[id][key], a[key], `Integrated Hummer ${key} must preserve the creator contract`);
  }
  a.seats.gunner[1] = -999; a.model.wheels.FL.r = -999; a.colliders[0].half[0] = -999;
  assert.deepEqual(b.seats.gunner, metadata.sockets.seat_gunner);
  assert.equal(b.model.wheels.FL.r, metadata.wheels.FL.r);
  assert.equal(b.colliders[0].half[0], metadata.collisionProxies[0].half[0]);
});

test('old targets and malformed wheel, panel, socket or mounted offset fail', () => {
  for (const corrupt of [
    m => { m.authoringStatus = 'unexported-targets'; },
    m => { m.authoringRevision = 'hummer-prototype-v1'; },
    m => { m.authoringRevision = 'hummer-base-v4'; },
    m => { m.authoringRevision = 'hummer-base-v5-cockpit'; },
    m => { m.sockets.mirror_C = [0, 1.91, .69]; },
    m => { delete m.glb; },
    m => { delete m.roundTrip; },
    m => { delete m.authoredPose; },
    m => { m.authoredPose.preExport.complete = false; },
    m => { m.authoredPose.postImport.maxDeltaMetres = .000051; },
    m => { m.authoredPose.builtBeforeReparent.maxDeltaBasisComponent = .000051; },
    m => { m.sockets.mirror_L = [.98, .8, .71]; },
    m => { m.sockets.mirror_R = [-.98, .8, .71]; },
    m => { m.socketBasis.mirror_R = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }; },
    // Exact V5 native defect: valid rearward export, unusably grazing side face.
    m => { m.socketBasis.mirror_R = { x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] }; },
    m => { m.socketBasis.mirror_L = { x: [-1, 0, 0], y: [0, 1, 0], z: [0, 0, -1] }; },
    m => { m.socketBasis.steering_wheel.z = [0, 0, 1]; },
    m => { m.roundTrip.complete = false; },
    m => { m.roundTrip.maxDeltaMetres = .000051; },
    m => { m.roundTrip.materialNamesEqual = false; },
    m => { m.roundTrip.maxDeltaBasisComponent = .000051; },
    m => { delete m.socketBasis.mirror_C; },
    m => { m.wheels.FL.r = NaN; },
    m => { m.wheels.RR.r += .01; },
    m => { delete m.parts.panel_door_L2; },
    m => { delete m.sockets.upgrade_engine; },
    m => { m.sockets.mounted_deck[2] += .08; },
    m => { m.collisionProxies[0].half[0] = 0; },
  ]) {
    const m = structuredClone(metadata); corrupt(m);
    assert.throws(() => base.createHummerBaseVehicleSpecs(m));
  }
});

test('real GLB has a glTF2 container and the actual named hierarchy', () => {
  const document = glbDocument();
  assert.equal(glb.length, metadata.glb.bytes);
  assert.equal(createHash('sha256').update(glb).digest('hex'), metadata.glb.sha256);
  const names = new Set(document.nodes.map(n => n.name));
  for (const name of ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR', ...Object.keys(metadata.parts),
    'seat_driver', 'seat_gunner', 'mounted_deck', 'steering_wheel', 'part_nitro', 'part_fuel', 'part_oil', 'part_mines']) {
    assert.ok(names.has(name), `Actual GLB is missing ${name}`);
  }
  for (const [parentName, childName] of [['panel_door_L', 'mirror_L'], ['panel_door_R', 'mirror_R'],
    ['steering_wheel', 'steering_wheel_mesh']]) {
    const parent = document.nodes.find(n => n.name === parentName);
    assert.ok(parent?.children?.some(index => document.nodes[index]?.name === childName), `${childName} must ride on ${parentName}`);
  }
  // Byte identity/container/hierarchy checks alone do not establish transformed bounds or renderability.
});

test('all installed tracks have real Hummer visual anchors and all 4 door mounts', () => {
  const plan = buildUpgradePlan(vehicleUpgradeMounts(VEHICLES[id]), EXPECTED_CAPS);
  assert.deepEqual(plan.ids.slice().sort(), Object.keys(EXPECTED_CAPS).sort());
  const actualNodeNames = new Set(glbDocument().nodes.map(node => node.name));
  for (const part of plan.parts) if (part.anchor !== 'body') {
    assert.ok(actualNodeNames.has(part.anchor), `Generated ${part.upgrade} anchor ${part.anchor} must exist in the actual GLB`);
  }
  for (const anchor of ['panel_door_L', 'panel_door_R', 'panel_door_L2', 'panel_door_R2']) {
    assert.ok(plan.parts.some(p => p.upgrade === 'armor' && p.anchor === anchor));
    assert.ok(plan.parts.some(p => p.upgrade === 'spikes' && p.anchor === anchor));
  }
  for (const track of ['nitro', 'fueltank', 'oil', 'mines']) {
    const anchor = `part_${track === 'fueltank' ? 'fuel' : track}`;
    assert.ok(plan.parts.some(p => p.upgrade === track && p.anchor === anchor));
  }
});

test('same-version JSON save retains owned selection and family levels, with valid snapshot capacity', () => {
  const p = fresh({ truck: id, trucks: [id], vehicleUpgradeSchema: 2,
    vehicleUpgrades: { hummer: { engine: 2, mines: 1 }, rustbucket: { armor: 3 } } });
  assert.equal(p.vehicleUpgrades.hummer.engine, 2); assert.equal(p.vehicleUpgrades.hummer.mines, 1);
  assert.equal(p.vehicleUpgrades.rustbucket.armor, 3);
  const restored = profile.normalizeProfile(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(restored, p); assert.deepEqual(profile.selectTruck(restored, id), { ok: true });
  assert.equal(restored.vehicleUpgrades.hummer.engine, 2); assert.equal(restored.vehicleUpgrades.hummer.mines, 1);
  assert.equal(restored.vehicleUpgrades.rustbucket.armor, 3);
  rejectUnchanged(restored, () => profile.buyTruck(restored, id), 'owned');
  assert.deepEqual(SPEC_IDS, Object.keys(VEHICLES)); assert.equal(SPEC_IDS.at(-2), id);
  assert.deepEqual(SPEC_IDS, [...BASELINE_SPEC_IDS, id, 'player_tank_t1'], 'all 24 previous wire identities must keep their exact indices');
  assert.ok(SPEC_IDS.length <= 256, 'Every uint8 spec index must remain representable');
  // Root must also compare the entire pre-integration SPEC_IDS sequence and run normal Session wallet/save flows.
});

test('the actual binary snapshot retains Hummer identity, four wheels, crew aim and recharge lock', () => {
  const spec = VEHICLES[id];
  const packet = (tick, time, x) => {
    const car = { id: 1, spec, kind: 'player', hp: spec.hp, maxHp: spec.hp, engineHp: 100,
      crew: { driver: { alive: true }, gunner: { alive: true, aimYaw: .2, aimPitch: .1, weapon: 0 } },
      veh: { pos: { x, y: 1, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 }, vel: { x: 10, y: 0, z: 0 },
        angvel: { x: 0, y: 0, z: 0 }, wheels: spec.wheels.map(() => ({ L: .4, slip: 0, grounded: true })),
        steerAngle: 0, rpm01: .5, brakeApplied: 0, nitroRechargeLocked: true } };
    return encodeSnapshot({ cars: new Map([[1, car]]), time, state: 'run',
      projectiles: { rockets: [], grenades: [] }, boss: null }, tick,
    { dist: x, hp01: 1, dhp01: 1, ghp01: 1, nitro01: .5, medkits: 2 });
  };
  const first = decodeSnapshot(packet(30, 1, 10));
  assert.ok(first); assert.equal(first.cars[0].spec, id); assert.equal(first.cars[0].L.length, 4);
  assert.ok(Math.abs(first.cars[0].gyaw - .2) < .0001); assert.ok(Math.abs(first.cars[0].gpitch - .1) < .0001);
  assert.equal(first.cars[0].fl & 4096, 4096);
  const buffer = new SnapshotBuffer();
  assert.equal(buffer.push(first, 10), true);
  assert.equal(buffer.push(decodeSnapshot(packet(33, 1.1, 11)), 10.1), true);
  buffer.clockOffset = 9; buffer.delay = 0; buffer.sample(10.05);
  const remote = buffer.states.get(1);
  assert.equal(remote.specId, id); assert.equal(remote.spec, spec); assert.equal(remote.nWheels, 4); assert.equal(remote.L.length, 4);
  assert.equal(remote.nitroRechargeLocked, true); assert.ok(Math.abs(remote.pos.x - 10.5) < .001);
  buffer.clear(); assert.equal(buffer.states.size, 0);
});
