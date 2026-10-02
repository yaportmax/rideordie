// Actual Run camera orchestration and real rigs. CPU geometry/pose acceptance
// only: no browser, rendered pixels, timings or campaign completion inference.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadCrewAssets, THREE, CrewView } from './helpers/crew-assets.mjs';
import { Run } from '../src/game/run.js';
import { WorldView } from '../src/game/world_view.js';
import { makeCarState } from '../src/view/car_state.js';
import { MountedGun, MINIGUN_SOCKETS } from '../src/view/mounted_gun.js';
import { mergeRigid, unifyAtlasMaterials } from '../src/core/merge.js';
import { WEAPONS } from '../src/data/weapons.js';
import { GunnerCam } from '../src/view/camera_rig.js';

await loadCrewAssets();
const bytes = await readFile(new URL('../public/models/weapons/mounted_minigun.glb', import.meta.url));
const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
unifyAtlasMaterials(asset.scene); mergeRigid(asset.scene, asset.parser.associations);
const dt = 1 / 60, commands = () => ({ driver: {}, gunner: {} });
const axis = rig => rig.pitchJoint.getWorldDirection(new THREE.Vector3()).normalize();
const viewAxis = camera => new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
const angle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));

function fixture(t, { carrier = [0, 0, 0], firstPerson = true, ads = 0 } = {}) {
  const prior = globalThis.window; globalThis.window = {};
  t.after(() => { if (prior === undefined) delete globalThis.window; else globalThis.window = prior; });
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 1000), scene = new THREE.Scene(), root = new THREE.Group();
  scene.add(camera, root); const state = makeCarState(1, 'truck_t1', 'player');
  state.pos.set(32100, 110, 90250); state.quat.setFromEuler(new THREE.Euler(...carrier, 'YXZ'));
  root.quaternion.copy(state.quat); root.position.copy(state.pos).add(new THREE.Vector3(0, -state.ride.restComHeight, 0).applyQuaternion(state.quat));
  const rig = new MountedGun('minigun', { model: asset.scene.clone(true) });
  const crew = new CrewView('hero_gunner', { role: 'gunner', weapon: 'minigun' });
  crew.weapon.dispose(); crew.weapon = rig; crew.mountAt = null;
  root.add(crew.root); crew.attach({ root, spec: state.spec }, state.spec.seats.gunner);
  const world = Object.assign(Object.create(WorldView.prototype), { cars: new Map([[1, { crew: { gunner: crew } }]]), playerWeaponOptics: {} });
  const run = new Run({ camera, fovBase: 80 }, { role: 'gunner', seed: 3 });
  const gunner = { weaponId: 'minigun', weapon: WEAPONS.minigun, yaw: 0, pitch: 0, ads, reloading: false,
    slots: ['minigun'], shots: 0, pos: new THREE.Vector3(), magNow: WEAPONS.minigun.mag, trigger: false, swapT: 0, throwing: 0, reloadT: 0 };
  Object.assign(run, { wv: world, gunner, spec: state.spec, states: new Map([[1, state]]), simState: 'run',
    introDone: true, started: true, goSeen: true, eye: new THREE.Vector3() });
  run.gcam.firstPerson = firstPerson;
  const pose = { alive: true, weaponId: 'minigun', quat: state.quat, vel: state.vel, aimYaw: 0, aimPitch: 0, fire: false,
    local: { firstPerson, camera, gunner, adsK: ads, eye: run.eye, reloadLen: 5.2, reloadT: 0 } };
  function frame() {
    pose.aimYaw = gunner.yaw; pose.aimPitch = gunner.pitch; pose.reloading = gunner.reloading;
    pose.local.firstPerson = run.gcam.firstPerson && run.gcam.tpK < .5;
    pose.local.adsK = run.gcam.adsK; run._gunnerEye(state, run.eye); crew.update(dt, pose);
    run._camera(dt, commands(), state); scene.updateMatrixWorld(true);
  }
  t.after(() => crew.dispose()); return { run, gunner, crew, state, root, rig, world, scene, camera, frame };
}

function expectedEye(f) {
  const hip = new THREE.Vector3(), ads = new THREE.Vector3();
  f.rig.eyeWorld(hip, .60); hip.y += .12; f.rig.eyeWorld(ads, .30);
  return hip.lerp(ads, f.gunner.ads);
}

