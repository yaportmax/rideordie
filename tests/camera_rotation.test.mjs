import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ChaseCam, GunnerCam } from '../src/view/camera_rig.js';

const up = new THREE.Vector3(0, 1, 0);
const forward = camera => new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);

test('both chase presets stay continuous during full spins against a fixed travel direction', () => {
  for (const mode of [1, 2]) for (const sign of [-1, 1]) {
    const camera = new THREE.PerspectiveCamera(), rig = new ChaseCam(camera);
    rig.mode = mode;
    const pos = new THREE.Vector3(25, 2, 50000), quat = new THREE.Quaternion();
    const velocity = new THREE.Vector3(0, 0, 36), dt = 1 / 120;
    const update = heading => rig.update(dt, pos, quat.setFromAxisAngle(up, heading), velocity);
    for (let i = 0; i < 600; i++) update(0);
    let previous = camera.quaternion.clone();
    let offset = camera.position.clone().sub(pos);
    // Fixed velocity during a chassis spin is the antipodal case that made the
    // old half-wrapped-heading target jump to the opposite side of the truck.
    for (let i = 1; i <= 960; i++) {
      update(sign * i * Math.PI / 240);
      assert.ok(previous.angleTo(camera.quaternion) < .05, `mode ${mode}, spin ${sign}, frame ${i}`);
      const nextOffset = camera.position.clone().sub(pos);
      assert.ok(offset.distanceTo(nextOffset) < .55, 'chase offset must not flip across the car');
      previous.copy(camera.quaternion); offset.copy(nextOffset);
    }
  }
});

test('chase travel bias has no discontinuity around the old speed threshold', () => {
  const camera = new THREE.PerspectiveCamera(), rig = new ChaseCam(camera); rig.mode = 1;
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  const velocity = new THREE.Vector3(5.999, 0, 0), dt = 1 / 60;
  for (let i = 0; i < 300; i++) rig.update(dt, pos, quat, velocity);
  const previous = camera.quaternion.clone();
  velocity.x = 6.001;
  rig.update(dt, pos, quat, velocity);
  assert.ok(previous.angleTo(camera.quaternion) < .002, 'crossing 6 m/s must not start a sudden camera orbit');
});

test('cockpit and both gunner views retain continuous aim across repeated yaw wraps', () => {
  for (const worldZ of [0, 50000]) for (const sign of [-1, 1]) {
    const pos = new THREE.Vector3(0, 2, worldZ), quat = new THREE.Quaternion();
    const eye = pos.clone().add(new THREE.Vector3(.3, 1.6, .5));
    const camera = new THREE.PerspectiveCamera(), driver = new ChaseCam(camera);
    let previous;
    for (let i = 0; i <= 960; i++) {
      const yaw = sign * i * Math.PI / 240;
      quat.setFromAxisAngle(up, yaw);
      driver.update(1 / 120, pos, quat, new THREE.Vector3(), { cockpitEye: eye });
      if (previous) assert.ok(previous.angleTo(camera.quaternion) < .03, 'cockpit yaw must cross PI without a spin');
      previous = camera.quaternion.clone();
    }
    for (const firstPerson of [false, true]) {
      const gunner = new GunnerCam(camera); gunner.firstPerson = firstPerson;
      previous = null;
      for (let i = 0; i <= 960; i++) {
        const yaw = sign * i * Math.PI / 240;
        // Feed the same wrapped world angles as GunnerController does.
        const wrappedYaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        gunner.update(1 / 120, eye, wrappedYaw, .12, false, { truckQuat: quat });
        const expected = new THREE.Vector3(Math.sin(yaw) * Math.cos(.12), Math.sin(.12), Math.cos(yaw) * Math.cos(.12));
        assert.ok(forward(camera).dot(expected) > .999999, 'gunner view must follow the current world aim');
        if (previous) assert.ok(previous.angleTo(camera.quaternion) < .03, 'gunner yaw must cross PI without a spin');
        previous = camera.quaternion.clone();
      }
    }
  }
});
