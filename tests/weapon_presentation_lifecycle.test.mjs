// WORK-authored actual-source checks. Root runs these after composing source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWeaponAssets, THREE } from './helpers/weapon-assets.mjs';
import { WEAPONS } from '../src/data/weapons.js';
import { usesFullscreenWeaponScope } from '../src/data/weapon_visual_config.js';
import { ViewModel } from '../src/view/viewmodel.js';
import { WeaponView } from '../src/view/weapon_view.js';
import { canCutViewmodelMesh, splitIslands } from '../src/view/fp_cutaway.js';
import { WeaponLaser, canPresentWeaponLaser } from '../src/view/weapon_laser.js';

await loadWeaponAssets();

test('physical combat 3x keeps the VM presentation while factory specialist scopes retain fullscreen presentation', () => {
  for (const id of ['rifle', 'sniper']) {
    assert.equal(usesFullscreenWeaponScope({ ...WEAPONS[id], scope: true, opticId: 'combat_3x' }), false);
  }
  for (const id of ['sniper', 'rpg']) {
    assert.equal(usesFullscreenWeaponScope({ ...WEAPONS[id], opticId: 'standard' }), true);
    assert.equal(usesFullscreenWeaponScope(WEAPONS[id]), true, 'legacy missing opticId is preserved');
  }
  for (const id of ['pistol', 'revolver', 'smg', 'shotgun', 'rifle', 'lmg', 'minigun']) {
    assert.equal(usesFullscreenWeaponScope({ ...WEAPONS[id], opticId: 'standard' }), false);
  }
  assert.equal(usesFullscreenWeaponScope(undefined), false);
});

function fixture(t, id, opticId = 'standard', attachments = []) {
  const previousWindow = globalThis.window; globalThis.window = {};
  t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  const vm = new ViewModel(), camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 200);
  const weapon = { ...WEAPONS[id], opticId, ...(opticId === 'combat_3x' ? { scope: true, scopeZoom: 3 } : {}) };
  const gunner = { weaponId: id, weapon, optics: { [id]: opticId }, attachments: { [id]: attachments },
    slots: [id], shots: 0, pos: new THREE.Vector3(), magNow: weapon.mag, trigger: false, swapT: 0,
    throwing: 0, reloading: false, reloadT: 0 };
  const local = { camera, gunner, adsK: 1, scoped: usesFullscreenWeaponScope(weapon), eye: new THREE.Vector3(900, 900, 900) };
  const state = { local, vel: new THREE.Vector3() };
  vm.update(0, state, !local.scoped); t.after(() => vm.dispose());
  return { vm, state, gunner };
}

for (const id of ['rifle', 'sniper']) test(`${id}: settled purchased 3x uses its actual visible physical scope`, t => {
  const { vm } = fixture(t, id, 'combat_3x');
  assert.equal(vm.visible, true); assert.equal(vm.scopedNow, false);
  assert.equal(vm.root.visible, true); assert.equal(vm.gun.root.visible, true);
  assert.equal(vm.gun.optic.root.visible, true); assert.equal(vm.gun.optic.glass.visible, true);
  assert.equal(vm.gun.optic.replaced.visible, false);
  assert.ok(vm.gun.optic.housing.geometry.attributes.position.count > 200);
  assert.equal(vm.gun.optic.glass.material.transparent, true);
  assert.equal(vm.gun.optic.glass.material.depthWrite, false);
});

test('cut eligibility rejects actual owned modifications and moving/skinned material assemblies', t => {
  const { vm } = fixture(t, 'smg', 'standard', ['extended_mag', 'laser', 'foregrip', 'stock']);
  assert.ok(vm.gun.modifications.objects.length >= 4);
  for (const mesh of vm.gun.modifications.objects) {
    assert.equal(canCutViewmodelMesh(mesh), false);
    assert.ok(!vm.gun.adsCut.some(cut => cut.mesh === mesh), 'production traversal excludes all owned kit geometry');
  }
  const material = new THREE.MeshBasicMaterial(), geometry = new THREE.BoxGeometry(1, 1, 1);
  t.after(() => { geometry.dispose(); material.dispose(); });
  assert.equal(canCutViewmodelMesh(new THREE.Mesh(geometry, material)), true);
  assert.equal(canCutViewmodelMesh(new THREE.SkinnedMesh(geometry, material)), false);
  assert.equal(canCutViewmodelMesh(new THREE.Mesh(geometry, [material])), false);
  assert.equal(canCutViewmodelMesh(new THREE.Group()), false);
});

