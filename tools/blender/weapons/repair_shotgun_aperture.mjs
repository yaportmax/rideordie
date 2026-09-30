// Remove the two accidental ghost-ring caps from the existing textured shotgun GLB.
// Run from any directory: node tools/blender/weapons/repair_shotgun_aperture.mjs [shotgun.glb]
// The generator now creates the hollow ring correctly; this repair avoids rebaking its textures.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = process.argv[2] || fileURLToPath(new URL('../../../public/models/weapons/shotgun.glb', import.meta.url));
const original = fs.readFileSync(path);
assert.equal(original.readUInt32LE(0), 0x46546c67, 'Expected a GLB');
assert.equal(original.readUInt32LE(4), 2, 'Expected GLB version 2');
assert.equal(original.readUInt32LE(8), original.length, 'GLB length mismatch');

const chunks = [];
for (let offset = 12; offset < original.length;) {
  const length = original.readUInt32LE(offset), type = original.readUInt32LE(offset + 4);
  assert.ok(offset + 8 + length <= original.length, 'Truncated GLB chunk');
  chunks.push({ type, data: Buffer.from(original.subarray(offset + 8, offset + 8 + length)) });
  offset += 8 + length;
}
assert.equal(chunks[0].type, 0x4e4f534a, 'Expected JSON first');
const binChunks = chunks.filter((chunk) => chunk.type === 0x004e4942);
assert.equal(binChunks.length, 1, 'Expected one binary chunk');
const binary = binChunks[0].data;
const json = JSON.parse(chunks[0].data.toString('utf8'));
const beforeJson = structuredClone(json);
const beforeBinary = Buffer.from(binary);
const body = json.nodes.find((node) => node.name === 'mesh_body');
assert.ok(body && body.mesh !== undefined, 'Expected shotgun mesh_body');
const primitive = json.meshes[body.mesh].primitives.find((item) => json.materials[item.material].name === 'gun_black');
assert.ok(primitive, 'Expected gun_black body primitive');
const position = json.accessors[primitive.attributes.POSITION];
const index = json.accessors[primitive.indices];
assert.equal(position.type, 'VEC3');
assert.equal(position.componentType, 5126);
assert.equal(index.type, 'SCALAR');
assert.equal(index.componentType, 5123, 'Expected ushort indices');
assert.ok(!position.sparse && !index.sparse, 'Sparse accessors are unsupported');
const positionView = json.bufferViews[position.bufferView], indexView = json.bufferViews[index.bufferView];
assert.equal(positionView.buffer, 0); assert.equal(indexView.buffer, 0);
assert.ok(!indexView.byteStride, 'Strided index accessors are unsupported');
assert.equal(index.count % 3, 0, 'Expected triangle indices');
const positionOffset = (positionView.byteOffset || 0) + (position.byteOffset || 0);
const positionStride = positionView.byteStride || 12;
const indexOffset = (indexView.byteOffset || 0) + (index.byteOffset || 0);
assert.ok(positionOffset + (position.count - 1) * positionStride + 12 <= binary.length);
assert.ok(indexOffset + index.count * 2 <= binary.length);

function vertex(i) {
  assert.ok(i < position.count, 'Index outside vertex accessor');
  const offset = positionOffset + i * positionStride;
  return [binary.readFloatLE(offset), binary.readFloatLE(offset + 4), binary.readFloatLE(offset + 8)];
}
function isCap(indices) {
  const vertices = indices.map(vertex);
  // Both endpoint caps lie entirely inside the 3.3 mm bore, at its two axial endpoints.
  return [0.0065, 0.0095].some((z) => vertices.every(([x, y, vz]) =>
    Math.abs(vz - z) < 1e-7 && Math.hypot(x, y - 0.09) <= 0.003301));
}

const kept = []; let removed = 0;
for (let i = 0; i < index.count; i += 3) {
  const triangle = [0, 1, 2].map((j) => binary.readUInt16LE(indexOffset + (i + j) * 2));
  if (isCap(triangle)) removed++; else kept.push(...triangle);
}
if (!removed) {
  console.log('Shotgun aperture is already open; no changes.');
  process.exit(0);
}
assert.equal(removed, 52, 'Unexpected aperture geometry; refusing partial repair');
const oldCount = index.count;
for (let i = 0; i < kept.length; i++) binary.writeUInt16LE(kept[i], indexOffset + i * 2);
index.count = kept.length;
if (index.min) index.min = [Math.min(...kept)];
if (index.max) index.max = [Math.max(...kept)];
// Leave the binary allocation intact; the accessor count excludes its unused trailing indices.
assert.ok(beforeBinary.subarray(0, indexOffset).equals(binary.subarray(0, indexOffset)));
assert.ok(beforeBinary.subarray(indexOffset + oldCount * 2).equals(binary.subarray(indexOffset + oldCount * 2)));
const expectedJson = structuredClone(beforeJson);
expectedJson.accessors[primitive.indices] = structuredClone(index);
assert.deepEqual(json, expectedJson, 'Unexpected GLB metadata change');
for (let i = 0; i < kept.length; i += 3) assert.ok(!isCap(kept.slice(i, i + 3)));

let encoded = Buffer.from(JSON.stringify(json));
if (encoded.length % 4) encoded = Buffer.concat([encoded, Buffer.alloc(4 - encoded.length % 4, 0x20)]);
chunks[0].data = encoded;
const parts = chunks.map(({ type, data }) => {
  const header = Buffer.alloc(8); header.writeUInt32LE(data.length, 0); header.writeUInt32LE(type, 4);
  return Buffer.concat([header, data]);
});
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + parts.reduce((total, part) => total + part.length, 0), 8);
fs.writeFileSync(path, Buffer.concat([header, ...parts]));
console.log(`Removed ${removed} shotgun sight cap triangles; body indices ${oldCount} -> ${index.count}. All nodes, sockets, materials, textures and other geometry are unchanged.`);
