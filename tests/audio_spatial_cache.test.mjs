import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Listener, Voice } from '../src/core/audio.js';
import { AudioBridge } from '../src/view/audio_bridge.js';
import { VEHICLES } from '../src/data/vehicles.js';

function listenerAudio() {
  return { dt: 1 / 60, ctx: { listener: Object.fromEntries(['positionX', 'positionY', 'positionZ', 'forwardX', 'forwardY', 'forwardZ', 'upX', 'upY', 'upZ'].map(k => [k, { value: 0 }])) } };
}
const pose = l => ({ pos: { ...l.pos }, fwd: { ...l.fwd }, up: { ...l.up }, vel: { ...l.vel } });

test('audio listener updates moving camera ancestors without visiting the weapon subtree', () => {
  const a = listenerAudio(), b = listenerAudio(), actual = new Listener(a), reference = new Listener(b);
  const root = new THREE.Group(), mount = new THREE.Group(), camera = new THREE.PerspectiveCamera();
  root.add(mount); mount.add(camera);
  const weapon = new THREE.Group(); camera.add(weapon);
  let visits = 0;
  weapon.updateMatrixWorld = () => { visits++; };
  weapon.updateWorldMatrix = () => { visits++; };
  const scratch = [actual._matrixPos, actual._matrixFwd, actual._matrixUp];
  for (let frame = 0; frame < 50; frame++) {
    root.position.set(frame * .1, Math.sin(frame), -20);
    root.rotation.set(.1, frame * .013, -.08);
    mount.position.set(2, 3, -.4); mount.rotation.set(0, -.2, .07);
    camera.position.set(.2, frame * .03, 1); camera.rotation.set(frame * .004, .3, 0);
    const velocity = frame % 3 === 0 ? new THREE.Vector3(2, 0, 3) : undefined;
    actual.update(camera, velocity);
    // Matrix-derived pose is an independent oracle; setRaw still owns the
    // previous listener position when deriving velocity without a supplied one.
    const e = camera.matrixWorld.elements;
    reference.setRaw({ x: e[12], y: e[13], z: e[14] }, { x: -e[8], y: -e[9], z: -e[10] }, { x: e[4], y: e[5], z: e[6] }, velocity);
    assert.deepEqual(pose(actual), pose(reference), 'pose frame ' + frame);
    assert.deepEqual(a.ctx.listener, b.ctx.listener, 'AudioParam values frame ' + frame);
    const inverse = camera.matrixWorld.clone().invert().elements;
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(camera.matrixWorldInverse.elements[i] - inverse[i]) < 1e-12, 'camera inverse ' + i);
    assert.equal(actual._matrixPos, scratch[0]); assert.equal(actual._matrixFwd, scratch[1]); assert.equal(actual._matrixUp, scratch[2]);
  }
  assert.equal(visits, 0, 'the renderer owns weapon descendant matrices');
  assert.notEqual(actual.pos.x, .2, 'listener position must include updated ancestors');
});

test('audio listener retains matrix-only camera compatibility and legacy listener output', () => {
  const calls = [], audio = { dt: .1, ctx: { listener: { setPosition: (...p) => calls.push(p), setOrientation: (...p) => calls.push(p) } } };
  const listener = new Listener(audio);
  let updates = 0;
  const camera = { matrixWorld: new THREE.Matrix4(), updateMatrixWorld() { updates++; this.matrixWorld.makeTranslation(4, 5, 6); } };
  listener.update(camera, [1, 2, 3]);
  assert.equal(updates, 1); assert.deepEqual(listener.pos, { x: 4, y: 5, z: 6 });
  assert.deepEqual(listener.vel, { x: 1, y: 2, z: 3 });
  assert.deepEqual(calls, [[4, 5, 6], [-0, -0, -1, 0, 1, 0]]);
});

