import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCrewAssets, THREE, CrewView } from './helpers/crew-assets.mjs';
import { createMountedFirstPersonArms } from '../src/view/viewmodel.js';
import { WorldView, crewFrustumRadius } from '../src/game/world_view.js';
import { GarageScene } from '../src/game/garage_scene.js';
import { WEAPONS } from '../src/data/weapons.js';
import { CITY_DOUBLE_BUS } from '../src/data/city_bus.js';
import { Fx } from '../src/view/fx.js';
import { ParticleSystem, PDesc, STRIDE, PF } from '../src/view/fx/particles.js';
import { Rng } from '../src/view/fx/util.js';
import { MUZZLE } from '../src/view/fx/weapons.js';

await loadCrewAssets();

function fixture(t, weaponId = 'minigun') {
  const oldWindow = globalThis.window; globalThis.window = {};
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  t.mock.method(THREE.TextureLoader.prototype, 'load', () => new THREE.Texture());
  const scene = new THREE.Scene(), root = new THREE.Group(), camera = new THREE.PerspectiveCamera(60, 16 / 9, .01, 300);
  scene.add(root, camera); root.position.set(17, 3, 420);
  const car = { root, spec: { id: 'mounted_runtime_fixture' } }, seat = [0, .95, -.85];
  const crew = new CrewView('hero_gunner', { role: 'gunner', weapon: weaponId }); root.add(crew.root); crew.attach(car, seat);
  const gunner = { weaponId, weapon: WEAPONS[weaponId], slots: ['smg', 'minigun'], shots: 0, pos: new THREE.Vector3(),
    magNow: WEAPONS[weaponId].mag, trigger: false, swapT: 0, throwing: 0, reloading: false, reloadT: 0 };
  const state = { alive: true, weaponId, quat: new THREE.Quaternion(), vel: new THREE.Vector3(), aimYaw: 0, aimPitch: 0,
    local: { firstPerson: true, camera, gunner, adsK: 1, eye: new THREE.Vector3(), reloadLen: 5.2, reloadT: 0 } };
  t.after(() => crew.dispose()); return { scene, root, car, crew, seat, camera, gunner, state };
}

test('mounted first person keeps one physical deck gun, real depth arms, and dynamic muzzle through a full traverse', t => {
  const f = fixture(t), mount = f.crew.weapon;
  assert.equal(mount.mounted, true); assert.equal(mount.root.parent, f.root);
  const base = mount.root.position.clone();
  for (const yaw of [0, Math.PI / 2, Math.PI - .001, -Math.PI + .001, -Math.PI / 2, 0]) {
    f.state.aimYaw = yaw; f.crew.update(1 / 60, f.state); f.scene.updateMatrixWorld(true);
    assert.deepEqual(mount.root.position.toArray(), base.toArray(), 'the footplate never follows a hand or camera');
    assert.equal(mount.root.parent, f.root); assert.equal(f.crew.useVm, false);
    assert.equal(f.gunner.vm, null); assert.equal(f.gunner.fp, false); assert.equal(f.gunner.mountedRig, mount);
    assert.equal(f.crew.mountedArms.visible, true); assert.equal(f.crew.mountedArms.material.colorWrite, true);
    assert.equal(f.crew.mountedArms.skeleton, f.crew.model.getObjectByName('body').skeleton);
    assert.equal(f.crew.mountedArms.material.isShaderMaterial, undefined, 'arms use the actual scene PBR projection');
    assert.ok(!f.crew.vm || !f.crew.vm.root.visible, 'no projected firearm duplicate');
    const actual = new THREE.Vector3(), socket = new THREE.Vector3();
    assert.equal(f.crew.muzzleWorld(actual), true); mount.sockets.muzzle.getWorldPosition(socket);
    assert.ok(actual.distanceTo(socket) < 1e-9);
    assert.ok(Math.abs(Math.hypot(f.crew.root.position.x - base.x, f.crew.root.position.z - base.z) - .58) < 1e-9);
    for (const side of ['Right', 'Left']) {
      const target = mount.sockets[side === 'Right' ? 'grip_R' : 'grip_L'].getWorldPosition(new THREE.Vector3());
      const wrist = f.crew.arm[side].h.getWorldPosition(new THREE.Vector3());
      assert.ok(wrist.distanceTo(target) < .04, `${side} wrist reaches its physical spade grip`);
    }
  }
});

test('handheld/mounted swaps hide and restore the same existing VM without cached mounted projections', t => {
  const f = fixture(t, 'smg'); f.crew.update(1 / 60, f.state);
  const vm = f.crew.vm; assert.ok(vm); assert.equal(f.gunner.vm, vm);
  f.state.weaponId = f.gunner.weaponId = 'minigun'; f.gunner.weapon = WEAPONS.minigun;
  f.crew.update(1 / 60, f.state); const mount = f.crew.weapon;
  assert.equal(vm.root.visible, false); assert.equal(f.gunner.mountedRig, mount); assert.equal(vm._gunFor('minigun'), null);
  assert.ok(![...vm.guns.values()].some(gun => gun.id === 'minigun'));
  f.state.weaponId = f.gunner.weaponId = 'smg'; f.gunner.weapon = WEAPONS.smg;
  f.crew.update(1 / 60, f.state);
  assert.equal(mount.disposed, true); assert.equal(mount.root.parent, null);
  assert.equal(f.crew.vm, vm); assert.equal(f.gunner.vm, vm); assert.equal(f.gunner.mountedRig, null);
  assert.equal(vm.root.visible, true); assert.equal(f.crew.mountedArms.visible, false);
});

