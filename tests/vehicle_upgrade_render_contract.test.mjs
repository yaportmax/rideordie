import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../src/core/assets.js';
import { VEHICLES, vehicleModelURL, vehicleModelURLs } from '../src/data/vehicles.js';
import { PLAYER_VEHICLE_IDS, DRIVER_UPGRADE_IDS, familyOf, upgradeCap } from '../src/data/vehicle_families.js';
import { CarView } from '../src/view/car_view.js';
import { buildUpgradePlan } from '../src/view/car_upgrade_plan.js';
import { vehicleUpgradeMounts } from '../src/view/car_upgrade_mounts.js';
import { DebrisSystem } from '../src/view/debris.js';
import { WorldView } from '../src/game/world_view.js';
import { measureCabin } from '../src/view/fx/cabin.js';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { upgradeStats, truckStats, suggestNext } from '../src/ui/garage_stats.js';
import { buildPlayerSpec } from '../src/game/run_setup.js';

// Actual shipped GLBs and production loader/merge path. Only image decoding is
// replaced, so these are geometry/ownership contracts, not GPU or art proof.
const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self, createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends old.Request { constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://vehicle-contract.local' + url : url, opts); } };
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  if (url.origin !== 'http://vehicle-contract.local') return old.fetch(request);
  return new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
};
try { await Assets.preload([...new Set(PLAYER_VEHICLE_IDS.map(vehicleModelURL))]); }
finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }

const maxLevels = id => Object.fromEntries(DRIVER_UPGRADE_IDS.map(upgrade => [upgrade, upgradeCap(familyOf(id), upgrade)]));
const meshCount = root => { let count = 0; root.traverse(node => { if (node.isMesh) count++; }); return count; };
const modifiers = root => { const nodes = []; root.traverse(node => { if (node.userData.ownedVehicleUpgradeGeometry) nodes.push(node); }); return nodes; };

test('every purchased driver track mounts on all ten actual player stages without changing template mechanics', () => {
  for (const id of PLAYER_VEHICLE_IDS) {
    const template = Assets.template(vehicleModelURL(id)), before = meshCount(template), view = new CarView(VEHICLES[id], { lod: false });
    const levels = maxLevels(id), plan = buildUpgradePlan(vehicleUpgradeMounts(VEHICLES[id]), levels);
    assert.deepEqual(plan.ids.sort(), [...DRIVER_UPGRADE_IDS].sort(), id);
    assert.equal(view.setUpgradeLevels(levels), true);
    assert.equal(view.upgradeKit.meshCount, plan.estimatedDraws, 'one generated draw per actual detachable anchor');
    const kit = view.upgradeKit;
    assert.equal(view.setUpgradeLevels(structuredClone(levels)), false, 'same immutable configuration does no geometry rebuilding');
    assert.equal(view.upgradeKit, kit);
    for (const record of kit.records) {
      assert.ok(record.anchor.parent, `${id}: ${record.anchor.name}`);
      for (const value of record.mesh.geometry.attributes.position.array) assert.ok(Number.isFinite(value));
    }
    assert.equal(meshCount(template), before, 'the reusable GLB remains free of installed geometry');
    for (const [name, node] of view.wheelNodes) assert.equal(node.getObjectByName(`installed_upgrades_wheel_${name}`)?.parent, node, 'tread moves with its wheel');
    view.dispose(); assert.equal(kit.meshCount, 0);
  }
});

