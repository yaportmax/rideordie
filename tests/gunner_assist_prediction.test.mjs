import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Input } from '../src/core/input.js';
import { applySettings, normalizeSettings } from '../src/ui/settings_store.js';
import { GunnerController } from '../src/game/gunner.js';
import { GunnerCam } from '../src/view/camera_rig.js';

// Actual Input -> assist -> controller -> camera, with explicit CPU DOM/pad
// seams and target geometry. No browser, physical controller or network proof.
const wrap = value => Math.atan2(Math.sin(value), Math.cos(value));
const neutralContext = { emit() {}, ownCar: () => null, targets: function* () {}, raycastWorld: () => null };
const near = (actual, expected, label, epsilon = 1e-10) => assert.ok(Math.abs(actual - expected) <= epsilon, `${label}: ${actual} vs ${expected}`);

function actualInput(t, { axis = 0, padSens = 1, ads = false } = {}) {
  const names = ['addEventListener', 'document', 'navigator'];
  const descriptors = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const handlers = new Map();
  const listen = (name, handler) => { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(handler); };
  const pad = { index: 0, id: 'CPU standard-gamepad fixture', mapping: 'standard', connected: true,
    axes: [0, 0, axis, 0], buttons: Array.from({ length: 20 }, (_, index) => ({ pressed: false, value: index === 6 && ads ? 1 : 0 })) };
  Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: listen });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener: listen, pointerLockElement: null } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => [pad] } });
  t.after(() => names.forEach((name, index) => { if (descriptors[index]) Object.defineProperty(globalThis, name, descriptors[index]); else delete globalThis[name]; }));
  const input = new Input({ addEventListener: listen });
  applySettings(input, normalizeSettings({ padSens }));
  // Neutral-stick tracking represents a previous real pad turn. Run does not
  // route an untouched keyboard/mouse frame through its pad assistance gate.
  if (!axis && !ads) { pad.axes[2] = .3; input.poll(); input.endFrame(); pad.axes[2] = axis; }
  input.poll(); assert.equal(input.lastDevice, 'pad');
  return input;
}

function sample(t, definition) {
  const { dt, target, relativeVelocity = [0, 0, 0], axis = 0, padSens = 1, ads = false,
    yaw = target ? Math.atan2(target[0], target[2]) : Math.PI - .002, eyeAt = [0, 0, 0],
    previousADS = ads, competitors = [], competitorFirst = false } = definition;
  const input = actualInput(t, { axis, padSens, ads });
  const raw = input.gunner(dt, ads), command = { ...raw };
  const gunner = new GunnerController({ weapons: ['rifle'] }, neutralContext);
  gunner.yaw = yaw; gunner.pitch = target ? Math.atan2(target[1], Math.hypot(target[0], target[2])) : 0; gunner.ads = ads ? 1 : 0;
  gunner._adsPrev = previousADS;
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, .05, 1000), rig = new GunnerCam(camera);
  const eye = new THREE.Vector3(...eyeAt), carrier = new THREE.Quaternion();
  const currentDir = new THREE.Vector3(Math.sin(gunner.yaw) * Math.cos(gunner.pitch), Math.sin(gunner.pitch), Math.cos(gunner.yaw) * Math.cos(gunner.pitch));
  const ownVelocity = new THREE.Vector3(0, 0, 40);
  const point = (offset, velocity) => ({ p: eye.clone().add(new THREE.Vector3(...offset)), v: ownVelocity.clone().add(new THREE.Vector3(...velocity)) });
  const chosen = target ? point(target, relativeVelocity) : null;
  const others = competitors.map(other => point(other.target, other.relativeVelocity || [0, 0, 0]));
  const points = chosen ? competitorFirst ? [...others, chosen] : [chosen, ...others] : others;
  const cameraRay = { position: eye, dir: currentDir };
  let geometry = null;
  if (target) {
    const currentPoint = new THREE.Vector3(...target), distance = currentPoint.length(), current = currentPoint.clone().normalize();
    const angle = Math.acos(Math.min(1, current.dot(currentDir)));
    const cone = Math.max(.035, Math.min(.12, 2.2 / distance));
    const selected = distance >= 3 && distance <= 220 && angle < cone && angle < .12;
    const predicted = currentPoint.clone().addScaledVector(new THREE.Vector3(...relativeVelocity), .1);
    const nextSample = currentPoint.clone().addScaledVector(new THREE.Vector3(...relativeVelocity), dt);
    geometry = { distance, angle, cone, selected, slow: selected ? .45 + .55 * angle / cone : 1,
      predicted, nextSample, predictedSameHemisphere: predicted.dot(current) > 0, nextSampleSameHemisphere: nextSample.dot(current) > 0,
      nextYawDelta: nextSample.lengthSq() ? wrap(Math.atan2(nextSample.x, nextSample.z) - yaw) : null };
  }
  gunner.assist(command, dt, cameraRay, points, ownVelocity);
  const before = { yaw: gunner.yaw, pitch: gunner.pitch };
  const slow = geometry?.slow ?? 1;
  const tracking = { dYaw: command.dYaw - raw.dYaw * slow, dPitch: command.dPitch - raw.dPitch * slow };
  gunner.update(dt, command, cameraRay, 0, { carQuat: carrier, poseRevision: 0, streamPoseGeneration: 0, deferFire: true });
  rig.update(dt, eye, gunner.yaw, gunner.pitch, ads, { truckQuat: carrier });
  const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const adsMultiplier = ads ? .6 : 1;
  const row = { raw, command, tracking, geometry, before, after: { yaw: gunner.yaw, pitch: gunner.pitch },
    integratedAimDelta: wrap(gunner.yaw - before.yaw), adsMultiplier, direction, gunner };
  near(row.integratedAimDelta, command.dYaw * adsMultiplier, 'Actual controller consumes assistance-mutated command');
  assert.ok(direction.dot(rig.dir) > .999999999, 'Actual camera follows same-frame aim');
  assert.ok([...direction.toArray(), ...camera.quaternion.toArray()].every(Number.isFinite));
  return row;
}

