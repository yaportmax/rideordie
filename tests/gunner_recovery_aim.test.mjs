import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunnerController } from '../src/game/gunner.js';
import { Car } from '../src/sim/car.js';
import { VEHICLES } from '../src/data/vehicles.js';
import { makeCarState, stateFromCar } from '../src/view/car_state.js';

const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const neutral = { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1 };
const ctx = () => ({ emit() {}, ownCar: () => null, targets: function* () {}, raycastWorld: () => null });

for (const [weapon, ads, mouseMul] of [['pistol', false, 1], ['rifle', true, .6], ['sniper', true, .28]]) {
  test(`${weapon}: recovery preserves world aim and the current mouse turn instead of inheriting a truck teleport`, () => {
    for (const [before, after] of [[4, 5], [65535, 0]]) {
      const gunner = new GunnerController({ weapons: [weapon] }, ctx());
      gunner.ads = ads ? 1 : 0; gunner.yaw = .7;
      gunner.update(1 / 60, { ...neutral, ads }, null, .05, { poseRevision: before });
      const previous = gunner.yaw;
      gunner.update(1 / 60, { ...neutral, ads, dYaw: .025 }, null, Math.PI - .05, { poseRevision: after });
      assert.ok(Math.abs(angle(gunner.yaw - previous) - .025 * mouseMul) < .002, 'a near-180 degree recovery must not turn the gunner camera');
      const recovered = gunner.yaw;
      gunner.update(1 / 60, { ...neutral, ads }, null, Math.PI - .03, { poseRevision: after });
      assert.ok(Math.abs(angle(gunner.yaw - recovered) - .02 * .55) < .002, 'normal carrier steering resumes immediately after recovery');
    }
  });
}

test('ordinary chassis heading crosses the PI seam with its authored 55 percent inheritance', () => {
  const gunner = new GunnerController({ weapons: ['pistol'] }, ctx());
  gunner.update(1 / 60, neutral, null, Math.PI - .01, { poseRevision: 8 });
  const before = gunner.yaw;
  gunner.update(1 / 60, neutral, null, -Math.PI + .01, { poseRevision: 8 });
  assert.ok(Math.abs(angle(gunner.yaw - before) - .02 * .55) < 1e-12);
});

test('legacy controller callers without a pose revision retain normal carrier turn inheritance', () => {
  const gunner = new GunnerController({ weapons: ['pistol'] }, ctx());
  gunner.update(1 / 60, neutral, null, -.2);
  const before = gunner.yaw;
  gunner.update(1 / 60, neutral, null, .1);
  assert.ok(Math.abs(angle(gunner.yaw - before) - .3 * .55) < 1e-12);
});

test('host actual-source CarState carries wrapped vehicle recovery revisions into stabilized gunner aim', () => {
  let heading = .05;
  const vehicle = {
    poseRevision: 65535, vel: new THREE.Vector3(), grounded: 4, airTime: 0,
    wheels: VEHICLES.truck_t1.wheels.map(() => ({ L: .3, slip: 0, grounded: true })),
    lerpPose(_alpha, position, quaternion) { position.set(0, 2, 40); quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading); },
  };
  const car = new Car(null, 1, VEHICLES.truck_t1, vehicle, 'player');
  const state = makeCarState(1, 'truck_t1', 'player');
  assert.equal(state.poseRevision, 0);
  const gunner = new GunnerController({ weapons: ['pistol'] }, ctx());
  stateFromCar(car, 1, state);
  assert.equal(state.poseRevision, 65535);
  gunner.update(1 / 60, neutral, null, heading, { poseRevision: state.poseRevision });
  const before = gunner.yaw;
  vehicle.poseRevision = 0; heading = Math.PI - .05;
  stateFromCar(car, 1, state);
  assert.equal(state.poseRevision, 0);
  gunner.update(1 / 60, neutral, null, heading, { poseRevision: state.poseRevision });
  assert.ok(Math.abs(angle(gunner.yaw - before)) < 1e-12, 'host recovery revision must prevent inherited camera snap');
});
