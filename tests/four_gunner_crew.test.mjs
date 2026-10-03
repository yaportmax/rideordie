import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Car, GhostCar, GUNNER_ROLES } from '../src/sim/car.js';
import { VEHICLES, rideInfo } from '../src/data/vehicles.js';
import { makeCarState, stateFromCar } from '../src/view/car_state.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';
import { createRunHeader, encodeRunPacket, decodeRunPacket, NET_PROTOCOL } from '../src/net/run_packet.js';
import { WorldView } from '../src/game/world_view.js';

const GUN_NAMES = { gunner: 'rifle', gunner2: 'smg', gunner3: 'shotgun', gunner4: 'mg' };
const close = (a, b, epsilon = .00021) => assert.ok(Math.abs(a - b) < epsilon, `${a} agrees with ${b}`);

function carFixture(specId = 'e_warwagon', id = 7) {
  const spec = VEHICLES[specId]; assert.ok(spec, 'production vehicle catalogue contains ' + specId);
  const ride = rideInfo(spec);
  const pos = new THREE.Vector3(12, ride.restComHeight, 40), quat = new THREE.Quaternion();
  const veh = {
    pos, quat, vel: new THREE.Vector3(1, 0, 24), angvel: new THREE.Vector3(0, .02, 0), poseRevision: 37,
    restComHeight: ride.restComHeight, wheels: spec.wheels.map(() => ({ L: .4, slip: .25, grounded: true, flat: false })),
    steerAngle: .12, rpm01: .6, brakeApplied: 0, speed: 24, grounded: spec.wheels.length, airTime: 0,
    nitroRechargeLocked: true, lerpPose(_alpha, p, q) { p.copy(pos); q.copy(quat); },
  };
  const car = new Car({}, id, spec, veh, spec.kind);
  car.gunName = spec.kind === 'enemy' ? 'rifle' : null;
  car.gunNames = spec.kind === 'enemy' ? { ...GUN_NAMES } : {};
  for (const [index, role] of GUNNER_ROLES.entries()) if (car.crew[role]) {
    Object.assign(car.crew[role], { aimYaw: -.75 + .5 * index, aimPitch: -.15 + .1 * index,
      fire: index % 2 === 0, ads: index !== 1, crouch: index === 3, reloading: index === 1 });
  }
  return car;
}

function packet(cars, tick = 30, time = .25) {
  return encodeSnapshot({ cars: new Map(cars.map(car => [car.id, car])), time, state: 'run',
    projectiles: { rockets: [], grenades: [] }, boss: null }, tick,
  { hp01: 1, dhp01: 1, ghp01: 1, nitro01: .25, dist: 40, medkits: 2 });
}

function materialize(bytes) {
  const decoded = decodeSnapshot(bytes); assert.ok(decoded, 'the actual receiver accepts encoded bytes');
  const buffer = new SnapshotBuffer(); buffer.push(decoded, 10); buffer.sample(10);
  return { decoded, buffer };
}

test('the production warwagon has four independent crew and identical local/remote hit zones', () => {
  const car = carFixture(), st = stateFromCar(car, 1, makeCarState(car.id, car.spec.id, car.kind));
  const ghost = new GhostCar(st); ghost.sync(st);
  assert.equal(car.spec.gunners, 4); assert.equal(car.crewAlive(), 5);
  assert.deepEqual(Object.keys(car.crew), ['driver', ...GUNNER_ROLES]);
  assert.deepEqual(ghost.zones, car.zones);
  for (const role of GUNNER_ROLES) {
    assert.equal(car.zones.filter(zone => zone.role === role).length, 3, role + ' has head, body and legs');
    const seat = car.spec.seats[role], side = Math.sign(seat[0]) || 1;
    // Cast from its own side so the opposite roof crew cannot screen this head.
    car.crew[role].crouch = false; st[role].crouch = false; ghost.sync(st);
    const origin = new THREE.Vector3(seat[0] + side * 5, seat[1] + 1.62, seat[2]).add(car.pos).add(new THREE.Vector3(0, -car.veh.restComHeight, 0));
    const direction = new THREE.Vector3(-side, 0, 0);
    const local = car.raycast(origin, direction, 10), remote = ghost.raycast(origin, direction, 10);
    assert.equal(local?.zone.kind, role + '_head'); assert.equal(remote?.zone.kind, role + '_head');
    close(local.t, remote.t, 1e-10); assert.deepEqual(local.point.toArray(), remote.point.toArray());
    car.crew[role].alive = false; st[role + 'Alive'] = false; ghost.sync(st);
    assert.notEqual(car.raycast(origin, direction, 5.4)?.zone.role, role, 'dead ' + role + ' no longer blocks bullets');
    assert.notEqual(ghost.raycast(origin, direction, 5.4)?.zone.role, role, 'remote dead crew agrees');
    car.crew[role].alive = true; st[role + 'Alive'] = true; ghost.sync(st);
  }
});

