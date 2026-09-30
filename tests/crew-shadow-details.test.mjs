import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CrewView } from '../src/view/crew_view.js';

function fixture(role = 'gunner') {
  const root = new THREE.Group(), body = new THREE.Group(), model = new THREE.Group(), gun = new THREE.Group();
  root.add(body); body.add(model, gun);
  const mesh = (name, visible = true, caster = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    m.name = name; m.visible = visible; m.castShadow = caster; return m;
  };
  const hair = mesh('hair'), eyes = mesh('eyes'), authoredHidden = mesh('hair_cards', false);
  const castingDetail = mesh('hair_caster', true, true), torso = mesh('body', true, true), fpArms = mesh('hair_fp_arms'); fpArms.userData.fpArms = true;
  model.add(hair, eyes, authoredHidden, castingDetail, torso, fpArms);
  const weaponRoot = new THREE.Group(), weaponMesh = mesh('hair_named_weapon'); weaponRoot.add(weaponMesh); gun.add(weaponRoot);
  const weapon = { root: weaponRoot, sockets: {}, dispose: () => weaponRoot.removeFromParent() };
  const crew = Object.assign(Object.create(CrewView.prototype), { root, body, model, gun, role, hero: true, weapon, weaponId: 'rifle',
    deadT: -1, alive: true, bones: null, car: null, mixer: null, _cutPrepared: true, _driver: () => {}, _mount: CrewView.prototype._mount });
  return { crew, hair, eyes, authoredHidden, castingDetail, torso, fpArms, weaponMesh };
}

test('local shadow-only mode hides only noncasting model hair/eyes and preserves visibility across repeated toggles', () => {
  const f = fixture(), meshes = [f.hair, f.eyes, f.authoredHidden, f.castingDetail, f.torso, f.fpArms, f.weaponMesh];
  const materials = meshes.map((m) => m.material);
  for (let i = 0; i < 3; i++) {
    f.crew._setShadowOnly(true); f.crew._setShadowOnly(true);
    assert.deepEqual(meshes.map((m) => m.visible), [false, false, false, true, true, true, true]);
    assert.equal(f.torso.castShadow, true); assert.equal(f.castingDetail.castShadow, true);
    assert.equal(f.torso.material.colorWrite, false); assert.equal(f.torso.material.depthWrite, false);
    assert.equal(f.fpArms.material, materials[5]); assert.equal(f.weaponMesh.material.colorWrite, false);
    f.crew._setShadowOnly(false); f.crew._setShadowOnly(false);
    assert.deepEqual(meshes.map((m) => m.visible), [true, true, false, true, true, true, true]);
    meshes.forEach((m, j) => assert.equal(m.material, materials[j]));
  }
  // Preserve a visibility choice made in normal mode on the next transition.
  f.hair.visible = false; f.crew._setShadowOnly(true); f.crew._setShadowOnly(false); assert.equal(f.hair.visible, false);
});

test('weapon swaps reapply shadow materials without replacing the hidden-detail visibility snapshot', () => {
  const f = fixture(); f.crew._setShadowOnly(true);
  f.crew.setWeapon('pistol'); assert.equal(f.crew._shadowOnlyOn, undefined);
  const weaponMeshes = []; f.crew.weapon.root.traverse((o) => { if (o.isMesh) weaponMeshes.push(o); });
  const materials = weaponMeshes.map((o) => o.material);
  f.crew._setShadowOnly(true);
  assert.equal(f.hair.visible, false); assert.equal(f.eyes.visible, false);
  weaponMeshes.forEach((o) => assert.equal(o.material.colorWrite, false));
  f.crew._setShadowOnly(false);
  assert.equal(f.hair.visible, true); assert.equal(f.eyes.visible, true); assert.equal(f.authoredHidden.visible, false);
  weaponMeshes.forEach((o, i) => assert.equal(o.material, materials[i]));
});

test('external and cinematic driver updates restore detail before returning through the driver path', () => {
  const f = fixture('driver'), s = { alive: true, local: { firstPerson: false, cockpit: { active: true } } };
  f.crew._setShadowOnly(true); f.crew.update(1 / 60, s);
  assert.equal(f.hair.visible, true); assert.equal(f.eyes.visible, true); assert.equal(f.authoredHidden.visible, false);
  f.crew._setShadowOnly(true); s.local.firstPerson = true;
  const originalWindow = globalThis.window;
  try {
    globalThis.window = { __run: { cinematic: true } };
    f.crew.update(1 / 60, s);
    assert.equal(f.crew._shadowOnlyOn, false); assert.equal(f.hair.visible, true); assert.equal(f.eyes.visible, true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
  }
});

test('death restores detail even without first-person helpers and retains helper/material restoration', () => {
  const f = fixture('driver'); f.crew._setShadowOnly(true); f.crew.die();
  assert.equal(f.hair.visible, true); assert.equal(f.eyes.visible, true); assert.equal(f.authoredHidden.visible, false);
  assert.equal(f.torso.material, f.torso.userData.mat0); assert.equal(f.crew.body.visible, true);
  f.crew.die(); assert.equal(f.hair.visible, true);
  const g = fixture('driver'), visibility = [];
  g.crew.vm = { setVisible: (v) => visibility.push(['vm', v]) }; g.crew.drvArms = { setVisible: (v) => visibility.push(['arms', v]) };
  g.crew.useVm = g.crew.useArms = true; g.crew._setShadowOnly(true); g.crew.die();
  assert.deepEqual(visibility, [['vm', false], ['arms', false]]); assert.equal(g.crew.useVm, false); assert.equal(g.crew.useArms, false);
  assert.equal(g.hair.visible, true); assert.equal(g.eyes.visible, true);
});