for (const carrier of [[0, 0, 0], [.35, .8, -.28], [-.48, -2.4, .42]]) {
  test(`actual mounted Run full-circle hip/ADS stays behind rig with carrier ${carrier.join('/')}`, t => {
    const f = fixture(t, { carrier }); let previous;
    for (const ads of [0, 1]) for (const pitch of [-1.05, 0, 1.10]) {
      f.gunner.ads = ads; f.gunner.pitch = pitch; previous = null;
      for (let i = 0; i <= 72; i++) {
        f.gunner.yaw = -Math.PI + i * Math.PI / 36; f.frame();
        assert.ok(f.camera.position.distanceTo(expectedEye(f)) < 1e-8, 'real hip and ADS eye follows the rotating pedestal');
        assert.ok(viewAxis(f.camera).distanceTo(axis(f.rig)) < 1e-8, 'camera looks along the actual cradle axis');
        assert.ok(f.run.camDir.distanceTo(axis(f.rig)) < 1e-8);
        for (const side of ['Right', 'Left']) {
          const arm = f.crew.arm[side], target = f.rig.sockets[side === 'Right' ? 'grip_R' : 'grip_L'].getWorldPosition(new THREE.Vector3());
          const miss = arm.h.getWorldPosition(new THREE.Vector3()).distanceTo(target);
          assert.ok(miss < .04, `${side} wrist remains on the real grip at yaw=${f.gunner.yaw} pitch=${pitch} ads=${ads}; ${JSON.stringify({ miss, reach: arm.u.getWorldPosition(new THREE.Vector3()).distanceTo(target), lengths: arm.lens, turretPitch: f.rig.pitchJoint.rotation.x })}`);
        }
        const sight = new THREE.Vector3(); f.rig.sightWorld(sight);
        assert.ok(sight.clone().sub(f.camera.position).dot(axis(f.rig)) > .18, 'camera remains behind physical sight');
        if (ads) { const ndc = sight.clone().project(f.camera); assert.ok(Math.abs(ndc.x) < 1e-7 && Math.abs(ndc.y) < 1e-7, 'open reflex center lands on crosshair'); }
        if (previous) assert.ok(angle(previous, f.camera.quaternion) < .12, 'five-degree input cannot produce a whole-view angular snap');
        previous = f.camera.quaternion.clone();
        assert.ok([...f.camera.position.toArray(), ...f.camera.quaternion.toArray()].every(Number.isFinite));
      }
    }
  });
}

test('actual mounted yaw seams stay continuous in both representations of the same full-circle angle', t => {
  const f = fixture(t, { carrier: [.3, 1.3, -.35], ads: 1 }); f.gunner.pitch = .45;
  for (let i = 0; i < 60; i++) f.frame();
  for (const pair of [[Math.PI - 1e-5, -Math.PI + 1e-5], [-1e-5, Math.PI * 2 + 1e-5]]) {
    f.gunner.yaw = pair[0]; f.frame(); const before = f.camera.quaternion.clone(), position = f.camera.position.clone();
    f.gunner.yaw = pair[1]; f.frame();
    assert.ok(angle(before, f.camera.quaternion) < 5e-4); assert.ok(position.distanceTo(f.camera.position) < 1e-4);
  }
});

test('active mounted recoil/shake preserves actual GunnerCam offsets and final wrist correction reaches the turned grips', t => {
  const f = fixture(t, { carrier: [.25, -1.2, .3], ads: 1 }); f.gunner.yaw = 2.8; f.gunner.pitch = .7;
  const referenceCamera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 1000), reference = new GunnerCam(referenceCamera);
  let sawShakeOffset = false, sawShoulderOffset = false;
  let wristSyncs = 0; const sync = f.world.syncMountedHands.bind(f.world);
  f.world.syncMountedHands = (...args) => { wristSyncs++; return sync(...args); };
  for (let i = 0; i < 24; i++) {
    if (i === 8) f.run.gcam.firstPerson = false;
    if (i === 16) f.run.gcam.firstPerson = true;
    f.run.gcam.addRecoil(.025, i % 2 ? -.014 : .014); f.run.gcam.shake.add(.12); f.rig.fire(20);
    // The independent real camera supplies the original shake/shoulder delta.
    // The mounted path must translate that delta to its final recoil-turned eye,
    // not erase shake or abruptly discard the shoulder at a tpK threshold.
    for (const key of ['fov', 'adsK', 'kickPitch', 'kickYaw', 'tpK', 'firstPerson', 'roll']) reference[key] = f.run.gcam[key];
    reference.shake.trauma = f.run.gcam.shake.trauma; reference.shake.t = f.run.gcam.shake.t;
    const cp = Math.cos(f.gunner.pitch);
    f.rig.aimWorld(new THREE.Vector3(Math.sin(f.gunner.yaw) * cp, Math.sin(f.gunner.pitch), Math.cos(f.gunner.yaw) * cp));
    const beforeEye = expectedEye(f);
    const referenceDir = reference.update(dt, beforeEye, f.gunner.yaw, f.gunner.pitch, true,
      { scoped: false, scopeFov: WEAPONS.minigun.scopeFov, fovBase: 80, speed01: 0, boosting: false, truckQuat: f.state.quat }).clone();
    const originalOffset = referenceCamera.position.clone().sub(beforeEye);
    if (reference.shake.offset(new THREE.Vector3(), reference.firstPerson ? .25 : .4).length() > .001) sawShakeOffset = true;
    if (reference.tpK > .1) sawShoulderOffset = true;
    f.frame();
    assert.ok(viewAxis(f.camera).distanceTo(axis(f.rig)) < 1e-8);
    const finalEye = expectedEye(f), expectedPosition = finalEye.clone().add(originalOffset);
    assert.ok(f.camera.position.distanceTo(expectedPosition) < 1e-8, 'exact real shake and transitioning shoulder offset survives physical eye reconciliation');
    assert.ok(f.run.eye.distanceTo(finalEye) < 1e-8);
    assert.equal(f.run.gcam.tpK, reference.tpK); assert.equal(f.run.gcam.adsK, reference.adsK);
    assert.equal(f.run.gcam.shake.trauma, reference.shake.trauma); assert.equal(f.run.gcam.shake.t, reference.shake.t);
    referenceCamera.position.copy(expectedPosition);
    referenceCamera.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(referenceDir, axis(f.rig)));
    referenceCamera.updateMatrixWorld(true);
    assert.ok(angle(f.camera.quaternion, referenceCamera.quaternion) < 1e-7, 'physical axis correction preserves actual camera roll');
    const sight = new THREE.Vector3(); f.rig.sightWorld(sight);
    assert.ok(sight.clone().project(f.camera).distanceTo(sight.clone().project(referenceCamera)) < 1e-8, 'optical projection agrees with real offset camera during trauma');
    for (const side of ['Right', 'Left']) {
      const target = f.rig.sockets[side === 'Right' ? 'grip_R' : 'grip_L'].getWorldPosition(new THREE.Vector3());
      const arm = f.crew.arm[side], wrist = arm.h.getWorldPosition(new THREE.Vector3()), shoulder = arm.u.getWorldPosition(new THREE.Vector3());
      assert.ok(wrist.distanceTo(target) < .04, `${side} wrist follows final recoil pose ${JSON.stringify({ frame: i, miss: wrist.distanceTo(target), reach: shoulder.distanceTo(target), lengths: arm.lens, wrist: wrist.toArray(), target: target.toArray(), shoulder: shoulder.toArray(), yaw: f.rig.yawJoint.rotation.y, pitch: f.rig.pitchJoint.rotation.x })}`);
    }
  }
  assert.ok(sawShakeOffset, 'fixture exercises nonzero physical shake');
  assert.ok(sawShoulderOffset, 'fixture exercises both mounted view transitions');
  assert.equal(wristSyncs, 24, 'one bounded current-frame hand correction per mounted camera update');
});

