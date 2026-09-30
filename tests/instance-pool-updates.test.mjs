import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { InstancePool } from '../src/world/dressing/pool.js';
import { InstList } from '../src/world/dressing/util.js';

const CAM = { x: 0, y: 0, z: 0 }, FWD = { x: 0, z: 1 };
function placements(points) {
  const list = new InstList(2), matrix = new THREE.Matrix4();
  points.forEach((p, i) => list.pushMatrix(matrix.makeTranslation(...p).elements, 1, 0.2 + i / 100, 0.4, 0.8));
  return list;
}
function fixture(spec = {}) {
  const asset = { parts: [{ geometry: new THREE.BoxGeometry(), material: new THREE.MeshStandardMaterial(), role: 'main', tris: 12 }],
    sphere: new THREE.Sphere(new THREE.Vector3(), 1), height: 2 };
  const pool = new InstancePool(new THREE.Scene(), { get: () => asset, state: () => 'ready' });
  pool.setSpec('prop', { far: 100, ...spec });
  const rebuild = (lists, cam = CAM, shadow = null) => pool.rebuild(lists.map((list) => ({ lists: new Map([['prop', list]]) })), cam, FWD, shadow);
  return { pool, rebuild, sets: (name = 'prop') => pool.entries.get(name).sets };
}
function consume(set) { set.attr.clearUpdateRanges(); set.colAttr.clearUpdateRanges(); }
function versions(set) { return [set.attr.version, set.colAttr.version]; }
function buffers(set) { return { matrix: Array.from(set.mat.subarray(0, set.n * 16)), color: Array.from(set.col.subarray(0, set.n * 3)), count: set.n }; }

test('identical pool selections keep buffer versions stable while matrix and color edits upload independently', () => {
  const { pool, rebuild, sets } = fixture();
  const src = placements([[0, 0, 10], [4, 0, 20]]);
  rebuild([src]); const set = sets()[0], expected = buffers(set), initial = versions(set);
  consume(set);
  for (let i = 0; i < 3; i++) {
    rebuild([src], { x: i / 10, y: 0, z: 0 });
    assert.deepEqual(buffers(set), expected); assert.deepEqual(versions(set), initial);
    assert.deepEqual(set.attr.updateRanges, []); assert.deepEqual(set.colAttr.updateRanges, []);
  }
  src.col[0] = 0.9; rebuild([src]);
  assert.deepEqual(versions(set), [initial[0], initial[1] + 1]); assert.equal(set.col[0], src.col[0]);
  assert.deepEqual(set.colAttr.updateRanges, [{ start: 0, count: 6 }]); consume(set);
  src.m[0] = 1.5; rebuild([src]);
  assert.deepEqual(versions(set), [initial[0] + 1, initial[1] + 1]); assert.equal(set.mat[0], 1.5); consume(set);
  // An exact comparison also preserves IEEE Float32 signed-zero changes.
  src.m[3] = -0; rebuild([src]); assert.ok(Object.is(set.mat[3], -0));
  assert.equal(set.attr.version, initial[0] + 2); consume(set);
  rebuild([src]); assert.equal(set.attr.version, initial[0] + 2);
  src.m = src.m.slice(); src.col = src.col.slice(); rebuild([src]);
  assert.equal(set.attr.version, initial[0] + 2); assert.equal(set.colAttr.version, initial[1] + 1);
  const radius = set.sph.radius; src.rad = 5; rebuild([src]);
  assert.equal(set.sph.radius, radius + 4); assert.equal(set.attr.version, initial[0] + 2);
  pool.dispose();
});

test('packed chunk reordering, clearing and capacity growth retain exact instance data', () => {
  const { pool, rebuild, sets } = fixture();
  const a = placements(Array.from({ length: 80 }, (_, i) => [i % 8, 0, 10 + i % 10]));
  const b = placements(Array.from({ length: 80 }, (_, i) => [20 + i % 8, 0, 30 + i % 10]));
  b.col[0] = 0.9;
  rebuild([a]); const set = sets()[0], oldAttribute = set.attr; consume(set);
  rebuild([a, b]);
  assert.ok(set.cap >= 160); assert.notEqual(set.attr, oldAttribute);
  assert.deepEqual(Array.from(set.mat.subarray(0, 160 * 16)), [...a.m.subarray(0, 80 * 16), ...b.m.subarray(0, 80 * 16)]);
  assert.deepEqual(Array.from(set.col.subarray(0, 160 * 3)), [...a.col.subarray(0, 80 * 3), ...b.col.subarray(0, 80 * 3)]);
  consume(set); const grown = versions(set); rebuild([a, b]); assert.deepEqual(versions(set), grown);
  rebuild([b, a]); assert.deepEqual(versions(set), grown.map((v) => v + 1));
  assert.deepEqual(set.mat.subarray(0, 80 * 16), b.m.subarray(0, 80 * 16)); consume(set);
  const reordered = versions(set); rebuild([b]);
  assert.deepEqual(versions(set), reordered); assert.equal(set.meshes[0].count, 80);
  assert.ok(set.sph.containsPoint(new THREE.Vector3(27, 0, 39)));
  rebuild([]); assert.equal(set.n, 0); assert.equal(set.meshes[0].count, 0); assert.equal(set.meshes[0].visible, false);
  assert.deepEqual(versions(set), reordered);
  rebuild([b]); assert.deepEqual(versions(set), reordered); assert.equal(set.meshes[0].visible, true);
  assert.equal(pool.stats.instances, 80); pool.dispose();
});

