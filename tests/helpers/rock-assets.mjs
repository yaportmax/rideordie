import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { AssetKit } from '../../src/world/dressing/assets.js';

export const ROCK_IDS = ['rock_01', 'rock_01_red', 'rock_03', 'rock_03_red', 'rock_05', 'rock_05_red', 'rock_06', 'boulder_01', 'boulder_02', 'boulder_03', 'canyon_pillar_a', 'canyon_pillar_b'];
let loading;
/** Shipped GLB geometry/node transforms, without browser-only image decoding. */
export function loadRockAssets() {
  return loading ||= (async () => {
    const kit = new AssetKit(), loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), assets = new Map();
    for (const id of ROCK_IDS) {
      const src = readFileSync(new URL(`../../public/models/props/${id}.glb`, import.meta.url));
      const jsonLength = src.readUInt32LE(12), json = JSON.parse(src.subarray(20, 20 + jsonLength).toString());
      delete json.images; delete json.textures; delete json.samplers;
      json.materials = (json.materials || []).map(m => ({ name: m.name }));
      let jsonBytes = Buffer.from(JSON.stringify(json));
      jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 32)]);
      const binary = src.subarray(20 + jsonLength), header = Buffer.alloc(20);
      header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + jsonBytes.length + binary.length, 8);
      header.writeUInt32LE(jsonBytes.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
      const bytes = Buffer.concat([header, jsonBytes, binary]);
      const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
      const asset = kit._extract(id, gltf, `/models/props/${id}.glb`);
      assets.set(id, asset);
    }
    return assets;
  })();
}
