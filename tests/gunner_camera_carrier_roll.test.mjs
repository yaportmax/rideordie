// Actual-source regressions for carrier pitch/roll singularities and authored bank feedback.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunnerController } from '../src/game/gunner.js';
import { GunnerCam } from '../src/view/camera_rig.js';

const command = { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1 };
const rotation = (yaw, pitch = 0, roll = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
const eye = new THREE.Vector3(0, 3, 40);
function setup(weapon = 'pistol') {
  const camera = new THREE.PerspectiveCamera(76, 16 / 9, .05, 4000);
  return {
    camera, rig: new GunnerCam(camera),
    gunner: new GunnerController({ weapons: [weapon] }, { emit() {}, ownCar: () => null, targets: function* () {}, raycastWorld: () => null }),
  };
}

for (const [weapon, ads, scoped] of [['pistol', false, false], ['rifle', true, false], ['sniper', true, true]]) {
  test(`${weapon}: complete controller/camera path remains orientation-continuous through chassis vertical pitch`, () => {
    for (const sign of [-1, 1]) {
      const { camera, rig, gunner } = setup(weapon); let last = null;
      gunner.ads = ads ? 1 : 0;
      for (let degrees = 85; degrees <= 95; degrees += .25) {
        const q = rotation(.4, sign * degrees * Math.PI / 180);
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
        // Zero dt isolates carrier orientation from authored scope breathing;
        // camera still updates with real 60Hz damping and view-specific scope.
        gunner.update(0, { ...command, ads }, null, Math.atan2(forward.x, forward.z), { poseRevision: 1, carQuat: q });
        rig.update(1 / 60, eye, gunner.yaw, gunner.pitch, ads, { truckQuat: q, scoped });
        assert.ok(Math.abs(rig.roll) < 1e-12, 'pure pitch has no lateral tilt');
        if (last) assert.ok(last.angleTo(camera.quaternion) < 1e-7, 'pure pitch must not rotate the world aim/camera');
        last = camera.quaternion.clone();
      }
    }
  });
}

test('authored ordinary chassis roll feedback is preserved exactly through plus/minus85 degrees and all yaw quadrants', () => {
  for (const yaw of [-Math.PI, -1.4, 0, 1.4, Math.PI]) {
    for (const degrees of [-85, -45, -10, 0, 10, 45, 85]) {
      const { rig } = setup(); const roll = degrees * Math.PI / 180;
      rig.update(1 / 60, eye, .6, .2, false, { truckQuat: rotation(yaw, 0, roll) });
      const expected = roll * .3 * (1 - Math.exp(-10 / 60));
      assert.ok(Math.abs(rig.roll - expected) < 1e-12, `ordinary bank feedback ${yaw}/${degrees}`);
    }
  }
});

test('lateral tilt is sign-equivalent and bounded for continuous rolling/pitching/inverted poses', () => {
  const { camera, rig } = setup(); let previous = null;
  for (let i = 0; i <= 720; i++) {
    const phase = i * Math.PI / 180;
    const q = rotation(phase, 1.65 * Math.sin(phase), phase);
    if (i % 2) q.set(-q.x, -q.y, -q.z, -q.w);
    rig.update(1 / 60, eye, .6, .2, false, { truckQuat: q });
    assert.ok(Number.isFinite(rig.roll) && Math.abs(rig.roll) <= Math.PI * .15 + 1e-12);
    if (previous) assert.ok(previous.angleTo(camera.quaternion) < .05, 'smooth carrier poses must not invent camera roll jumps');
    previous = camera.quaternion.clone();
  }
});

test('equivalent quaternion signs preserve the same near-vertical bank target', () => {
  for (const pitch of [89.9, 90, 90.1, -89.9, -90, -90.1]) {
    const q = rotation(2.6, pitch * Math.PI / 180, .7);
    const a = setup(), b = setup();
    a.rig.update(1 / 60, eye, .6, .2, false, { truckQuat: q });
    b.rig.update(1 / 60, eye, .6, .2, false, { truckQuat: new THREE.Quaternion(-q.x, -q.y, -q.z, -q.w) });
    assert.equal(a.rig.roll, b.rig.roll);
    assert.ok(a.camera.quaternion.angleTo(b.camera.quaternion) < 1e-7);
  }
});

test('explicit recovery preserves world aim while camera bank converges with authored10 damping', () => {
  const { camera, rig, gunner } = setup();
  const previous = rotation(.2, 0, .7), recovered = rotation(3.1, 1.8, 0);
  gunner.update(0, command, null, .2, { carQuat: previous, poseRevision: 65535 });
  rig.roll = .7 * .3;
  rig.update(0, eye, gunner.yaw, gunner.pitch, false, { truckQuat: previous });
  const before = camera.quaternion.clone();
  gunner.update(0, command, null, -Math.PI + .02, { carQuat: recovered, poseRevision: 0 });
  assert.equal(gunner.yaw, 0, 'revision wrap keeps world aim');
  const expected = rig.roll * Math.exp(-10 / 60);
  rig.update(1 / 60, eye, gunner.yaw, gunner.pitch, false, { truckQuat: recovered });
  assert.ok(Math.abs(rig.roll - expected) < 1e-12, 'bank retains exact authored time constant');
  assert.ok(before.angleTo(camera.quaternion) < .04, 'recovery releases old bank without invented Euler PI roll');
  for (let i = 0; i < 120; i++) rig.update(1 / 60, eye, gunner.yaw, gunner.pitch, false, { truckQuat: recovered });
  assert.ok(Math.abs(rig.roll) < 1e-8);
});
