import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GunnerController } from '../src/game/gunner.js';

const neutral = { dYaw: 0, dPitch: 0, fire: false, firePressed: false, ads: false, reload: false, grenade: false, swap: 0, slot: -1, crouch: false, moveX: 0, moveZ: 0 };
const camera = { position: new THREE.Vector3(0, 2, 0), dir: new THREE.Vector3(0, 0, 1) };

function setup(weapons = ['smg']) {
  const events = [], shots = [];
  let elapsed = 0;
  const gunner = new GunnerController({ weapons }, {
    emit: (e) => { events.push(e); if (e.t === 'shot') shots.push({ time: elapsed, event: e }); },
    ownCar: () => null, targets: function* () {}, raycastWorld: () => null,
  });
  const step = (dt, cmd = {}) => {
    elapsed += dt;
    const before = gunner.shots;
    gunner.update(dt, { ...neutral, ...cmd }, camera, 0);
    assert.ok(gunner.shots - before <= 1, 'a frame must emit at most one shot, including after a pause');
  };
  return { gunner, events, shots, step };
}

for (const weapon of ['smg', 'rifle', 'lmg']) {
  test(`${weapon} sustained fire retains its configured cadence at 30/60/120 FPS and irregular frames`, () => {
    const counts = [];
    for (const pattern of [[1 / 30], [1 / 60], [1 / 120], [0.008, 0.024, 0.012, 0.037, 0.016]]) {
      const { gunner, events, shots, step } = setup([weapon]);
      const duration = 2, period = 60 / gunner.weapon.rpm;
      let elapsed = 0, frame = 0;
      while (elapsed < duration - 1e-10) {
        const dt = Math.min(pattern[frame++ % pattern.length], duration - elapsed);
        step(dt, { fire: true }); elapsed += dt;
      }
      const expected = 1 + Math.floor((duration - shots[0].time) / period + 1e-8);
      assert.equal(shots.length, expected, `${pattern.join(',')} frame durations must preserve ${gunner.weapon.rpm} RPM`);
      assert.equal(gunner.magNow, gunner.weapon.mag - expected);
      assert.equal(gunner.shots, expected);
      assert.equal(events.filter((e) => e.t === 'shot').length, expected);
      assert.ok(shots.every(({ event }) => event.src === 'player' && event.weapon === weapon && event.mode === 'auto' && event.rays.length === 1));
      counts.push(shots.length);
    }
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, 'frame sampling may move only the final boundary shot');
  });
}

test('automatic fire resumes with a fresh cooldown after trigger release or a frame pause', () => {
  for (const interrupt of ['release', 0.05, 0.5]) {
    const { gunner, shots, step } = setup();
    step(1 / 30, { fire: true });
    step(1 / 30, { fire: true });
    if (interrupt === 'release') { step(0.01); step(0.04, { fire: true }); }
    else step(interrupt, { fire: true });
    assert.equal(shots.length, 2);
    assert.equal(gunner.fireT, 60 / gunner.weapon.rpm, `${interrupt} must discard timing debt`);
    step(0.04, { fire: true });
    assert.equal(shots.length, 2, 'recovery must not schedule an early catch-up shot');
    step(0.04, { fire: true });
    assert.equal(shots.length, 3);
  }
});

test('reload completion, an empty magazine, weapon swap and grenade recovery discard automatic timing debt', () => {
  for (const interrupt of ['reload', 'empty', 'swap', 'grenade']) {
    const { gunner, shots, step } = setup(['smg', 'rifle']);
    step(1 / 30, { fire: true });
    step(1 / 30, { fire: true });
    if (interrupt === 'reload') {
      gunner.startReload();
      step(0.04, { fire: true });
      gunner.reloadT = gunner.weapon.reload - 0.02;
      step(0.03, { fire: true });
    } else if (interrupt === 'empty') {
      gunner.mag[0] = 0;
      step(0.04, { fire: true });
      step(0.02, { fire: true });
      assert.equal(shots.length, 1);
      assert.equal(gunner.reloading, true);
      gunner.reloadT = gunner.weapon.reload - 0.02;
      step(0.03, { fire: true });
    } else if (interrupt === 'swap') {
      gunner.swapTo(1);
      gunner.swapT = 0.02;
      gunner.fireT = 0.02;
      step(0.03, { fire: true });
    } else {
      gunner.throwGrenade(camera);
      step(0.04, { fire: true });
      gunner.throwing = 0.02;
      step(0.03, { fire: true });
    }
    assert.equal(shots.length, 2, `${interrupt} must resume held automatic fire`);
    assert.equal(gunner.fireT, 60 / gunner.weapon.rpm, `${interrupt} recovery must use a full cooldown`);
    step(0.04, { fire: true });
    assert.equal(shots.length, 2, `${interrupt} must not produce a catch-up shot`);
  }
});

test('semi and pump weapons still require new trigger edges and their original cooldowns', () => {
  for (const weapon of ['pistol', 'shotgun']) {
    const { gunner, shots, step } = setup([weapon]);
    const period = 60 / gunner.weapon.rpm;
    step(0.02, { fire: true });
    for (let i = 0; i < 60; i++) step(1 / 30, { fire: true });
    assert.equal(shots.length, 1, 'holding a non-automatic trigger must not repeat');
    step(0.01);
    step(0.03, { fire: true, firePressed: true });
    assert.equal(shots.length, 2);
    assert.equal(gunner.fireT, period);
    step(period / 2);
    step(period / 4, { fire: true, firePressed: true });
    assert.equal(shots.length, 2, 'a trigger edge during cooldown must not fire');
  }
});