test('mounted reload targets the lower magazine socket and death removes FP arms while retaining the fixed pedestal', t => {
  const f = fixture(t); f.state.reloading = f.gunner.reloading = true; f.state.local.reloadT = 2.1;
  f.crew.update(1 / 60, f.state); f.scene.updateMatrixWorld(true);
  const mount = f.crew.weapon, target = mount.sockets.mag_well.getWorldPosition(new THREE.Vector3());
  const wrist = f.crew.arm.Left.h.getWorldPosition(new THREE.Vector3());
  assert.ok(wrist.distanceTo(target) < .04); assert.equal(mount.reloading, true);
  const sight = mount.sockets.sight.getWorldPosition(new THREE.Vector3()); assert.ok(target.y < sight.y - .2);
  f.crew.fire(20); f.crew.update(.05, f.state); f.crew.die({ cause: 'bullet' });
  assert.equal(f.crew.mountedArms.visible, false); assert.equal(mount.root.parent, f.root);
  assert.equal(mount.root.visible, true); assert.equal(mount.shotHold, 0); assert.equal(mount.spinSpeed, 0);
});

test('world mounted shot/camera lookup resolves an immediate selected-weapon swap and returns actual world muzzle', t => {
  const f = fixture(t, 'smg'), st = { id: 1 }, world = Object.assign(Object.create(WorldView.prototype), {
    cars: new Map([[1, { crew: { gunner: f.crew } }]]), playerWeaponOptics: {},
  });
  const direction = new THREE.Vector3(.8, .1, -.3).normalize();
  assert.equal(world.aimMountedWeapon(st, direction, 'minigun'), true);
  const mount = world.mountedWeapon(st), actual = new THREE.Vector3(), expected = new THREE.Vector3();
  assert.equal(mount.root.parent, f.root); assert.equal(world.muzzlePos(st, actual), true); mount.muzzleWorld(expected);
  assert.ok(actual.distanceTo(expected) < 1e-9);
  assert.equal(world.mountedWeapon(st, 'smg'), null); assert.equal(mount.disposed, true);
});

test('arms-only world geometry preserves forearms and keeps template buffers, materials and skeleton unmodified', () => {
  const source = new THREE.BufferGeometry();
  source.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1], 3));
  source.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 4));
  source.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  source.setIndex([0, 1, 2, 3, 4, 5]);
  const arm = new THREE.Bone(), torso = new THREE.Bone(); arm.name = 'RightForeArm'; torso.name = 'Spine';
  const skeleton = new THREE.Skeleton([arm, torso]), material = new THREE.MeshStandardMaterial();
  const body = new THREE.SkinnedMesh(source, material), parent = new THREE.Group(); parent.add(body); body.bind(skeleton);
  const first = createMountedFirstPersonArms(body), second = createMountedFirstPersonArms(body);
  assert.deepEqual([...first.geometry.index.array], [0, 1, 2]); assert.deepEqual([...source.index.array], [0, 1, 2, 3, 4, 5]);
  assert.equal(first.geometry, second.geometry); assert.equal(first.skeleton, skeleton); assert.equal(first.material, material);
  assert.equal(first.geometry.attributes.position, source.attributes.position); assert.equal(first.castShadow, false);
  assert.equal(first.material.depthTest, true); assert.equal(first.material.depthWrite, true);
  assert.equal(first.parent, parent); assert.equal(first.userData.fpArms, true);
  source.dispose(); material.dispose(); skeleton.dispose();
});

test('the minigun bench presents its upright pedestal on the plinth and disposes private display resources once', () => {
  const garage = Object.assign(Object.create(GarageScene.prototype), { scene: new THREE.Scene(), ringMat: new THREE.MeshStandardMaterial() });
  garage._buildBench('minigun'); const bench = garage.benchWeapon, mount = bench.view;
  assert.equal(mount.mounted, true); assert.equal(mount.root.parent, bench.root);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(mount.root.quaternion); assert.ok(up.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-9);
  bench.root.updateMatrixWorld(true);
  const plinth = bench.root.children.find(node => node.geometry?.type === 'CylinderGeometry');
  const pedestalBottom = new THREE.Box3().setFromObject(mount.root).min.y, plinthTop = new THREE.Box3().setFromObject(plinth).max.y;
  assert.ok(Math.abs(pedestalBottom - plinthTop) < 1e-5, 'footplate contacts its display surface');
  let reticleDisposed = 0, plinthDisposed = 0;
  mount.optic.reticle.material.addEventListener('dispose', () => reticleDisposed++);
  plinth.geometry.addEventListener('dispose', () => plinthDisposed++);
  garage._buildBench(null); mount.dispose();
  assert.equal(reticleDisposed, 1); assert.equal(plinthDisposed, 1); assert.equal(garage.scene.children.length, 0);
  garage.ringMat.dispose(); garage._plinthMat?.dispose();
});

