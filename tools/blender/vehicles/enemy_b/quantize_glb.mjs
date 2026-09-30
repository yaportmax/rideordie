// Lossless-enough size pass for big baked vehicles (the boss): NORMAL -> int8 normalized, TEXCOORD_1 (unique wear atlas, always in
// [0,1]) -> uint16 normalized, uint16 indices where possible.  POSITION, TEXCOORD_0 (tiling detail UVs), node transforms, names,
// sockets and materials are untouched, so extract_model_info / hit boxes / pivots stay identical.  three.js GLTFLoader supports
// KHR_mesh_quantization natively.
// usage: node tools/blender/vehicles/enemy_b/quantize_glb.mjs in.glb [out.glb]
import fs from 'fs';
import { NodeIO, PropertyType } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, prune } from '@gltf-transform/functions';

const src = process.argv[2];
const dst = process.argv[3] || src;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const before = fs.statSync(src).size;
await doc.transform(quantize({ pattern: /^(NORMAL|TEXCOORD_1)$/, quantizeNormal: 8, quantizeTexcoord: 16, cleanup: false }));
await doc.transform(prune({ propertyTypes: [PropertyType.ACCESSOR], keepLeaves: true, keepAttributes: true, keepIndices: true }));   // drop the replaced float accessors
doc.createExtension(KHRMeshQuantization).setRequired(true);
fs.writeFileSync(dst, await io.writeBinary(doc));
console.log(`quantize_glb: ${src} ${(before / 1048576).toFixed(2)} MB -> ${dst} ${(fs.statSync(dst).size / 1048576).toFixed(2)} MB`);
