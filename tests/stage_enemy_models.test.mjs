import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import * as Assets from '../src/core/assets.js';
import { CarView } from '../src/view/car_view.js';
import { VEHICLES, vehicleModelURL } from '../src/data/vehicles.js';
import { ENEMY_VARIANT_IDS } from '../src/data/enemy_variants.js';

// Real shipped GLBs, real production loader/merge and CarView. Replacing
// browser image decoding proves geometry/resource contracts, not image quality.
const previous = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self,
  createImageBitmap: globalThis.createImageBitmap, ProgressEvent: globalThis.ProgressEvent };
const PAGE_ORIGIN = 'http://stage-enemy-test.local';
const TEXTURE_PATHS = ['albedo', 'normal', 'arm'].map(name => `/textures/rust_metal/${name}.jpg`);
const resourceRequests = [], decodedJpegBytes = [];
globalThis.self = globalThis;
globalThis.createImageBitmap = async blob => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.equal(blob.type, 'image/jpeg', 'texture response is actual JPEG, not fallback HTML');
  assert.ok(bytes.length > 1024, 'shared texture bytes are present');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff], 'bitmap stub accepts real JPEG bytes only');
  decodedJpegBytes.push(bytes.length);
  // No native JPEG decode or visual quality claim follows from this white
  // image fixture. The real production loader must still fetch correct bytes.
  return { width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) };
};
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends previous.Request {
  constructor(url, options) { super(typeof url === 'string' ? new URL(url, PAGE_ORIGIN) : url, options); }
};
globalThis.fetch = async request => {
  // Browser fetch resolves ImageBitmapLoader's direct string URLs against the
  // page origin too. GLB FileLoader uses Request, while images do not.
  const url = new URL(typeof request === 'string' ? request : request.url, PAGE_ORIGIN);
  assert.equal(url.origin, PAGE_ORIGIN, 'fixture must not make external requests');
  resourceRequests.push(url.pathname);
  const contentType = TEXTURE_PATHS.includes(url.pathname) ? 'image/jpeg' : 'application/octet-stream';
  return new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': contentType } });
};
try { await Assets.preload(ENEMY_VARIANT_IDS.map(id => vehicleModelURL(id))); }
finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }

