import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { cloneDocument } from '@gltf-transform/functions';
import * as THREE from 'three';
import { GRILLE_BROW_MOUNTS, supportGrilleBrow } from '../tools/blender/vehicles/player/support_grille_brow.mjs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(new URL('../public/models/vehicles/truck_t3.glb', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
const root = document.getRoot(), body = root.listNodes().find(n => n.getName() === 'body');
const armor = body.getMesh().listPrimitives().find(p => p.getMaterial().getName() === 'armor');
const originalVertices = armor.getAttribute('POSITION').getCount() - 48;
const originalIndexCount = armor.getIndices().getCount() - 72;
function rays(primitive, x, z, count = primitive.getIndices().getCount()) {
  const p = primitive.getAttribute('POSITION').getArray(), idx = primitive.getIndices().getArray();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), point = new THREE.Vector3();
  const ray = new THREE.Ray(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, 1, 0));
  const hits = [];
  for (let i = 0; i < count; i += 3) {
    a.fromArray(p, idx[i] * 3); b.fromArray(p, idx[i+1] * 3); c.fromArray(p, idx[i+2] * 3);
    if (ray.intersectTriangle(a, b, c, false, point)) hits.push(point.y);
  }
  return hits.sort((a, b) => a - b).filter((y, i, all) => !i || Math.abs(y - all[i-1]) > 1e-6);
}
function snapshot(document) {
  const root = document.getRoot();
  const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString('base64');
  return { nodes: root.listNodes().map(n => [n.getName(), n.getTranslation(), n.getRotation(), n.getScale(), n.listChildren().map(c => c.getName())]),
    materials: root.listMaterials().map(m => [m.getName(), m.getBaseColorFactor(), m.getMetallicFactor(), m.getRoughnessFactor()]),
    textures: root.listTextures().map(t => [t.getName(), t.getMimeType(), Buffer.from(t.getImage()).toString('base64')]),
    primitives: root.listMeshes().flatMap(m => m.listPrimitives().map(p => ({ name: m.getName(), material: p.getMaterial()?.getName(),
      attributes: p.listSemantics().map(s => [s, p.getAttribute(s).getType(), p.getAttribute(s).getNormalized(), bytes(p.getAttribute(s).getArray())]),
      index: bytes(p.getIndices().getArray()) }))) };
}

test('Bruiser grille brow remains physically mounted after the real hood panel detaches', () => {
  assert.ok(body.getMesh());
  const hood = root.listNodes().find(n => n.getName() === 'panel_hood');
  assert.ok(hood && hood !== body, 'hood damage must stay an independently detachable part');
  assert.equal(root.getExtras().rideordieGrilleBrowMounts, 1);
  assert.equal(body.getTranslation().every(v => v === 0), true);
  const p = armor.getAttribute('POSITION').getArray(), idx = armor.getIndices().getArray();
  for (const [i, mount] of GRILLE_BROW_MOUNTS.entries()) {
    const bounds = new THREE.Box3();
    for (let j = originalIndexCount + i * 36; j < originalIndexCount + (i + 1) * 36; j++) {
      assert.ok(idx[j] >= originalVertices && idx[j] < originalVertices + 48);
      bounds.expandByPoint(new THREE.Vector3().fromArray(p, idx[j] * 3));
    }
    for (const axis of ['x', 'y', 'z']) {
      const k = ['x', 'y', 'z'].indexOf(axis);
      assert.ok(Math.abs(bounds.min[axis] - mount.min[k]) < 1e-6);
      assert.ok(Math.abs(bounds.max[axis] - mount.max[k]) < 1e-6);
    }
    const x = (mount.min[0] + mount.max[0]) / 2;
    for (const z of [2.535, 2.555, 2.575]) {
      const oldHits = rays(armor, x, z, originalIndexCount);
      const railTop = oldHits.filter(y => y > 1.18 && y < 1.25).at(-1);
      const browUnder = oldHits.find(y => y > 1.3 && y < 1.38);
      assert.ok(railTop && browUnder && browUnder - railTop > .1, 'actual source geometry reproduces the unsupported brow');
      assert.ok(bounds.min.y < railTop && bounds.max.y > browUnder, 'the fixed bracket must overlap both actual armor pieces');
      const hits = rays(armor, x, z);
      assert.ok(hits.some(y => Math.abs(y - bounds.min.y) < 1e-6));
      assert.ok(hits.some(y => Math.abs(y - bounds.max.y) < 1e-6));
    }
  }
  assert.equal(body.getMesh().listPrimitives().filter(p => p.getMaterial().getName() === 'armor').length, 1,
    'both welded mounts share the existing armor draw');
});

test('brow repair preserves every authored triangle, attribute, node, texture and material and is idempotent', () => {
  const baseline = cloneDocument(document), a = baseline.getRoot().listNodes().find(n => n.getName() === 'body').getMesh().listPrimitives().find(p => p.getMaterial().getName() === 'armor');
  for (const s of a.listSemantics()) {
    const accessor = a.getAttribute(s);
    a.setAttribute(s, accessor.clone().setArray(accessor.getArray().slice(0, originalVertices * accessor.getElementSize())));
  }
  a.setIndices(a.getIndices().clone().setArray(a.getIndices().getArray().slice(0, originalIndexCount)));
  const extras = { ...baseline.getRoot().getExtras() }; delete extras.rideordieGrilleBrowMounts; baseline.getRoot().setExtras(extras);
  const before = snapshot(baseline);
  assert.deepEqual(supportGrilleBrow(baseline), { vertices: 48, triangles: 24 });
  const after = snapshot(baseline);
  assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.materials, before.materials); assert.deepEqual(after.textures, before.textures);
  for (let i = 0; i < before.primitives.length; i++) {
    const old = before.primitives[i], current = after.primitives[i];
    if (old.name !== body.getMesh().getName() || old.material !== 'armor') { assert.deepEqual(current, old); continue; }
    assert.ok(Buffer.from(current.index, 'base64').subarray(0, Buffer.from(old.index, 'base64').length).equals(Buffer.from(old.index, 'base64')));
    for (const [j, attribute] of old.attributes.entries()) {
      assert.deepEqual(current.attributes[j].slice(0, 3), attribute.slice(0, 3));
      const source = Buffer.from(attribute[3], 'base64');
      assert.ok(Buffer.from(current.attributes[j][3], 'base64').subarray(0, source.length).equals(source));
    }
  }
  assert.deepEqual(supportGrilleBrow(baseline), { vertices: 0, triangles: 0 });
  assert.deepEqual(snapshot(baseline), after, 'repeating repair must allocate or change nothing');
  assert.deepEqual(after, snapshot(document), 'checked-in asset must be the exact supported candidate');
});
