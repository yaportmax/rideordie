import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeaponAssets, THREE, Assets } from './helpers/weapon-assets.mjs';
import { GarageScene } from '../src/game/garage_scene.js';
import { WeaponView } from '../src/view/weapon_view.js';
import { REFLEX_GUNS, weaponOpticKey } from '../src/data/weapon_optics.js';

// Actual shipped weapons and the production loader/rigid-merge path. This
// fixture invokes the real bench lifecycle without constructing a renderer,
// menu render targets, garage environment or browser image decoder.
await loadWeaponAssets();

const meshes = root => { const result = []; root.traverse(node => { if (node.isMesh) result.push(node); }); return result; };
const materials = mesh => [].concat(mesh.material);
const opaque = mesh => materials(mesh).every(material => !material.transparent && !material.isShaderMaterial);

function watch(resources) {
  return [...new Set(resources)].map(resource => {
    const record = { resource, count: 0 };
    record.listener = () => record.count++;
    resource.addEventListener('dispose', record.listener);
    return record;
  });
}
const unwatch = records => { for (const record of records) record.resource.removeEventListener('dispose', record.listener); };
const disposed = (records, expected, label) => { for (const record of records) assert.equal(record.count, expected, label); };

function assertBenchPolicy(garage, id, opticId) {
  const bench = garage.benchWeapon, gun = bench.view;
  assert.equal(garage.benchId, weaponOpticKey(id, opticId));
  assert.equal(bench.root.parent, garage.scene);
  assert.equal(gun.root.parent, bench.root);
  assert.equal(gun.id, id); assert.equal(gun.opticId, opticId);
  assert.ok(gun.model, 'exercise the actual firearm GLB, never a placeholder');

  const all = meshes(gun.root), casters = all.filter(mesh => mesh.castShadow);
  assert.equal(casters.length, 1, `${id}/${opticId}: retain one firearm body caster`);
  assert.ok(opaque(casters[0]), `${id}/${opticId}: only an opaque firearm mesh casts`);
  const sourceGeometry = new Set(meshes(Assets.template(`/models/weapons/${id}.glb`)).map(mesh => mesh.geometry));
  assert.ok(sourceGeometry.has(casters[0].geometry), 'the caster belongs to the shipped firearm, not an attachment');
  assert.ok(all.every(mesh => !mesh.receiveShadow), `${id}/${opticId}: bench placement preserves the firearm receiver policy`);

  // The loader can merge authored body primitives and change their names.
  // Compare shared source geometry with an untouched actual WeaponView rather
  // than duplicating its body-selection algorithm or reapplying it to the bench.
  const reference = new WeaponView(id, { opticId });
  try {
    const expected = meshes(reference.root).filter(mesh => mesh.castShadow);
    assert.equal(expected.length, 1);
    assert.equal(casters[0].geometry, expected[0].geometry, 'garage setup preserves the constructor-selected firearm body');
  } finally { reference.dispose(); }

  if (opticId === 'wide_reflex') {
    assert.ok(gun.optic, 'the real mounted optic is present');
    for (const [name, mesh] of Object.entries({ housing: gun.optic.housing, lens: gun.optic.glass, reticle: gun.optic.reticle })) {
      assert.equal(mesh.castShadow, false, `${id}: ${name} cannot become a shadow caster on the bench`);
      assert.equal(mesh.receiveShadow, false, `${id}: ${name} retains its no-receiver policy`);
    }
    assert.equal(gun.optic.glass.material.transparent, true);
    assert.equal(gun.optic.reticle.material.isShaderMaterial, true);
  } else assert.equal(gun.optic, null);

  const plinth = bench.root.children.find(mesh => mesh.isMesh && mesh.geometry.type === 'CylinderGeometry');
  assert.ok(plinth, 'the actual generated display plinth is retained');
  assert.equal(plinth.receiveShadow, true, 'the display surface still receives the firearm shadow');
  return bench;
}

test('real garage bench creation, standard/reflex replacement and removal preserve firearm shadow and resource ownership', () => {
  const garage = Object.assign(Object.create(GarageScene.prototype), {
    scene: new THREE.Scene(), ringMat: new THREE.MeshStandardMaterial(), benchWeapon: null,
  });
  const templateGeometry = REFLEX_GUNS.flatMap(id => meshes(Assets.template(`/models/weapons/${id}.glb`)).map(mesh => mesh.geometry));
  const sourceRecords = watch(templateGeometry), pending = [];
  try {
    for (const id of REFLEX_GUNS) {
      garage._buildBench(id, 'standard');
      const standard = assertBenchPolicy(garage, id, 'standard');
      const standardDisplay = watch(standard.root.children.filter(node => node.isMesh).map(node => node.geometry));
      pending.push(...standardDisplay);

      garage._buildBench(id, 'wide_reflex');
      assert.equal(standard.view.disposed, true, 'replacement disposes the prior WeaponView');
      assert.equal(standard.root.parent, null); assert.equal(standard.view.root.parent, null);
      disposed(standardDisplay, 1, 'replacement releases prior plinth/ring geometry exactly once');
      const reflex = assertBenchPolicy(garage, id, 'wide_reflex');
      const owned = watch([reflex.view.optic.reticle.material]);
      const shared = watch([reflex.view.optic.housing.geometry, reflex.view.optic.housing.material,
        reflex.view.optic.glass.geometry, reflex.view.optic.glass.material]);
      const reflexDisplay = watch(reflex.root.children.filter(node => node.isMesh).map(node => node.geometry));
      pending.push(...owned, ...shared, ...reflexDisplay);

      // Standard sight preview itself rebuilds the bench. Ownership/equip may
      // be confirmed later, so observe disposal at this actual lifecycle seam.
      garage._buildBench(id, 'standard');
      assert.equal(reflex.view.disposed, true); assert.equal(reflex.root.parent, null);
      assert.equal(reflex.view.root.parent, null); assert.equal(reflex.view.optic.root.parent, null);
      disposed(owned, 1, 'restoring standard releases the owned optic reticle material once');
      disposed(shared, 0, 'restoring standard retains shared housing/lens buffers and materials');
      disposed(reflexDisplay, 1, 'restoring standard releases old display geometry once');
      const restored = assertBenchPolicy(garage, id, 'standard');
      const restoredDisplay = watch(restored.root.children.filter(node => node.isMesh).map(node => node.geometry));
      pending.push(...restoredDisplay);
      assert.equal(garage.scene.children.length, 1, 'each replacement leaves only the current bench holder');

      garage._buildBench(null);
      assert.equal(restored.view.disposed, true); assert.equal(restored.root.parent, null);
      assert.equal(restored.view.root.parent, null); assert.equal(garage.benchWeapon, null);
      assert.equal(garage.scene.children.length, 0, 'removal leaves no abandoned display holder');
      disposed(restoredDisplay, 1, 'removal releases the final display geometry once');
      disposed(owned, 1, 'later removal cannot dispose an already retired reticle again');
      disposed(shared, 0, 'later removal cannot release shared optic resources');
      disposed(sourceRecords, 0, 'bench retirement never disposes reusable firearm GLB geometry');
    }
  } finally {
    garage._buildBench(null);
    unwatch(pending); unwatch(sourceRecords);
    garage.ringMat.dispose(); garage._plinthMat?.dispose();
  }
});
