import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Nav } from '../src/ui/nav.js';

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let Ui;
try { ({ Ui } = await import('../src/ui/ui.js')); } finally { css.deregister(); }

// Exercise actual Ui event handlers with only the DOM operations they consume.
class Element extends EventTarget {
  constructor(root = false) {
    super(); this.children = []; this.dataset = {}; this.style = {}; this.root = root;
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
      toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
    };
  }
  get isConnected() { return !this.removed && (this.root || !!this.parent?.isConnected); }
  appendChild(child) { child.parent = this; child.removed = false; this.children.push(child); return child; }
  remove() { this.removed = true; if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  set innerHTML(html) {
    this.buttons = [...html.matchAll(/data-i="(\d+)"/g)].map(match => {
      const button = this.appendChild(new Element()); button.dataset.i = match[1]; return button;
    });
  }
  querySelectorAll() { return this.buttons || []; }
  click() { this.dispatchEvent(new Event('click')); }
}

function fixture(t) {
  const originals = new Map(), frames = new Map(), focused = [], sounds = [];
  let nextFrame = 0, pad = null, disconnected = 0;
  const setGlobal = (name, value) => {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  setGlobal('document', { createElement: () => new Element(), activeElement: null });
  setGlobal('requestAnimationFrame', callback => { frames.set(++nextFrame, callback); return nextFrame; });
  setGlobal('cancelAnimationFrame', id => frames.delete(id));
  setGlobal('navigator', { getGamepads: () => pad ? [pad] : [] });
  const ui = Object.assign(Object.create(Ui.prototype), {
    opts: { backdrop: false }, input: { lastDevice: 'kbm' }, _dev: 'kbm',
    stack: [], _modal: null, _disposed: false, _running: false, _loop() {},
    _blockUntil: 0, _sound: name => sounds.push(name),
    el: new Element(true), bgEl: new Element(), toastsEl: new Element(), modalEl: new Element(),
    _ro: { disconnect() { disconnected++; } },
  });
  ui.el.appendChild(ui.modalEl);
  ui.nav = Object.assign(Object.create(Nav.prototype), {
    ui, cur: null, prev: Array(20).fill(false), dirHeld: null, capture: null,
    ensure(preferred) { const node = preferred || this.scope()?.querySelectorAll()[0]; focused.push(node); this.cur = node || null; },
  });
  t.after(() => {
    if (!ui._disposed) ui.dispose();
    for (const [name, original] of originals) {
      if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name];
    }
  });
  return {
    ui, focused, sounds, disconnected: () => disconnected,
    flushFrames() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); },
    escape() { ui.nav.onKey({ code: 'Escape', preventDefault() {}, stopImmediatePropagation() {} }); },
    gamepadBack() {
      pad = { id: 'Xbox test pad', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 1, value: i === 1 ? 1 : 0 })) };
      ui._blockUntil = 0; ui.nav.update(0.016);
    },
  };
}

const startButtons = () => [{ label: 'DAM', id: 'dam', kind: 'primary' }, { label: 'START', id: 'start' }, { label: 'BACK', id: null, cancel: true }];

for (const action of ['click', 'Escape', 'gamepad B']) {
  test(`checkpoint BACK preserves explicit null through ${action}`, async t => {
    const f = fixture(t), pending = f.ui.modal({ buttons: startButtons() });
    if (action === 'click') f.ui._modal.el.querySelectorAll()[2].click();
    else if (action === 'Escape') f.escape(); else f.gamepadBack();
    assert.equal(await pending, null); assert.equal(f.ui.modalOpen(), false);
  });
}

test('modal selection preserves falsy explicit IDs and falls back to index only for absent IDs', async t => {
  const { ui } = fixture(t);
  for (const id of [0, false, '']) {
    const pending = ui.modal({ buttons: [{ label: 'FIRST' }, { label: 'CHOOSE', id }] });
    ui._modal.el.querySelectorAll()[1].click(); assert.equal(await pending, id);
  }
  const pending = ui.modal({ buttons: [{ label: 'FIRST' }, { label: 'SECOND' }] });
  ui._modal.el.querySelectorAll()[1].click(); assert.equal(await pending, 1);
});

for (const action of ['click', 'cancel']) {
  test(`a ${action} callback can open a replacement without closing it or changing the selected result`, async t => {
    const f = fixture(t); let replacement, replacementSettled = false, calls = 0;
    const original = f.ui.modal({ buttons: [{ label: 'NEXT', id: 'next', cancel: true, onClick() {
      calls++; assert.equal(f.ui.modalOpen(), false);
      replacement = f.ui.modal({ buttons: [{ label: 'DONE', id: 'done' }] });
      replacement.then(() => { replacementSettled = true; });
    } }] });
    const oldButton = f.ui._modal.el.querySelectorAll()[0];
    if (action === 'click') oldButton.click(); else f.ui.modalCancel();
    assert.equal(await original, 'next'); assert.equal(replacementSettled, false);
    const current = f.ui._modal;
    oldButton.click(); original.close();
    assert.equal(calls, 1); assert.equal(f.ui._modal, current); assert.equal(replacementSettled, false);
    f.flushFrames(); assert.deepEqual(f.focused, [current.el.querySelectorAll()[0]]);
    current.el.querySelectorAll()[0].click(); assert.equal(await replacement, 'done');
  });
}

test('replaced dialogs settle as cancelled and detached buttons cannot invoke old callbacks', async t => {
  const f = fixture(t); let calls = 0;
  const original = f.ui.modal({ buttons: [{ label: 'OLD', onClick() { calls++; } }] });
  const oldButton = f.ui._modal.el.querySelectorAll()[0];
  const replacement = f.ui.modal({ buttons: [{ label: 'NEW', id: 'new' }] }), current = f.ui._modal;
  assert.equal(await original, null);
  oldButton.click(); original.close(); assert.equal(calls, 0); assert.equal(f.ui._modal, current);
  f.flushFrames(); assert.deepEqual(f.focused, [current.el.querySelectorAll()[0]]);
  current.el.querySelectorAll()[0].click(); assert.equal(await replacement, 'new');
});

test('required dialogs ignore Escape and gamepad back but still accept their button', async t => {
  const f = fixture(t), pending = f.ui.connectionLost();
  const current = f.ui._modal; f.escape(); f.gamepadBack();
  assert.equal(f.ui._modal, current);
  current.el.querySelectorAll()[0].click(); assert.equal(await pending, 0);
});

test('hideAll cancels pending modal promises', async t => {
  const { ui } = fixture(t), pending = ui.modal({ buttons: startButtons() });
  ui.hideAll(); assert.equal(await pending, null); assert.equal(ui.active(), false);
});

test('dispose cancels modal promises and queued focus, with no detached button callback', async t => {
  const f = fixture(t); let calls = 0, destroyed = 0;
  f.ui.stack.push({ el: new Element(), destroy() { destroyed++; } });
  const pending = f.ui.modal({ buttons: [{ label: 'CONTINUE', onClick() { calls++; } }] });
  const oldButton = f.ui._modal.el.querySelectorAll()[0];
  f.ui.dispose(); assert.equal(await pending, null);
  oldButton.click(); pending.close(); f.flushFrames();
  assert.equal(calls, 0); assert.equal(destroyed, 1); assert.equal(f.disconnected(), 1);
  assert.equal(f.ui.active(), false); assert.equal(f.ui._running, false); assert.equal(f.ui.el.isConnected, false);
  assert.deepEqual(f.focused, []);
  assert.equal(await f.ui.modal(), null); assert.equal(f.ui.modalOpen(), false);
});
