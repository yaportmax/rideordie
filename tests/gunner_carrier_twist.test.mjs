import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunnerController } from '../src/game/gunner.js';

// Actual controller regressions: run after merging the WORK carrier-twist hunk.
const neutral = { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1 };
const ctx = { emit() {}, ownCar: () => null, targets: function* () {}, raycastWorld: () => null };
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const Y = new THREE.Vector3(0, 1, 0);
const rotation = (yaw, pitch = 0, roll = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
const heading = q => { const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q); return Math.atan2(f.x, f.z); };
const controller = (weapon = 'pistol') => new GunnerController({ weapons: [weapon] }, ctx);
function step(g, q, revision = 1, cmd = neutral) {
  const before = g.yaw;
  g.update(1 / 60, cmd, null, heading(q), { carQuat: q, poseRevision: revision });
  return wrap(g.yaw - before);
}
function near(actual, expected, label) { assert.ok(Math.abs(actual - expected) < 1e-10, `${label}: ${actual} vs ${expected}`); }

test('quaternion carrier inheritance keeps 55 percent through yaw seams and quaternion sign changes', () => {
  for (const sign of [-1, 1]) {
    const g = controller(); let yaw = sign * (Math.PI - .02);
    step(g, rotation(yaw));
    for (let i = 0; i < 600; i++) {
      yaw += sign * .03;
      const q = rotation(yaw);
      if (i % 2) q.set(-q.x, -q.y, -q.z, -q.w);
      near(step(g, q), sign * .03 * .55, 'seam/sign-equivalent pose');
    }
  }
});

test('continuous chassis pitch through vertical does not inherit a projected-heading snap', () => {
  for (const sign of [-1, 1]) {
    const g = controller(); step(g, rotation(.4, sign * 85 * Math.PI / 180));
    for (let degrees = 85.25; degrees <= 95; degrees += .25) {
      near(step(g, rotation(.4, sign * degrees * Math.PI / 180)), 0, 'vertical crossing');
    }
  }
});

test('world-Y steering on rolled or pitched carriers remains authored and incremental', () => {
  for (const [pitch, roll] of [[0, 1.4], [Math.PI / 2, .8], [1.7, -2.4]]) {
    const g = controller(); let q = rotation(.6, pitch, roll);
    step(g, q);
    for (let i = 0; i < 400; i++) {
      q = q.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(Y, -.012));
      near(step(g, q), -.012 * .55, 'world twist while banked');
    }
  }
});

test('degenerate horizontal 180-degree swing is finite and does not invent a Y turn', () => {
  for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)]) {
    const g = controller(); const q = rotation(.3, .7, .2); step(g, q);
    const flipped = q.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(axis, Math.PI));
    near(step(g, flipped), 0, 'undefined twist');
    near(step(g, flipped.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(Y, .02))), .02 * .55, 'next valid twist');
  }
});

for (const [weapon, ads, multiplier] of [['pistol', false, 1], ['rifle', true, .6], ['sniper', true, .28]]) {
  test(`${weapon}: wrapped recovery revision skips carrier reset and preserves current mouse aim`, () => {
    const g = controller(weapon); g.ads = ads ? 1 : 0;
    // dt=0 keeps scope breathing stationary, isolating the actual aim update.
    const update = (q, revision, dYaw) => {
      const before = g.yaw;
      g.update(0, { ...neutral, ads, dYaw }, null, heading(q), { carQuat: q, poseRevision: revision });
      return wrap(g.yaw - before);
    };
    update(rotation(.2), 65535, 0);
    const recovered = rotation(3.1, 1.8, .4);
    near(update(recovered, 0, .07), .07 * multiplier, 'current mouse during recovery');
    near(update(recovered.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(Y, .04)), 0, -.02), .04 * .55 - .02 * multiplier, 'next-frame steering and mouse');
  });
}

test('missing/invalid carrier quaternion retains legacy heading fallback and clears stale quaternion state', () => {
  const g = controller();
  g.update(0, neutral, null, .1);
  g.update(0, neutral, null, .3);
  near(g.yaw, .2 * .55, 'legacy heading');
  step(g, rotation(.3));
  const before = g.yaw;
  g.update(0, neutral, null, .4, { carQuat: { x: NaN, y: 0, z: 0, w: 1 } });
  near(wrap(g.yaw - before), .1 * .55, 'invalid quaternion fallback');
  near(step(g, rotation(2.4)), 0, 'resume establishes fresh quaternion baseline');
  near(step(g, rotation(2.5)), .1 * .55, 'resume next steering');
});

test('normalized and unnormalized equivalent poses cannot create carrier motion or mutate input quaternion', () => {
  const g = controller(); const q = rotation(.2, .6, 1.1); step(g, q);
  const scaled = new THREE.Quaternion(q.x * 4, q.y * 4, q.z * 4, q.w * 4);
  const before = scaled.toArray();
  near(step(g, scaled), 0, 'same orientation with scaled quaternion');
  assert.deepEqual(scaled.toArray(), before);
});
