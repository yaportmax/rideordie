import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../src/core/assets.js';
import { VEHICLES, vehicleModelURL } from '../src/data/vehicles.js';
import { VEHICLE_FAMILIES, upgradeCap } from '../src/data/vehicle_families.js';
import { CarView } from '../src/view/car_view.js';
import { vehicleUpgradeMounts } from '../src/view/car_upgrade_mounts.js';
import { buildUpgradePlan } from '../src/view/car_upgrade_plan.js';
import { UpgradeKit } from '../src/view/car_upgrade_kit.js';

// Keep the shipped GLB, loader, rigid merge, anchors and generated geometry.
// Only browser image decoding is replaced. This is a CPU geometry regression,
// not a claim about textures, visual acceptance or current gameplay timing.
const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self, createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends old.Request {
  constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://buggy-glass.local' + url : url, opts); }
};
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  if (url.origin !== 'http://buggy-glass.local') return old.fetch(request);
  return new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
};
try { await Assets.preload([...new Set(VEHICLE_FAMILIES.buggy.stageIDs.map(vehicleModelURL))]); }
finally {
  for (const [key, value] of Object.entries(old)) {
    if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
}

// Healthy driver-forward, driver-restored and driver-boost eyes from the native
// vehicle-native-v3-subset/player_buggy_t3-driver-max.json capture, transformed
// through body_mesh_1.matrixWorld into the CarView ground frame. These are the
// actual Head-based Run._cockpitEye positions, rather than the higher bootstrap
// seat-plus-offset camera. A future rig change also needs fresh native evidence.
const healthyEyes = [
  [.3613354221, 1.2172212856, .1576577515],
  [.3606003199, 1.2055105240, .1633088079],
  [.3622869326, 1.2021599448, .1216555382],
].map(p => new THREE.Vector3(...p));
const roadPitches = [0, 1, 3, 6, 9, 12];

function authoredDashboard(view) {
  view.root.updateMatrixWorld(true);
  const toGround = view.root.matrixWorld.clone().invert(), bounds = new THREE.Box3(), point = new THREE.Vector3();
  let count = 0;
  view.model.traverse(node => {
    if (!node.isMesh) return;
    const materials = [].concat(node.material);
    if (!materials.some(m => m.name === 'interior')) return;
    const p = node.geometry.attributes.position, indices = node.geometry.index;
    const transform = new THREE.Matrix4().multiplyMatrices(toGround, node.matrixWorld);
    const ranges = node.geometry.groups.length ? node.geometry.groups : [{ start: 0, count: indices?.count ?? p.count, materialIndex: 0 }];
    for (const range of ranges) {
      if (materials[range.materialIndex]?.name !== 'interior') continue;
      for (let i = range.start; i < range.start + range.count; i++) {
        point.fromBufferAttribute(p, indices ? indices.getX(i) : i).applyMatrix4(transform);
        // Authored dash: buggy.py build_interior(), .90 m wide at forward
        // Z=.88, Y=.84, height .26, pitch -8 degrees. Bound this panel within
        // the real interior primitive; CV boots, hoses and shifter are outside.
        if (Math.abs(point.x) <= .47 && point.y >= .69 && point.y <= 1.0 && point.z >= .80 && point.z <= .95) {
          bounds.expandByPoint(point); count++;
        }
      }
    }
  });
  assert.ok(count >= 8 && !bounds.isEmpty(), 'the shipped interior contains the authored dashboard surface');
  assert.ok(bounds.max.x - bounds.min.x > .87, 'measure the full dashboard, not an isolated gauge or switch');
  assert.ok(bounds.max.y > .94 && bounds.max.y < 1.0, 'the actual dashboard upper silhouette remains below the healthy driver eye');
  return bounds;
}

function lowerRail(plan) {
  const horizontal = plan.parts.filter(p => p.upgrade === 'glass' && p.shape === 'box' && p.size[0] > p.size[1] * 10);
  assert.equal(horizontal.length, 2, 'the purchased frame retains both horizontal rails');
  const rail = horizontal.reduce((a, b) => a.p[1] < b.p[1] ? a : b);
  assert.deepEqual(rail.rotation, [0, 0, 0], 'the horizontal lower rail uses its actual box extents');
  return new THREE.Box3(
    new THREE.Vector3(...rail.p).addScaledVector(new THREE.Vector3(...rail.size), -.5),
    new THREE.Vector3(...rail.p).addScaledVector(new THREE.Vector3(...rail.size), .5),
  );
}

function supportedBelowEye(rail, dash) {
  const lowestEye = Math.min(...healthyEyes.map(eye => eye.y));
  return rail.max.y <= dash.max.y + .002
    && rail.max.y >= dash.max.y - .035
    && rail.max.y <= lowestEye - .20
    && rail.min.x >= dash.min.x - .015 && rail.max.x <= dash.max.x + .015
    && rail.min.z >= dash.min.z - .04 && rail.max.z <= dash.max.z + .04;
}

function blockedRoadRays(kit) {
  kit.root.updateMatrixWorld(true);
  const meshes = kit.records.map(record => record.mesh), raycaster = new THREE.Raycaster(), blocked = [];
  // Camera-neutral forward and a downward road-view fan. Restrict the ray to
  // the nearby aperture, so a distant rear/side accessory cannot mask failure.
  for (const [eyeIndex, eye] of healthyEyes.entries()) for (const pitch of roadPitches) {
    const angle = THREE.MathUtils.degToRad(pitch);
    const direction = new THREE.Vector3(0, -Math.sin(angle), Math.cos(angle));
    const origin = eye.clone().applyMatrix4(kit.root.matrixWorld);
    direction.transformDirection(kit.root.matrixWorld);
    raycaster.set(origin, direction); raycaster.near = .01; raycaster.far = 2;
    if (raycaster.intersectObjects(meshes, false).length) blocked.push({ eyeIndex, pitch });
  }
  return blocked;
}

test('all three actual buggy stages keep bought glass reinforcement on the dashboard and clear the healthy driver road view', () => {
  const cap = upgradeCap('buggy', 'glass');
  assert.equal(cap, 1, 'the actual buggy family has one purchased glass level');
  assert.equal(VEHICLE_FAMILIES.buggy.stageIDs.length, 3);
  for (const id of VEHICLE_FAMILIES.buggy.stageIDs) {
    const view = new CarView(VEHICLES[id], { lod: false, upgradeLevels: { glass: cap } });
    try {
      assert.equal(view.usesModel, true, `${id}: exercise the shipped GLB, never its placeholder`);
      const dash = authoredDashboard(view), plan = view.upgradeKit.plan;
      assert.equal(plan.parts.length, 4, `${id}: keep both side retainers and both horizontal rails`);
      assert.ok(plan.parts.every(p => p.upgrade === 'glass'));
      assert.equal(view.upgradeKit.meshCount, 1, `${id}: raycast the real merged body kit`);
      assert.ok(supportedBelowEye(lowerRail(plan), dash), `${id}: lower retainer follows the authored dashboard with at least 20 cm eye clearance`);
      assert.deepEqual(blockedRoadRays(view.upgradeKit), [], `${id}: no new opaque hardware crosses the central road-view fan`);

      // Negative control reconstructs the actual regression: retaining the
      // stock high deflector's lower edge at eye height. The very same support
      // and triangle-ray predicates must reject that former generated kit.
      const mounts = vehicleUpgradeMounts(VEHICLES[id]);
      const oldMounts = { ...mounts, windshield: { ...mounts.windshield, bottom: [0, 1.20, .72] } };
      const oldPlan = buildUpgradePlan(oldMounts, { glass: cap });
      assert.equal(supportedBelowEye(lowerRail(oldPlan), dash), false, `${id}: the old retainer floats above the real dashboard`);
      const oldKit = new UpgradeKit(view.root, oldPlan, name => view._upgradeAnchor(name));
      try { assert.ok(blockedRoadRays(oldKit).length > 0, `${id}: real old-kit triangles obstruct a healthy driver road ray`); }
      finally { oldKit.dispose({ includeDetached: true }); }
    } finally { view.dispose(); }
  }
});
