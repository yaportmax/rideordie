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
const humm = 'player_tank_t1';
const url = vehicleModelURL(humm);
const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self,
  createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends old.Request {
  constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://tank-geometry.local' + url : url, opts); }
};
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  if (url.origin !== 'http://tank-geometry.local') return old.fetch(request);
  const path = resolve(root, 'public', '.' + url.pathname);
  if (!path.startsWith(resolve(root, 'public') + '/'.replace('/', process.platform === 'win32' ? '\\' : '/'))) throw new Error('Asset fixture escaped public root');
  return new Response(readFileSync(path), { headers: { 'Content-Type': 'application/octet-stream' } });
};
try { await Assets.preload([url]); }
finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }

const { makeCarState } = await load('src/view/car_state.js');
const { TANK_BASE_CAPS } = await load('src/data/tank_base.js');
const { TankGarageEnvelope } = await load('src/game/hummer_garage_fit.js');

test('actual loader preserves two aggregate fallback belts and twelve real roadwheels', () => {
  const model = Assets.clone(url), spec = VEHICLES[humm]; model.updateMatrixWorld(true);
  for (const name of ['part_track_L', 'part_track_R', 'panel_turret', ...['FL', 'FR', 'RL', 'RR'].map(n => 'wheel_' + n),
    ...['L', 'R'].flatMap(side => [0, 1, 2, 3].map(i => `part_roadwheel_${side}${i}`))]) {
    const node = model.getObjectByName(name); assert.ok(node, name);
    let count = 0; node.traverse(mesh => { if (mesh.isMesh) count += mesh.geometry.attributes.position.count; });
    assert.ok(count > 0, `${name} actual vertices`);
  }
  const position = new THREE.Vector3(), inverse = model.matrixWorld.clone().invert();
  for (const [name, expected] of Object.entries(spec.model.sockets)) {
    const node = model.getObjectByName(name); assert.ok(node, name);
    node.getWorldPosition(position).applyMatrix4(inverse);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(position.getComponent(i) - expected[i]) <= .00005, `${name} ${i}`);
  }
  assert.equal(model.getObjectByName('mirror_L').parent.name, 'panel_door_L');
  assert.equal(model.getObjectByName('mirror_R').parent.name, 'panel_door_R');
});

test('loaded tracked view instantiates both belts, follows suspension, and retires only owned buffers', () => {
  const template = Assets.template(url), shared = [];
  template.traverse(mesh => { if (mesh.isMesh) shared.push([mesh, mesh.geometry, mesh.material, mesh.visible]); });
  const car = new CarView(VEHICLES[humm], { lod: false }), st = makeCarState(99, humm, 'player');
  assert.ok(car.trackedTank); const visual = car.trackedTank, meshes = visual.records.flatMap(r => [r.shoes, r.bands]);
  const geometry = [...visual.ownedGeometry], disposed = new Map(geometry.map(g => [g, 0]));
  for (const g of geometry) g.addEventListener('dispose', () => disposed.set(g, disposed.get(g) + 1));
  const borrowed = new Set(meshes.map(m => m.material)); let borrowedDisposed = 0;
  for (const material of borrowed) material.addEventListener('dispose', () => borrowedDisposed++);
  const buffers = meshes.map(mesh => mesh.instanceMatrix);
  st.pos.set(0, st.ride.restComHeight, 0); st.vel.set(0, 0, 18); st.gunner.yaw = 0; st.L.fill(st.ride.restLen);
  try {
    for (let i = 0; i < 100; i++) {
      st.L[0] = st.ride.restLen + .10; st.L[2] = st.ride.restLen - .10;
      st.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * .01); st.gunner.yaw = i * .03;
      car.update(st, 1 / 60);
    }
    assert.deepEqual(meshes.map(mesh => mesh.instanceMatrix), buffers);
    for (const mesh of meshes) assert.ok(Array.from(mesh.instanceMatrix.array).every(Number.isFinite));
    const left = visual.records[0]; assert.notEqual(left.front.position.y, left.rear.position.y);
    assert.ok(left.middle.every(node => node.position.y > left.front.position.y && node.position.y < left.rear.position.y));
    for (let level = 1; level <= 4; level++) {
      const beforeBands = visual.records.map(r => Array.from(r.bands.instanceMatrix.array));
      const phase = visual.records.map(r => r.phase), spin = visual.records.map(r => r.spin);
      car.setUpgradeLevels({ tires: level }); assert.equal(visual.level, level); assert.ok(car.upgradeKit.meshCount >= 4);
      for (let i = 0; i < visual.records.length; i++) {
        assert.notDeepEqual(Array.from(visual.records[i].bands.instanceMatrix.array), beforeBands[i], `${visual.records[i].letter} paid level${level} changes actual bands before another update`);
      }
      assert.deepEqual(visual.records.map(r => r.phase), phase); assert.deepEqual(visual.records.map(r => r.spin), spin);
      assert.deepEqual(meshes.map(mesh => mesh.instanceMatrix), buffers);
    }
    left.front.userData.gone = true; car.update(st, 0); assert.equal(left.group.visible, false);
    assert.ok(left.middle.every(node => !node.visible)); assert.equal(visual.records[1].group.visible, true);
  } finally { car.dispose(); car.dispose(); }
  for (const count of disposed.values()) assert.equal(count, 1);
  assert.equal(borrowedDisposed, 0);
  for (const [node, g, m, visible] of shared) { assert.equal(node.geometry, g); assert.equal(node.material, m); assert.equal(node.visible, visible); }
});

test('all 27 paid levels rebuild loaded anchored geometry immediately and tank garage envelope includes every actual instance', () => {
  const view = new CarView(VEHICLES[humm], { lod: false }), frame = new THREE.Group(); frame.add(view.root);
  const point = new THREE.Vector3(), matrix = new THREE.Matrix4(), instance = new THREE.Matrix4();
  try {
    for (const [track, cap] of Object.entries(TANK_BASE_CAPS)) for (let level = 1; level <= cap; level++) {
      assert.equal(view.setUpgradeLevels({ [track]: level }), true); assert.equal(view.upgradeLevels[track], level);
      assert.ok(view.upgradeKit?.meshCount > 0, `${track} level ${level} visible kit`);
      for (const record of view.upgradeKit.records) assert.ok(record.anchor === view.model || record.anchor.parent, 'paid kit retains actual anchor');
      const envelope = new TankGarageEnvelope(view, [], frame); frame.updateWorldMatrix(true, true);
      const inverse = frame.matrixWorld.clone().invert(); let vertices = 0, instances = 0;
      view.root.traverseVisible(mesh => {
        if (!mesh.isMesh) return;
        const position = mesh.geometry.attributes.position, count = mesh.isInstancedMesh ? mesh.count : 1;
        for (let index = 0; index < count; index++) {
          matrix.multiplyMatrices(inverse, mesh.matrixWorld);
          if (mesh.isInstancedMesh) { mesh.getMatrixAt(index, instance); matrix.multiply(instance); instances++; }
          for (let i = 0; i < position.count; i++) {
            point.fromBufferAttribute(position, i).applyMatrix4(matrix); assert.ok(envelope.box.containsPoint(point), `${track} level${level} ${mesh.name}:${index}:${i}`); vertices++;
          }
        }
      });
      assert.equal(instances, 256); assert.ok(vertices > 0); assert.ok(Number.isFinite(envelope.radius) && envelope.radius > 0);
      assert.equal(view.trackedTank.level, track === 'tires' ? level : 0);
    }
  } finally { view.dispose(); }
});