test('canonical aliases reuse actual templates while families have separate chassis and visible stage trim', () => {
  assert.equal(Assets.template(vehicleModelURL('player_sedan_t1')), Assets.template(vehicleModelURL('player_sedan_t2')));
  assert.equal(Assets.template(vehicleModelURL('player_buggy_t1')), Assets.template(vehicleModelURL('player_buggy_t3')));
  assert.notEqual(Assets.template(vehicleModelURL('player_sedan_t1')), Assets.template(vehicleModelURL('truck_t1')));
  assert.notEqual(Assets.template(vehicleModelURL('player_buggy_t1')), Assets.template(vehicleModelURL('truck_t1')));
  assert.equal(new Set(vehicleModelURLs()).size, vehicleModelURLs().length);
  for (const id of ['player_sedan_t2', 'player_buggy_t2', 'player_buggy_t3']) {
    const view = new CarView(VEHICLES[id], { lod: false });
    assert.ok(view.stageTrim.meshCount > 0, id); assert.equal(view.upgradeKit, null, 'stage trim does not grant bought tracks');
    const trim = view.stageTrim; view.dispose(); assert.equal(trim.meshCount, 0);
  }
});

test('detached purchased hardware survives vehicle removal and releases each owned buffer at debris retirement', () => {
  const view = new CarView(VEHICLES.player_sedan_t1, { lod: false, upgradeLevels: maxLevels('player_sedan_t1') });
  const scene = new THREE.Scene(), debris = new DebrisSystem(scene, () => null); scene.add(view.root);
  const door = view.panels.get('door_L'), child = door.getObjectByName('installed_upgrades_panel_door_L');
  let released = 0; child.geometry.addEventListener('dispose', () => released++);
  debris.detach(door, new THREE.Vector3(), new THREE.Vector3(), .05);
  const kit = view.upgradeKit; view.dispose();
  assert.equal(released, 0); assert.equal(child.parent, door); assert.ok(kit.meshCount > 0);
  debris.update(.1); assert.equal(released, 1); assert.equal(child.parent, null); assert.equal(kit.meshCount, 0);
  debris.clear(); view.dispose(); assert.equal(released, 1, 'retiring twice cannot dispose the same owned buffer twice');
});

test('fallback wreck coloring never corrupts the shared modifier material or sibling purchases', () => {
  const a = new CarView(VEHICLES.player_sedan_t1, { lod: false, upgradeLevels: { armor: 1 } });
  const b = new CarView(VEHICLES.player_sedan_t1, { lod: false, upgradeLevels: { armor: 1 } });
  const aMesh = modifiers(a.root)[0], bMesh = modifiers(b.root)[0];
  assert.equal(aMesh.material, bMesh.material);
  const sibling = Array.from(bMesh.geometry.attributes.color.array), shared = bMesh.material.color.toArray();
  const materials = new Map(); a.root.traverse(node => { if (node.isMesh) for (const material of [].concat(node.material)) if (!materials.has(material)) materials.set(material, { color: material.color?.clone(), intensity: material.emissiveIntensity }); });
  WorldView.prototype._charCar.call({}, { view: a });
  assert.deepEqual(Array.from(bMesh.geometry.attributes.color.array), sibling);
  assert.deepEqual(bMesh.material.color.toArray(), shared);
  assert.notDeepEqual(Array.from(aMesh.geometry.attributes.color.array), sibling);
  for (const [material, original] of materials) { if (original.color) material.color.copy(original.color); material.emissiveIntensity = original.intensity; }
  a.dispose(); b.dispose();
});

test('rear-engine buggy cabin measurement follows the actual motor cover instead of the front hood', () => {
  for (const id of ['player_buggy_t1', 'player_buggy_t3']) {
    const view = new CarView(VEHICLES[id], { lod: false, upgradeLevels: { engine: 2 } });
    const cab = measureCabin(view); assert.equal(cab.rearEngine, true);
    assert.ok(cab.hood.max.z < -.8 && cab.hood.min.z < -1.4, 'rear smoke/fire envelope stays behind both seats');
    assert.ok(cab.plane.z > 0); assert.ok(cab.max.z > cab.min.z); view.dispose();
  }
  const sedan = new CarView(VEHICLES.player_sedan_t1, { lod: false }), cab = measureCabin(sedan);
  assert.equal(cab.rearEngine, false); assert.ok(cab.hood.min.z > .6); sedan.dispose();
});

