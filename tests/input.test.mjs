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
