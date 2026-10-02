import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeaponAssets, THREE } from './helpers/weapon-assets.mjs';
import { ViewModel, VMU, BAND } from '../src/view/viewmodel.js';
import { WEAPONS } from '../src/data/weapons.js';

await loadWeaponAssets();
function fixture(t, id, opticId = 'standard', ads = 1) {
  const oldWindow = globalThis.window; globalThis.window = {};
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  const vm = new ViewModel(), camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 200);
  const gunner = { slots: [id], optics: { [id]: opticId }, weaponId: id, weapon: { ...WEAPONS[id], opticId },
    shots: 0, pos: new THREE.Vector3(), magNow: WEAPONS[id].mag, trigger: false,
    swapT: 0, throwing: 0, reloading: false, reloadT: 0 };
  const state = { local: { camera, gunner, adsK: ads, eye: new THREE.Vector3() }, vel: new THREE.Vector3() };
  vm.update(0, state, true);
  // Deterministic real deferred shot drives the same star/cone uniforms and timers.
  t.mock.method(Math, 'random', () => .5); gunner.shots++; vm.notifyShot(gunner);
  vm.root.updateWorldMatrix(true, true); camera.updateWorldMatrix(true, false);
  t.after(() => vm.dispose()); return { vm, camera, gunner, state };
}
const flashes = vm => [vm.flashStar, vm.flashCone, vm.flashStar2];
// CPU analytic fragment/depth proof. This does not execute WebGL or prove pixels.
function bandDepth(point, camera) {
  const clip = new THREE.Vector4(point.x, point.y, point.z, 1)
    .applyMatrix4(camera.matrixWorldInverse).applyMatrix4(VMU.vmProj.value);
  return (clip.z / clip.w + 1) * BAND / 2;
}
function sourceBand(material) {
  const found = material.vertexShader.match(/gl_Position\.z\s*=\s*\(gl_Position\.z\s*\+\s*gl_Position\.w\)\s*\*\s*([\d.]+)\s*-\s*gl_Position\.w/);
  assert.ok(found, 'the actual flash shader uses the same authored VM depth remap');
  assert.equal(Number(found[1]), BAND);
}
function depthPass(material, fragment, stored) {
  assert.equal(material.depthFunc, THREE.LessEqualDepth);
  return !material.depthTest || fragment <= stored;
}
function hits(root, camera, point, predicate = material => material.depthWrite && !material.transparent) {
  const objects = [];
  root.traverse(mesh => {
    if (!mesh.isMesh || Array.isArray(mesh.material) || mesh.material.isShaderMaterial || !predicate(mesh.material)) return;
    for (let parent = mesh; parent; parent = parent.parent) if (!parent.visible) return;
    objects.push(mesh);
  });
  return new THREE.Raycaster(camera.position, point.clone().sub(camera.position).normalize(), 0,
    point.distanceTo(camera.position) + .000001).intersectObjects(objects, false);
}

test('actual own star, secondary star and cone depth-test in the VM band without writing depth or changing reticle policy', t => {
  for (const opticId of ['standard', 'wide_reflex']) {
    const { vm } = fixture(t, 'rifle', opticId);
    for (const mesh of flashes(vm)) {
      const material = mesh.material;
      sourceBand(material); assert.equal(material.uniforms.vmProj, VMU.vmProj);
      assert.equal(material.depthTest, true); assert.equal(material.depthWrite, false);
      assert.equal(material.transparent, true); assert.equal(material.blending, THREE.AdditiveBlending);
      assert.equal(mesh.renderOrder, 998); assert.equal(mesh.visible, true);
      assert.equal(mesh.parent, vm.gun.sockets.muzzle);
    }
    assert.equal(vm.reticle.material.depthTest, false, 'the authored standard chevron policy remains separate');
    if (vm.gun.optic) { assert.equal(vm.gun.optic.reticle.material.depthTest, true); assert.equal(vm.gun.optic.reticle.material.depthWrite, false); }
    assert.equal(vm.flashStar.material.uniforms.uCone.value, 0); assert.equal(vm.flashStar2.material.uniforms.uCone.value, 0);
    assert.equal(vm.flashCone.material.uniforms.uCone.value, 1);
  }
});

