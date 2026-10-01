import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { sightBoreGeometry } from '../src/view/sight_geometry.js';

const channel = { centerX: 0, centerY: 0, radius: 0.5, minZ: -0.1, maxZ: 0.1, sides: 24 };
function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0, 2, 2, 0, 3, 2, 0, 2, 3, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 1.5, 1.5, 2, 1.5, 1.5, 2], 2));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Array(7).fill([0, 0, 1]).flat(), 3));
  geometry.setAttribute('tangent', new THREE.Float32BufferAttribute(Array(7).fill([1, 0, 0, -1]).flat(), 4));
  geometry.setAttribute('color', new THREE.Uint8BufferAttribute(Array(7).fill([255, 128, 0]).flat(), 3, true));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}
function area(geometry) {
  const position = geometry.attributes.position, index = geometry.index, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let value = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i)); b.fromBufferAttribute(position, index.getX(i + 1)); c.fromBufferAttribute(position, index.getX(i + 2));
    value += b.sub(a).cross(c.sub(a)).length() * 0.5;
  }
  return value;
}
function rayHits(geometry, x = 0, y = 0, z = -1) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  return new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, 1)).intersectObject(mesh).length;
}

test('bounded polygon bore opens only its channel and preserves annular cap faces and untouched data', () => {
  const source = fixture(), indexBefore = [...source.index.array];
  const attributesBefore = Object.fromEntries(Object.entries(source.attributes).map(([name, attr]) => [name, [...attr.array]]));
  const result = sightBoreGeometry(source, channel);
  assert.notEqual(result, source);
  assert.equal(rayHits(result), 0, 'the optical center must be open');
  assert.ok(rayHits(result, 0.75, 0), 'the cap surrounding the aperture survives');
  assert.ok(rayHits(result, 2.2, 2.2), 'the separate untouched triangle survives');
  const polygonArea = channel.sides * channel.radius ** 2 * Math.sin(2 * Math.PI / channel.sides) / 2;
  assert.ok(Math.abs(area(result) - (4.5 - polygonArea)) < 2e-7, 'only the convex aperture area is removed');
  assert.deepEqual([...source.index.array], indexBefore);
  assert.deepEqual([...result.index.array].slice(-3), [4, 5, 6], 'untouched triangle keeps its exact indices');
  for (const [name, attr] of Object.entries(source.attributes)) {
    assert.deepEqual([...attr.array], attributesBefore[name], 'the source attributes are never changed');
    assert.deepEqual([...result.attributes[name].array].slice(0, attr.array.length), attributesBefore[name], 'original vertices remain byte-identical');
  }
  for (let i = source.attributes.position.count; i < result.attributes.position.count; i++) {
    const p = result.attributes.position, uv = result.attributes.uv;
    assert.ok(Math.abs(uv.getX(i) - (p.getX(i) + 1) / 2) < 1e-7);
    assert.ok(Math.abs(uv.getY(i) - (p.getY(i) + 1) / 2) < 1e-7);
    assert.deepEqual([result.attributes.normal.getX(i), result.attributes.normal.getY(i), result.attributes.normal.getZ(i)], [0, 0, 1]);
    assert.deepEqual([0, 1, 2, 3].map(k => result.attributes.tangent.getComponent(i, k)), [1, 0, 0, -1]);
    assert.deepEqual([...result.attributes.color.array].slice(i * 3, i * 3 + 3), [255, 128, 0]);
  }
});

test('variants coalesce by channel values while misses, bounded Z ranges and empty channels preserve the source', () => {
  const source = fixture(), result = sightBoreGeometry(source, channel);
  assert.equal(sightBoreGeometry(source, { ...channel }), result);
  assert.equal(sightBoreGeometry(source, [{ ...channel }]), result);
  assert.equal(sightBoreGeometry(source, { ...channel, minZ: 1, maxZ: 2 }), source);
  assert.equal(sightBoreGeometry(source, { ...channel, centerX: 5 }), source);
  assert.equal(sightBoreGeometry(source, []), source);
  const second = sightBoreGeometry(source, [channel, { ...channel, centerX: 2.2, centerY: 2.2, radius: 0.1 }]);
  assert.equal(rayHits(second, 0, 0), 0);
  assert.equal(rayHits(second, 2.2, 2.2), 0);
  assert.ok(area(second) < area(result));
  assert.equal(sightBoreGeometry(source, channel), result, 'other channels cannot poison an existing variant');
});

test('the finite Z extent cuts a side-facing triangle pair without opening material beyond either end', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, -0.5, 0, 1, -0.5, 0, 1, 0.5, 0, -1, 0.5], 3));
  source.setIndex([0, 1, 2, 0, 2, 3]);
  const result = sightBoreGeometry(source, channel);
  assert.ok(Math.abs(area(result) - 1.8) < 1e-7);
  const mesh = new THREE.Mesh(result, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.updateMatrixWorld(true);
  const hitsAt = z => new THREE.Raycaster(new THREE.Vector3(-1, 0, z), new THREE.Vector3(1, 0, 0)).intersectObject(mesh).length;
  assert.equal(hitsAt(0), 0);
  assert.ok(hitsAt(-0.25)); assert.ok(hitsAt(0.25));
});

