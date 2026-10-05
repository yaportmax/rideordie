import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeaponAssets, THREE } from './helpers/weapon-assets.mjs';
import { WeaponView } from '../src/view/weapon_view.js';
import { ViewModel, VMU } from '../src/view/viewmodel.js';
import { REFLEX_GUNS, REFLEX_WINDOW, REFLEX_MOUNTS } from '../src/data/weapon_optics.js';
import { WEAPONS } from '../src/data/weapons.js';

await loadWeaponAssets();
function solids(gun) {
  gun.root.updateMatrixWorld(true); const proxies = [], material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  gun.root.traverse(mesh => {
    if (!mesh.isMesh || mesh.material.isShaderMaterial || /glass|lens/.test(mesh.material.name || '')) return;
    for (let parent = mesh; parent; parent = parent.parent) if (!parent.visible) return;
    const proxy = new THREE.Mesh(mesh.geometry, material); proxy.matrixWorld.copy(mesh.matrixWorld); proxies.push(proxy);
  });
  return { proxies, material };
}

test('all five mounted reflex windows clear fifteen real full-gun rays and retain solid outer housing', () => {
  for (const id of REFLEX_GUNS) {
    const gun = new WeaponView(id, { opticId: 'wide_reflex' }), { proxies, material } = solids(gun);
    try {
      const center = gun.optic.aim.getWorldPosition(new THREE.Vector3());
      for (const dx of [-.013, -.006, 0, .006, .013]) for (const dy of [-.011, 0, .011]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(center.x + dx, center.y + dy, center.z - .10), new THREE.Vector3(0, 0, 1), 0, 2);
        assert.equal(ray.intersectObjects(proxies, false).length, 0, `${id}: useful window remains open`);
      }
      assert.ok(new THREE.Raycaster(new THREE.Vector3(center.x + .0185, center.y, center.z - .10), new THREE.Vector3(0, 0, 1), 0, .2).intersectObjects(proxies, false).length, `${id}: protective frame stays solid`);
    } finally { material.dispose(); gun.dispose(); }
  }
});

test('pistol firing/racking and LMG reload move their actual optics with authored mechanisms', () => {
  for (const id of REFLEX_GUNS) {
    const gun = new WeaponView(id, { opticId: 'wide_reflex' }), optic = gun.optic, mount = REFLEX_MOUNTS[id];
    assert.equal(optic.root.parent, gun.nodes[mount.parent]); gun.root.updateMatrixWorld(true);
    const expected = new THREE.Vector3(...mount.rootPosition).add(new THREE.Vector3(0, REFLEX_WINDOW.centerY + (mount.riserHeight || 0), REFLEX_WINDOW.lensZ));
    assert.ok(gun.root.worldToLocal(optic.aim.getWorldPosition(new THREE.Vector3())).distanceTo(expected) < 1e-7);
    const before = optic.root.matrixWorld.clone();
    if (id === 'pistol') { gun.fire(5); gun.update(.015); }
    else if (id === 'lmg') gun.update(0, { reloading: true, reload01: .5 });
    gun.root.updateMatrixWorld(true);
    if (id === 'pistol' || id === 'lmg') assert.notDeepEqual(optic.root.matrixWorld.elements, before.elements);
    if (id === 'pistol') { gun.update(.2, { parts: { rack: 1 } }); gun.root.updateMatrixWorld(true); assert.notDeepEqual(optic.root.matrixWorld.elements, before.elements); }
    gun.dispose();
  }
});