test('shop comparisons use target-family purchases and next-level previews leave persistent ownership intact', () => {
  const p = DEFAULT_PROFILE(); p.trucks.push('truck_t1', 'player_buggy_t1');
  p.vehicleUpgrades.sedan.engine = 2; p.vehicleUpgrades.rustbucket.engine = 5; p.vehicleUpgrades.buggy.engine = 0;
  p.vehicleUpgrades.sedan.nitro = 1; const before = structuredClone(p);
  const rows = truckStats(p, 'truck_t1', 'km'), speed = rows.find(row => row.label === 'TOP SPEED');
  assert.ok(Math.abs(speed.before - VEHICLES.player_sedan_t1.engine.vmax * 1.14 * 3.6) < 1e-9);
  assert.ok(Math.abs(speed.after - VEHICLES.truck_t1.engine.vmax * 1.35 * 3.6) < 1e-9);
  const tank = upgradeStats(p, 'nitro').find(row => row.label === 'NITRO TANK');
  const next = structuredClone(p); next.vehicleUpgrades.sedan.nitro++;
  assert.equal(tank.before, buildPlayerSpec(p).spec.nitro.capacity); assert.equal(tank.after, buildPlayerSpec(next).spec.nitro.capacity);
  assert.deepEqual(p, before);
  p.truck = 'player_buggy_t1'; p.vehicleUpgrades.buggy.armor = 2;
  assert.equal(upgradeStats(p, 'armor')[0].after, null, 'family armor cap hides an impossible purchase');
  const suggestion = suggestNext(p, 'TRUCK'); assert.notEqual(suggestion?.id, 'armor', 'reward suggestions respect the cap');
});

test('repeated actual-model previews release only instance-owned materials and retain cached GLB/LOD resources', () => {
  const templates = new Set(), shared = new Set();
  for (const id of PLAYER_VEHICLE_IDS) {
    const template = Assets.template(vehicleModelURL(id)); templates.add(template);
    template.traverse(node => { if (node.isMesh) { shared.add(node.geometry); for (const m of [].concat(node.material)) shared.add(m); } });
  }
  let sharedReleases = 0;
  const sharedRelease = () => sharedReleases++;
  for (const resource of shared) resource.addEventListener('dispose', sharedRelease);
  let created = 0, released = 0;
  for (let repeat = 0; repeat < 2; repeat++) for (const id of PLAYER_VEHICLE_IDS) {
    const view = new CarView(VEHICLES[id], { upgradeLevels: maxLevels(id) });
    const instance = [...view.ownedResources.users.keys()];
    assert.ok(instance.length > 0); assert.ok(instance.includes(view.lodMat), 'each distinct LOD tint material is owned');
    for (const resource of instance) {
      assert.ok(!shared.has(resource)); created++; resource.addEventListener('dispose', () => released++);
    }
    const cached = view.lod.children[0].geometry; let cachedRelease = 0;
    const onCached = () => cachedRelease++; cached.addEventListener('dispose', onCached);
    view.dispose(); view.dispose();
    assert.equal(view.ownedResources.users.size, 0); assert.equal(cachedRelease, 0);
    cached.removeEventListener('dispose', onCached);
  }
  assert.equal(released, created, 'every generated preview material is released exactly once');
  assert.equal(sharedReleases, 0);
  for (const resource of shared) resource.removeEventListener('dispose', sharedRelease);
});

const firstPaint = panel => {
  let paint;
  panel.traverse(node => { if (node.isMesh) paint ||= [].concat(node.material).find(m => m.name === 'paint'); });
  return paint;
};

