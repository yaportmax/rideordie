// Actual Input, Run target enumeration/final camera, and controller methods.
// Explicit DOM/pad and enemy CarState geometry seams. No Run.update dispatch,
// native input/pixels, natural enemy, friend/WAN or performance proof.
import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Input } from '../src/core/input.js';
import { applySettings, normalizeSettings } from '../src/ui/settings_store.js';
import { GunnerController } from '../src/game/gunner.js';
import { Run } from '../src/game/run.js';
import { makeCarState } from '../src/view/car_state.js';

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const near = (a, b, message, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${message}: ${a} vs ${b}`);
const Y = new THREE.Vector3(0, 1, 0);
const vector = a => new THREE.Vector3(...a);
const rotation = (yaw, pitch = 0, roll = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
const context = { emit() {}, ownCar: () => null, targets: function* () {}, raycastWorld: () => null };

function fixture(t, { weapon = 'rifle', ads = false, firstPerson = true, axis = .3, padSens = 1 } = {}) {
  const names = ['window', 'addEventListener', 'document', 'navigator'];
  const old = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const listeners = new Map();
  const listen = (name, fn) => { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); };
  const pad = { index: 0, id: 'CPU standard-pad geometry seam', mapping: 'standard', connected: true,
    axes: [0, 0, axis, 0], buttons: Array.from({ length: 20 }, (_, i) => ({ pressed: i === 6 && ads, value: i === 6 && ads ? 1 : 0 })) };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: listen });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener: listen, pointerLockElement: null } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  t.after(() => names.forEach((name, i) => { if (old[i]) Object.defineProperty(globalThis, name, old[i]); else delete globalThis[name]; }));
  const input = new Input({ addEventListener: listen }); applySettings(input, normalizeSettings({ padSens })); input.poll();
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 9000), run = new Run({ camera, fovBase: 80, input, aimAssist: true }, { role: 'gunner', seed: 7 });
  const state = makeCarState(1, 'truck_t1', 'player'), gunner = new GunnerController({ weapons: [weapon] }, context);
  state.pos.set(7130, 32, 49000); state.vel.set(0, 0, 40);
  Object.assign(run, { gunner, spec: state.spec, simState: 'run', started: true, introDone: true, goSeen: true, eye: vector([7130, 35, 49000]) });
  run.states.set(1, state); run.gcam.firstPerson = firstPerson; run.gcam.tpK = firstPerson ? 0 : 1;
  gunner.ads = ads ? 1 : 0; gunner._adsPrev = ads; run.gcam.adsK = ads ? 1 : 0;
  const mouse = (x, y = 0) => { input.locked = true; for (const fn of listeners.get('mousemove') || []) fn({ movementX: x, movementY: y }); input.poll(); };
  const cameraStep = (dt, command) => { run._camera(dt, { driver: {}, gunner: command }, state); camera.updateMatrixWorld(true); };
  const prime = (yaw, pitch) => {
    gunner.yaw = yaw; gunner.pitch = pitch;
    gunner.update(0, input.gunner(0, ads), null, 0, { carQuat: state.quat, poseRevision: 0, streamPoseGeneration: 0, deferFire: true });
    cameraStep(0, {}); input.endFrame();
  };
  function step(dt, { assist = true, revision = state.poseRevision, generation = 0 } = {}) {
    input.poll(); const raw = input.gunner(dt, gunner.ads > .5), command = { ...raw }, beforeYaw = gunner.yaw, beforePitch = gunner.pitch;
    const previousCamera = camera.quaternion.clone(), priorScopeYaw = gunner._swY || 0, ray = { position: camera.position.clone(), dir: run.camDir.clone() };
    const points = run._assistTargets();
    // Explicit CPU device-dispatch seam; Run.update itself is not invoked.
    const routed = assist && input.lastDevice === 'pad' && run.g.aimAssist;
    if (routed) gunner.assist(command, dt, ray, points, state.vel);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(state.quat);
    gunner.update(dt, command, ray, Math.atan2(fwd.x, fwd.z), { carQuat: state.quat, poseRevision: revision, streamPoseGeneration: generation, deferFire: true });
    cameraStep(dt, command); input.endFrame();
    const actualDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    assert.ok(actualDirection.distanceTo(run.camDir) < 1e-8, 'actual Run final camera is the same-frame aim');
    assert.ok([...actualDirection.toArray(), ...camera.quaternion.toArray()].every(Number.isFinite));
    assert.ok(Math.abs(camera.quaternion.lengthSq() - 1) < 1e-10);
    return { raw, command, routed, points, ray, beforeYaw, beforePitch, yawDelta: wrap(gunner.yaw - beforeYaw), scopeYawDelta: (gunner._swY || 0) - priorScopeYaw, cameraAngle: previousCamera.angleTo(camera.quaternion), actualDirection };
  }
  function target(offset, relativeVelocity) {
    const enemy = makeCarState(2, 'truck_t1', 'enemy'); enemy.driverAlive = enemy.gunnerAlive = false;
    enemy.pos.copy(camera.position).add(offset); enemy.vel.copy(state.vel).add(relativeVelocity); run.states.set(enemy.id, enemy);
    const points = run._assistTargets(); assert.equal(points.length, 1); assert.ok(points[0].p.distanceTo(enemy.pos) < 1e-12);
    return enemy;
  }
  return { input, pad, camera, run, state, gunner, mouse, prime, step, target };
}

for (const rear of [false, true]) for (const sign of [-1, 1]) for (const dt of [1 / 60, .05]) for (const ads of [false, true]) {
  test(`authored legal elevated horizontal-pole witness retains player yaw and actual Run view: rear=${rear}, sign=${sign}, dt=${dt}, ADS=${ads}`, t => {
    const f = fixture(t, { axis: sign * .3, ads });
    const offset = vector([sign * 2.9, 10, 2.9]), velocity = vector([-sign * 35, 0, -35]);
    if (rear) { offset.applyAxisAngle(Y, Math.PI); velocity.applyAxisAngle(Y, Math.PI); }
    const yaw = Math.atan2(offset.x, offset.z), pitch = Math.atan2(offset.y, Math.hypot(offset.x, offset.z));
    assert.ok(pitch >= -1.15 && pitch <= 1.2); f.prime(yaw, pitch); f.target(offset, velocity);
    const current = offset.clone().normalize(), predicted = offset.clone().addScaledVector(velocity, .1), next = offset.clone().addScaledVector(velocity, dt);
    assert.ok(offset.length() >= 3 && offset.length() <= 220 && current.dot(f.run.camDir) > .999999999, 'actual source range/cone eligible');
    assert.ok(predicted.dot(current) > 0 && predicted.x * current.x + predicted.z * current.z < 0, '3D guard passes while horizontal bearing reverses');
    near(wrap(Math.atan2(next.x, next.z) - yaw), 0, 'ordinary next-frame target bearing is unchanged');
    const oldLead = wrap(Math.atan2(predicted.x, predicted.z) - yaw) * 4.9 * dt;
    assert.ok(Math.abs(oldLead) > .25, 'published formula manufactures the established jump witness');
    const row = f.step(dt), angle = Math.acos(Math.min(1, current.dot(row.ray.dir)));
    const cone = Math.max(.035, Math.min(.12, 2.2 / offset.length())), slow = .45 + .55 * angle / cone;
    near(row.command.dYaw, row.raw.dYaw * slow, 'opposite projected lead adds no turn');
    near(row.yawDelta, row.raw.dYaw * slow * (ads ? .6 : 1), 'actual controller preserves player/ADS gain');
    const pitchLead = (Math.asin(predicted.clone().normalize().y) - pitch) * 4.9 * dt;
    near(row.command.dPitch, row.raw.dPitch * slow + pitchLead, 'authored pitch tracking remains');
    assert.ok(row.cameraAngle < .1, 'real final camera cannot receive the manufactured whole-view yaw jump');
  });
}

for (const sign of [-1, 1]) test(`valid horizontal lead remains exact through rear yaw representation seam: ${sign}`, t => {
  const f = fixture(t), offset = vector([sign * .3, 0, -30]), velocity = vector([-sign * 8, 0, 0]);
  const yaw = Math.atan2(offset.x, offset.z); f.prime(yaw, 0); f.target(offset, velocity);
  const future = offset.clone().addScaledVector(velocity, .1), expected = wrap(Math.atan2(future.x, future.z) - yaw) * 4.9 / 60;
  assert.ok(Math.abs(Math.atan2(future.x, future.z) - yaw) > 6, 'raw prediction crosses PI representation');
  const row = f.step(1 / 60); near(row.command.dYaw - row.raw.dYaw * .45, expected, 'valid lead keeps authored gain and wrap');
});

test('rising ADS keeps current-target snap when its future horizontal bearing reverses', t => {
  const f = fixture(t, { ads: true }), offset = vector([2.9, 10, 2.9]);
  const yaw = Math.atan2(offset.x, offset.z); f.prime(yaw - .04, Math.atan2(10, Math.hypot(2.9, 2.9)));
  f.gunner._adsPrev = false; f.target(offset, vector([-35, 0, -35]));
  const row = f.step(1 / 60), current = offset.clone().normalize(), angle = Math.acos(Math.min(1, current.dot(row.ray.dir)));
  const slow = .45 + .55 * angle / Math.max(.035, Math.min(.12, 2.2 / offset.length()));
  near(row.command.dYaw - row.raw.dYaw * slow, .04 * ((1 / 60) / .15) * .8, 'current-target ADS snap survives');
  near(f.gunner._snapT, .15 - 1 / 60, 'snap lifetime unchanged');
});

for (const [weapon, ads, gain] of [['pistol', false, 1], ['rifle', true, .6], ['sniper', true, .28]]) {
  for (const firstPerson of [true, false]) test(`${weapon} legal full-speed pad circuits preserve existing yaw without a rate cap; FP=${firstPerson}`, t => {
    const f = fixture(t, { weapon, ads, firstPerson, axis: 1, padSens: 5 }); f.prime(Math.PI - .002, 0);
    let accumulated = 0;
    for (let i = 0; i < 80; i++) {
      const row = f.step(.05); assert.equal(row.points.length, 0);
      near(row.raw.dYaw, -.775 * (ads ? .55 : 1), 'actual max legal settings-scaled pad command');
      near(row.yawDelta, row.raw.dYaw * gain + row.scopeYawDelta, 'player turn and original scope breathing preserved through complete circles'); accumulated += row.yawDelta;
      assert.ok(row.cameraAngle < .8, 'legal command produces its own bounded camera turn');
    }
    assert.ok(Math.abs(accumulated) > 6.28, 'actual command sequence completes more than a full loop');
  });
  test(`${weapon} captured fast mouse turn bypasses pad prediction with no general yaw limiter`, t => {
    const f = fixture(t, { weapon, ads, axis: 1 }); f.prime(Math.PI - .002, 1.1);
    f.target(vector([-2.9, 10, 2.9]), vector([35, 0, -35])); f.mouse(-1000);
    const row = f.step(.05); assert.equal(f.input.lastDevice, 'kbm'); assert.equal(row.routed, false);
    near(row.raw.dYaw, 2.2, 'unrestricted actual source mouse packet'); near(row.command.dYaw, row.raw.dYaw, 'no assist added to captured mouse');
    near(row.yawDelta, row.raw.dYaw * gain + row.scopeYawDelta, 'actual controller and Run preserve fast yaw and original scope breathing');
  });
}

test('carrier sign-equivalent steering, vertical pitch circuit and explicit recovery keep existing world aim policy', t => {
  const f = fixture(t, { axis: 0 }); f.prime(.7, .35);
  for (let i = 1; i <= 360; i++) {
    f.state.quat.copy(rotation(0, i * Math.PI / 180, 0));
    if (i % 2) { const q = f.state.quat; q.set(-q.x, -q.y, -q.z, -q.w); }
    const row = f.step(0); near(row.yawDelta, 0, 'pure full carrier pitch circuit has no invented yaw');
  }
  f.state.quat.copy(rotation(.02)); let row = f.step(0); near(row.yawDelta, .02 * .55, 'ordinary carrier steering resumes');
  f.state.quat.copy(rotation(3.1, 1.8)); row = f.step(0, { revision: 1 }); near(row.yawDelta, 0, 'explicit pose recovery preserves world aim');
  f.state.quat.copy(rotation(-2.3, .7)); row = f.step(0, { revision: 1, generation: 1 }); near(row.yawDelta, 0, 'stream rebase preserves world aim');
  f.state.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(Y, -.02));
  row = f.step(0, { revision: 1, generation: 1 }); near(row.yawDelta, -.02 * .55, 'valid banked steering resumes after rebase');
});
