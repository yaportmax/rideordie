import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { AssetKit } from '../../src/world/dressing/assets.js';

let pending;
/** Actual stage models, retaining geometry/node matrices and stripping only browser image decoding. */
export function loadDrivingAssets() {
  return pending ||= loadGeometryAssets([['rb_wreck_car', 'structures'], ['rock_03_red', 'props'], ['jersey_barrier', 'props'], ['rock_03', 'props'], ['rb_container', 'structures']]);
}

/** Source geometry proof only; this deliberately does not claim texture/render acceptance. */
export async function loadGeometryAssets(entries) {
    const kit = new AssetKit(), loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), out = new Map();
    for (const [id, folder] of entries) {
      const src = readFileSync(new URL(`../../public/models/${folder}/${id}.glb`, import.meta.url));
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
      out.set(id, kit._extract(id, gltf, `/models/${folder}/${id}.glb`));
    }
    return out;
}
