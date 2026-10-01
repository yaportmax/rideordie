import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Input } from '../src/core/input.js';
import { GunnerController } from '../src/game/gunner.js';

const DT = 1 / 120;
const camera = { position: new THREE.Vector3(0, 2, 0), dir: new THREE.Vector3(0, 0, 1) };

// Exercise the registered input listeners and real controller state together.
// Browser pointer capture and native mouse delivery are verified separately.
function fixture(t, weapons = ['smg', 'rifle', 'pistol']) {
  const names = ['addEventListener', 'document', 'navigator'];
  const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => names.forEach((name, i) => {
    if (saved[i]) Object.defineProperty(globalThis, name, saved[i]);
    else delete globalThis[name];
  }));
  const win = new EventTarget(), doc = new EventTarget(), canvas = new EventTarget();
  let pads = [];
  globalThis.addEventListener = win.addEventListener.bind(win);
  globalThis.document = doc;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  const event = (target, type, props = {}) => target.dispatchEvent(Object.assign(new Event(type), props));
  canvas.requestPointerLock = () => {
    doc.pointerLockElement = canvas;
    event(doc, 'pointerlockchange');
    return Promise.resolve();
  };
  doc.exitPointerLock = () => { doc.pointerLockElement = null; event(doc, 'pointerlockchange'); };
  doc.pointerLockElement = null;
  const input = new Input(canvas), events = [];
  const gunner = new GunnerController({ weapons }, {
    emit: e => events.push(e), ownCar: () => null, targets: function* () {}, raycastWorld: () => null,
  });
  const frame = (paused = false) => {
    input.poll();
    const cmd = input.gunner(DT);
    if (!paused) gunner.update(DT, cmd, camera, 0);
    input.endFrame();
    return cmd;
  };
  const seconds = (n, paused = false) => { for (let i = 0; i < Math.ceil(n / DT); i++) frame(paused); };
  const mouseDown = button => event(canvas, 'mousedown', { button });
  const mouseUp = button => event(win, 'mouseup', { button });
  const keyDown = code => event(win, 'keydown', { code, repeat: false });
  const keyUp = code => event(win, 'keyup', { code });
  input.requestLock();
  return { win, doc, input, gunner, events, event, frame, seconds, mouseDown, mouseUp, keyDown, keyUp, pads: values => { pads = values; } };
}

test('automatic mouse fire survives ADS exit, reload, weapon swap and a return to hip fire', t => {
  const f = fixture(t);
  f.mouseDown(0); f.mouseDown(2); f.seconds(0.4);
  assert.ok(f.gunner.shots >= 5);
  assert.ok(f.gunner.ads > 0.95);
  const adsShots = f.gunner.shots;
  f.mouseUp(2); f.seconds(0.3);
  assert.ok(f.gunner.ads < 0.05);
  assert.ok(f.gunner.shots > adsShots, 'releasing RMB cannot drop the held LMB state');
  f.keyDown('KeyR'); f.frame(); f.keyUp('KeyR');
  assert.equal(f.gunner.reloading, true);
  const reloadShots = f.gunner.shots;
  f.seconds(f.gunner.weapon.reload + 0.3);
  assert.ok(f.gunner.shots > reloadShots, 'held LMB resumes after the real reload timer');
  assert.equal(f.gunner.reloading, false);
  f.keyDown('Digit2'); f.frame(); f.keyUp('Digit2');
  assert.equal(f.gunner.weaponId, 'rifle');
  const swapShots = f.gunner.shots;
  f.seconds(0.7);
  assert.ok(f.gunner.shots > swapShots, 'held LMB resumes after switching automatic weapons');
  assert.ok(f.gunner.ads < 0.001);
  f.mouseUp(0); const releasedShots = f.gunner.shots; f.seconds(0.3);
  assert.equal(f.gunner.shots, releasedShots);
});

test('mouse hip fire recovers after pause unlock, recapture and focus loss for automatic and semi weapons', async t => {
  for (const weapon of ['smg', 'rifle', 'pistol']) {
    await t.test(weapon, st => {
      const f = fixture(st, [weapon]);
      f.mouseDown(0); f.seconds(0.1);
      assert.ok(f.gunner.shots > 0);
      f.input.releaseLock();
      assert.equal(f.input.mouse.left, false);
      assert.equal(f.input.locked, false);
      const pauseShots = f.gunner.shots;
      f.seconds(0.4, true);
      assert.equal(f.gunner.shots, pauseShots);
      // App resumes by resetting inputs, then requesting capture. A fresh click
      // must deliver a fresh edge even though the paused gunner held its trigger.
      f.input.reset(); f.input.requestLock(); f.seconds(0.5);
      f.mouseDown(0); f.seconds(0.1);
      assert.ok(f.gunner.shots > pauseShots, `${weapon} must fire after resume and recapture`);
      f.mouseUp(0); f.seconds(0.5);
      f.mouseDown(0); f.frame();
      f.event(f.win, 'blur');
      assert.equal(f.input.mouse.left, false);
      f.seconds(0.5);
      const blurShots = f.gunner.shots;
      f.mouseDown(0); f.seconds(0.1);
      assert.ok(f.gunner.shots > blurShots, `${weapon} must fire on a fresh click after focus returns`);
    });
  }
});

test('registered mouse events resume automatic fire after empty-magazine reload without a second edge', t => {
  const f = fixture(t);
  f.gunner.mag[0] = 1;
  f.mouseDown(0); f.frame();
  assert.equal(f.gunner.magNow, 0);
  assert.equal(f.gunner.reloading, true);
  assert.equal(f.gunner.shots, 1);
  f.seconds(f.gunner.weapon.reload + 0.4);
  assert.equal(f.input.mouse.left, true);
  assert.equal(f.gunner.reloading, false);
  assert.ok(f.gunner.shots >= 4);
  assert.equal(f.events.filter(e => e.t === 'reloadEnd').length, 1);
});

test('controller fire recovers through reload, pause and a real trigger release/press', t => {
  const f = fixture(t);
  const pad = { index: 0, id: 'test-controller', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })) };
  f.pads([pad]); pad.buttons[7].value = 0.4;
  f.seconds(0.3);
  assert.equal(f.input.lastDevice, 'pad');
  assert.ok(f.gunner.shots >= 3);
  pad.buttons[2] = { pressed: true, value: 1 }; f.frame();
  pad.buttons[2] = { pressed: false, value: 0 };
  const reloadShots = f.gunner.shots;
  f.seconds(f.gunner.weapon.reload + 0.3);
  assert.ok(f.gunner.shots > reloadShots);
  f.input.releaseLock(); f.input.reset();
  const pausedShots = f.gunner.shots;
  f.seconds(0.5, true);
  assert.equal(f.gunner.shots, pausedShots);
  pad.buttons[7].value = 0; f.input.reset(); f.seconds(0.5);
  pad.buttons[7].value = 0.4; f.seconds(0.3);
  assert.ok(f.gunner.shots > pausedShots);
  pad.buttons[7].value = 0; const releasedShots = f.gunner.shots; f.seconds(0.3);
  assert.equal(f.gunner.shots, releasedShots);
});
