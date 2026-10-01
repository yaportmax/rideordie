import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunnerController } from '../src/game/gunner.js';
import { Run } from '../src/game/run.js';
import { WorldView } from '../src/game/world_view.js';

const neutral = () => ({ dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false,
  reload: false, grenade: false, swap: 0, slot: -1, crouch: false, moveX: 0, moveZ: 0 });

function controller() {
  const events = [], kicks = [];
  const gunner = new GunnerController({ weapons: ['pistol'] }, {
    ownCar: () => null, targets: function* () {}, raycastWorld: () => null,
    emit: event => events.push(event), kick: (...values) => kicks.push(values),
  });
  gunner.muzzle.set(5, 2, -7);
  return { gunner, events, kicks };
}

function withFixedRandom(fn) {
  const random = Math.random;
  Math.random = () => .5;
  try { return fn(); } finally { Math.random = random; }
}

test('legacy player crouch state and pressed crouch input reset immediately, including a zero-time frame', () => {
  const { gunner } = controller();
  for (const dt of [0, 1 / 120, 1 / 30]) {
    gunner.crouch = 1;
    gunner.update(dt, { ...neutral(), crouch: true }, null, 0);
    assert.equal(gunner.crouch, 0, `crouch remains disabled at dt=${dt}`);
  }
});

test('legacy player bed position and pressed movement input reset immediately in both directions', () => {
  const { gunner } = controller();
  for (const [dt, moveX, moveZ] of [[0, 1, -1], [1 / 60, -1, 1], [1 / 30, 1, 1]]) {
    gunner.pos.set(.55, 0, -.45);
    gunner.update(dt, { ...neutral(), moveX, moveZ }, null, 0);
    assert.deepEqual(gunner.pos.toArray(), [0, 0, 0], `walking remains disabled at dt=${dt}`);
  }
});

test('stale crouch cannot grant player spread or recoil bonuses even before the next input update', () => {
  const standing = controller(), legacy = controller();
  legacy.gunner.crouch = 1;
  for (const ads of [0, .5, 1]) {
    standing.gunner.ads = legacy.gunner.ads = ads;
    assert.equal(legacy.gunner.spreadNow(), standing.gunner.spreadNow(), `same spread at ADS=${ads}`);
  }
  standing.gunner.ads = legacy.gunner.ads = 0;
  const cam = { position: new THREE.Vector3(5, 2, -8), dir: new THREE.Vector3(0, 0, 1) };
  withFixedRandom(() => standing.gunner.fire(cam));
  withFixedRandom(() => legacy.gunner.fire(cam));
  const standingShot = standing.events.find(event => event.t === 'shot');
  const legacyShot = legacy.events.find(event => event.t === 'shot');
  assert.ok(standingShot?.rays.length && legacyShot?.rays.length, 'both controllers emit a real hitscan shot');
  assert.deepEqual(legacyShot.rays, standingShot.rays, 'spread produces the same physical endpoints');
  assert.deepEqual(legacy.kicks, standing.kicks, 'camera recoil has no crouch discount');
  assert.equal(legacy.gunner.pitch, standing.gunner.pitch, 'aim recoil has no crouch discount');
  assert.equal(legacy.gunner.yaw, standing.gunner.yaw);
  assert.equal(legacy.gunner.magNow, standing.gunner.magNow);
  assert.equal(legacy.gunner.shots, 1);
});

test('the local player eye remains standing at the fixed bed position despite stale crouch and movement', () => {
  const seat = [.15, 1.25, -.95], restComHeight = .72;
  const pst = { spec: { seats: { gunner: seat } }, ride: { restComHeight },
    pos: new THREE.Vector3(17, 2.4, -31), quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(.12, .7, -.08, 'YXZ')) };
  const run = Object.assign(Object.create(Run.prototype), { gunner: { crouch: 1, pos: new THREE.Vector3(.55, 0, -.45) } });
  const expected = new THREE.Vector3(seat[0], seat[1] + 1.66 - restComHeight, seat[2] + .08).applyQuaternion(pst.quat).add(pst.pos);
  assert.deepEqual(run._gunnerEye(pst, new THREE.Vector3()).toArray(), expected.toArray());
  run.gunner.crouch = 0; run.gunner.pos.set(0, 0, 0);
  assert.deepEqual(run._gunnerEye(pst, new THREE.Vector3()).toArray(), expected.toArray());
});

test('the host normalizes legacy remote crouch and bed movement while preserving aim, weapon and firing input', () => {
  const run = Object.assign(Object.create(Run.prototype), { sim: {}, gunnerRemote: { crouch: true, x: .4, z: -.3 } });
  run.onNet({ t: 'g', y: .76, p: -.24, f: 1, c: 1, a: 1, w: 2, r: 1, x: .55, z: -.45 });
  assert.deepEqual(run.gunnerRemote, { yaw: .76, pitch: -.24, fire: true, crouch: false,
    ads: true, weapon: 2, reloading: true, x: 0, z: 0 });
});