test('mounted third person preserves GunnerCam shoulder orbit rather than forcing its camera into the physical sight', t => {
  const f = fixture(t, { firstPerson: false, carrier: [.2, .4, -.15], ads: 0 }); f.gunner.yaw = -.8; f.gunner.pitch = .12;
  for (let i = 0; i < 90; i++) f.frame();
  assert.ok(f.run.gcam.tpK > .99); assert.ok(f.camera.position.distanceTo(expectedEye(f)) > 2);
  assert.equal(f.crew.mountedArms?.visible || false, false);
  const forward = viewAxis(f.camera); assert.ok(forward.distanceTo(f.run.camDir) < 1e-9);
  const delta = f.camera.position.clone().sub(f.run.eye);
  assert.ok(delta.dot(forward) < -2.3, 'external camera remains behind operator');
});

test('actual mounted view toggles retain a continuous shoulder return through the half-transition boundary', t => {
  const f = fixture(t, { firstPerson: false }); f.gunner.yaw = .7;
  for (let i = 0; i < 90; i++) f.frame();
  for (const firstPerson of [true, false, true]) {
    f.run.gcam.firstPerson = firstPerson;
    for (let i = 0; i < 90; i++) {
      const previous = f.camera.position.clone(), previousAngle = f.camera.quaternion.clone(); f.frame();
      assert.ok(f.camera.position.distanceTo(previous) < .45, `camera cannot discard a metre of shoulder offset at tpK=${f.run.gcam.tpK}`);
      assert.ok(angle(previousAngle, f.camera.quaternion) < .05, 'fixed aim retains angular continuity during view switches');
    }
  }
});

test('current mounted camera/shot muzzle is the real rotating barrel-zero bore, never the bundle center', t => {
  const f = fixture(t, { carrier: [-.3, .6, .4], ads: 1 }); f.gunner.yaw = -2.9; f.gunner.pitch = -.75;
  for (let i = 0; i < 12; i++) {
    f.gunner.trigger = true; f.rig.fire(20); f.frame();
    assert.equal(f.rig.sockets.muzzle.parent, f.rig.rotor);
    const expected = new THREE.Vector3().fromArray(MINIGUN_SOCKETS.muzzle); f.rig.rotor.localToWorld(expected);
    const actual = new THREE.Vector3(); assert.equal(f.world.muzzlePos(f.state, actual), true);
    assert.ok(actual.distanceTo(expected) < 1e-8);
    const bundle = f.rig.pitchJoint.localToWorld(new THREE.Vector3(0, 0, .895));
    assert.ok(Math.abs(actual.distanceTo(bundle) - .078) < 1e-7, 'launch is on a real barrel, away from empty bundle axis');
    const bore = f.rig.sockets.muzzle.worldToLocal(actual.clone()); assert.ok(bore.length() < 1e-8);
  }
});
