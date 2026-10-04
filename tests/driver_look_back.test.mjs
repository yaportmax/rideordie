import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChaseCam, DRIVER_CAMERA_NAMES } from '../src/view/camera_rig.js';
import { Run } from '../src/game/run.js';
import { Input, DEFAULT_BINDINGS } from '../src/core/input.js';
import { makeCarState } from '../src/view/car_state.js';

const dir = camera => new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
const close = (a, b, reason, tolerance = 1e-10) => assert.ok(a.distanceTo(b) < tolerance, `${reason}: ${a.distanceTo(b)}`);
function pose(heading, position = new THREE.Vector3(12, 2, -40)) {
  const quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
  const eye = new THREE.Vector3(.4, 1.6, .55).applyQuaternion(quaternion).add(position);
  const rearEye = new THREE.Vector3(1.4, 1.7, .7).applyQuaternion(quaternion).add(position);
  return { position, quaternion, forward, eye, rearEye, velocity: forward.clone().multiplyScalar(36) };
}

test('both chase presets reverse and return in one frame without accumulating a yaw spin or changing distance/FOV', () => {
  for (const mode of [1, 2]) for (const heading of [0, 1.2, Math.PI - .001, -Math.PI + .001]) {
    const p = pose(heading), camera = new THREE.PerspectiveCamera(), rig = new ChaseCam(camera);
    rig.mode = mode;
    const update = lookBack => rig.update(1 / 60, p.position, p.quaternion, p.velocity, { lookBack });
    for (let i = 0; i < 360; i++) update(false);
    const originalYaw = rig.yaw, originalPosition = camera.position.clone(), originalFov = camera.fov;
    const originalRadius = camera.position.clone().sub(p.position).length();
    assert.ok(dir(camera).dot(p.forward) > .98);
    for (let i = 0; i < 120; i++) {
      update(true);
      assert.ok(dir(camera).dot(p.forward) < -.98, 'held chase must face the road behind the truck');
      assert.ok(camera.position.clone().sub(p.position).dot(p.forward) > 0, 'rearward view is positioned ahead of the truck');
      assert.ok(Math.abs(camera.position.clone().sub(p.position).length() - originalRadius) < 1e-6);
      assert.ok(Math.abs(camera.fov - originalFov) < .001);
      assert.ok(Math.abs(rig.yaw - originalYaw) < 1e-12, 'look-back must not enter heading state');
    }
    update(false);
    assert.ok(dir(camera).dot(p.forward) > .98, 'release returns to forward chase immediately');
    close(camera.position, originalPosition, 'forward chase offset returns without a smoothing orbit', 1e-6);
    assert.equal(camera.near, .15);
  }
});

test('look-back remains relative to a moving, turning truck under uneven frame pacing in both chase modes', () => {
  for (const mode of [1, 2]) {
    const camera = new THREE.PerspectiveCamera(), rig = new ChaseCam(camera); rig.mode = mode;
    let time = 0;
    for (let i = 0; i < 900; i++) {
      const dt = [.016, .033, .008, .025][i % 4]; time += dt;
      const p = pose(Math.PI - .2 + time * .08, new THREE.Vector3(time * 28, 2 + Math.sin(time) * .05, -40 + time * 34));
      const held = i % 80 < 40;
      rig.update(dt, p.position, p.quaternion, p.velocity, { lookBack: held, yawRate: .08 });
      assert.ok(dir(camera).dot(p.forward) * (held ? -1 : 1) > .97);
      const relative = camera.position.clone().sub(p.position);
      assert.ok(relative.length() < 12 && relative.length() > 7, 'chase never drifts or stretches behind the moving truck');
      assert.ok(camera.quaternion.toArray().every(Number.isFinite));
    }
  }
});

