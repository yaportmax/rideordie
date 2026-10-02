import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadWeaponAssets, THREE, Assets } from './helpers/weapon-assets.mjs';
import { GarageScene } from '../src/game/garage_scene.js';
import { BENCH } from '../src/game/garage_env.js';
import { MountedGun, MOUNTED_MINIGUN_MODEL } from '../src/view/mounted_gun.js';

await loadWeaponAssets();
// Load the actual shipped mounted GLB through the same cache/rigid-merge path.
// This model has no textures; no renderer, browser or image decoder is needed.
const saved = { fetch: globalThis.fetch, Request: globalThis.Request, self: globalThis.self, ProgressEvent: globalThis.ProgressEvent };
globalThis.self = globalThis;
globalThis.ProgressEvent = class { constructor(type, props) { this.type = type; Object.assign(this, props); } };
globalThis.Request = class extends saved.Request {
  constructor(url, opts) { super(typeof url === 'string' && url.startsWith('/') ? 'http://mounted-garage-test.local' + url : url, opts); }
};
globalThis.fetch = async request => {
  const url = new URL(typeof request === 'string' ? request : request.url);
  if (url.origin !== 'http://mounted-garage-test.local') return saved.fetch(request);
  return new Response(readFileSync(new URL('../public' + url.pathname, import.meta.url)), { headers: { 'Content-Type': 'application/octet-stream' } });
};
try { await Assets.preload([MOUNTED_MINIGUN_MODEL]); }
finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }

const meshes = root => { const result = []; root.traverse(o => { if (o.isMesh) result.push(o); }); return result; };
const pbr = material => {
  assert.ok(material?.isMeshStandardMaterial && material.color && material.emissive, 'compare actual PBR materials, not the separate reticle ShaderMaterial');
  return { name: material.name, color: material.color.toArray(), emissive: material.emissive.toArray(),
    emissiveIntensity: material.emissiveIntensity, metalness: material.metalness, roughness: material.roughness,
    envMapIntensity: material.envMapIntensity, transparent: material.transparent, depthTest: material.depthTest, depthWrite: material.depthWrite };
};
const lightState = light => ({ position: light.position.toArray(), target: light.target?.position.toArray(),
  color: light.color.toArray(), intensity: light.intensity, angle: light.angle, penumbra: light.penumbra, decay: light.decay });
function fixture(t) {
  const garage = Object.assign(Object.create(GarageScene.prototype), { scene: new THREE.Scene(), ringMat: new THREE.MeshStandardMaterial() });
  garage._lights();
  t.after(() => { garage._buildBench(null); garage.ringMat.dispose(); garage._plinthMat?.dispose(); });
  return garage;
}
function watch(t, resources) {
  return [...new Set(resources)].map(resource => {
    const record = { resource, count: 0 }, listener = () => record.count++;
    resource.addEventListener('dispose', listener); t.after(() => resource.removeEventListener('dispose', listener)); return record;
  });
}