test('one instance paint shared by two detached doors stays live until the last piece retires', () => {
  const view = new CarView(VEHICLES.player_sedan_t1, { lod: false, upgradeLevels: { armor: 1 } });
  const scene = new THREE.Scene(), debris = new DebrisSystem(scene, () => null); scene.add(view.root);
  // The chopped sedan deliberately has mismatched salvaged door paint. Its
  // left rear and right front doors share the same instance-owned paint.
  const left = view.panels.get('door_L2'), right = view.panels.get('door_R'), paint = firstPaint(left);
  assert.ok(paint); assert.equal(firstPaint(right), paint);
  let released = 0; paint.addEventListener('dispose', () => released++);
  debris.detach(left, new THREE.Vector3(), new THREE.Vector3(), .05);
  debris.detach(right, new THREE.Vector3(), new THREE.Vector3(), .2);
  view.dispose(); assert.equal(released, 0);
  debris.update(.1); assert.equal(released, 0, 'the surviving second door still uses the paint');
  debris.update(.11); assert.equal(released, 1);
  debris.clear(); view.dispose(); assert.equal(released, 1);
});

test('material cleanup handles parts retired before their car and debris eviction after their car', () => {
  const scene = new THREE.Scene(), debris = new DebrisSystem(scene, () => null);
  const retired = new CarView(VEHICLES.player_sedan_t1, { lod: false }); scene.add(retired.root);
  const retiredDoor = retired.panels.get('door_R'), retiredPaint = firstPaint(retiredDoor);
  let retiredReleases = 0; retiredPaint.addEventListener('dispose', () => retiredReleases++);
  debris.detach(retiredDoor, new THREE.Vector3(), new THREE.Vector3(), .01); debris.update(.02);
  retired.dispose(); assert.equal(retiredReleases, 1, 'an already invisible part cannot hold resources forever');

  const evicted = new CarView(VEHICLES.player_sedan_t1, { lod: false }); scene.add(evicted.root);
  const evictedDoor = evicted.panels.get('door_R'), evictedPaint = firstPaint(evictedDoor);
  let evictedReleases = 0; evictedPaint.addEventListener('dispose', () => evictedReleases++);
  debris.max = 1;
  debris.detach(evictedDoor, new THREE.Vector3(), new THREE.Vector3()); evicted.dispose();
  assert.equal(evictedReleases, 0);
  const other = new THREE.Group(); scene.add(other);
  debris.detach(other, new THREE.Vector3(), new THREE.Vector3()); assert.equal(evictedReleases, 1);
  debris.clear(); assert.equal(evictedReleases, 1);
});

test('unloaded placeholder owns its geometry and materials, retaining detached wheel resources until clear', () => {
  const view = new CarView(VEHICLES.player_sedan_t1, { modelUrl: '/intentionally-unloaded.glb', lod: false });
  const scene = new THREE.Scene(), debris = new DebrisSystem(scene, () => null); scene.add(view.root);
  const owned = [...view.ownedResources.users.keys()], released = new Map(owned.map(resource => [resource, 0]));
  for (const resource of owned) resource.addEventListener('dispose', () => released.set(resource, released.get(resource) + 1));
  const wheel = view.wheelNodes.get('FL'), tire = wheel.children[0].geometry;
  debris.detach(wheel, new THREE.Vector3(), new THREE.Vector3()); view.dispose();
  assert.equal(released.get(tire), 0, 'the shared-in-instance tire buffer follows the surviving wheel');
  debris.clear(); view.dispose();
  for (const count of released.values()) assert.equal(count, 1);
});

test('boot warm owners retain only materials so preview cleanup cannot invalidate prewarmed programs', () => {
  const warmMaterials = new Set();
  const view = new CarView(VEHICLES.truck_t1, { warmMaterials, upgradeLevels: { armor: 2 } });
  assert.ok(warmMaterials.size > 0); assert.ok(warmMaterials.has(view.lodMat));
  for (const m of view.paintMats) assert.ok(warmMaterials.has(m));
  let released = 0;
  for (const m of warmMaterials) { assert.ok(m.isMaterial); m.addEventListener('dispose', () => released++); }
  const kit = view.upgradeKit; view.dispose();
  assert.equal(released, 0, 'temporary view removal keeps the boot program owner alive');
  assert.equal(kit.meshCount, 0, 'generated warm geometry is still released');
  for (const m of warmMaterials) m.dispose();
  assert.equal(released, warmMaterials.size, 'the boot owner can explicitly release its bounded materials');
});