const rotated = (q, x, y, z) => {
  const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y, iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z, iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
};
function bridgeAudio() {
  const audio = { now: 1, dt: 1 / 60, engines: new Map(), ambience: { wind() {} }, expect() {}, setDanger() {},
    listener: { distTo: p => Math.hypot(p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]) },
    play() { return { isNull: true }; },
    engine(id) { const engine = { update(...args) { this.args = args; } }; this.engines.set(id, engine); return engine; },
  };
  return audio;
}
const stateFor = (spec, id) => ({ id, spec, kind: spec.kind, pos: new THREE.Vector3(10, 3, 30), vel: new THREE.Vector3(1, 0, 20),
  quat: new THREE.Quaternion(), speed: 20, rpm01: .6, hp01: 1, engineHp01: .8, grounded: new Uint8Array(spec.wheels.length).fill(1),
  slip: new Float32Array(spec.wheels.length), airborne: false, braking: false, boosting: false });

test('audio bridge exhaust arrays remain distinct and preserve every vehicle pose and engine input', () => {
  const audio = bridgeAudio(), bridge = new AudioBridge(audio, { playerId: 1 });
  const states = Object.values(VEHICLES).map((spec, i) => stateFor(spec, i + 1));
  const arrays = new Map();
  for (let frame = 0; frame < 100; frame++) {
    audio.now += 1 / 60;
    for (const st of states) {
      st.pos.set(frame * .2 + st.id, Math.sin(frame * .07), frame * .3 - st.id);
      st.quat.setFromEuler(new THREE.Euler(frame * .02, st.id * .1 + frame * .013, frame * -.004));
      st.speed = 20 + Math.sin(frame * .03 + st.id); st.boosting = frame % 30 < 5;
      bridge.updateCar(st, 1 / 60, { surface: frame % 2 ? 'gravel' : 'asphalt', throttle: .4 });
      const args = audio.engines.get(st.id).args, ex = args[5];
      const r = rotated(st.quat, .25, .3, -(st.spec.length || 5) * .5);
      assert.deepEqual(ex.exhaustPos, [st.pos.x + r[0], st.pos.y + r[1], st.pos.z + r[2]], st.spec.id + ':' + frame);
      assert.equal(args[0], st.rpm01); assert.equal(args[1], st.boosting ? 1 : .4); assert.equal(args[2], st.boosting ? 1 : 0);
      assert.equal(args[3], st.id === 1 ? 0 : audio.listener.distTo(st.pos)); assert.equal(args[4], st.speed);
      assert.equal(ex.pos, st.pos); assert.equal(ex.vel, st.vel); assert.equal(ex.grounded, 1); assert.equal(ex.engineHp01, .8);
      if (arrays.has(st.id)) assert.equal(ex.exhaustPos, arrays.get(st.id)); else arrays.set(st.id, ex.exhaustPos);
    }
  }
  assert.equal(new Set(arrays.values()).size, states.length);
});

test('an exhaust one-shot keeps its copied origin while the per-car scratch array moves', () => {
  const audio = bridgeAudio(), bridge = new AudioBridge(audio, { playerId: -1 });
  const st = stateFor(VEHICLES.e_muscle, 2); bridge.updateCar(st);
  const exhaust = bridge.cars.get(st.id).ex.exhaustPos, captured = [...exhaust];
  const node = () => ({ gain: {}, frequency: {}, positionX: {}, positionY: {}, positionZ: {}, connect() {} });
  const voiceAudio = { ctx: { currentTime: 1 }, rand: () => .5, _gain: node, _filter: node, _panner: node, busIn: { sfx: {} } };
  const voice = new Voice(voiceAudio, { gain: 1, cat: { ref: 8, slap: 0 }, duration: 1 }, { pos: exhaust }, 10);
  st.pos.set(100, 20, -50); st.quat.setFromEuler(new THREE.Euler(.2, 1, -.3)); bridge.updateCar(st);
  assert.equal(bridge.cars.get(st.id).ex.exhaustPos, exhaust);
  assert.notDeepEqual(exhaust, captured);
  assert.deepEqual(voice.pos, { x: captured[0], y: captured[1], z: captured[2] });
});