test('actual mounted GLB stands on the floor plinth clear of the real hanging lamp through the preview sweep', t => {
  const garage = fixture(t), otherLights = garage.scene.children.filter(o => o.isLight && o !== garage.benchLight);
  const otherBefore = otherLights.map(lightState), lampBefore = lightState(garage.benchLight);
  garage._buildBench('minigun');
  const bench = garage.benchWeapon, mount = bench.view;
  assert.equal(mount.fallback, false, 'measure the authored physical pedestal, not fallback geometry');
  assert.equal(mount.root.scale.x, 1); assert.equal(mount.root.scale.y, 1); assert.equal(mount.root.scale.z, 1);
  assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(mount.root.quaternion).distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9);
  const plinth = bench.root.children.find(o => o.geometry?.type === 'CylinderGeometry'); assert.ok(plinth);
  const tableBounds = new THREE.Box3(new THREE.Vector3(-14.55, .91, BENCH.z - 2.1), new THREE.Vector3(-13.05, .99, BENCH.z + 2.1));
  const matBounds = new THREE.Box3(new THREE.Vector3(BENCH.x - .55, .99, BENCH.z - .9), new THREE.Vector3(BENCH.x + .55, 1.01, BENCH.z + .9));
  const lampBounds = new THREE.Box3(new THREE.Vector3(BENCH.x + .3 - .42, 2.34, BENCH.z - .42), new THREE.Vector3(BENCH.x + .3 + .42, 2.72, BENCH.z + .42));
  for (const yaw of [0, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2, -.15, .2, .55]) {
    bench.root.rotation.y = yaw; bench.root.updateMatrixWorld(true);
    // Exact transformed vertices: rotating the local box of a cylinder creates
    // an oversized square, which is not the display's physical clearance.
    const gunBounds = new THREE.Box3().setFromObject(mount.root, true), plinthBounds = new THREE.Box3().setFromObject(plinth, true);
    assert.ok(Math.abs(plinthBounds.min.y) < 1e-7, 'display support contacts the actual y=0 floor');
    assert.ok(Math.abs(gunBounds.min.y - plinthBounds.max.y) < 1e-7, 'authored footplate contacts the plinth');
    // Authored visible bulb: center y=2.42, radius .08. Its lower edge must
    // remain above the whole full-size gun, including the factory optic.
    assert.ok(gunBounds.max.y < 2.34 - .6, 'the gun cannot occupy the hanging bulb or shade');
    assert.equal(gunBounds.intersectsBox(lampBounds), false, 'entire gun bounds clear the actual hanging fixture');
    assert.equal(gunBounds.intersectsBox(tableBounds), false); assert.equal(plinthBounds.intersectsBox(tableBounds), false);
    assert.equal(gunBounds.intersectsBox(matBounds), false); assert.equal(plinthBounds.intersectsBox(matBounds), false);
    assert.ok(gunBounds.min.x > -15 && plinthBounds.min.x > -15, 'full display clears the garage wall');
    const nearest = gunBounds.clampPoint(garage.benchLight.position, new THREE.Vector3());
    assert.ok(nearest.distanceTo(garage.benchLight.position) > .8, 'no close-range spotlight hotspot inside the rig bounds');
    // Existing rubber mat reaches BENCH.x+.55 at y=1; floor staging is clear
    // of it as well as the physical table farther toward the garage wall.
    assert.ok(plinthBounds.min.x > BENCH.x + .55, 'floor display stays outside the raised bench mat');
  }
  assert.deepEqual(garage.benchLight.position.toArray(), lampBefore.position, 'keep the physical light at its visible bulb');
  assert.equal(garage.benchLight.intensity, lampBefore.intensity, 'retain the existing lamp power');
  assert.deepEqual(garage.benchLight.target.position.toArray(), bench.root.userData.base.toArray());
  assert.deepEqual(otherLights.map(lightState), otherBefore, 'no scene-wide light or quality change');
});

test('real mounted preview drag rotates the full rig and frames every box corner in default and recorded native panel rectangles', t => {
  const previous = { innerWidth: globalThis.innerWidth, innerHeight: globalThis.innerHeight };
  globalThis.innerWidth = 1280; globalThis.innerHeight = 720;
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } });
  const garage = fixture(t), cam = { tx: 0, ty: 1, tz: 0, az: .5, el: .13, dist: 14, fov: 28 };
  Object.assign(garage, { camera: new THREE.PerspectiveCamera(28, 16 / 9, .1, 1500), cam, goal: { ...cam },
    tab: 'weapons', t: 0, orbit: 0, turn: .4, turnVel: .16, present: null, crew: [], drop: 0,
    turntable: new THREE.Group(), ttDisc: new THREE.Group(), renderer: { getPixelRatio: () => 1 },
    set: { motes: { mat: { uniforms: { uTime: {}, uPx: {} } } }, rayMat: {} }, sparks: { update() {} } });
  garage._buildBench('minigun'); garage.benchDrop = 0;
  for (let i = 0; i < 180; i++) garage._garage(1 / 60);
  const before = garage.benchWeapon.root.quaternion.clone();
  garage.drag(120);
  for (let i = 0; i < 60; i++) garage._garage(1 / 60);
  assert.ok(before.angleTo(garage.benchWeapon.root.quaternion) > .35, 'ordinary production drag affects this mounted display');
  const frames = [
    { label: 'default', rect: { l: 1280 * .32, r: 1280 * .72, t: 720 * .14, b: 720 * .86 } },
    // Exact retained v4 native free area. At yaw .86672 the old fit projected
    // its empty floor-box corner to y605.12 beyond actual bottom583.333374.
    { label: 'retained native v4', rect: { l: 394.6666793823242, r: 928, t: 109.33333587646484, b: 583.3333740234375 } },
  ];
  for (const { label, rect: frame } of frames) {
    garage.setFrameRect(frame);
    for (let i = 0; i < 180; i++) garage._garage(1 / 60);
    for (const yaw of [0, Math.PI / 4, .86672, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      garage.benchWeapon.root.rotation.y = yaw; garage.benchWeapon.root.updateMatrixWorld(true);
      garage.camera.updateMatrixWorld(true); garage.camera.updateProjectionMatrix();
      const bounds = new THREE.Box3().setFromObject(garage.benchWeapon.root, true);
      // Keep the strict all-eight-corner envelope criterion. These corners
      // include empty space around the actual round support, intentionally.
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const ndc = new THREE.Vector3(x, y, z).project(garage.camera), px = (ndc.x + 1) * 640, py = (1 - ndc.y) * 360;
        assert.ok(ndc.z > -1 && ndc.z < 1, 'entire conservative display envelope lies between camera clipping planes');
        assert.ok(px >= frame.l && px <= frame.r && py >= frame.t && py <= frame.b,
          `${label}, yaw${yaw}: box corner ${px},${py} must fit ${JSON.stringify(frame)}`);
      }
    }
  }
});