for (const dt of [1 / 240, 1 / 120, 1 / 60, 1 / 20]) for (const direction of [-1, 1]) {
  test(`collinear ${direction < 0 ? 'rear' : 'front'} approach has no invented angular tracking before crossing, dt=${dt}`, t => {
    const row = sample(t, { dt, target: [0, 0, direction * 6], relativeVelocity: [0, 0, -direction * 70] });
    assert.equal(row.geometry.selected, true); assert.equal(row.geometry.nextSampleSameHemisphere, true);
    assert.equal(row.geometry.predictedSameHemisphere, false);
    near(row.geometry.nextYawDelta, 0, 'Straight radial approach has no current angular motion');
    near(row.tracking.dYaw, 0, 'No invented lateral tracking toward opposite predicted bearing');
    near(row.tracking.dPitch, 0, 'No invented vertical tracking');
  });
}

for (const dt of [1 / 60, 1 / 20]) for (const axis of [-1, 1]) {
  test(`valid sensitivity5 stick command survives singular-target rejection, axis=${axis}, dt=${dt}`, t => {
    const row = sample(t, { dt, axis, padSens: 5, target: [0, 0, -6], relativeVelocity: [0, 0, 70] });
    near(row.raw.dYaw, -axis * 3.1 * 5 * dt, 'Real Input settings-scaled full stick');
    near(row.tracking.dYaw, 0, 'Reject only invented assist turn');
    near(row.integratedAimDelta, row.raw.dYaw * row.geometry.slow, 'Source slowdown preserves player turn and sign');
  });
}

for (const definition of [
  { name: 'stationary-front', target: [0, 0, 30] },
  { name: 'stationary-rear', target: [0, 0, -30] },
  { name: 'approaching-rear-noncrossing', target: [0, 0, -30], relativeVelocity: [0, 0, 40] },
  { name: 'receding-close-rear', target: [0, 0, -3.01], relativeVelocity: [0, 0, -40] },
  { name: 'exact-predicted-origin', target: [0, 0, -6], relativeVelocity: [0, 0, 60] },
]) test(`${definition.name} preserves zero angular motion for a centered radial target`, t => {
  const row = sample(t, { ...definition, dt: 1 / 60 });
  assert.equal(row.geometry.selected, true);
  near(row.tracking.dYaw, 0, 'Radial geometry has no lateral target motion');
  near(row.tracking.dPitch, 0, 'Radial geometry has no vertical target motion');
});

test('ordinary same-hemisphere transverse tracking retains authored lead formula', t => {
  const dt = 1 / 60, row = sample(t, { dt, target: [0, 0, 30], relativeVelocity: [8, 0, 0] });
  assert.equal(row.geometry.predictedSameHemisphere, true);
  near(row.tracking.dYaw, Math.atan2(.8, 30) * (0.7 / .1) * dt * .7, 'Exact existing lead tracking');
});

test('a close target behind the camera ray remains unselected', t => {
  const row = sample(t, { dt: 1 / 20, target: [0, 0, -6], yaw: 0, relativeVelocity: [0, 0, 70], axis: 1 });
  assert.equal(row.geometry.selected, false); near(row.tracking.dYaw, 0, 'No target lock'); near(row.geometry.slow, 1, 'No slowdown');
  near(row.integratedAimDelta, row.raw.dYaw, 'Player retains unassisted turn');
});

