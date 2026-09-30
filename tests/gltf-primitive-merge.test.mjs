import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeRigid } from '../src/core/merge.js';

function primitiveFixture() {
  const data = new ArrayBuffer(104);
  new Float32Array(data, 0, 9).set([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  new Float32Array(data, 36, 9).set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  new Float32Array(data, 72, 6).set([0, 0, 1, 0, 0, 1]);
  new Uint16Array(data, 96, 3).set([0, 1, 2]);
  const primitive = { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 };
  const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'panel_hood', mesh: 0, translation: [1, 2, 3], children: [1, 2] },
      { name: 'panel_hood_1', mesh: 1, translation: [2, 0, 0] }, { name: 'seat_gunner', translation: [0, 1, 0] }],
    meshes: [{ name: 'panel_hood', primitives: [primitive, primitive] }, { name: 'panel_hood_1', primitives: [primitive] }],
    materials: [{ name: 'paint' }], buffers: [{ byteLength: data.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 24 }, { buffer: 0, byteOffset: 96, byteLength: 6 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' }] };
  const json = Buffer.from(JSON.stringify(gltf)), jsonLength = (json.length + 3) & ~3;
  const out = Buffer.alloc(12 + 8 + jsonLength + 8 + data.byteLength, 0x20);
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(jsonLength, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20);
  out.writeUInt32LE(data.byteLength, 20 + jsonLength); out.writeUInt32LE(0x004e4942, 24 + jsonLength);
  Buffer.from(data).copy(out, 28 + jsonLength);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}
function meshCount(root) { let n = 0; root.traverse((o) => { if (o.isMesh) n++; }); return n; }
function vertices(root) {
  root.updateMatrixWorld(true); const points = [], point = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry, count = geo.index?.count ?? geo.attributes.position.count;
    for (let i = 0; i < count; i++) points.push(point.fromBufferAttribute(geo.attributes.position, geo.index ? geo.index.getX(i) : i).applyMatrix4(o.matrixWorld).toArray());
  });
  return points.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

test('glTF primitive merging preserves authored panel pivots, named mesh roots, sockets and geometry', async () => {
  const g = await new GLTFLoader().parseAsync(primitiveFixture(), ''), map = g.parser.associations;
  const authored = new Map(); g.scene.traverse((o) => { const source = map.get(o); if (source?.nodes !== undefined) authored.set(source.nodes, o); });
  const panel = authored.get(0), child = authored.get(1), socket = authored.get(2), childGeometry = child.geometry;
  assert.equal(meshCount(g.scene), 3);
  assert.ok(map.get(child).primitives !== undefined); // authored single-primitive mesh has both fields
  assert.ok(child.name.startsWith('panel_hood_1'));
  const legacy = g.scene.clone(); mergeRigid(legacy); assert.equal(meshCount(legacy), 3); // metadata remains optional
  const before = vertices(g.scene), rest = panel.matrixWorld.clone();
  const result = mergeRigid(g.scene, map);
  assert.deepEqual(result, { before: 2, after: 1 }); assert.equal(meshCount(g.scene), 2);
  assert.deepEqual(vertices(g.scene), before); assert.ok(panel.matrixWorld.equals(rest));
  assert.equal(child.geometry, childGeometry); assert.equal(child.parent, panel); assert.equal(socket.parent, panel);
  assert.deepEqual(socket.position.toArray(), [0, 1, 0]);
  const scene = new THREE.Scene(); scene.attach(panel); panel.rotation.z = Math.PI / 2; scene.updateMatrixWorld(true);
  assert.equal(meshCount(panel), 2); assert.equal(child.geometry, childGeometry);
  const childPosition = child.getWorldPosition(new THREE.Vector3());
  assert.ok(childPosition.distanceTo(new THREE.Vector3(1, 4, 3)) < 1e-6);
});

test('generated primitives still respect visibility, shadow and morph boundaries', () => {
  const root = new THREE.Group(), panel = new THREE.Group(); panel.name = 'panel_bumper_F'; root.add(panel);
  const material = new THREE.MeshStandardMaterial(), map = new Map([[panel, { nodes: 0, meshes: 0 }]]);
  const meshes = Array.from({ length: 6 }, (_, i) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); mesh.name = `panel_bumper_F_${i}`;
    map.set(mesh, { meshes: 0, primitives: i }); panel.add(mesh); return mesh;
  });
  meshes[2].visible = false; meshes[3].castShadow = true; meshes[4].receiveShadow = true;
  meshes[5].geometry.morphAttributes.position = [meshes[5].geometry.attributes.position.clone()];
  mergeRigid(root, map);
  assert.equal(meshCount(root), 5); assert.equal(panel.parent, root);
  for (const mesh of meshes.slice(2)) assert.equal(mesh.parent, panel);
  assert.equal(meshes[2].visible, false); assert.equal(meshes[3].castShadow, true); assert.equal(meshes[4].receiveShadow, true);
  assert.equal(meshes[5].geometry.morphAttributes.position.length, 1);
});