test('pending uploads retain changed inactive tails until WebGL consumes their ranges', () => {
  const { pool, rebuild, sets } = fixture(); const src = placements([[0, 0, 10], [0, 0, 20]]);
  rebuild([src]); const set = sets()[0]; consume(set);
  const gpuMatrix = set.mat.slice(), gpuColor = set.col.slice();
  set.warm = false;
  src.m[16] = 2; src.col[3] = 0.75; rebuild([src]);
  assert.equal(set.meshes[0].visible, false);
  const dirty = versions(set); rebuild([src]); assert.deepEqual(versions(set), dirty);
  src.n = 1; src.m[0] = 3; src.col[0] = 0.6; rebuild([src]);
  assert.deepEqual(set.attr.updateRanges, [{ start: 0, count: 32 }]);
  assert.deepEqual(set.colAttr.updateRanges, [{ start: 0, count: 6 }]);
  for (const r of set.attr.updateRanges) gpuMatrix.set(set.mat.subarray(r.start, r.start + r.count), r.start);
  for (const r of set.colAttr.updateRanges) gpuColor.set(set.col.subarray(r.start, r.start + r.count), r.start);
  consume(set); const uploaded = versions(set);
  src.n = 2; set.warm = true; rebuild([src]);
  assert.deepEqual(versions(set), uploaded); assert.equal(set.meshes[0].visible, true);
  assert.deepEqual(gpuMatrix.subarray(0, 32), set.mat.subarray(0, 32));
  assert.deepEqual(gpuColor.subarray(0, 6), set.col.subarray(0, 6)); pool.dispose();
});

test('mixed LOD and shadow selections update only sets whose packed data changes', () => {
  const { pool, rebuild, sets } = fixture({ shadow: true, lods: [{ asset: 'near', max: 30 }, { asset: 'far', max: 1e9 }] });
  const src = placements([[0, 0, 10], [0, 0, 45], [0, 0, 80]]);
  const shadow = { on: true, fx: 0, fy: 0, fz: 10, lx: 0, ly: 1, lz: 0, rad: 8, depth: 10 };
  rebuild([src], CAM, shadow);
  const [nearPlain, nearShadow] = sets('near'), [farPlain, farShadow] = sets('far');
  assert.deepEqual([nearPlain.n, nearShadow.n, farPlain.n, farShadow.n], [0, 1, 2, 0]);
  assert.equal(nearShadow.mat[14], 10); assert.equal(farPlain.mat[14], 45); assert.equal(farPlain.mat[30], 80);
  const active = [nearPlain, nearShadow, farPlain, farShadow]; active.forEach(consume);
  const initial = active.map(versions); rebuild([src], CAM, shadow); assert.deepEqual(active.map(versions), initial);
  shadow.fz = 45; rebuild([src], CAM, shadow);
  assert.deepEqual(active.map((s) => s.n), [1, 0, 1, 1]);
  assert.equal(nearPlain.mat[14], 10); assert.equal(farPlain.mat[14], 80); assert.equal(farShadow.mat[14], 45);
  active.forEach(consume); const moved = active.map(versions);
  rebuild([src], CAM, shadow); assert.deepEqual(active.map(versions), moved);
  rebuild([src], { x: 0, y: 0, z: 45 }, shadow);
  assert.deepEqual(active.map((s) => s.n), [0, 1, 2, 0]);
  assert.equal(nearShadow.mat[14], 45); assert.equal(farPlain.mat[14], 10); assert.equal(farPlain.mat[30], 80);
  pool.qf = 0.3; rebuild([src], { x: 0, y: 0, z: 45 }, shadow);
  assert.deepEqual(active.map((s) => s.n), [0, 1, 0, 0]); assert.equal(pool.stats.shadowInstances, 1);
  active.forEach(consume); const culled = active.map(versions);
  rebuild([src], { x: 0, y: 0, z: 45 }, shadow); assert.deepEqual(active.map(versions), culled);
  pool.dispose();
});