const close = (actual, expected, label, epsilon = 1e-4) => assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} versus ${expected}`);
const close3 = (actual, expected, label) => actual.forEach((value, index) => close(value, expected[index], `${label}[${index}]`));
function moving(node) {
  for (let parent = node; parent; parent = parent.parent) if (/^wheel_[A-Za-z0-9]+$/.test(parent.name) || parent.name === 'steering_wheel') return true;
  return false;
}

test('six shipped models resolve all shared PBR maps through the production root-relative GLTF loader', () => {
  const expectedResources = new Set([...TEXTURE_PATHS, ...ENEMY_VARIANT_IDS.map(vehicleModelURL)]);
  assert.equal(resourceRequests.length, ENEMY_VARIANT_IDS.length * 4, 'each GLB and its three shared image sources were requested');
  assert.equal(decodedJpegBytes.length, ENEMY_VARIANT_IDS.length * 3, 'all shared source images delivered actual JPEG bytes');
  for (const pathname of resourceRequests) assert.ok(expectedResources.has(pathname), `unexpected or model-directory-prefixed resource ${pathname}`);
  for (const pathname of TEXTURE_PATHS) assert.equal(resourceRequests.filter(value => value === pathname).length, ENEMY_VARIANT_IDS.length, `every parser fetched ${pathname}`);
  for (const id of ENEMY_VARIANT_IDS) {
    const url = vehicleModelURL(id), bytes = readFileSync(new URL('../public' + url, import.meta.url));
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    assert.equal(json.images.length, 3, 'exactly three existing shared maps, without embedded copies');
    for (const image of json.images) {
      assert.ok(image.uri.startsWith('../../textures/rust_metal/'), 'portable file-relative image reference');
      assert.equal(image.bufferView, undefined, 'textures remain shared external assets');
      const local = new URL(THREE.LoaderUtils.resolveURL(image.uri, THREE.LoaderUtils.extractUrlBase(url)), PAGE_ORIGIN);
      const absoluteModel = new URL(url, PAGE_ORIGIN).href;
      const absolute = new URL(THREE.LoaderUtils.resolveURL(image.uri, THREE.LoaderUtils.extractUrlBase(absoluteModel)));
      assert.ok(TEXTURE_PATHS.includes(local.pathname)); assert.equal(local.href, absolute.href);
      assert.ok(readFileSync(new URL('../public' + local.pathname, import.meta.url)).length > 1024);
    }
  }
});

for (const id of ENEMY_VARIANT_IDS) test(`${id} production model has distinct real geometry, exact wheel/seat sockets and bounded body draw work`, () => {
  const spec = VEHICLES[id], view = new CarView(spec, { lod: false });
  try {
    assert.equal(view.usesModel, true, 'missing or malformed model cannot silently pass through a placeholder');
    view.root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(view.model, true);
    close3(bounds.min.toArray(), spec.model.bbox.min, 'loaded minimum'); close3(bounds.max.toArray(), spec.model.bbox.max, 'loaded maximum');
    close(spec.length, bounds.max.z - bounds.min.z, 'visual length'); close(spec.width, bounds.max.x - bounds.min.x, 'visual width');
    assert.deepEqual([...view.wheelNodes.keys()].sort(), ['FL', 'FR', 'RL', 'RR']);
    for (const wheel of spec.wheels) {
      const node = view.wheelNodes.get(wheel.name), point = node.getWorldPosition(new THREE.Vector3()).applyMatrix4(view.root.matrixWorld.clone().invert());
      const expected = spec.model.wheels[wheel.name];
      close3(point.toArray(), [expected.x, expected.y, expected.z], wheel.name + ' hub');
      close(wheel.x, expected.x, wheel.name + ' physics X'); close(wheel.z, expected.z, wheel.name + ' physics Z');
    }
    for (const [role, seat] of Object.entries(spec.seats)) {
      if (!seat) continue;
      const socket = view.model.getObjectByName('seat_' + role); assert.ok(socket, role + ' authored seat');
      const point = socket.getWorldPosition(new THREE.Vector3()).applyMatrix4(view.root.matrixWorld.clone().invert());
      close3(point.toArray(), seat, role + ' physical seat');
    }
    let bodyDraws = 0, triangles = 0;
    const texturedMaterials = new Set();
    view.model.traverse(node => {
      if (!node.isMesh) return;
      for (const material of [].concat(node.material)) if (['paint', 'paint2', 'metal_dark', 'rim'].includes(material.name)) {
        texturedMaterials.add(material.name);
        for (const slot of ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap']) {
          assert.ok(material[slot]?.isTexture, `${id}/${material.name}/${slot}: production loader retained the actual PBR texture`);
          assert.ok(material[slot].image, `${id}/${material.name}/${slot}: image decode completed`);
          assert.equal(material[slot].wrapS, THREE.RepeatWrapping); assert.equal(material[slot].wrapT, THREE.RepeatWrapping);
        }
        assert.equal(material.map.colorSpace, THREE.SRGBColorSpace, 'albedo uses color data');
        for (const slot of ['roughnessMap', 'metalnessMap', 'normalMap', 'aoMap']) assert.equal(material[slot].colorSpace, THREE.NoColorSpace, `${slot} uses linear data`);
      }
      const geometry = node.geometry;
      for (const [name, attribute] of Object.entries(geometry.attributes)) {
        const getters = ['getX', 'getY', 'getZ', 'getW'];
        for (let vertex = 0; vertex < attribute.count; vertex++) for (let component = 0; component < Math.min(attribute.itemSize, 4); component++) {
          assert.ok(Number.isFinite(attribute[getters[component]](vertex)), `${node.name} ${name} finite declared accessor`);
        }
      }
      triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      if (!moving(node)) bodyDraws += Array.isArray(node.material) ? geometry.groups.filter(group => group.count > 0 && node.material[group.materialIndex]?.visible !== false).length : 1;
    });
    assert.deepEqual([...texturedMaterials].sort(), ['metal_dark', 'paint', 'paint2', 'rim']);
    assert.ok(bodyDraws <= 24, `${id}: static draw count ${bodyDraws}`);
    assert.ok(triangles > 500 && triangles < 26000, `${id}: bounded authored detail ${triangles}`);
    if (spec.weakpoint) {
      const socket = view.model.getObjectByName('weak_fuel'); assert.ok(socket, 'reactor art has an authored hit socket');
      const point = socket.getWorldPosition(new THREE.Vector3()).applyMatrix4(view.root.matrixWorld.clone().invert());
      close3(point.toArray(), spec.hitZones.fuel.c, 'visible reactor / physical weakpoint');
    }
  } finally { view.dispose(); }
});
