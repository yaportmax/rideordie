import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../src/core/assets.js';
import { CarView } from '../src/view/car_view.js';
import { Cockpit, mirrorGlassGeometry } from '../src/view/cockpit.js';
import { VEHICLES } from '../src/data/vehicles.js';

const ids = ['truck_t1', 'truck_t2', 'truck_t3', 'truck_t4'];
const old = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self, createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.createImageBitmap = async () => ({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends old.Request { constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://mirror-test.local' + url : url, opts); } };
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  return url.origin === 'http://mirror-test.local' ? new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)),
    { headers: { 'Content-Type': 'application/octet-stream' } }) : old.fetch(request);
};
try { await Assets.preload(ids.map(id => `/models/vehicles/${id}.glb`)); }
finally { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
function fixture(id) {
  const car = new CarView(VEHICLES[id], { lod: false }), prior = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: (_target, key) => {
    if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
    return () => {};
  }, set: () => true }) }) };
  let cockpit;
  try { cockpit = new Cockpit(car); } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
  return { car, cockpit };
}
function housingSupportsPoint(root, point, socket) {
  const direction = new THREE.Vector3(0, 0, -1).transformDirection(socket.matrixWorld);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  const ray = new THREE.Ray(point, direction); let supported = false;
  root.traverse(mesh => {
    if (!mesh.isMesh || ![].concat(mesh.material).some(m => m.name === 'rubber')) return;
    const p = mesh.geometry.attributes.position, idx = mesh.geometry.index;
    for (let i = 0; i < (idx?.count ?? p.count); i += 3) {
      a.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(p, idx ? idx.getX(i+1) : i+1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(p, idx ? idx.getX(i+2) : i+2).applyMatrix4(mesh.matrixWorld);
      if (ray.intersectTriangle(a, b, c, false, hit) && hit.distanceTo(point) < .012) { supported = true; break; }
    }
  });
  return supported;
}

for (const id of ids) test(`${id} centre mirror image fits the actual rounded housing without floating corners`, () => {
  const { car, cockpit } = fixture(id);
  const socket = car.model.getObjectByName('mirror_C'), glass = socket.getObjectByName('mirror_centre');
  car.model.updateMatrixWorld(true);
  const original = new THREE.PlaneGeometry(.25 * .97, .07 * .92), originalPos = original.attributes.position;
  const point = new THREE.Vector3(), badCorners = [];
  for (let i = 0; i < originalPos.count; i++) {
    point.fromBufferAttribute(originalPos, i).applyMatrix4(glass.matrixWorld);
    if (!housingSupportsPoint(car.model, point, socket)) badCorners.push(i);
  }
  assert.equal(badCorners.length, 4, 'the old rectangle must reproduce all four unsupported housing corners');
  const positions = glass.geometry.attributes.position, uv = glass.geometry.attributes.uv;
  assert.equal(positions.count, 20); assert.equal(glass.geometry.index.count / 3, 18);
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(glass.matrixWorld);
    assert.equal(housingSupportsPoint(car.model, point, socket), true, 'every new glass outline vertex sits over authored housing');
    // Image crop and horizontal mirror orientation remain the same affine map.
    assert.ok(Math.abs(uv.getX(i) - (.5 - positions.getX(i) / (.25 * .97) * .4)) < 1e-6);
    assert.ok(Math.abs(uv.getY(i) - (.56 + positions.getY(i) * .4 * (1024/320) / (.25 * .97))) < 1e-6);
  }
  assert.equal(glass.material, cockpit.glassMat); assert.equal(glass.material.map, cockpit.rt.texture);
  assert.equal(glass.parent, socket); assert.ok(glass.getWorldDirection(new THREE.Vector3()).z < -.99);
  cockpit.setActive(true); assert.equal(glass.visible, true);
  cockpit.setActive(false); assert.equal(glass.visible, false);
  let disposed = 0; glass.geometry.addEventListener('dispose', () => disposed++);
  cockpit.dispose(); cockpit.dispose(); assert.equal(disposed, 1); assert.equal(glass.parent, null);
  original.dispose(); car.dispose();
});

test('unrounded mirror fallback retains the original four-vertex plane and full crop range', () => {
  const geometry = mirrorGlassGeometry(.24, .062), uv = geometry.attributes.uv;
  assert.equal(geometry.attributes.position.count, 4); assert.equal(geometry.index.count, 6);
  assert.equal(Math.min(...uv.array), 0); assert.equal(Math.max(...uv.array), 1); geometry.dispose();
});