test('cockpit retains its outboard rear eye, held 78-degree view and selected 85-degree forward view', () => {
  const p = pose(.6), camera = new THREE.PerspectiveCamera(), rig = new ChaseCam(camera);
  const update = back => rig.update(1 / 60, p.position, p.quaternion, new THREE.Vector3(), { cockpitEye: p.eye, lookBackEye: p.rearEye, lookBack: back, fovBase: 85 });
  for (let i = 0; i < 360; i++) update(false);
  assert.ok(dir(camera).dot(p.forward) > .99); assert.ok(Math.abs(camera.fov - 85) < .051);
  update(true);
  assert.ok(dir(camera).dot(p.forward) < -.98);
  assert.ok(camera.position.distanceTo(p.rearEye) < .003, 'cockpit rear eye is retained');
  for (let i = 0; i < 120; i++) update(true);
  assert.ok(Math.abs(camera.fov - 78) < .051);
  update(false);
  assert.ok(dir(camera).dot(p.forward) > .99);
  assert.ok(camera.position.distanceTo(p.eye) < .003);
  for (let i = 0; i < 360; i++) update(false);
  assert.ok(Math.abs(camera.fov - 85) < .051); assert.equal(camera.near, .05);
});

function runFixture() {
  const p = pose(0), camera = new THREE.PerspectiveCamera(), chase = new ChaseCam(camera);
  const cockpit = { active: true, setActive(value) { this.active = value; }, update() {}, lookBackWorld(out) { return out.copy(p.rearEye); } };
  const run = Object.assign(Object.create(Run.prototype), {
    g: { camera, driverFovBase: 85, look: { night: 0 }, audio: { setCabin() {} } },
    chase, cockpit, role: 'driver', sim: { state: 'run' }, player: { veh: { yawRate: 0 } },
    states: new Map(), camDir: new THREE.Vector3(), _introK: () => 1, _cockpitEye: (dt, state, out) => out.copy(p.eye),
  });
  const state = { pos: p.position, quat: p.quaternion, vel: new THREE.Vector3(), boosting: false, airborne: false };
  return { run, p, camera, chase, cockpit, state };
}

test('real Run camera dispatch forwards held look-back in all three modes', () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const { run, p, camera, chase, cockpit, state } = runFixture();
    const command = { throttle: 1, steer: -.7, nitro: false, lookBack: true, lookX: 0, lookY: 0, cameraToggle: false };
    const unchanged = { ...command };
    for (const mode of [0, 1, 2]) {
      chase.mode = mode;
      run._camera(1 / 60, { driver: command }, state);
      assert.ok(dir(camera).dot(p.forward) < -.98, `mode ${mode} must face backwards through real Run dispatch`);
      assert.equal(cockpit.active, false);
      assert.deepEqual(command, unchanged, 'look-back must not alter vehicle input');
      run._camera(1 / 60, { driver: { ...command, lookBack: false } }, state);
      assert.ok(dir(camera).dot(p.forward) > .98);
      assert.equal(cockpit.active, mode === 0);
    }
  } finally { globalThis.window = previousWindow; }
});