test('AR factory irons and paid reflex each hide their own baked optic without hiding receiver or changing a sibling', () => {
  const standard = new WeaponView('rifle'), reflex = new WeaponView('rifle', { opticId: 'wide_reflex' });
  const old = reflex.nodes.optic; let triangles = 0; old.traverse(mesh => { if (mesh.isMesh) triangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3; });
  assert.equal(triangles, 2640); assert.equal(old.visible, false); assert.equal(standard.nodes.optic.visible, false);
  assert.ok(standard.factorySight); assert.equal(standard.optic, null); assert.equal(reflex.factorySight, null);
  assert.ok(standard.factorySight.root.parent); assert.equal(standard.factorySight.replaced, standard.nodes.optic);
  assert.notEqual(old, standard.nodes.optic, 'each model owns its visibility state');
  const receiver = []; reflex.model.traverse(mesh => { if (mesh.isMesh && mesh !== reflex.optic.reticle && !mesh.name.startsWith('optic')) receiver.push(mesh); });
  assert.ok(receiver.some(mesh => mesh.visible)); reflex.dispose(); assert.equal(old.visible, true);
  assert.equal(standard.nodes.optic.visible, false, 'disposing paid optic leaves live factory irons intact');
  standard.dispose(); assert.equal(standard.nodes.optic.visible, true, 'factory disposal restores only its own authored optic');
});

function vmFixture(t) {
  const old = globalThis.window; globalThis.window = {};
  t.after(() => { if (old === undefined) delete globalThis.window; else globalThis.window = old; });
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  const vm = new ViewModel(), camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 200);
  const gunner = { slots: ['pistol', 'smg', 'rifle'], optics: Object.fromEntries(REFLEX_GUNS.map(id => [id, 'wide_reflex'])),
    weaponId: 'pistol', weapon: { ...WEAPONS.pistol, opticId: 'wide_reflex' }, shots: 0, pos: new THREE.Vector3(), magNow: 12,
    trigger: false, swapT: 0, throwing: 0, reloading: false, reloadT: 0 };
  const state = { local: { camera, gunner, adsK: 0, eye: new THREE.Vector3() }, vel: new THREE.Vector3() };
  vm.update(0, state, true); t.after(() => vm.dispose()); return { vm, camera, gunner, state };
}

test('reflex VM uses its real mounted point, clear glass and clipped depth-tested reticle in ADS and restores hip/reload', t => {
  const { vm, gunner, state } = vmFixture(t); assert.equal(vm.guns.size, 3, 'only equipped three-slot pairs are built');
  for (const id of REFLEX_GUNS) {
    gunner.weaponId = id; gunner.weapon = { ...WEAPONS[id], opticId: 'wide_reflex' }; gunner.magNow = gunner.weapon.mag;
    state.local.adsK = 1; vm.t = 0; vm.update(0, state, true);
    const gun = vm.gun, optic = gun.optic;
    assert.deepEqual(gun.tune.adsSight, gun.loc.optic_sight.p.toArray()); assert.equal(gun.tune.relief, REFLEX_MOUNTS[id].relief);
    assert.equal(optic.reticle.visible, true); assert.equal(optic.reticle.material.depthTest, true); assert.equal(optic.reticle.material.depthWrite, false);
    assert.equal(optic.reticle.material.uniforms.vmProj, VMU.vmProj); assert.equal(vm.reticle.visible, false);
    assert.ok(optic.glass.material.transparent); assert.equal(optic.glass.material.depthWrite, false); assert.ok(optic.glass.material.opacity <= .035);
    const center = optic.aim.getWorldPosition(new THREE.Vector3()).applyMatrix4(state.local.camera.matrixWorldInverse).applyMatrix4(VMU.vmProj.value);
    assert.ok(Math.abs(center.x) < .01 && Math.abs(center.y) < .015, `${id}: authored optic point aligns with actual VM projection`);
    state.local.adsK = 0; gunner.reloading = true; vm.update(0, state, true); assert.equal(optic.reticle.visible, false);
    for (const cut of gun.adsCut) assert.equal(cut.mesh.geometry, cut.full); gunner.reloading = false;
  }
});