test('optional v4 carries all four distinct aim, fire, alive and weapon states with bounded overhead', () => {
  const car = carFixture(), ordinary = carFixture('truck_t1', 1);
  const ordinaryBytes = packet([ordinary]); assert.equal(new Uint8Array(ordinaryBytes)[0], 3);
  const bytes = packet([car, ordinary]); assert.equal(new Uint8Array(bytes)[0], 4);
  const { decoded, buffer } = materialize(bytes), st = buffer.states.get(car.id);
  assert.equal(decoded.cars.length, 2); assert.equal(NET_PROTOCOL, 7);
  assert.equal(st.poseRevision, 37); assert.equal(st.nitroRechargeLocked, true);
  assert.equal(st.nWheels, car.spec.wheels.length);
  for (const role of GUNNER_ROLES) {
    const crew = car.crew[role], received = st[role];
    assert.equal(st[role + 'Alive'], true); close(received.yaw, crew.aimYaw); close(received.pitch, crew.aimPitch);
    assert.equal(received.fire, crew.fire); assert.equal(received.crouch, crew.crouch);
    assert.equal(received.ads, crew.ads); assert.equal(received.reloading, crew.reloading);
    assert.equal(st.gunNames[role], GUN_NAMES[role]);
  }
  assert.equal(buffer.states.get(1).gunner3Alive, false);
  assert.equal(buffer.states.get(1).gunner4Alive, false);
  // The first car adds 16 bytes (4 metadata + 2x6 crew); the ordinary car adds 4.
  const noExtra = { ...car, crew: { driver: car.crew.driver, gunner: car.crew.gunner, gunner2: car.crew.gunner2 } };
  const baseline = packet([noExtra, ordinary]); assert.equal(new Uint8Array(baseline)[0], 3);
  assert.equal(bytes.byteLength - baseline.byteLength, 20);
  const padded = new Uint8Array(bytes.byteLength + 13); padded.set(new Uint8Array(bytes), 9);
  assert.equal(decodeSnapshot(padded.subarray(9, 9 + bytes.byteLength)).cars[0].g3fire, true);
});

test('four-crew death updates and lifetime isolation survive the production envelope and monotonic interpolation', () => {
  const car = carFixture(), live = decodeSnapshot(packet([car], 30, .25));
  car.crew.gunner3.alive = false; car.crew.gunner3.fire = false;
  car.crew.gunner4.alive = false; car.crew.gunner4.fire = false;
  const deadBytes = packet([car], 60, .5), dead = decodeSnapshot(deadBytes);
  const buffer = new SnapshotBuffer(); assert.equal(buffer.push(live, 10), true); assert.equal(buffer.push(dead, 10.25), true);
  buffer.clockOffset = 9.75; buffer.delay = 0; buffer.sample(10.25);
  const st = buffer.states.get(car.id); assert.equal(st.gunner3Alive, false); assert.equal(st.gunner4Alive, false);
  assert.equal(st.gunner3.fire, false); assert.equal(st.gunner4.fire, false);
  assert.equal(buffer.push(live, 10.3), false, 'late old aim/alive cannot rewind the four-crew stream');
  const oldHeader = createRunHeader('four-crew-old-life'), newHeader = createRunHeader('four-crew-new-life');
  const oldPacket = encodeRunPacket(oldHeader, deadBytes);
  assert.equal(decodeRunPacket(newHeader, oldPacket), null);
  assert.equal(decodeSnapshot(decodeRunPacket(oldHeader, oldPacket)).cars[0].g4fire, false);
});

