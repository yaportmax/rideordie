import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';

function setup() {
  const handlers = new Map(); let pads = [];
  const on = (name, fn) => { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); };
  globalThis.addEventListener = on;
  globalThis.document = { addEventListener: on, pointerLockElement: null };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  const canvas = { addEventListener: on };
  return { input: new Input(canvas), pads: (p) => { pads = p; }, emit: (name, event = {}) => { for (const fn of handlers.get(name) || []) fn(event); } };
}
const pad = (buttons = []) => ({ index: 0, id: 'pad', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 20 }, (_, i) => ({ pressed: buttons.includes(i), value: buttons.includes(i) ? 1 : 0 })) });

test('typing a room code never holds driving keys or eats spaces', () => {
  const s = setup(); let prevented = false;
  s.emit('keydown', { code: 'KeyW', target: { tagName: 'INPUT' }, preventDefault: () => { prevented = true; } });
  s.emit('keydown', { code: 'Space', target: { tagName: 'INPUT' }, preventDefault: () => { prevented = true; } });
  assert.equal(s.input.down('throttle'), false); assert.equal(prevented, false);
  s.emit('keydown', { code: 'Tab', target: {}, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('focus loss clears held inputs, mouse buttons, deltas, wheel and button edges', () => {
  const s = setup(), i = s.input;
  i.keys.add('KeyW'); i.pressed.add('KeyG'); i.mouse.left = i.mouse.middle = true; i.mousePressed.left = true;
  i.mouseDX = 8; i.mouseDY = 4; i.wheel = 1; i.padEdge[2] = true;
  s.emit('blur');
  assert.equal(i.down('throttle'), false); assert.equal(i.hit('grenade'), false);
  assert.equal(i.mouse.left, false); assert.equal(i.mouse.middle, false); assert.equal(i.mousePressed.left, false);
  assert.equal(i.mouseDX + i.mouseDY + i.wheel, 0); assert.equal(i.edge(2), false);
});

test('unplugging a gamepad clears edges and a new controller does not inherit held buttons', () => {
  const s = setup(), i = s.input;
  s.pads([pad([2])]); i.poll(); assert.equal(i.edge(2), true); i.poll(); assert.equal(i.edge(2), false);
  s.pads([]); i.poll(); assert.equal(i.padConnected, false); assert.equal(i.edge(2), false);
  s.pads([pad([2])]); i.poll(); assert.equal(i.edge(2), true);
});

test('scrolling a menu does not swap guns and driver look honors mouse sensitivity', () => {
  const s = setup(), i = s.input;
  s.emit('wheel', { deltaY: 1 }); assert.equal(i.wheel, 0);
  i.locked = true; s.emit('wheel', { deltaY: -1 }); assert.equal(i.wheel, -1);
  i.mouseDX = 100; i.sens.mouse = 0.001; assert.ok(Math.abs(i.driver(1 / 60).mouseYaw + 0.1) < 1e-6);
});

test('solo controller buttons cannot reload and drop oil, or flip and swap at the same time', () => {
  const s = setup(), i = s.input;
  s.pads([pad([2, 3, 5])]); i.poll();
  const c = i.solo(1 / 60);
  assert.equal(c.gunner.reload, true); assert.equal(c.driver.special1, false);
  assert.equal(c.driver.reset, true); assert.equal(c.gunner.swap, 0);
  assert.equal(c.gunner.fire, true); assert.equal(c.gunner.firePressed, true);
  i.endFrame(); i.poll(); assert.equal(i.solo(1 / 60).gunner.firePressed, false);
});

test('usable analog trigger and aim input select controller mode before the pressed threshold', () => {
  for (const [button, value, command] of [[7, 0.4, 'fire'], [6, 0.31, 'ads']]) {
    const s = setup(), p = pad(); p.buttons[button].value = value;
    s.pads([p]); s.input.poll();
    assert.equal(s.input.gunner(1 / 60)[command], true);
    assert.equal(s.input.lastDevice, 'pad', `analog ${command} must enable controller prompts and aim assist`);
  }
  const s = setup(), p = pad(); p.axes[2] = 0.2;
  s.pads([p]); s.input.poll();
  assert.notEqual(s.input.gunner(1 / 60).dYaw, 0);
  assert.equal(s.input.lastDevice, 'pad');
});

test('controller steering is active above its own deadzone and unused axes never change the input device', () => {
  const s = setup(), p = pad();
  p.axes = [0.099, 0.139, 0.119, -0.119, 0.9, -1];
  s.pads([p]); s.input.poll();
  assert.equal(s.input.lastDevice, 'kbm');
  p.axes[0] = 0.11; s.input.poll();
  assert.notEqual(s.input.driver(1 / 60).steer, 0);
  assert.equal(s.input.lastDevice, 'pad');
});

test('disconnecting a spare controller does not repeat a held active-controller action', () => {
  const s = setup(), active = pad([2]), spare = { ...pad(), index: 1, id: 'spare' };
  s.pads([active, spare]); s.input.poll();
  assert.equal(s.input.driver(1 / 60).special1, true);
  s.input.endFrame(); s.input.poll();
  assert.equal(s.input.driver(1 / 60).special1, false);
  s.emit('gamepaddisconnected', { gamepad: spare }); s.pads([active]); s.input.poll();
  assert.equal(s.input.driver(1 / 60).special1, false, 'a held button must not gain a new edge when another pad leaves');
  s.emit('gamepaddisconnected', { gamepad: active });
  assert.equal(s.input.padConnected, false); assert.equal(s.input.edge(2), false);
});

test('solo controller gadgets do not steer the truck and the steering stick still works', () => {
  const s = setup(), p = pad([14, 15]);
  s.pads([p]); s.input.poll();
  const c = s.input.solo(1 / 60);
  assert.equal(c.driver.special1, true); assert.equal(c.driver.special2, true);
  assert.equal(c.driver.steer, 0);
  p.buttons[15] = { pressed: false, value: 0 }; s.input.poll();
  assert.equal(s.input.solo(1 / 60).driver.steer, 0, 'oil slick button must not force a turn');
  p.axes[0] = 0.7; s.input.poll();
  assert.ok(s.input.solo(1 / 60).driver.steer < 0, 'the left stick retains right steering while the oil button is held');
  assert.equal(s.input.driver(1 / 60).steer, 1, 'dedicated driver retains D-pad steering');
});

function scopedSetup(t) {
  const names = ['addEventListener', 'document', 'navigator'];
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  t.after(() => names.forEach((name, i) => {
    if (previous[i]) Object.defineProperty(globalThis, name, previous[i]);
    else delete globalThis[name];
  }));
  return setup();
}

test('old crouch keys and a legacy custom binding cannot crouch the gunner or suppress normal actions', t => {
  const s = scopedSetup(t), i = s.input;
  i.bindings.crouch = ['ControlLeft', 'KeyZ'];
  for (const code of ['ControlLeft', 'KeyC', 'KeyZ', 'KeyW', 'KeyR', 'KeyG']) s.emit('keydown', { code, target: {} });
  i.mouse.left = i.mouse.right = true;
  const cmd = i.gunner(1 / 60);
  assert.equal(cmd.crouch, false, 'held legacy keys cannot activate crouch even if an old binding object remains in memory');
  assert.equal(cmd.moveX, 0); assert.equal(cmd.moveZ, 0); assert.equal(cmd.fire, true); assert.equal(cmd.ads, true);
  assert.equal(cmd.reload, true); assert.equal(cmd.grenade, true);
  assert.equal(i.driver(1 / 60).cameraToggle, true, 'C remains the driver camera control');
  assert.equal(i.solo(1 / 60).gunner.crouch, false);
});

test('controller B is inactive for dedicated gunner crouch and preserves driver/solo role actions', t => {
  const s = scopedSetup(t), i = s.input;
  s.pads([pad([1])]); i.poll();
  const gunner = i.gunner(1 / 60), driver = i.driver(1 / 60), solo = i.solo(1 / 60);
  assert.equal(gunner.crouch, false); assert.equal(gunner.grenade, false);
  assert.equal(gunner.fire, false); assert.equal(gunner.ads, false); assert.equal(gunner.reload, false);
  assert.equal(driver.special2, true, 'dedicated driver B still drops a mine');
  assert.equal(solo.gunner.grenade, true, 'solo B still throws a grenade');
  assert.equal(solo.gunner.crouch, false); assert.equal(solo.driver.special2, false);
  i.endFrame(); i.poll();
  assert.equal(i.gunner(1 / 60).crouch, false, 'holding B across subsequent frames cannot crouch');
  assert.equal(i.solo(1 / 60).gunner.grenade, false, 'holding B does not repeat the solo grenade edge');
});

test('gunner WASD and old custom walking bindings stay neutral while keyboard driving still works', t => {
  const s = scopedSetup(t), i = s.input;
  for (const [key, command, value] of [['KeyW', 'throttle', 1], ['KeyS', 'brake', 1], ['KeyA', 'steer', 1], ['KeyD', 'steer', -1]]) {
    i.reset();
    s.emit('keydown', { code: key, target: {} });
    assert.deepEqual([i.gunner(1 / 60).moveX, i.gunner(1 / 60).moveZ], [0, 0], key + ' cannot walk the gunner');
    for (let frame = 0; frame < 60; frame++) i.driver(1 / 60);
    assert.equal(i.driver(1 / 60)[command], value, key + ' still drives the truck');
    assert.equal(i.solo(1 / 60).driver[command], value, key + ' still drives in solo');
  }
  i.reset();
  Object.assign(i.bindings, { moveL: ['KeyJ'], moveR: ['KeyL'], moveF: ['KeyI'], moveB: ['KeyK'] });
  for (const key of ['KeyJ', 'KeyL', 'KeyI', 'KeyK']) {
    i.keys.clear(); s.emit('keydown', { code: key, target: {} });
    assert.deepEqual([i.gunner(1 / 60).moveX, i.gunner(1 / 60).moveZ], [0, 0], key + ' cannot revive a stale walking binding');
  }
});

test('left stick cannot walk the gunner while driver/solo steering and right-stick aiming remain active', t => {
  const s = scopedSetup(t), p = pad(), i = s.input;
  p.axes = [.8, -.7, .4, -.35]; s.pads([p]); i.poll();
  const gunner = i.gunner(1 / 60), driver = i.driver(1 / 60), solo = i.solo(1 / 60);
  assert.deepEqual([gunner.moveX, gunner.moveZ, gunner.crouch], [0, 0, false]);
  assert.ok(gunner.dYaw < 0); assert.ok(gunner.dPitch > 0);
  assert.ok(driver.steer < 0); assert.equal(solo.driver.steer, driver.steer);
  assert.deepEqual([solo.gunner.moveX, solo.gunner.moveZ], [0, 0]);
});

test('advertised driver right-stick click changes camera once while steering-stick click preserves the view', t => {
  const s = scopedSetup(t), i = s.input, p = pad([11]);
  p.axes = [.7, 0, .4, -.3]; s.pads([p]); i.poll();
  const command = i.driver(1 / 60);
  assert.equal(command.cameraToggle, true, 'standard button11 is advertised R3 camera');
  assert.ok(command.steer < 0, 'steering remains active while clicking the look stick');
  assert.ok(command.lookX > 0 && command.lookY < 0, 'right-stick looking is not consumed by camera switching');
  assert.equal(command.medkit, false);
  i.endFrame(); i.poll();
  assert.equal(i.driver(1 / 60).cameraToggle, false, 'held R3 does not toggle every frame');
  p.buttons[11] = { pressed: false, value: 0 }; p.buttons[10] = { pressed: true, value: 1 }; i.poll();
  assert.equal(i.driver(1 / 60).cameraToggle, false, 'L3 steering click does not switch the driver view');
  p.buttons[10] = { pressed: false, value: 0 }; p.buttons[11] = { pressed: true, value: 1 }; i.poll();
  assert.equal(i.driver(1 / 60).cameraToggle, true, 'release and repress R3 switches again');
});

test('right-stick click retains the separate gunner medkit and solo next-weapon bindings', t => {
  const s = scopedSetup(t), i = s.input, p = pad([11]); s.pads([p]); i.poll();
  const gunner = i.gunner(1 / 60), solo = i.solo(1 / 60);
  assert.equal(gunner.medkit, true); assert.equal(gunner.viewToggle, false);
  assert.equal(solo.gunner.swap, 1); assert.equal(solo.gunner.medkit, false, 'solo next weapon cannot spend a medkit');
  i.endFrame(); i.poll();
  assert.equal(i.gunner(1 / 60).medkit, false);
  assert.equal(i.solo(1 / 60).gunner.swap, 0, 'holding R3 cannot continuously cycle the loadout');
});