test('mounted display keeps source and run PBR/shadow resources intact and restores ordinary optic previews', t => {
  const garage = fixture(t), template = Assets.template(MOUNTED_MINIGUN_MODEL);
  assert.ok(template);
  const sourceMeshes = meshes(template), sourceMaterials = [...new Set(sourceMeshes.flatMap(o => [].concat(o.material)))];
  const sourceBefore = sourceMaterials.map(pbr), shared = watch(t, [...sourceMaterials, ...sourceMeshes.map(o => o.geometry)]);
  garage._buildBench('smg', 'wide_reflex');
  const ordinaryBase = garage.benchWeapon.root.userData.base.toArray(), ordinaryTarget = garage.benchLight.target.position.toArray();
  garage._buildBench('minigun'); const mount = garage.benchWeapon.view;
  assert.equal(mount.fallback, false);
  const previewMaterials = [...new Set(meshes(mount.model).flatMap(o => [].concat(o.material)))].filter(m => m.isMeshStandardMaterial);
  const freshRunRig = new MountedGun(); t.after(() => freshRunRig.dispose());
  assert.equal(freshRunRig.fallback, false);
  for (const material of previewMaterials) {
    assert.ok(!sourceMaterials.includes(material), 'mounted instance owns mutable PBR');
    assert.deepEqual(pbr(material), pbr(sourceMaterials.find(m => m.name === material.name)), 'presentation must not darken or retune the asset');
    const runMaterial = meshes(freshRunRig.model).flatMap(o => [].concat(o.material)).find(m => m.name === material.name);
    assert.notEqual(material, runMaterial); assert.deepEqual(pbr(material), pbr(runMaterial), 'garage never changes the in-run look');
  }
  assert.equal(mount.optic.reticle.castShadow, false); assert.equal(mount.optic.reticle.receiveShadow, false);
  const casters = meshes(mount.model).filter(o => o.castShadow);
  assert.equal(casters.length, 1); assert.ok(sourceMeshes.some(o => o.geometry === casters[0].geometry));
  const owned = watch(t, [...mount._ownedResources, mount.optic.reticle.material]);
  const display = watch(t, garage.benchWeapon.root.children.filter(o => o.isMesh).map(o => o.geometry));
  garage._buildBench('smg', 'wide_reflex');
  assert.equal(mount.disposed, true); assert.equal(mount.root.parent, null);
  assert.ok(owned.every(r => r.count === 1)); assert.ok(display.every(r => r.count === 1));
  assert.ok(shared.every(r => r.count === 0)); assert.deepEqual(sourceMaterials.map(pbr), sourceBefore);
  assert.deepEqual(garage.benchWeapon.root.userData.base.toArray(), ordinaryBase);
  assert.deepEqual(garage.benchLight.target.position.toArray(), ordinaryTarget);
  for (const o of [garage.benchWeapon.view.optic.glass, garage.benchWeapon.view.optic.reticle]) {
    assert.equal(o.castShadow, false); assert.equal(o.receiveShadow, false);
  }
  garage._buildBench(null); mount.dispose();
  assert.deepEqual(garage.benchLight.target.position.toArray(), BENCH.toArray());
  assert.ok(owned.every(r => r.count === 1)); assert.ok(shared.every(r => r.count === 0));
});