test('attachment disposal releases only its own reticle material once and preserves shared sibling resources', () => {
  const first = new WeaponView('smg', { opticId: 'wide_reflex' }), sibling = new WeaponView('smg', { opticId: 'wide_reflex' });
  assert.equal(first.optic.housing.geometry, sibling.optic.housing.geometry); assert.equal(first.optic.glass.geometry, sibling.optic.glass.geometry);
  assert.equal(first.optic.housing.material, sibling.optic.housing.material); assert.notEqual(first.optic.reticle.material, sibling.optic.reticle.material);
  let reticleDisposed = 0, sharedDisposed = 0; first.optic.reticle.material.addEventListener('dispose', () => reticleDisposed++);
  for (const resource of [sibling.optic.housing.geometry, sibling.optic.housing.material, sibling.optic.glass.geometry, sibling.optic.glass.material]) resource.addEventListener('dispose', () => sharedDisposed++);
  first.dispose(); first.dispose(); assert.equal(reticleDisposed, 1); assert.equal(sharedDisposed, 0); assert.ok(sibling.optic.root.parent); sibling.dispose();
});

for (const id of REFLEX_GUNS) for (const ads of [0, 1]) {
  test(`${id} reflex ${ads ? 'ADS' : 'hip'}: hands retain reload contact and muzzle FX matches the actual rendered barrel`, t => {
    const { vm, camera, gunner, state } = vmFixture(t);
    gunner.weaponId = id; gunner.weapon = { ...WEAPONS[id], opticId: 'wide_reflex' }; gunner.magNow = 0;
    state.local.adsK = ads; vm.update(0, state, true); gunner.reloading = true; vm.relAmt = 1;
    let maxL = 0, maxR = 0;
    for (let frame = 0; frame <= 200; frame++) {
      gunner.reloadT = frame / 200 * gunner.weapon.reload; vm.update(0, state, true);
      maxL = Math.max(maxL, vm.B.socket_hand_L.getWorldPosition(new THREE.Vector3()).distanceTo(vm._aL.p));
      maxR = Math.max(maxR, vm.B.socket_hand_R.getWorldPosition(new THREE.Vector3()).distanceTo(vm._aR.p));
      for (const bone of vm.armBones) assert.ok([...bone.position.toArray(), ...bone.quaternion.toArray(), ...bone.matrixWorld.elements].every(Number.isFinite));
      const muzzle = new THREE.Vector3(); assert.equal(vm.muzzleWorld(muzzle), true);
      const expected = vm.gun.sockets.muzzle.getWorldPosition(new THREE.Vector3()).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(VMU.vmProj.value);
      const projected = muzzle.project(camera);
      assert.ok(Math.abs(projected.x - expected.x) < 1e-8 && Math.abs(projected.y - expected.y) < 1e-8, `reload ${frame}: apparent muzzle and rendered socket match`);
    }
    assert.ok(maxL < .04, `left hand remains within40mm of its real choreography contact (${maxL * 1000}mm)`);
    assert.ok(maxR < .04, `right hand remains within40mm of its real choreography contact (${maxR * 1000}mm)`);
  });
}

test('prewarm transfers five reflex and two combat-scope shader owners and leaves runtime materials independently disposable', t => {
  const { vm } = vmFixture(t); const cleanup = [], retained = new Set();
  const group = WeaponView.warmReflexObjects(fn => cleanup.push(fn), retained);
  assert.equal(group.children.length, 7); let disposals = 0;
  assert.equal(group.children.filter(root => root.getObjectByName('optic_open_reflex')).length, 5);
  assert.equal(group.children.filter(root => root.getObjectByName('optic_combat_3x')).length, 2);
  for (const root of group.children) {
    const reticles = []; root.traverse(mesh => { if (mesh.userData.opticReticle) reticles.push(mesh); });
    assert.equal(reticles.length, 1, 'each world optic has one exact shader owner');
    assert.equal(reticles[0].material.uniforms.vmProj, undefined, 'world prewarm must retain its unpatched projection program');
    reticles[0].material.addEventListener('dispose', () => disposals++);
  }
  for (const finish of cleanup) finish();
  assert.equal(group.children.length, 0); assert.equal(retained.size, 7); assert.equal(disposals, 0);
  const runtime = vm._gunFor('smg', 'wide_reflex'); assert.equal(retained.has(runtime.optic.reticle.material), false);
  const scopedRuntime = vm._gunFor('rifle', 'combat_3x'); assert.equal(retained.has(scopedRuntime.optic.reticle.material), false);
  for (const material of retained) material.dispose(); assert.equal(disposals, 7);
});
