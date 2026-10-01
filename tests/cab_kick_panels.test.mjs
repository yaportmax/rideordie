import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import * as THREE from 'three';
import { CAB_DIMENSIONS, cabKickPanels, closeCabKickPanels } from '../tools/blender/vehicles/player/close_cab_kick_panels.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
function sideWallHit(primitive, side, y, z, halfWidth, count = primitive.getIndices().getCount()) {
  const p = primitive.getAttribute('POSITION').getArray(), indices = primitive.getIndices().getArray();
  const ray = new THREE.Ray(new THREE.Vector3(0, y, z), new THREE.Vector3(side, 0, 0));
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    a.fromArray(p, indices[i]*3); b.fromArray(p, indices[i+1]*3); c.fromArray(p, indices[i+2]*3);
    if (ray.intersectTriangle(a, b, c, false, hit) && Math.abs(Math.abs(hit.x) - halfWidth) < .045) return true;
  }
  return false;
}
for (const id of Object.keys(CAB_DIMENSIONS)) test(`${id} fixed cab corners stay sealed when the real front fenders shed`, async () => {
  const document = await io.read(fileURLToPath(new URL(`../public/models/vehicles/${id}.glb`, import.meta.url)));
  const root = document.getRoot(), body = root.listNodes().find(n => n.getName() === 'body');
  const interior = body.getMesh().listPrimitives().find(p => p.getMaterial().getName() === 'interior');
  const [halfWidth, floor, windshield, doorFront, cowl] = CAB_DIMENSIONS[id];
  const originalIndexCount = interior.getIndices().getCount() - 72;
  assert.equal(root.getExtras().rideordieCabKickPanels, 1);
  assert.equal(body.getMesh().listPrimitives().filter(p => p.getMaterial().getName() === 'interior').length, 1,
    'both kick panels share the existing cab draw');
  for (const side of [-1, 1]) for (const z of [doorFront + .03, doorFront + .065, cowl - .03]) for (const y of [floor+.08, floor+.2]) {
    assert.equal(sideWallHit(interior, side, y, z, halfWidth, originalIndexCount), false,
      `the actual previous fixed cab geometry must reproduce the open footwell corner ${side}/${y}/${z}`);
    assert.equal(sideWallHit(interior, side, y, z, halfWidth), true,
      'road must remain occluded by permanent interior geometry after a detachable fender is gone');
  }
  // The parts still detach independently; the new panels cannot fill a window.
  assert.ok(root.listNodes().find(n => n.getName() === 'panel_fender_L'));
  assert.ok(root.listNodes().find(n => n.getName() === 'panel_fender_R'));
  const p = interior.getAttribute('POSITION').getArray(), idx = interior.getIndices();
  for (let i = originalIndexCount; i < idx.getCount(); i++) {
    assert.ok(p[idx.getArray()[i] * 3 + 1] <= windshield + .005 + 1e-6);
    assert.ok(p[idx.getArray()[i] * 3 + 2] >= doorFront - .012 - 1e-6);
    assert.ok(p[idx.getArray()[i] * 3 + 2] <= cowl + .005 + 1e-6);
  }
  for (const panel of cabKickPanels(id)) {
    const innerX = Math.min(Math.abs(panel.min[0]), Math.abs(panel.max[0]));
    assert.ok(innerX < halfWidth - .035, 'dash cap overlaps the kick panel instead of leaving a new seam');
    assert.ok(innerX < halfWidth - .03, 'firewall overlaps the kick panel');
    assert.ok(innerX < halfWidth - .02, 'floor overlaps the kick panel');
    assert.ok(panel.min[1] <= floor - .035 + 1e-8); assert.ok(panel.min[2] < doorFront && panel.max[2] >= cowl + .005 - 1e-8);
  }
});

test('kick-panel migration preserves authored geometry, textures, materials and sockets and adds no draws', async () => {
  for (const id of Object.keys(CAB_DIMENSIONS)) {
    const document = await io.read(fileURLToPath(new URL(`../public/models/vehicles/${id}.glb`, import.meta.url)));
    const baseline = cloneDocument(document), root = baseline.getRoot();
    const primitive = root.listNodes().find(n => n.getName() === 'body').getMesh().listPrimitives().find(p => p.getMaterial().getName() === 'interior');
    const vertexCount = primitive.getAttribute('POSITION').getCount() - 48, indexCount = primitive.getIndices().getCount() - 72;
    for (const s of primitive.listSemantics()) {
      const original = primitive.getAttribute(s); primitive.setAttribute(s, original.clone().setArray(original.getArray().slice(0, vertexCount * original.getElementSize())));
    }
    primitive.setIndices(primitive.getIndices().clone().setArray(primitive.getIndices().getArray().slice(0, indexCount)));
    const extras = { ...root.getExtras() }; delete extras.rideordieCabKickPanels; root.setExtras(extras);
    const beforeAttributes = primitive.listSemantics().map(s => [s, primitive.getAttribute(s).getArray().slice()]);
    const beforeIndices = primitive.getIndices().getArray().slice();
    const other = root.listMeshes().flatMap(mesh => mesh.listPrimitives()).filter(p => p !== primitive).map(p => ({
      p, attrs: p.listSemantics().map(s => [s, p.getAttribute(s), bytes(p.getAttribute(s).getArray()).toString('base64')]),
      indices: p.getIndices(), raw: bytes(p.getIndices().getArray()).toString('base64'), material: p.getMaterial() }));
    const nodes = root.listNodes().map(n => [n, n.getName(), n.getTranslation(), n.getRotation(), n.getScale()]);
    const textures = root.listTextures().map(t => [t, bytes(t.getImage()).toString('base64')]);
    const materials = root.listMaterials().slice();
    assert.deepEqual(closeCabKickPanels(baseline, id), { id, vertices: 48, triangles: 24 });
    for (const [s, source] of beforeAttributes) assert.ok(bytes(primitive.getAttribute(s).getArray().subarray(0, source.length)).equals(bytes(source)), s);
    assert.ok(bytes(primitive.getIndices().getArray().subarray(0, beforeIndices.length)).equals(bytes(beforeIndices)));
    for (const r of other) {
      assert.equal(r.p.getMaterial(), r.material); assert.equal(r.p.getIndices(), r.indices);
      assert.equal(bytes(r.p.getIndices().getArray()).toString('base64'), r.raw);
      for (const [s, accessor, raw] of r.attrs) { assert.equal(r.p.getAttribute(s), accessor); assert.equal(bytes(accessor.getArray()).toString('base64'), raw); }
    }
    for (const [n, name, pos, quat, scale] of nodes) assert.deepEqual([n.getName(), n.getTranslation(), n.getRotation(), n.getScale()], [name, pos, quat, scale]);
    for (const [texture, raw] of textures) assert.equal(bytes(texture.getImage()).toString('base64'), raw);
    assert.deepEqual(root.listMaterials(), materials);
    assert.deepEqual(closeCabKickPanels(baseline, id), { id, vertices: 0, triangles: 0 });
  }
});