test('actual Run.update synchronizes the driver mode and cockpit visibility before posing crew, then resolves the current eye', () => {
  const previousWindow = globalThis.window; globalThis.window = {};
  try {
    const { run, p, camera, chase, cockpit } = runFixture(), states = new Map();
    const state = makeCarState(1, 'truck_t1', 'player'); states.set(1, state);
    state.pos.copy(p.position); state.quat.copy(p.quaternion); state.vel.set(0, 0, 0);
    const calls = [], observations = [], colliderOrder = []; let colliderGeneration = 0;
    Object.assign(run, {
      sim: null, simState: 'run', player: null, playerId: 1, states,
      buf: { sample: () => null }, ghosts: new Map([[1, { sync() {} }]]),
      time: 0, streakT: 0, acc: 0, events: [], netEvents: [], localEvents: [], effects: { weapons: ['pistol'] },
      gunner: null, gunnerRemote: { weapon: 0 }, humanDriver: true, humanGunner: false, eye: new THREE.Vector3(),
      hazMarks: { update() {} }, banner: { update() {} }, threatHud: { setVisible() {}, update() {} },
      _updateFrustum() {}, _hudData: () => ({}), _outcome() {},
      dressing: { update() { colliderGeneration++; colliderOrder.push('dressing'); } },
      structures: { updateRocks() { colliderGeneration++; colliderOrder.push('rocks'); } },
      _cockpitEye(dt, current, out) { calls.push('current-eye'); return out.copy(p.eye); },
      wv: { viewMap: new Map(), updateBoss() {}, update(dt, current, events, context) {
        calls.push('pose'); observations.push({ mode: chase.mode, fp: context.localDriver.firstPerson, cockpitActive: cockpit.active });
      } },
    });
    cockpit.onEvent = () => null;
    const camUpdate = chase.update;
    chase.update = function(...args) {
      calls.push('camera');
      if (chase.mode >= 3) {
        assert.equal(colliderGeneration, 2, 'the new exterior camera observes current dressing/rock mutations');
        assert.deepEqual(colliderOrder, ['dressing', 'rocks']);
      }
      return camUpdate.apply(this, args);
    };
    const update = command => {
      calls.length = 0; colliderOrder.length = 0; colliderGeneration = 0;
      run.update(1 / 60, { driver: command, gunner: {} }, 0);
      assert.deepEqual(calls, chase.mode >= 3 ? ['camera', 'pose'] : ['pose', 'current-eye', 'camera'],
        'cockpit/current-eye order stays intact; new exterior cameras precede current culling/pose');
      const observed = observations.at(-1);
      assert.equal(observed.mode, chase.mode, 'the camera and crew must select the same mode within this frame');
      assert.equal(observed.fp, chase.mode === 0);
      assert.equal(observed.cockpitActive, chase.mode === 0 && !command.lookBack);
      if (chase.mode <= 2) assert.ok(dir(camera).dot(p.forward) * (command.lookBack ? -1 : 1) > .98);
      else {
        const expectedSign = (chase.mode === 4 ? -1 : 1) * (command.lookBack ? -1 : 1);
        assert.ok(dir(camera).dot(p.forward) * expectedSign > .8, 'the front exterior actually looks back at the truck');
      }
    };
    for (const lookBack of [false, true]) {
      chase.mode = 0;
      update({ cameraToggle: false, lookBack });
      for (let next = 1; next <= DRIVER_CAMERA_NAMES.length; next++) {
        update({ cameraToggle: true, lookBack }); assert.equal(chase.mode, next % DRIVER_CAMERA_NAMES.length);
      }
    }
  } finally { globalThis.window = previousWindow; }
});

test('held keyboard B and gamepad LB map to rear-view commands while steering and throttle remain available', () => {
  const input = Object.assign(Object.create(Input.prototype), {
    keys: new Set(['KeyW', 'KeyA', 'KeyB']), pressed: new Set(), bindings: { ...DEFAULT_BINDINGS }, sens: { mouse: .0022 },
    locked: false, mouseDX: 0, mouseDY: 0, invertY: false, steerSmooth: 0, pad: null, padEdge: [],
  });
  let command = input.driver(1 / 60);
  assert.equal(command.lookBack, true); assert.equal(command.throttle, 1); assert.ok(command.steer > 0);
  input.keys.delete('KeyB'); command = input.driver(1 / 60);
  assert.equal(command.lookBack, false); assert.equal(command.throttle, 1);
  input.keys.clear(); input.pad = { axes: [-.7, 0, 0, 0], buttons: Array.from({ length: 20 }, (_, i) => ({ pressed: i === 4 || i === 7, value: i === 4 || i === 7 ? 1 : 0 })) };
  command = input.driver(1 / 60);
  assert.equal(command.lookBack, true); assert.equal(command.throttle, 1); assert.ok(command.steer > 0);
  input.pad.buttons[4] = { pressed: false, value: 0 }; command = input.driver(1 / 60);
  assert.equal(command.lookBack, false); assert.equal(command.throttle, 1);
});
