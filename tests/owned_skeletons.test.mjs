import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCrewAssets, THREE, CrewView } from './helpers/crew-assets.mjs';
import { loadWeaponAssets } from './helpers/weapon-assets.mjs';
import * as Assets from '../src/core/assets.js';
import { DriverArms } from '../src/view/driver_arms.js';
import { ViewModel, FP_ARMS_URL } from '../src/view/viewmodel.js';
import { WeaponView } from '../src/view/weapon_view.js';
import { Game } from '../src/game/game.js';
import { WorldView } from '../src/game/world_view.js';
import { ownClonedSkeletons, disposeOwnedSkeletons, disposeOwnedSkeletonsIn } from '../src/view/owned_skeletons.js';

await loadCrewAssets();
await loadWeaponAssets(); // All five actual mounted optic variants are present during boot ownership proof.

function skeletons(root) {
  const out = new Set(); root.traverse(o => { if (o.isSkinnedMesh) out.add(o.skeleton); }); return out;
}
function upload(skeletonSet) {
  // The real renderer allocates this DataTexture on first skinned submission.
  // Exercise the same Three allocation/dispose events without opening WebGL.
  return [...skeletonSet].map(skeleton => {
    if (!skeleton.boneTexture) skeleton.computeBoneTexture();
    const rec = { skeleton, texture: skeleton.boneTexture, disposed: 0 };
    rec.texture.addEventListener('dispose', () => rec.disposed++);
    return rec;
  });
}
function assertFreed(records, label) {
  for (const rec of records) {
    assert.equal(rec.disposed, 1, label); assert.equal(rec.skeleton.boneTexture, null, label);
  }
}
function mockImages(t) {
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('real cloned rigs release exact owned skeletons once, including offgraph aliases, without touching live rigs or templates', () => {
  const url = '/models/characters/hero_gunner.glb', blueprint = Assets.template(url);
  const clone = Assets.clone(url), live = ownClonedSkeletons(Assets.clone(url));
  const owned = skeletons(clone), liveSet = skeletons(live), templateSet = skeletons(blueprint);
  assert.equal(owned.size, 6); assert.equal(liveSet.size, 6); assert.equal(templateSet.size, 1);
  const source = [...templateSet][0];
  for (const s of owned) {
    assert.notEqual(s, source); assert.equal(s.boneInverses, source.boneInverses);
    assert.ok(s.bones.every((bone, i) => bone !== source.bones[i]));
    assert.ok(!liveSet.has(s));
  }
  const geometryMaterial = new Set(); blueprint.traverse(o => {
    if (o.isMesh) { geometryMaterial.add(o.geometry); for (const m of [].concat(o.material)) geometryMaterial.add(m); }
  });
  let sharedDisposed = 0;
  const onDispose = () => sharedDisposed++;
  for (const resource of geometryMaterial) resource.addEventListener('dispose', onDispose);
  const beforeInverses = source.boneInverses.map(matrix => matrix.toArray());
  const records = upload(owned), liveRecords = upload(liveSet), templateRecords = upload(templateSet);
  let mesh; clone.traverse(o => { if (!mesh && o.isSkinnedMesh) mesh = o; });
  // An alias shares an owned skeleton; an externally attached mesh borrows a
  // different live owner's skeleton. Graph position does not change ownership.
  const alias = new THREE.SkinnedMesh(mesh.geometry, mesh.material); alias.skeleton = mesh.skeleton;
  const external = new THREE.SkinnedMesh(mesh.geometry, mesh.material); external.skeleton = [...liveSet][0];
  clone.add(alias); ownClonedSkeletons(clone);
  clone.add(external); mesh.removeFromParent();
  assert.equal(disposeOwnedSkeletons(clone), 6);
  assertFreed(records, 'owned rig');
  assert.equal(disposeOwnedSkeletons(clone), 0);
  assert.equal(disposeOwnedSkeletons(blueprint), 0);
  for (const rec of [...liveRecords, ...templateRecords]) { assert.equal(rec.disposed, 0); assert.equal(rec.skeleton.boneTexture, rec.texture); }
  assert.deepEqual(source.boneInverses.map(matrix => matrix.toArray()), beforeInverses);
  assert.equal(sharedDisposed, 0);
  for (const resource of geometryMaterial) resource.removeEventListener('dispose', onDispose);
  disposeOwnedSkeletons(live); source.dispose();
});

test('CrewView disposes separate camera viewmodel, driver arms and cached offgraph cloned models idempotently', t => {
  mockImages(t);
  const crew = new CrewView('hero_gunner', { role: 'gunner', weapon: 'smg', opticId: 'wide_reflex' });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(); scene.add(crew.root, camera);
  crew.vm = new ViewModel(); camera.add(crew.vm.root);
  crew.vm._gunFor('pistol', 'wide_reflex'); crew.vm._gunFor('smg', 'wide_reflex');
  crew.drvArms = new DriverArms(crew); assert.equal(crew.drvArms.ok, true);
  // A cached loadout model may no longer be under the visible VM graph. Real
  // shipped rig data ensures that cleanup is not merely an empty weapon case.
  const offgraph = ownClonedSkeletons(Assets.clone('/models/characters/raider_a.glb'));
  const offgraphGun = new WeaponView('pistol', { opticId: 'wide_reflex' });
  offgraphGun.model.removeFromParent(); offgraphGun.model = offgraph; offgraphGun.root.add(offgraph);
  crew.vm.guns.set('offgraph', offgraphGun);
  const all = new Set([...skeletons(crew.model), ...skeletons(crew.vm.model), ...skeletons(offgraph)]);
  assert.equal(all.size, 11); // hero 6 + driver arms 1 + viewmodel 1 + raider 3
  const records = upload(all);
  const opticMaterials = resourceEvents([crew.weapon.optic.reticle.material,
    ...[...crew.vm.guns.values()].map(gun => gun.optic.reticle.material)]);
  const sharedOptics = resourceEvents([crew.weapon.optic.housing.geometry, crew.weapon.optic.housing.material,
    crew.weapon.optic.glass.geometry, crew.weapon.optic.glass.material]);
  crew.dispose(); crew.dispose(); crew.vm.dispose(); crew.drvArms.dispose();
  assertFreed(records, 'whole crew ownership');
  assertResourceEvents(opticMaterials, 1); assertResourceEvents(sharedOptics, 0);
  assert.equal(crew.root.parent, null); assert.equal(crew.vm.root.parent, null); assert.equal(crew.drvArms.model.parent, null);
  stopResourceEvents(opticMaterials); stopResourceEvents(sharedOptics);
});

test('replacing fallback arms releases all cloned skeletons, including removed body/armor meshes, while new arms remain live', t => {
  mockImages(t);
  const vm = new ViewModel(), firstRecords = upload(skeletons(vm.model));
  const cloned = [], originalClone = THREE.Skeleton.prototype.clone;
  t.mock.method(THREE.Skeleton.prototype, 'clone', function () {
    const next = originalClone.call(this); cloned.push(next); return next;
  });
  vm._buildArms(); // actual hero fallback removes body/hair/eyes/armor meshes
  assertFreed(firstRecords, 'replaced dedicated arms');
  assert.equal(cloned.length, 6); assert.equal(skeletons(vm.model).size, 1);
  const fallbackRecords = upload(new Set(cloned));
  vm._buildArms(Assets.clone(FP_ARMS_URL), Assets.getAnimations(FP_ARMS_URL));
  assertFreed(fallbackRecords, 'including five offgraph fallback skeletons');
  const currentRecords = upload(skeletons(vm.model));
  assert.equal(currentRecords.length, 1); assert.equal(currentRecords[0].disposed, 0);
  vm.dispose(); vm.dispose(); assertFreed(currentRecords, 'latest arms');
});

test('a rejected real fp-arms clone releases its owned resources and preserves the current rig', t => {
  mockImages(t); t.mock.method(console, 'warn', () => {});
  const vm = new ViewModel(), currentRecords = upload(skeletons(vm.model));
  const invalid = Assets.clone(FP_ARMS_URL); invalid.getObjectByName('socket_hand_R').removeFromParent();
  const rejected = [], originalClone = THREE.Skeleton.prototype.clone;
  t.mock.method(THREE.Skeleton.prototype, 'clone', function () {
    const next = originalClone.call(this); rejected.push(...upload(new Set([next]))); return next;
  });
  assert.equal(vm._fpFrom({ scene: invalid, animations: Assets.getAnimations(FP_ARMS_URL) }), false);
  assertFreed(rejected, 'rejected clone');
  for (const rec of currentRecords) { assert.equal(rec.disposed, 0); assert.equal(rec.skeleton.boneTexture, rec.texture); }
  vm.dispose();
});

function resourceEvents(resources) {
  return [...new Set(resources)].map(resource => {
    const rec = { resource, disposed: 0 }; rec.listener = () => rec.disposed++;
    resource.addEventListener('dispose', rec.listener); return rec;
  });
}
function warmMaterialResources(vm) {
  return new Set([...vm._ownedMaterials, ...[...vm.guns.values()].filter(gun => gun.optic).map(gun => gun.optic.reticle.material)]);
}
function assertResourceEvents(records, count) { for (const rec of records) assert.equal(rec.disposed, count, rec.resource.type); }
function stopResourceEvents(records) { for (const rec of records) rec.resource.removeEventListener('dispose', rec.listener); }

test('runtime VM releases only unique flash/reticle/shell allocations, preserving sibling, asset, cut, sleeve and projectile pool resources', t => {
  mockImages(t);
  const vm = new ViewModel(), sibling = new ViewModel(); vm._buildArms(); sibling._buildArms();
  const gun = vm._gunFor('smg'), siblingGun = sibling._gunFor('smg');
  assert.equal(vm.arms.geometry, sibling.arms.geometry); assert.equal(vm.arms.material, sibling.arms.material);
  for (const side of ['Left', 'Right']) {
    const a = vm.model.getObjectByName('vm_sleeve_' + side), b = sibling.model.getObjectByName('vm_sleeve_' + side);
    assert.equal(a.geometry, b.geometry); assert.equal(a.material, b.material);
  }
  assert.equal(vm.shell.children[0].material, sibling.shell.children[0].material);
  const uniqueGeometry = resourceEvents([vm.flashStar.geometry, vm.flashCone.geometry, vm.flashStar2.geometry, vm.reticle.geometry, ...vm.shell.children.map(mesh => mesh.geometry)]);
  const uniqueMaterials = resourceEvents([vm.flashStar.material, vm.flashCone.material, vm.flashStar2.material, vm.reticle.material]);
  assert.equal(uniqueGeometry.length, 3); assert.equal(uniqueMaterials.length, 4);
  assert.notEqual(vm.flashStar.geometry, sibling.flashStar.geometry); assert.notEqual(vm.flashStar.material, sibling.flashStar.material);
  const shared = new Set();
  for (const root of [vm.model, sibling.model, gun.root, siblingGun.root, Assets.template(FP_ARMS_URL), sibling.shell]) root.traverse(o => {
    if (o.isMesh) { shared.add(o.geometry); for (const material of [].concat(o.material)) shared.add(material); }
  });
  for (const cut of gun.adsCut) { shared.add(cut.full); shared.add(cut.keep); if (cut.cut) shared.add(cut.cut); }
  const pool = new WorldView({ scene: new THREE.Scene() });
  shared.add(pool.grenadeGeo); shared.add(pool.grenadeMat); shared.add(pool.rocketGeo); shared.add(pool.rocketMat);
  shared.add(vm.flashStar.material.uniforms.map.value); // shared muzzle atlas
  const sharedEvents = resourceEvents(shared);
  // These live external resources deliberately appear under the dying root.
  // A blanket traverse-and-dispose implementation would corrupt the pool/peer.
  vm.root.add(new THREE.Mesh(pool.grenadeGeo, pool.grenadeMat), new THREE.Mesh(sibling.flashStar.geometry, sibling.flashStar.material));
  const siblingEvents = resourceEvents([sibling.flashStar.geometry, sibling.flashStar.material]);
  vm.flashStar.removeFromParent(); vm.flashStar2.removeFromParent(); vm.shell.removeFromParent();
  vm.dispose(); vm.dispose();
  assertResourceEvents(uniqueGeometry, 1); assertResourceEvents(uniqueMaterials, 1);
  assertResourceEvents(sharedEvents, 0); assertResourceEvents(siblingEvents, 0);
  for (const records of [uniqueGeometry, uniqueMaterials, sharedEvents, siblingEvents]) stopResourceEvents(records);
  sibling.dispose(); pool.dispose();
});

function warmFixture() {
  const game = Object.create(Game.prototype), previous = { name: 'garage target' }; let target = previous;
  Object.assign(game, {
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), sky: { setLook() {} },
    renderer: {
      getRenderTarget: () => target, getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
      setRenderTarget(next) { target = next; }, compileAsync: async () => {}, render() {},
    },
  });
  return { game, previous, getTarget: () => target };
}