test('gunner network packets keep removed stance and movement fields at zero even with stale controller values', () => {
  const packets = [];
  const run = Object.assign(Object.create(Run.prototype), {
    gunnerSendAcc: 0, outEvents: [], net: { sendJSON: (packet, fast) => packets.push({ packet, fast }) },
    gunner: { yaw: 1.23456, pitch: -.123456, trigger: true, magNow: 3, crouch: 1, ads: 1,
      cur: 2, reloading: true, pos: new THREE.Vector3(.55, 0, -.45) },
  });
  run._sendGunner(1 / 60); assert.equal(packets.length, 0, 'the existing 30 Hz send gate is retained');
  run._sendGunner(1 / 60);
  assert.deepEqual(packets, [{ packet: { t: 'g', y: 1.2346, p: -.1235, f: 1, c: 0, a: 1, w: 2, r: 1, x: 0, z: 0 }, fast: true }]);
});

function poseWorld() {
  const world = Object.create(WorldView.prototype), records = new Map(), updates = [];
  Object.assign(world, { cars: records, playerWeapon: 'pistol', fx: {}, loose: [], debris: { update() {} }, _projectiles() {}, handleEvent() {} });
  world.ensure = (state) => {
    if (records.has(state.id)) return records.get(state.id);
    const crew = {}, crewEntries = [];
    for (const role of ['driver', 'gunner', 'gunner2']) {
      const actor = { deadT: -1, root: {}, update(dt, pose) { updates.push({ id: state.id, role, values: { ...pose } }); } };
      crew[role] = actor; crewEntries.push({ role, crew: actor, pose: {} });
    }
    const view = { lodOn: false, wheelNodes: new Map(), update() {}, setLights() {}, setLod(value) { this.lodOn = value; } };
    const record = { id: state.id, crew, crewEntries, view, wreck: false }; records.set(state.id, record); return record;
  };
  const state = (id, kind) => ({ id, kind, pos: new THREE.Vector3(id * 4, 0, 0), quat: new THREE.Quaternion(),
    vel: new THREE.Vector3(0, 0, 25), hp01: 1, driverAlive: true, gunnerAlive: true, gunner2Alive: true,
    steer: .2, speed: 25, airborne: false, intent: 'shoot',
    gunner: { yaw: .6, pitch: .1, fire: true, crouch: true, x: .4, z: -.2 },
    gunner2: { yaw: -.6, pitch: -.1, fire: false, crouch: true, x: -.3, z: .25 } });
  return { world, updates, states: new Map([[1, state(1, 'player')], [2, state(2, 'enemy')]]) };
}

test('world poses keep both player gunner roles standing and fixed while retaining enemy crouch and bed offsets', () => {
  const { world, updates, states } = poseWorld();
  const local = { firstPerson: true, crouch: 1, bedX: .55, bedZ: -.45 };
  const step = () => world.update(1 / 60, states, [], { cameraPos: new THREE.Vector3(), localGunner: local });
  step();
  const latest = (id, role) => updates.filter(update => update.id === id && update.role === role).at(-1).values;
  for (const role of ['gunner', 'gunner2']) {
    const playerPose = latest(1, role), enemyPose = latest(2, role), enemyInput = states.get(2)[role];
    assert.equal(playerPose.crouch, false, `${role}: player crouch removed`);
    assert.equal(playerPose.bedX, 0, `${role}: player lateral movement removed`);
    assert.equal(playerPose.bedZ, 0, `${role}: player fore/aft movement removed`);
    assert.equal(enemyPose.crouch, true, `${role}: enemy crouch retained`);
    assert.equal(enemyPose.bedX, enemyInput.x); assert.equal(enemyPose.bedZ, enemyInput.z);
    assert.equal(enemyPose.aimYaw, enemyInput.yaw); assert.equal(playerPose.fire, states.get(1)[role].fire);
  }
  states.get(2).gunner.crouch = false; states.get(2).gunner.x = -.12; states.get(2).gunner.z = .18;
  states.get(2).gunner2.crouch = false; states.get(2).gunner2.x = .21; states.get(2).gunner2.z = -.22;
  step();
  for (const role of ['gunner', 'gunner2']) {
    const playerPose = latest(1, role), enemyPose = latest(2, role);
    assert.deepEqual([playerPose.crouch, playerPose.bedX, playerPose.bedZ], [false, 0, 0]);
    assert.deepEqual([enemyPose.crouch, enemyPose.bedX, enemyPose.bedZ], [false, states.get(2)[role].x, states.get(2)[role].z], 'cached enemy poses refresh independently');
  }
});
