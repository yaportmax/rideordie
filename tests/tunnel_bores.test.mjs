import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { openTunnelBore, ROCK_TUNNELS } from '../tools/blender/structures/open_tunnel_bores.mjs';
import { Road } from '../src/world/road.js';
import { buildFeatures, gridMesh } from '../src/world/dressing/features.js';
import { InstList } from '../src/world/dressing/util.js';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const names = [...ROCK_TUNNELS, 'tunnel_portal_concrete', 'tunnel_exit_concrete', 'tunnel_mid_10m'];
const assets = new Map();
function load(name) {
  let promise = assets.get(name);
  if (!promise) { promise = io.read(new URL('../public/models/structures/' + name + '.glb', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')); assets.set(name, promise); }
  return promise;
}
function triangles(document, collision = false) {
  const result = [];
  for (const node of document.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh || (node.getName() === 'collision') !== collision) continue;
    const matrix = new THREE.Matrix4().fromArray(node.getWorldMatrix());
    for (const primitive of mesh.listPrimitives()) {
      const pos = primitive.getAttribute('POSITION'), idx = primitive.getIndices();
      const points = Array.from({ length: pos.getCount() }, (_, i) => new THREE.Vector3().fromArray(pos.getElement(i, [])).applyMatrix4(matrix));
      for (let i = 0; i < idx.getCount(); i += 3) result.push([0, 1, 2].map(k => points[idx.getScalar(i + k)]));
    }
  }
  return result;
}
function hits(ts, x, y) {
  const ray = new THREE.Ray(new THREE.Vector3(x, y, -10), new THREE.Vector3(0, 0, 1)), pt = new THREE.Vector3();
  return ts.filter(t => ray.intersectTriangle(...t, false, pt));
}

test('actual shipped entrances, exits and middle tubes have an open drivable bore across both ends', async () => {
  for (const name of names) {
    const document = await load(name), visual = triangles(document), collision = triangles(document, true);
    for (const x of [-6, -5, -3, 0, 3, 5, 6]) {
      const roof = 3.8 + 3.6 * Math.sqrt(1 - (x / 7.4) ** 2);
      for (const y of [.5, 1, 2, 4, roof - .6]) {
        assert.equal(hits(visual, x, y).length, 0, `${name}: opaque wall at x=${x}, y=${y}`);
        assert.equal(hits(collision, x, y).length, 0, `${name}: collider across the lane at x=${x}, y=${y}`);
      }
    }
    if (ROCK_TUNNELS.includes(name)) {
      assert.ok(hits(visual, 0, 10).length > 0, `${name}: exterior rock above the arch must remain`);
      assert.ok(hits(visual, 10, 2).length > 0, `${name}: exterior rock beside the arch must remain`);
      assert.equal(openTunnelBore(document, name).changedTriangles, 0, `${name}: migration must be idempotent`);
    }
  }
});

function buildTunnel(road, seed, f) {
  const lists = new Map(), extras = [], hooks = [], material = new THREE.MeshStandardMaterial();
  const chunk = { s0: Math.floor(f.s1 / 96) * 96, hooks: [], rec: { mesh: { material } },
    list(name) { if (!lists.has(name)) lists.set(name, new InstList()); return lists.get(name); },
    addExtra(mesh) { extras.push(mesh); }, done: new Set() };
  const ctx = { road, seed, kit: { state: () => 'ready', get: () => ({ collision: null }) }, pool: { register() {} }, hook: value => hooks.push(value) };
  assert.equal(buildFeatures(ctx, chunk), true);
  return { extras, hooks, lists, material };
}

test('actual seeded canyon tunnel placement keeps end curtains above the complete tube crown', () => {
  for (const seed of [7, 31, 12345]) {
    const road = new Road(seed); road.extendTo(24000);
    const f = road.features.find(f => f.type === 'tunnel' && f.rock);
    assert.ok(f, 'Seeded route needs a real rock tunnel');
    // Isolate the chosen feature from other structures to test its exact mesh.
    road.features = [f];
    const { extras, hooks, lists, material } = buildTunnel(road, seed, f);
    assert.equal(hooks.length, 1); assert.equal(hooks[0].type, 'tunnel');
    assert.equal(hooks[0].clearHeight, 7.4); assert.equal(hooks[0].halfWidth, 7.4);
    assert.ok(lists.get('tunnel_mid_10m').n > 0);
    const mesh = extras[0], pos = mesh.geometry.attributes.position;
    let endBoreSamples = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + mesh.position.x, y = pos.getY(i) + mesh.position.y, z = pos.getZ(i) + mesh.position.z;
      const n = road.nearest(x, z, f.s0 + (f.s1 - f.s0) / 2, f.s1 - f.s0 + 50, {});
      if (Math.abs(n.d) <= 7.5) { assert.ok(y - road.sample(n.s).y >= 8.15, `seed ${seed}, s=${n.s}, d=${n.d}: terrain curtain crosses tube`); endBoreSamples++; }
    }
    assert.ok(endBoreSamples > 10);
    mesh.geometry.dispose(); material.dispose();
  }
});

test('ordinary terrain skirts keep their original depth when no tunnel clearance is supplied', () => {
  const extras = [], material = new THREE.MeshStandardMaterial();
  const grid = [[{ x: 0, y: 10, z: 0, ty: 0 }, { x: 1, y: 10, z: 0, ty: 0 }], [{ x: 0, y: 10, z: 1, ty: 0 }, { x: 1, y: 10, z: 1, ty: 0 }]];
  const mesh = gridMesh({ seed: 7 }, { addExtra: m => extras.push(m) }, material, grid, 'grey', { skirt: 9 });
  const p = mesh.geometry.attributes.position;
  assert.equal(p.getY(4) + mesh.position.y, 1);
  mesh.geometry.dispose(); material.dispose();
});