test('temporary warm owners release real rig textures on failure/retry and cannot resurrect arms from a late continuation', async t => {
  mockImages(t); t.mock.method(console, 'warn', () => {});
  const originalGunFor = ViewModel.prototype._gunFor, originalFpFrom = ViewModel.prototype._fpFrom;
  let owner, lateCalls = 0;
  t.mock.method(ViewModel.prototype, '_gunFor', function (...args) { owner = this; return originalGunFor.apply(this, args); });
  t.mock.method(ViewModel.prototype, '_fpFrom', function (g) { lateCalls++; return originalFpFrom.call(this, g); });
  const { game, previous, getTarget } = warmFixture();
  const live = ownClonedSkeletons(Assets.clone('/models/characters/raider_a.glb')); game.scene.add(live);
  const liveRecords = upload(skeletons(live));
  for (const failure of ['environment', 'render', null]) {
    const group = new THREE.Group(), cleanup = [];
    group.add(new CrewView('hero_driver', { role: 'driver' }).root);
    group.add(ViewModel.warmObject(dispose => cleanup.push(dispose)));
    assert.equal(cleanup.length, 1);
    const records = upload(skeletons(group));
    owner._tryFpArms(); // cached asset promise completes in a later microtask
    game.sky.setLook = () => { if (failure === 'environment') throw new Error('environment unavailable'); };
    game.renderer.render = () => { if (failure === 'render') throw new Error('upload failed'); };
    const pending = game._warmScene(group, cleanup);
    if (failure === 'environment') await assert.rejects(pending, /environment unavailable/);
    else await pending;
    await flush();
    assert.equal(cleanup.length, 0); assert.equal(owner.disposed, true); assert.equal(group.parent, null);
    assertFreed(records, failure || 'success'); assert.equal(disposeOwnedSkeletonsIn(group), 0);
    assert.equal(getTarget(), previous);
    // In the async compile cases the continuation can validly run before the
    // cleanup. A continuation queued after disposal must never replace the rig.
    const callsBefore = lateCalls; owner._tryFpArms(); await flush(); assert.equal(lateCalls, callsBefore);
    for (const rec of liveRecords) { assert.equal(rec.disposed, 0); assert.equal(rec.skeleton.boneTexture, rec.texture); }
  }
  disposeOwnedSkeletons(live);
});