for (const opticId of ['standard', 'wide_reflex']) {
  test(`SMG ${opticId}: actual closer opaque receiver/optic-base rejects the behind-barrel star fragment`, t => {
    const { vm, camera } = fixture(t, 'smg', opticId);
    const center = vm.flashStar.getWorldPosition(new THREE.Vector3()), fragmentDepth = bandDepth(center, camera);
    const opaque = hits(vm.gun.root, camera, center).filter(hit => hit.distance < center.distanceTo(camera.position) - .0001);
    assert.ok(opaque.length, 'the real loaded GLB reproduces an opaque blocker on the barrel-projected pixel');
    const storedDepth = bandDepth(opaque[0].point, camera);
    assert.ok(storedDepth < fragmentDepth && fragmentDepth < BAND, 'both real surfaces use ordered, bounded VM depths');
    assert.equal(depthPass(vm.flashStar.material, fragmentDepth, storedDepth), false,
      'a flash behind the nearer opaque sight/receiver must not paint that surface');
    const disabled = vm.flashStar.material.clone(); disabled.depthTest = false;
    assert.equal(depthPass(disabled, fragmentDepth, storedDepth), true, 'historical non-tested material reproduces through-gun overdraw'); disabled.dispose();
  });
}

test('real reflex lens does not write a blocker while the secondary flash behind its clear aperture remains drawable', t => {
  const { vm, camera } = fixture(t, 'smg', 'wide_reflex'), optic = vm.gun.optic;
  const lensPoint = optic.aim.getWorldPosition(new THREE.Vector3());
  const center = vm.flashStar2.getWorldPosition(new THREE.Vector3());
  const centerCamera = center.clone().applyMatrix4(camera.matrixWorldInverse);
  const lensCamera = lensPoint.clone().applyMatrix4(camera.matrixWorldInverse);
  // FLASH_VS builds a camera-facing billboard at c.z, regardless of the gun rotation.
  const fragmentCamera = lensCamera.clone().multiplyScalar(centerCamera.z / lensCamera.z);
  const delta = fragmentCamera.clone().sub(centerCamera), halfSize = vm.flashStar2.material.uniforms.uSize.value / 2;
  assert.ok(delta.x * delta.x + delta.y * delta.y < halfSize * halfSize,
    'the real secondary star covers a fragment through the useful aperture, inside its rotated square');
  const fragment = fragmentCamera.applyMatrix4(camera.matrixWorld), fragmentDepth = bandDepth(fragment, camera);
  const lensHits = hits(optic.root, camera, fragment, material => material.transparent && !material.depthWrite);
  assert.ok(lensHits.some(hit => hit.object === optic.glass), 'the actual transparent glass is nearer than the covered flash fragment');
  const lensDepth = bandDepth(lensHits.find(hit => hit.object === optic.glass).point, camera);
  assert.ok(lensDepth < fragmentDepth);
  const opaque = hits(vm.gun.root, camera, fragment);
  assert.equal(opaque.length, 0, 'the real aperture contains no opaque housing or receiver on this ray');
  assert.equal(optic.glass.material.depthWrite, false);
  assert.equal(depthPass(vm.flashStar2.material, fragmentDepth, 1), true,
    'near clear glass leaves the stored world/clear depth intact, so it cannot erase the farther flash');
  assert.equal(depthPass(vm.flashStar2.material, fragmentDepth, lensDepth), false,
    'negative control: accidentally writing lens depth would incorrectly hide the flash');
});

test('depth-tested flashes preserve authored burst envelope and release each owner once, without disposing the shared atlas or a live sibling', t => {
  const { vm, gunner, state } = fixture(t, 'smg', 'wide_reflex');
  const sibling = new ViewModel(); t.after(() => sibling.dispose());
  const owned = [...new Set(flashes(vm).map(mesh => mesh.material))], events = owned.map(material => {
    const row = { material, count: 0 }; material.addEventListener('dispose', () => row.count++); return row;
  });
  const atlas = vm.flashStar.material.uniforms.map.value; let atlasDisposals = 0, siblingDisposals = 0;
  const atlasListener = () => atlasDisposals++, siblingListener = () => siblingDisposals++;
  atlas.addEventListener('dispose', atlasListener); sibling.flashStar.material.addEventListener('dispose', siblingListener);
  t.after(() => { atlas.removeEventListener('dispose', atlasListener); sibling.flashStar.material.removeEventListener('dispose', siblingListener); });
  assert.equal(atlas, sibling.flashStar.material.uniforms.map.value);
  assert.notEqual(vm.flashStar.material, sibling.flashStar.material); assert.equal(vm.flashLen, .045);
  vm._flash(.0225, gunner.weapon, state.local.adsK);
  assert.equal(vm.flashT, .5); assert.equal(vm.flashStar.visible, true);
  assert.equal(vm.flashStar.material.uniforms.uI.value, 7 * .25 * (1 - state.local.adsK * .65));
  vm._flash(.0225, gunner.weapon, state.local.adsK);
  for (const mesh of flashes(vm)) assert.equal(mesh.visible, false);
  vm.dispose(); vm.dispose();
  for (const row of events) assert.equal(row.count, 1);
  assert.equal(atlasDisposals, 0); assert.equal(siblingDisposals, 0);
});
