// AUTHORED, UNRUN. Uses actual generated GLB through production loader/merge.
// Only embedded image decoding and Canvas2D drawing are replaced for CPU checks.
// Real texture decoding, animated crew, GPU pixels and handling remain required.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const load = path => import(pathToFileURL(resolve(root, path)).href);
const Assets = await load('src/core/assets.js');
const { VEHICLES, vehicleModelURL } = await load('src/data/vehicles.js');
const { CarView } = await load('src/view/car_view.js');
const { Cockpit, WINDSHIELD_BREAK_HITS } = await load('src/view/cockpit.js');
const { DRIVER_UPGRADE_IDS, upgradeCap, familyOf } = await load('src/data/vehicle_families.js');
const { vehicleUpgradeMounts } = await load('src/view/car_upgrade_mounts.js');
const { buildUpgradePlan } = await load('src/view/car_upgrade_plan.js');
const humm = 'player_hummer_t1';
const url = vehicleModelURL(humm);
const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self,
  createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends old.Request {
  constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://hummer-geometry.local' + url : url, opts); }
};
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  if (url.origin !== 'http://hummer-geometry.local') return old.fetch(request);
  const path = resolve(root, 'public', '.' + url.pathname);
  if (!path.startsWith(resolve(root, 'public') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) throw new Error('Asset fixture escaped public root');
  return new Response(readFileSync(path), { headers: { 'Content-Type': 'application/octet-stream' } });
};
try { await Assets.preload([url]); }
finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }

const records = root => {
  const out = []; root.traverse(mesh => { if (mesh.isMesh) out.push({ mesh, geometry: mesh.geometry,
    material: mesh.material, indices: Array.from(mesh.geometry.index?.array || []) }); }); return out;
};
const unchanged = before => {
  for (const r of before) { assert.equal(r.mesh.geometry, r.geometry); assert.equal(r.mesh.material, r.material);
    assert.deepEqual(Array.from(r.geometry.index?.array || []), r.indices); }
};
const bounds = (node, frame) => {
  frame.updateMatrixWorld(true); const box = new THREE.Box3(), v = new THREE.Vector3();
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert();
  node.traverse(mesh => { if (!mesh.isMesh) return; const matrix = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) box.expandByPoint(v.fromBufferAttribute(position, i).applyMatrix4(matrix)); });
  return box;
};
const near = (a, b, label) => assert.ok(Math.abs(a - b) <= .00005, `${label}: ${a} vs ${b}`);
const fixture = (upgradeLevels = {}) => {
  const car = new CarView(VEHICLES[humm], { lod: false, upgradeLevels }); assert.equal(car.usesModel, true);
  const priorDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (_target, key) =>
    key === 'createRadialGradient' ? () => ({ addColorStop() {} }) : () => {}, set: () => true }) }) };
  let cockpit; try { cockpit = new Cockpit(car); }
  finally { if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument; }
  return { car, cockpit };
};
const frontHit = cockpit => {
  const s = cockpit.shield, p = new THREE.Vector3(0, (s.bot + s.top) / 2, (s.botZ + s.topZ) / 2 - .5);
  cockpit.model.updateMatrixWorld(true);
  return { t: 'hit', enemy: true, carId: 1, zone: 'driver_head', dmg: 1,
    pos: cockpit.model.localToWorld(p).toArray(), normal: new THREE.Vector3(0, 0, 1).transformDirection(cockpit.model.matrixWorld).toArray() };
};

test('real GLB remains a separate loaded vehicle with measured hierarchy, bounds, wheels and sockets', () => {
  assert.equal(Assets.has(url), true); const car = new CarView(VEHICLES[humm], { lod: false });
  try {
    assert.equal(car.usesModel, true); const model = VEHICLES[humm].model, box = bounds(car.model, car.model);
    for (const [side, key] of [['min', 'min'], ['max', 'max']]) for (let i = 0; i < 3; i++) near(box[side].getComponent(i), model.bbox[key][i], `model ${side}[${i}]`);
    for (const [name, wheel] of Object.entries(model.wheels)) {
      const node = car.wheelNodes.get(name); assert.ok(node); const b = bounds(node, car.model);
      const p = car.model.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
      for (const [i, axis] of ['x', 'y', 'z'].entries()) near(p.getComponent(i), wheel[axis], `${name} origin ${axis}`);
      near((b.max.y - b.min.y) / 2, wheel.r, name + ' measured radius'); near(b.max.x - b.min.x, wheel.w, name + ' measured width');
    }
    for (const [name, metadata] of Object.entries(model.parts)) {
      const node = car.model.getObjectByName(name); assert.ok(node, name); const b = bounds(node, car.model);
      for (const side of ['min', 'max']) for (let i = 0; i < 3; i++) near(b[side].getComponent(i), metadata[side][i], name + ' ' + side);
    }
    for (const [name, expected] of Object.entries(model.sockets)) {
      const node = car.model.getObjectByName(name); assert.ok(node, name);
      const p = car.model.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
      for (let i = 0; i < 3; i++) near(p.getComponent(i), expected[i], name + ' socket');
      const toModel = new THREE.Matrix4().copy(car.model.matrixWorld).invert().multiply(node.matrixWorld);
      for (const [axis, basis] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]]) {
        const direction = new THREE.Vector3(...basis).transformDirection(toModel);
        for (let i = 0; i < 3; i++) near(direction.getComponent(i), model.socketBasis[name][axis][i], name + ' orientation ' + axis);
      }
    }
  } finally { car.dispose(); }
});