for (const axis of [-1, 1]) test(`unassisted max legal pad turn is preserved through rear/world wrap, axis=${axis}`, t => {
  const row = sample(t, { dt: .05, axis, padSens: 5, target: null });
  near(row.raw.dYaw, -axis * .775, 'Legal full-speed stick delta');
  near(row.integratedAimDelta, row.raw.dYaw, 'No general rotation clamp');
  near(row.tracking.dYaw, 0, 'No targets, no assist');
});

test('steady ADS separates player command from singular lead without changing ADS sensitivity', t => {
  const row = sample(t, { dt: 1 / 60, axis: .8, ads: true, target: [0, 0, -6], relativeVelocity: [0, 0, 70] });
  near(row.tracking.dYaw, 0, 'Only opposite-side tracking rejected');
  near(row.integratedAimDelta, row.raw.dYaw * row.geometry.slow * .6, 'Authored Input ADS0.55 and controller ADS0.6 remain');
});

test('rising ADS still snaps toward the current selected target when predicted lead crosses the eye', t => {
  const dt = 1 / 60, targetYaw = Math.PI - .04;
  const target = [Math.sin(targetYaw) * 6, 0, Math.cos(targetYaw) * 6];
  const relativeVelocity = target.map(value => -value * 70 / 6);
  const row = sample(t, { dt, target, relativeVelocity, yaw: Math.PI, ads: true, previousADS: false });
  assert.equal(row.geometry.selected, true); assert.equal(row.geometry.predictedSameHemisphere, false);
  near(row.command.dYaw, wrap(targetYaw - Math.PI) * (dt / .15) * .8, 'ADS snap uses current target, not opposite prediction');
  near(row.command.dPitch, 0, 'No invented vertical snap');
  near(row.gunner._snapT, .15 - dt, 'Authored snap lifetime remains');
  assert.equal(row.gunner._adsPrev, true);
});

for (const definition of [
  { name: 'translated horizontal', eyeAt: [7100, 35, 49000], target: [0, 0, -6], relativeVelocity: [0, 0, 70] },
  { name: 'translated pitched', eyeAt: [-4200, 70, 71000], target: [0, 3.6, -4.8], relativeVelocity: [0, -42, 56] },
]) test(`${definition.name} collinear prediction crossing introduces no yaw or pitch tracking`, t => {
  const row = sample(t, { ...definition, dt: 1 / 20 });
  assert.equal(row.geometry.selected, true); assert.equal(row.geometry.nextSampleSameHemisphere, true);
  assert.equal(row.geometry.predictedSameHemisphere, false);
  near(row.tracking.dYaw, 0, 'No fictitious yaw across translated eye');
  near(row.tracking.dPitch, 0, 'No fictitious pitch across translated eye');
  near(row.after.pitch, row.before.pitch, 'Actual controller preserves radial pitch');
});

for (const sign of [-1, 1]) test(`valid same-hemisphere lead remains wrapped through rear yaw seam, sign=${sign}`, t => {
  const dt = 1 / 60, target = [sign * .3, 0, -30], relativeVelocity = [-sign * 8, 0, 0];
  const row = sample(t, { dt, target, relativeVelocity });
  const targetYaw = Math.atan2(target[0], target[2]);
  const predictedYaw = Math.atan2(row.geometry.predicted.x, row.geometry.predicted.z);
  assert.equal(row.geometry.predictedSameHemisphere, true);
  assert.ok(Math.abs(predictedYaw - targetYaw) > 6, 'Fixture crosses the raw yaw seam');
  near(row.tracking.dYaw, wrap(predictedYaw - targetYaw) * (0.7 / .1) * dt * .7, 'Wrapped authored lead survives');
});

for (const competitorFirst of [false, true]) test(`competing eligible targets preserve nearest-angle selection, competitorFirst=${competitorFirst}`, t => {
  const dt = 1 / 60, distance = 30, winnerYaw = .04, otherYaw = -.06;
  const target = [Math.sin(winnerYaw) * distance, 0, Math.cos(winnerYaw) * distance];
  const row = sample(t, { dt, target, relativeVelocity: [8, 0, 0], yaw: 0, axis: .7, competitorFirst,
    competitors: [{ target: [Math.sin(otherYaw) * distance, 0, Math.cos(otherYaw) * distance], relativeVelocity: [-9, 0, 0] }] });
  assert.equal(row.geometry.selected, true);
  const predictionYaw = Math.atan2(row.geometry.predicted.x, row.geometry.predicted.z);
  near(row.command.dYaw, row.raw.dYaw * row.geometry.slow + wrap(predictionYaw - winnerYaw) * (0.7 / .1) * dt * .7,
    'Nearest angular target supplies both slowdown and lead regardless of enumeration order');
});