test('successful warm-up transfers five legacy and five optic material owners to Game and keeps runtime uniforms independent', async t => {
  mockImages(t);
  let owner; const originalGunFor = ViewModel.prototype._gunFor;
  t.mock.method(ViewModel.prototype, '_gunFor', function (...args) { owner = this; return originalGunFor.apply(this, args); });
  const { game } = warmFixture(), cleanup = []; game._warmMaterials = new Set();
  const group = ViewModel.warmObject(dispose => cleanup.push(dispose), game._warmMaterials);
  const materials = resourceEvents(warmMaterialResources(owner)), geometry = resourceEvents(owner._ownedGeometries);
  assert.equal(owner._ownedMaterials.size, 5); assert.equal(materials.length, 10); assert.equal(geometry.length, 4);
  assert.equal([...owner.guns.values()].filter(gun => gun.optic).length, 5);
  const warmFlash = owner.flashStar.material;
  await game._warmScene(group, cleanup);
  assert.equal(owner.disposed, true); assert.equal(game._warmMaterials.size, 10);
  assertResourceEvents(materials, 0); assertResourceEvents(geometry, 1);
  const runtime = new ViewModel(), runtimeMaterials = resourceEvents(runtime._ownedMaterials);
  assert.notEqual(runtime.flashStar.material, warmFlash);
  assert.notEqual(runtime.flashStar.material.uniforms.uI, warmFlash.uniforms.uI);
  runtime.flashStar.material.uniforms.uI.value = 2;
  assert.equal(warmFlash.uniforms.uI.value, 0);
  runtime.dispose(); runtime.dispose(); assertResourceEvents(runtimeMaterials, 1); assertResourceEvents(materials, 0);
  for (const material of game._warmMaterials) material.dispose(); game._warmMaterials.clear();
  assertResourceEvents(materials, 1);
  for (const records of [materials, geometry, runtimeMaterials]) stopResourceEvents(records);
});