test('seven source-confirmed incoming hit events break actual Hummer front glass while door/hatch glass and structure stay intact', () => {
  const { car, cockpit } = fixture({ glass: 2 }), sibling = new CarView(VEHICLES[humm], { lod: false });
  const sharedBefore = records(Assets.template(url)), siblingBefore = records(sibling.model);
  const unaffected = records(car.model).filter(record => !cockpit.frontGlassSwap.some(swap => swap.mesh === record.mesh));
  const frontPanel = car.panels.get('windshield'); assert.ok(frontPanel); assert.ok(cockpit.frontGlassSwap.length > 0);
  const affected = cockpit.frontGlassSwap.slice();
  for (const swap of affected) {
    let belongs = false; for (let p = swap.mesh; p && p !== car.model; p = p.parent) if (p === frontPanel) belongs = true;
    assert.equal(belongs, true); assert.ok(swap.full.index.count > swap.broken.index.count, 'actual front triangles must be removed');
  }
  try {
    const good = frontHit(cockpit);
    for (const normal of [[0, 0, -1], [1, 0, 0]]) {
      assert.equal(cockpit.onEvent({ ...good, normal: new THREE.Vector3(...normal).transformDirection(cockpit.model.matrixWorld).toArray() }), undefined);
    }
    assert.equal(cockpit.windshieldHits, 0, 'side/rear shots cannot fake front-window crossings');
    for (let i = 0; i < WINDSHIELD_BREAK_HITS - 1; i++) { assert.equal(cockpit.onEvent(frontHit(cockpit)), undefined); assert.equal(cockpit.windshieldBroken, false); }
    assert.equal(cockpit.onEvent(frontHit(cockpit)).t, 'windshieldBreak');
    for (const swap of affected) assert.equal(swap.mesh.geometry, swap.broken);
    assert.equal(frontPanel.visible, true, 'structural parent and bought retainers are not hidden');
    cockpit.setActive(true); cockpit.setActive(false); cockpit.setActive(true);
    for (const swap of affected) assert.equal(swap.mesh.geometry, swap.broken);
    unchanged(unaffected); unchanged(sharedBefore); unchanged(siblingBefore);
    cockpit.dispose(); cockpit.dispose();
    for (const swap of affected) assert.equal(swap.mesh.geometry, swap.full);
    unchanged(sharedBefore); unchanged(siblingBefore);
    const fresh = fixture();
    try { assert.equal(fresh.cockpit.windshieldHits, 0); assert.equal(fresh.cockpit.windshieldBroken, false);
      for (const swap of fresh.cockpit.frontGlassSwap) assert.equal(swap.mesh.geometry, swap.full); }
    finally { fresh.cockpit.dispose(); fresh.car.dispose(); }
  } finally { cockpit.dispose(); car.dispose(); sibling.dispose(); }
});

test('all paid driver levels create real attached geometry; all four doors own armor/spikes and zero levels own no kit', () => {
  const car = new CarView(VEHICLES[humm], { lod: false }), templateBefore = records(Assets.template(url));
  const caps = Object.fromEntries(DRIVER_UPGRADE_IDS.map(id => [id, upgradeCap(familyOf(humm), id)]));
  try {
    assert.equal(car.usesModel, true); assert.equal(car.upgradeKit, null);
    for (const id of DRIVER_UPGRADE_IDS) for (let level = 1; level <= caps[id]; level++) {
      car.setUpgradeLevels({ [id]: level }); assert.ok(car.upgradeKit?.meshCount > 0, `${id} level ${level}`);
      assert.deepEqual(car.upgradeKit.plan.ids, [id]);
      for (const record of car.upgradeKit.records) { assert.ok(record.anchor.parent); assert.ok(record.mesh.geometry.attributes.position.count > 0); }
    }
    car.setUpgradeLevels(caps); const plan = buildUpgradePlan(vehicleUpgradeMounts(VEHICLES[humm]), caps);
    assert.deepEqual(plan.ids.slice().sort(), [...DRIVER_UPGRADE_IDS].sort());
    assert.equal(car.upgradeKit.meshCount, plan.estimatedDraws);
    for (const anchor of ['panel_door_L', 'panel_door_R', 'panel_door_L2', 'panel_door_R2']) {
      for (const upgrade of ['armor', 'spikes']) assert.ok(plan.parts.some(part => part.anchor === anchor && part.upgrade === upgrade));
    }
    unchanged(templateBefore); car.setUpgradeLevels({}); assert.equal(car.upgradeKit, null); unchanged(templateBefore);
  } finally { car.dispose(); }
});