test('double-decker visibility bounds include both real standing upper-deck seats and retain the player culling policy', () => {
  const radius = crewFrustumRadius(CITY_DOUBLE_BUS, 1.31);
  assert.ok(radius > 5); assert.equal(crewFrustumRadius(CITY_DOUBLE_BUS, 1.31, 'player'), 5);
  for (const role of ['gunner', 'gunner2']) {
    const seat = CITY_DOUBLE_BUS.seats[role]; assert.ok(seat);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const extremity = new THREE.Vector3(seat[0] + Math.cos(yaw) * 1.2, seat[1] + 1.85 - 1.31, seat[2] + Math.sin(yaw) * 1.2);
      assert.ok(extremity.length() < radius, `${role} head/hands stay inside the source-computed sphere`);
    }
  }
});

function fxFixture() {
  const scene = new THREE.Scene(), pa = new ParticleSystem(scene, { cap: 64, uniforms: {} }), pf = new ParticleSystem(scene, { cap: 128, uniforms: {} });
  const ports = [], fx = Object.assign(Object.create(Fx.prototype), { pa, pf, p: new PDesc(), rng: new Rng(71), qd: 1,
    dist: () => 0, groundAt: () => -10, flashLight() {}, _eject: (weapon, origin, dx, dy, dz, ctx, event) => ports.push({ weapon, origin: [...origin], event }),
  });
  return { fx, pa, pf, ports, dispose() { pa.dispose(); pf.dispose(); } };
}

test('local mounted shots retain a world muzzle flash and use the actual ejection port without a projected FP tag', () => {
  const f = fxFixture(), event = { src: 'player', weapon: 'minigun', origin: [4, 5, 6], dir: [0, 0, 1], mounted: true,
    ej: [3.825, 4.94, 5.05], ejd: [-1, 0, 0], rays: [{ end: [4, 5, 90] }] };
  f.fx._shot(event, {}); assert.equal(f.ports[0].event, event);
  assert.equal(MUZZLE.minigun.casing, 1); assert.ok(MUZZLE.minigun.life < MUZZLE.lmg.life);
  let traces = 0, muzzleSprites = 0;
  for (let slot = 0; slot < f.pf.hw; slot++) { const o = slot * STRIDE; if (f.pf.data[o + 47] & PF.MUZZLE_START) traces++; else muzzleSprites++; }
  assert.equal(traces, 2); assert.ok(muzzleSprites > 0 && muzzleSprites < 16, 'bounded actual world particles remain visible');
  assert.equal(event.fp, undefined); f.dispose();
});

test('remote minigun casings follow this peer physical port while event origin/hits remain untouched', () => {
  const f = fxFixture(), event = { src: 'player', weapon: 'minigun', remote: true, mounted: true,
    origin: [4, 5, 6], dir: [0, 0, 1], ej: [3, 4, 5], ejd: [-1, 0, 0], rays: [{ end: [4, 5, 90] }] };
  const before = structuredClone(event); let queries = 0;
  f.fx._shot(event, { playerEject(position, direction) { queries++; position.set(7, 8, 9); direction.set(0, 0, -1); return true; } });
  assert.equal(queries, 1); assert.deepEqual(f.ports[0].event.ej, [7, 8, 9]); assert.deepEqual(f.ports[0].event.ejd, [0, 0, -1]);
  assert.equal(f.ports[0].event.mounted, true); assert.deepEqual(event, before); f.dispose();
});

test('actual casing integration starts at the supplied physical port in vehicle space', () => {
  const root = new THREE.Group(); root.position.set(10, 2, 40); root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .7);
  const local = new THREE.Vector3(-.175, 2.1, -.05), port = local.clone().applyQuaternion(root.quaternion).add(root.position);
  const direction = new THREE.Vector3(-1, 0, 0).applyQuaternion(root.quaternion), calls = [];
  const fx = Object.assign(Object.create(Fx.prototype), { rng: new Rng(3), near: () => true, casings: { spawn(...args) { calls.push(args); return 1; } } });
  fx._eject('minigun', [99, 99, 99], 0, 0, 1, { playerId: 1, carViews: new Map([[1, { root, spec: { seats: { gunner: [0, .95, 0] } } }]]) },
    { mounted: true, ej: port.toArray(), ejd: direction.toArray() });
  assert.ok(new THREE.Vector3(...calls[0].slice(0, 3)).distanceTo(local) < 1e-9);
  assert.equal(calls[0].at(-2), root); assert.equal(calls[0].at(-1), .95);
});