test('shared source geometry still reuses immutable cut results across sibling meshes', () => {
  const geometry = new THREE.BoxGeometry(.1, .1, .1), material = new THREE.MeshBasicMaterial();
  try {
    const first = new THREE.Mesh(geometry, material), second = new THREE.Mesh(geometry, material);
    const cut = splitIslands(first, [[-1, -1, -1, 1, 1, 1]]);
    assert.ok(cut); assert.equal(splitIslands(second, [[-1, -1, -1, 1, 1, 1]]), cut);
    assert.equal(cut.full, geometry); assert.equal(cut.keep.index.count, 0); assert.equal(cut.n, 12);
    cut.keep.dispose(); cut.cut.dispose();
  } finally { geometry.dispose(); material.dispose(); }
});

test('actual laser hide is idempotent and reactivation invalidates the old world impact', () => {
  const scene = new THREE.Scene(), laser = new WeaponLaser(scene);
  const weapon = { sockets: { laser_emitter: new THREE.Object3D() } }, own = { id: 1 };
  const gunner = { weaponId: 'smg', attachments: { smg: ['laser'] }, aimPoint: new THREE.Vector3(0, 0, -10),
    reloading: false, throwing: 0, swapT: 0, ctx: { ownCar: () => own, targets: () => [], raycastWorld: () => ({ t: 5 }) } };
  const provider = { laserWorld(out) { out.set(0, 0, 0); return true; } };
  laser.update(1 / 60, gunner, weapon, provider);
  assert.equal(laser.root.visible, true); assert.equal(laser.dot.visible, true);
  const firstCount = laser.queryCount; laser.hide(); laser.hide();
  assert.equal(laser.root.visible, false); assert.equal(laser.dot.visible, false);
  assert.equal(laser.weapon, null); assert.equal(laser.queryT, 0); assert.equal(laser.hit, false);
  gunner.ctx.raycastWorld = () => ({ t: 2 }); laser.update(1 / 60, gunner, weapon, provider);
  assert.equal(laser.queryCount, firstCount + 1); assert.equal(laser.endpoint.z, -2);
  laser.update(1 / 60, gunner, weapon, provider, false);
  assert.equal(laser.root.visible, false); assert.equal(laser.dot.visible, false);
  laser.dispose(); laser.hide(); assert.equal(laser.root.parent, null);
});

test('laser visibility policy rejects cleared/victory/missing-state phases for either co-op owner', () => {
  const player = { dead: false, exploded: false };
  for (const role of ['solo', 'driver', 'gunner']) {
    const run = { role, gunner: { crewAlive: true }, victoryPresentation: false };
    assert.equal(canPresentWeaponLaser(run, player, 'run'), true);
    assert.equal(canPresentWeaponLaser({ ...run, victoryPresentation: true }, player, 'run'), false);
    for (const phase of ['countdown', 'dying', 'over']) assert.equal(canPresentWeaponLaser(run, player, phase), false);
    for (const flag of ['cinematic', 'introOutside', 'deathCamT']) assert.equal(canPresentWeaponLaser({ ...run, [flag]: 1 }, player, 'run'), false);
    assert.equal(canPresentWeaponLaser(run, null, 'run'), false);
    assert.equal(canPresentWeaponLaser(run, { dead: true }, 'run'), false);
    assert.equal(canPresentWeaponLaser({ ...run, gunner: null }, player, 'run'), false);
  }
});

test('world prewarm includes exactly five reflex and two purchased physical scope owners', () => {
  const cleanups = [], retained = new Set();
  const group = WeaponView.warmReflexObjects(fn => cleanups.push(fn), retained);
  assert.equal(group.children.length, 7); assert.equal(cleanups.length, 7);
  const named = []; group.traverse(node => { if (node.name === 'optic_combat_3x') named.push(node); });
  assert.equal(named.length, 2);
  for (const cleanup of cleanups) cleanup();
  assert.equal(group.children.length, 0); assert.equal(retained.size, 7);
  for (const material of retained) material.dispose();
});