test('real side mirrors face the native driver-eye range while centre stays rearward and every image rides its socket', () => {
  const { car, cockpit } = fixture();
  const authored = { mirror_L: [1.23, 1.62, .528], mirror_R: [-1.23, 1.62, .528], mirror_C: [0, 1.73, .80] };
  try {
    car.model.updateMatrixWorld(true);
    for (const [socketName, imageName] of [['mirror_C', 'mirror_centre'], ['mirror_L', 'mirror_L'], ['mirror_R', 'mirror_R']]) {
      const socket = car.model.getObjectByName(socketName), image = socket?.children.find(node => node.name === imageName);
      assert.ok(image?.isMesh, socketName); assert.equal(image.parent, socket);
      const position = car.model.worldToLocal(socket.getWorldPosition(new THREE.Vector3()));
      for (let i = 0; i < 3; i++) near(position.getComponent(i), authored[socketName][i], `${socketName} independent authored position`);
      const yaw = ({ mirror_L: -106, mirror_R: 98, mirror_C: 180 })[socketName] * Math.PI / 180;
      const normal = image.getWorldDirection(new THREE.Vector3());
      near(normal.x, Math.sin(yaw), socketName + ' independent rigid normal X');
      near(normal.y, 0, socketName + ' independent rigid normal Y');
      near(normal.z, Math.cos(yaw), socketName + ' independent rigid normal Z');
      if (socketName !== 'mirror_C') {
        const centre = image.getWorldPosition(new THREE.Vector3());
        for (const eye of [[.4434370164667502, 1.5523463759591711, .25746012465918217],
          [.44144960055209326, 1.5539713530174848, .2712061292958773], [.44, 1.62, .34]]) {
          const towardEye = car.model.localToWorld(new THREE.Vector3(...eye)).sub(centre).normalize();
          assert.ok(normal.dot(towardEye) > .99, socketName + ' must have a useful face at actual/ideal driver eye');
          // Replay the exact V5 normal against the saved actual eye. Correct
          // rearward export must no longer be mistaken for usable side glass.
          const oldNormal = new THREE.Vector3(0, 0, -1).transformDirection(car.model.matrixWorld);
          assert.ok(oldNormal.dot(towardEye) < .4, socketName + ' negative V5 grazing face');
        }
      }
      assert.equal(image.material.map, cockpit.rt.texture);
    }
    const steering = car.model.getObjectByName('steering_wheel'), z = new THREE.Vector3(0, 0, 1).transformDirection(steering.matrixWorld);
    near(z.x, 0, 'steering basis X'); near(z.y, -Math.sin(24 * Math.PI / 180), 'authored steering tilt Y');
    near(z.z, Math.cos(24 * Math.PI / 180), 'authored steering tilt Z');
  } finally { cockpit.dispose(); car.dispose(); }
});

test('every real side-image boundary vertex has close rigid housing backing, not a plane rotated into the old box', () => {
  const { car, cockpit } = fixture();
  try {
    car.model.updateMatrixWorld(true);
    for (const side of ['L', 'R']) {
      const socket = car.model.getObjectByName('mirror_' + side);
      const image = socket.children.find(node => node.name === 'mirror_' + side);
      const door = car.model.getObjectByName('panel_door_' + side);
      assert.equal(socket.parent, door, 'whole mirror must leave with its actual door');
      const normal = image.getWorldDirection(new THREE.Vector3());
      const positions = image.geometry.attributes.position;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const point = image.localToWorld(new THREE.Vector3().fromBufferAttribute(positions, vertex)).addScaledVector(normal, .001);
        const ray = new THREE.Raycaster(point, normal.clone().negate(), 0, .026);
        const hits = ray.intersectObject(door, true).filter(hit => {
          const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
          return material?.name === 'metal_dark';
        });
        assert.ok(hits.length > 0, `${side} mirror boundary vertex${vertex} requires physical close backing`);
      }
    }
  } finally { cockpit.dispose(); car.dispose(); }
});

test('adding declared rear sides preserves every legacy bought geometry plan exactly', async () => {
  const { vehicleUpgradeMounts: oldMounts } = await import('./fixtures/hummer_legacy_upgrade_mounts_v1.mjs');
  const { buildUpgradePlan: oldPlan } = await import('./fixtures/hummer_legacy_upgrade_plan_v1.mjs');
  for (const id of ['player_sedan_t1', 'player_sedan_t2', 'truck_t1', 'truck_t2', 'truck_t3', 'truck_t4', 'player_buggy_t1', 'player_buggy_t2', 'player_buggy_t3']) {
    const spec = VEHICLES[id], caps = Object.fromEntries(DRIVER_UPGRADE_IDS.map(track => [track, upgradeCap(familyOf(id), track)]));
    const singleTrackLevels = DRIVER_UPGRADE_IDS.flatMap(track => Array.from({ length: caps[track] }, (_, index) => ({ [track]: index + 1 })));
    for (const levels of [{}, caps, ...singleTrackLevels]) {
      assert.deepEqual(buildUpgradePlan(vehicleUpgradeMounts(spec), levels), oldPlan(oldMounts(spec), levels), id);
    }
  }
});
