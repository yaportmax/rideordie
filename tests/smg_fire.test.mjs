import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunnerController } from '../src/game/gunner.js';

const neutral = () => ({ dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1, crouch: false, moveX: 0, moveZ: 0 });
const camera = { position: new THREE.Vector3(0, 2, 0), dir: new THREE.Vector3(0, 0, 1) };

function setup(weapons = ['smg'], levels) {
  const events = [];
  const gunner = new GunnerController({ weapons, levels }, {
    emit: (e) => events.push(e), ownCar: () => null, targets: function* () {}, raycastWorld: () => null,
  });
  const step = (seconds, cmd = {}) => {
    const input = { ...neutral(), ...cmd };
    for (let f = 0; f < Math.round(seconds * 120); f++) {
      gunner.update(1 / 120, input, camera, 0);
      input.firePressed = false;
      input.reload = false;
      input.slot = -1;
    }
  };
  return { gunner, events, step };
}

test('holding the SMG trigger fires sustained hip shots and release stops immediately', () => {
  const { gunner, events, step } = setup();
  step(0.6, { fire: true, firePressed: true });
  assert.equal(gunner.ads, 0);
  assert.ok(gunner.shots >= 7, 'a held hip-fire trigger must fire more than its first edge');
  const shots = events.filter((e) => e.t === 'shot');
  assert.equal(shots.length, gunner.shots);
  assert.equal(gunner.magNow, gunner.weapon.mag - shots.length);
  assert.ok(shots.every((e) => e.weapon === 'smg' && e.rays.length === 1));
  const beforeRelease = gunner.shots;
  step(0.3);
  assert.equal(gunner.shots, beforeRelease);
});

test('SMG continues firing while its held trigger transitions from sights to hip fire', () => {
  const { gunner, step } = setup();
  step(0.3, { fire: true, firePressed: true, ads: true });
  assert.ok(gunner.ads > 0.9);
  const beforeHip = gunner.shots;
  step(0.3, { fire: true, ads: false });
  assert.ok(gunner.ads < 0.1);
  assert.ok(gunner.shots > beforeHip + 2, 'releasing sights must not release a held fire trigger');
});

test('holding SMG hip fire through an empty magazine reloads and resumes at upgraded reload speed', () => {
  const { gunner, events, step } = setup(['smg'], { smg: { mag: 2, rel: 3 } });
  gunner.mag[0] = 1;
  step(0.1, { fire: true, firePressed: true });
  assert.equal(gunner.reloading, true);
  assert.equal(gunner.magNow, 0);
  const beforeReload = gunner.shots;
  step(gunner.weapon.reload + 0.3, { fire: true });
  assert.equal(gunner.reloading, false);
  assert.ok(gunner.shots > beforeReload, 'automatic fire must resume without a second click');
  assert.ok(gunner.magNow > 32, 'reload must retain the purchased magazine size');
  assert.equal(events.filter((e) => e.t === 'reloadEnd').length, 1);
});

test('SMG hip fire starts after switching from a reloading pistol without another trigger edge', () => {
  const { gunner, step } = setup(['pistol', 'smg']);
  gunner.mag[0] = 1;
  gunner.startReload();
  step(0.1, { slot: 1, fire: true, firePressed: true });
  assert.equal(gunner.weaponId, 'smg');
  assert.equal(gunner.reloading, false);
  assert.equal(gunner.shots, 0, 'switch animation must finish before firing');
  step(0.6, { fire: true });
  assert.ok(gunner.shots >= 3);
  assert.equal(gunner.mag[0], 1, 'switch must preserve the pistol magazine');
});