test('failed prewarm frees its retained material owners before retry without disposing shared resources', async t => {
  mockImages(t);
  const { game } = warmFixture(), cleanup = []; game._warmMaterials = new Set();
  let owner; const originalGunFor = ViewModel.prototype._gunFor;
  t.mock.method(ViewModel.prototype, '_gunFor', function (...args) { owner = this; return originalGunFor.apply(this, args); });
  const group = ViewModel.warmObject(dispose => cleanup.push(dispose), game._warmMaterials);
  const materials = resourceEvents(warmMaterialResources(owner)); assert.equal(materials.length, 10);
  const shared = resourceEvents([owner.arms.geometry, owner.arms.material, owner.shell.children[0].material, owner.flashStar.material.uniforms.map.value]);
  game.sky.setLook = () => { throw new Error('warm environment failed'); };
  game._prewarmAssets = () => game._warmScene(group, cleanup);
  await assert.rejects(game.prewarm(), /warm environment failed/);
  assert.equal(game._warmPromise, null); assert.equal(game._warmMaterials.size, 0);
  assertResourceEvents(materials, 1); assertResourceEvents(shared, 0);
  // A successful retry can own a fresh bounded set, rather than accumulating
  // the failed instance's shaders in the successful boot cache.
  const retryCleanup = [], retry = ViewModel.warmObject(dispose => retryCleanup.push(dispose), game._warmMaterials);
  const retryMaterials = resourceEvents(warmMaterialResources(owner)); assert.equal(retryMaterials.length, 10);
  game.sky.setLook = () => {}; game._prewarmAssets = () => game._warmScene(retry, retryCleanup);
  await game.prewarm(); assert.equal(game._warmMaterials.size, 10);
  assertResourceEvents(retryMaterials, 0); assertResourceEvents(materials, 1); assertResourceEvents(shared, 0);
  for (const material of game._warmMaterials) material.dispose(); game._warmMaterials.clear();
  for (const records of [materials, retryMaterials, shared]) stopResourceEvents(records);
});
