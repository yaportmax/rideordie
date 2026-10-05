// WORK-authored actual-source checks. Not executed by the child author.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Assets from '../src/core/assets.js';
import { loadWeaponAssets, THREE } from './helpers/weapon-assets.mjs';
import { configureFactorySights, FACTORY_RIFLE_IRONS } from '../src/view/factory_sights.js';
import { attachCombatScope, combatScopeHousingGeometry, COMBAT_SCOPE_MOUNTS, COMBAT_SCOPE_WINDOW } from '../src/view/combat_scope.js';
import { configureReflexProjection } from '../src/view/reflex_optic.js';

await loadWeaponAssets();

function rawWeapon(id, opticId) {
  const root = new THREE.Group(), model = Assets.clone(`/models/weapons/${id}.glb`), nodes = {};
  assert.ok(model, `${id}: actual prepared asset exists`); root.add(model);
  model.traverse(node => { if (node.name) nodes[node.name] = node; });
  return { id, opticId, root, model, nodes, _ownedResources: [] };
}
function solids(weapon) {
  weapon.root.updateWorldMatrix(true, true);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), proxies = [];
  weapon.root.traverse(mesh => {
    if (!mesh.isMesh || mesh.material.isShaderMaterial || /glass|lens/.test(mesh.material.name || '')) return;
    for (let node = mesh; node; node = node.parent) if (!node.visible) return;
    const proxy = new THREE.Mesh(mesh.geometry, material); proxy.matrixWorld.copy(mesh.matrixWorld); proxies.push(proxy);
  });
  return { material, hits(origin, direction = new THREE.Vector3(0, 0, 1), far = 2) {
    return new THREE.Raycaster(origin, direction, 0, far).intersectObjects(proxies, false);
  } };
}

test('actual annular housing constructor merges mixed primitive layouts into finite nonempty triangles', () => {
  const geometry = combatScopeHousingGeometry(.034), position = geometry.attributes.position;
  assert.ok(geometry.isBufferGeometry); assert.ok(position.count > 200);
  assert.equal(geometry.index, null); assert.equal(position.count % 3, 0);
  assert.ok([...position.array].every(Number.isFinite)); assert.equal(geometry.groups.length, 0);
  assert.ok(geometry.boundingBox && geometry.boundingSphere);
  assert.equal(combatScopeHousingGeometry(.034), geometry, 'immutable bounded cache identity');
});

test('free rifle irons hide only the isolated baked optic and leave real receiver/template bytes intact', () => {
  const weapon = rawWeapon('rifle', 'standard'), sibling = rawWeapon('rifle', 'standard');
  const geometryBytes = new Map(); weapon.model.traverse(mesh => {
    if (mesh.isMesh) geometryBytes.set(mesh.geometry, mesh.geometry.attributes.position.array.slice());
  });
  const original = weapon.nodes.optic, iron = configureFactorySights(weapon);
  assert.ok(iron); assert.equal(original.visible, false); assert.equal(sibling.nodes.optic.visible, true);
  assert.equal(iron.replaced, original); assert.equal(iron.root.parent, weapon.root);
  assert.equal(iron.tune.reticle, null); assert.equal(iron.tune.relief, .12);
  assert.deepEqual(iron.aim.position.toArray(), [...FACTORY_RIFLE_IRONS.eye]);
  for (const [geometry, before] of geometryBytes) assert.deepEqual(geometry.attributes.position.array, before);
  assert.equal(configureFactorySights(rawWeapon('rifle', 'wide_reflex')), null);
  assert.equal(configureFactorySights(rawWeapon('pistol', 'standard')), null);
  iron.dispose(); iron.dispose(); assert.equal(original.visible, true); assert.equal(iron.root.parent, null);
});

test('real factory iron picture has a broad clear target window above its retained physical front blade', () => {
  const weapon = rawWeapon('rifle', 'standard'), iron = configureFactorySights(weapon), rays = solids(weapon);
  try {
    for (const x of [-.004, -.002, 0, .002, .004]) for (const y of [.001, .002, .003]) {
      assert.equal(rays.hits(new THREE.Vector3(x, FACTORY_RIFLE_IRONS.axisY + y, -.290)).length, 0,
        `${x},${y}: real iron target window remains clear`);
    }
    assert.ok(rays.hits(new THREE.Vector3(0, FACTORY_RIFLE_IRONS.axisY - .0015, .380), undefined, .040).length,
      'the actual front blade remains solid below the aiming line');
    assert.ok(rays.hits(new THREE.Vector3(.010, FACTORY_RIFLE_IRONS.axisY, -.130), undefined, .050).length,
      'protective rear ears remain physical');
  } finally { rays.material.dispose(); iron.dispose(); }
});

for (const id of ['rifle', 'sniper']) test(`${id} paid combat scope clears full-gun rays and preserves an annular physical rim`, () => {
  const weapon = rawWeapon(id, 'combat_3x'), optic = attachCombatScope(weapon), rays = solids(weapon);
  try {
    assert.ok(optic); assert.equal(optic.replaced.visible, false); assert.equal(optic.mount.adsFov, 24);
    const aim = optic.aim.getWorldPosition(new THREE.Vector3());
    const expected = new THREE.Vector3(...COMBAT_SCOPE_MOUNTS[id].rootPosition).add(new THREE.Vector3(0, optic.mount.axisY, COMBAT_SCOPE_WINDOW.rearZ));
    assert.ok(aim.distanceTo(expected) < 1e-8);
    for (const dx of [-.010, -.005, 0, .005, .010]) for (const dy of [-.009, 0, .009]) {
      assert.equal(rays.hits(new THREE.Vector3(aim.x + dx, aim.y + dy, aim.z - optic.mount.relief)).length, 0,
        `${id} ${dx},${dy}: real optical aperture has no opaque cap or body blocker`);
    }
    assert.ok(rays.hits(new THREE.Vector3(aim.x + .0195, aim.y, aim.z - .040), undefined, .20).length,
      'annular protective tube retains real opaque walls/end rim');
    for (const glass of [optic.glass, optic.frontGlass]) {
      assert.equal(glass.material.transparent, true); assert.equal(glass.material.depthWrite, false);
    }
    const projection = { value: new THREE.Matrix4() }; configureReflexProjection(optic, projection, .0002);
    assert.equal(optic.reticle.material.uniforms.vmProj, projection);
    assert.equal(optic.reticle.material.depthTest, true); assert.equal(optic.reticle.material.depthWrite, false);
  } finally { rays.material.dispose(); optic.dispose(); }
});

test('paid scope siblings share only immutable resources and dispose owned reticle exactly once', () => {
  const first = attachCombatScope(rawWeapon('rifle', 'combat_3x')), second = attachCombatScope(rawWeapon('rifle', 'combat_3x'));
  assert.equal(first.housing.geometry, second.housing.geometry); assert.equal(first.glass.geometry, second.glass.geometry);
  assert.equal(first.housing.material, second.housing.material); assert.notEqual(first.reticle.material, second.reticle.material);
  let privateDisposals = 0, sharedDisposals = 0;
  first.reticle.material.addEventListener('dispose', () => privateDisposals++);
  for (const resource of [second.housing.geometry, second.housing.material, second.glass.geometry, second.glass.material,
    second.reticle.geometry]) resource.addEventListener('dispose', () => sharedDisposals++);
  first.dispose(); first.dispose(); assert.equal(privateDisposals, 1); assert.equal(sharedDisposals, 0);
  assert.ok(second.root.parent); second.dispose();
});