test('extended crew rejects malformed masks, reserved flags, weapon IDs and every truncated payload', () => {
  const bytes = packet([carFixture()]);
  const extension = 90; // v3 fixed vehicle fields end immediately after gunner2.fire.
  for (const [offset, values] of [
    [extension, [4, 128, 255]], [extension + 1, [9, 255]], [extension + 2, [9, 255]],
    [extension + 3, [16, 255, 1]], [extension + 8, [16, 255]], [extension + 9, [9, 255]],
    [extension + 14, [16, 255]], [extension + 15, [9, 255]],
  ]) for (const value of values) {
    const malformed = bytes.slice(0); new DataView(malformed).setUint8(offset, value);
    assert.equal(decodeSnapshot(malformed), null, `rejects field ${offset} value ${value}`);
  }
  for (let size = 0; size < bytes.byteLength; size++) assert.equal(decodeSnapshot(bytes.slice(0, size)), null, 'truncated at ' + size);
  const unsupported = bytes.slice(0); new DataView(unsupported).setUint8(0, 5); assert.equal(decodeSnapshot(unsupported), null);
  const falseVersion = bytes.slice(0); new DataView(falseVersion).setUint8(0, 3); assert.equal(decodeSnapshot(falseVersion), null);
  const unknownWeapon = carFixture(); unknownWeapon.gunNames.gunner4 = 'unknown'; assert.equal(packet([unknownWeapon]), null);
  const noSeat = carFixture('truck_t1'); noSeat.crew.gunner3 = { alive: true, aimYaw: 0, aimPitch: 0 };
  assert.equal(packet([noSeat]), null, 'undeclared extra seats cannot alias a legitimate chassis');
});

test('WorldView creates four separated armed enemy figures and routes each shot, death and grenade animation correctly', () => {
  const car = carFixture(), st = stateFromCar(car, 1, makeCarState(car.id, car.spec.id, car.kind));
  const view = new WorldView({ scene: new THREE.Scene() });
  try {
    const record = view.ensure(st); assert.deepEqual(Object.keys(record.crew), ['driver', ...GUNNER_ROLES]);
    const modelIds = { gunner: 'rifle', gunner2: 'smg', gunner3: 'shotgun', gunner4: 'lmg' };
    for (const role of GUNNER_ROLES) {
      assert.equal(record.crew[role].weaponId, modelIds[role]);
      assert.deepEqual(record.crew[role].root.position.toArray(), car.spec.seats[role]);
      for (const other of GUNNER_ROLES) if (other !== role) assert.ok(record.crew[role].root.position.distanceTo(record.crew[other].root.position) > 1.2);
    }
    const states = new Map([[car.id, st]]), calls = [];
    for (const role of GUNNER_ROLES) {
      record.crew[role].fire = () => calls.push('shot:' + role);
      record.crew[role].throwGrenade = () => calls.push('throw:' + role);
      record.crew[role].die = () => calls.push('dead:' + role);
      view.handleEvent({ t: 'shot', src: car.id, role, weapon: 'enemy' }, states);
      view.handleEvent({ t: 'grenadeThrow', src: car.id, role }, states);
      view.handleEvent({ t: 'crewDead', id: car.id, role }, states);
    }
    assert.deepEqual(calls, GUNNER_ROLES.flatMap(role => ['shot:' + role, 'throw:' + role, 'dead:' + role]));
  } finally { view.dispose(); }
});