test('rejects unsupported geometry or malformed channels before mutating the source', () => {
  for (const change of [
    g => { g.setIndex(null); },
    g => { g.setIndex(new THREE.Uint16BufferAttribute([0, 1, 2, 0, 2, 3, 4, 5, 6], 3)); },
    g => { g.setIndex(new THREE.Uint16BufferAttribute([0, 1, 2, 0, 2, 3, 4, 5, 6], 1, true)); },
    g => { g.setIndex(new THREE.Float32BufferAttribute([0, 1, 2, 0, 2, 3, 4, 5, 6], 1)); },
    g => { g.addGroup(0, 3, 0); },
    g => { g.setDrawRange(0, 3); },
    g => { g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(7 * 4), 4)); },
    g => { g.morphAttributes.position = [g.attributes.position.clone()]; },
    g => { g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0], 2)); },
    g => { g.setAttribute('uv', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Float32Array(7 * 2), 2), 2, 0)); },
    g => { g.setAttribute('uv', new THREE.Float16BufferAttribute(new Uint16Array(7 * 2), 2)); },
  ]) {
    const source = fixture(); change(source);
    assert.throws(() => sightBoreGeometry(source, channel), TypeError);
  }
  for (const invalid of [{ ...channel, radius: 0 }, { ...channel, minZ: 1 }, { ...channel, sides: 2 }, { ...channel, centerX: NaN }]) {
    assert.throws(() => sightBoreGeometry(fixture(), invalid), TypeError);
  }
  assert.throws(() => sightBoreGeometry(fixture(), Array(17).fill(channel)), TypeError);
});

// Read shipped GLB triangles directly: no browser, image decoding or renderer.
function shippedPrimitive(id, nodeName, materialName) {
  const file = readFileSync(new URL('../public/models/weapons/' + id + '.glb', import.meta.url));
  const length = file.readUInt32LE(12), json = JSON.parse(file.subarray(20, 20 + length).toString());
  const binary = file.subarray(28 + length, 28 + length + file.readUInt32LE(20 + length));
  const nodes = json.nodes.map(node => {
    const o = new THREE.Object3D();
    if (node.matrix) new THREE.Matrix4().fromArray(node.matrix).decompose(o.position, o.quaternion, o.scale);
    else { if (node.translation) o.position.fromArray(node.translation); if (node.rotation) o.quaternion.fromArray(node.rotation); if (node.scale) o.scale.fromArray(node.scale); }
    return o;
  });
  json.nodes.forEach((node, i) => (node.children || []).forEach(child => nodes[i].add(nodes[child])));
  const root = new THREE.Group(); json.scenes[json.scene || 0].nodes.forEach(i => root.add(nodes[i])); root.updateMatrixWorld(true);
  const nodeIndex = json.nodes.findIndex(node => node.name === nodeName), node = json.nodes[nodeIndex];
  assert.ok(node && node.mesh !== undefined);
  const primitive = json.meshes[node.mesh].primitives.find(p => json.materials[p.material].name === materialName);
  assert.ok(primitive);
  const read = ai => {
    const accessor = json.accessors[ai], view = json.bufferViews[accessor.bufferView];
    const itemSize = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const [Type, bytes, method] = { 5121: [Uint8Array, 1, 'readUInt8'], 5123: [Uint16Array, 2, 'readUInt16LE'], 5125: [Uint32Array, 4, 'readUInt32LE'], 5126: [Float32Array, 4, 'readFloatLE'] }[accessor.componentType];
    const values = new Type(accessor.count * itemSize), start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
    for (let i = 0; i < accessor.count; i++) for (let k = 0; k < itemSize; k++) values[i * itemSize + k] = binary[method](start + i * (view.byteStride || itemSize * bytes) + k * bytes);
    return new THREE.BufferAttribute(values, itemSize, !!accessor.normalized);
  };
  const geometry = new THREE.BufferGeometry();
  for (const [gltf, name] of Object.entries({ POSITION: 'position', NORMAL: 'normal', TEXCOORD_0: 'uv', TANGENT: 'tangent' })) if (primitive.attributes[gltf] !== undefined) geometry.setAttribute(name, read(primitive.attributes[gltf]));
  geometry.setIndex(read(primitive.indices));
  return { geometry, world: nodes[nodeIndex].matrixWorld };
}

test('actual rifle and LMG cap primitives open without deleting their surrounding sight rims', () => {
  for (const { id, node, centerY, radius, minZ, maxZ } of [
    { id: 'rifle', node: 'mesh_optic', centerY: 0.1585, radius: 0.0108, minZ: -0.072, maxZ: -0.012 },
    { id: 'lmg', node: 'mesh_feed_cover', centerY: 0.146, radius: 0.0022, minZ: -0.0121, maxZ: -0.0089 },
  ]) {
    const { geometry, world } = shippedPrimitive(id, node, 'gun_black');
    const inverse = world.clone().invert(), center = new THREE.Vector3(0, centerY, 0).applyMatrix4(inverse);
    const from = new THREE.Vector3(0, centerY, minZ).applyMatrix4(inverse), to = new THREE.Vector3(0, centerY, maxZ).applyMatrix4(inverse);
    assert.ok(Math.abs(new THREE.Vector3(0, 0, 1).transformDirection(world).z - 1) < 1e-6, 'shipped primitive uses the +Z channel axis');
    const result = sightBoreGeometry(geometry, { centerX: center.x, centerY: center.y, radius, minZ: from.z, maxZ: to.z });
    assert.ok(rayHits(geometry, center.x, center.y, from.z - 0.001));
    assert.equal(rayHits(result, center.x, center.y, from.z - 0.001), 0, id + ' bore opens');
    assert.ok(rayHits(result, center.x + radius * 1.15, center.y, from.z - 0.001), id + ' outer annulus survives');
    assert.ok(area(result) < area(geometry));
    // The rifle's boxy lower optic body also enters its lower aperture; opening
    // that authored intrusion leaves more than 90% of the optic's surface.
    assert.ok(area(result) > area(geometry) * 0.9, id + ' retains surrounding optic hardware');
  }
});
