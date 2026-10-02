import test from 'node:test';
import assert from 'node:assert/strict';
import { Input } from '../src/core/input.js';

function fixture(t) {
  const saved = ['addEventListener', 'document', 'navigator'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  t.after(() => { for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const win = new EventTarget(), doc = new EventTarget(), canvas = new EventTarget();
  let pads = [];
  globalThis.addEventListener = win.addEventListener.bind(win); globalThis.document = doc;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => pads } });
  doc.pointerLockElement = canvas;
  const input = new Input(canvas);
  doc.dispatchEvent(new Event('pointerlockchange'));
  const move = (x, y) => win.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: x, movementY: y }));
  return { input, move, setPad: pad => { pads = [pad]; } };
}
const activePad = () => ({ index: 0, id: 'active pad', connected: true, axes: [0, 0, .85, -.6], buttons: Array.from({ length: 20 }, (_, i) => ({ pressed: i === 6 || i === 7, value: i === 6 || i === 7 ? 1 : 0 })) });

test('captured mouse motion beats an actively polled pad for aim while retaining trigger buttons', t => {
  const { input, move, setPad } = fixture(t); setPad(activePad());
  input.poll(); assert.equal(input.lastDevice, 'pad');
  move(28, -3); input.poll();
  assert.equal(input.lastDevice, 'kbm', 'active pad polling must not re-enable mouse target snapping');
  const command = input.gunner(1 / 60, true);
  assert.equal(command.dYaw, -28 * input.sens.mouse); assert.equal(command.dPitch, 3 * input.sens.mouse);
  assert.equal(command.fire, true); assert.equal(command.ads, true);
  input.endFrame(); input.poll();
  assert.equal(input.lastDevice, 'pad', 'controller-only aim resumes on a later frame');
  assert.notEqual(input.gunner(1 / 60, true).dYaw, 0);
});

test('net-zero captured mouse motion still suppresses simultaneous pad aim until the frame ends', t => {
  const { input, move, setPad } = fixture(t); setPad(activePad());
  move(20, -2); move(-20, 2); input.poll();
  const command = input.gunner(1 / 60);
  assert.equal(input.lastDevice, 'kbm'); assert.equal(Math.abs(command.dYaw), 0); assert.equal(Math.abs(command.dPitch), 0);
  assert.equal(command.fire, true);
  input.endFrame(); input.poll(); assert.notEqual(input.gunner(1 / 60).dYaw, 0);
});

test('non-finite pointer events cannot poison aim and valid fast turns are not arbitrarily clamped', t => {
  const { input, move, setPad } = fixture(t); setPad(activePad()); input.poll();
  for (const [x, y] of [[NaN, 2], [4, Infinity], [-Infinity, 0]]) move(x, y);
  assert.equal(input.mouseDX, 0); assert.equal(input.mouseDY, 0); assert.equal(input.lastDevice, 'pad');
  move(1400, -900); input.poll();
  const command = input.gunner(1 / 60);
  assert.equal(command.dYaw, -1400 * input.sens.mouse); assert.equal(command.dPitch, 900 * input.sens.mouse);
  assert.equal(input.lastDevice, 'kbm');
});

test('capture loss clears mouse priority so a connected controller can aim again', t => {
  const { input, move, setPad } = fixture(t); setPad(activePad()); move(20, 3); input.poll();
  document.pointerLockElement = null; document.dispatchEvent(new Event('pointerlockchange')); input.poll();
  assert.equal(input.lastDevice, 'pad'); assert.equal(input.mouseDX, 0); assert.equal(input.mouseDY, 0);
  assert.notEqual(input.gunner(1 / 60).dYaw, 0);
});
