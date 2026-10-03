// WORK implementation tests. Authored for direct source imports; not executed by the author.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Input, DEFAULT_BINDINGS } from '../src/core/input.js';
import { ACTION_LABEL, conflictSet, defaultBindings, loadBindings, saveBindings } from '../src/ui/settings_store.js';
import { ControlsScreen } from '../src/ui/screens/controls.js';
import { Hud } from '../src/ui/hud.js';

function install(t, values) {
  const previous = Object.keys(values).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => { for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
}

function inputFixture(t) {
  const win = new EventTarget(), doc = new EventTarget(), canvas = new EventTarget(); let pads = [];
  install(t, { addEventListener: win.addEventListener.bind(win), document: doc, navigator: { getGamepads: () => pads } });
  const input = new Input(canvas);
  const key = (code, extra = {}) => win.dispatchEvent(Object.assign(new Event('keydown'), { code, repeat: false, ...extra }));
  const release = code => win.dispatchEvent(Object.assign(new Event('keyup'), { code }));
  const pad = { index: 0, id: 'test pad', connected: true, axes: [0, 0, 0, 0], buttons: Array.from({ length: 20 }, () => ({ pressed: false, value: 0 })) };
  return { input, key, release, win, doc, pad, setPads: value => { pads = value; } };
}

test('N is a shared, consumed edge and holding/repeating cannot reactivate it', t => {
  const { input, key, release } = inputFixture(t);
  assert.deepEqual(DEFAULT_BINDINGS.nuke, ['KeyN']);
  key('KeyN'); input.poll(); assert.equal(input.nukePressed(), true); assert.equal(input.nukePressed(), false);
  input.driver(1 / 60); input.gunner(1 / 60); input.solo(1 / 60);
  assert.equal(input.nukePressed(), false, 'seat command reads never route a second activation');
  input.endFrame(); key('KeyN', { repeat: true }); input.poll(); assert.equal(input.nukePressed(), false);
  release('KeyN'); input.endFrame(); key('KeyN'); input.poll(); assert.equal(input.nukePressed(), true);
});

test('L3 is edge-triggered in every seat without firing other mapped actions', t => {
  const { input, pad, setPads } = inputFixture(t); setPads([pad]);
  for (const role of ['driver', 'gunner', 'solo']) {
    pad.buttons[10] = { pressed: false, value: 0 }; input.endFrame(); input.poll();
    pad.buttons[10] = { pressed: true, value: 1 }; input.endFrame(); input.poll();
    assert.equal(input.nukePressed(), true, role); assert.equal(input.nukePressed(), false, role);
    const cmd = role === 'solo' ? input.solo(1 / 60) : { [role]: input[role](1 / 60) };
    for (const c of Object.values(cmd)) {
      for (const action of ['cameraToggle', 'viewToggle', 'special1', 'special2', 'medkit', 'reload', 'grenade', 'fire']) assert.ok(!c[action], `${role}: L3 must not trigger ${action}`);
      if ('swap' in c) assert.equal(Math.abs(c.swap), 0);
    }
    input.endFrame(); input.poll(); assert.equal(input.nukePressed(), false, `${role}: holding L3`);
  }
});

test('actual Input blocks an unsampled pause-time held L3 on the first poll after reset', t => {
  const { input, pad, setPads } = inputFixture(t); setPads([pad]); input.poll(); input.endFrame();
  assert.equal(input.padPrev[10], false);
  // L3 changes after the final paused sample; Resume resets before another poll.
  pad.buttons[10] = { pressed: true, value: 1 }; input.reset(); input.poll();
  assert.equal(input.edge(10), true, 'ordinary button edge data stays unchanged');
  assert.equal(input.nukePressed(), false); assert.equal(input.nukePressed(), false);
  for (let frame = 0; frame < 3; frame++) { input.endFrame(); input.poll(); assert.equal(input.nukePressed(), false, 'a held L3 cannot rearm'); }
  pad.buttons[10] = { pressed: false, value: 0 }; input.endFrame(); input.poll(); assert.equal(input.nukePressed(), false);
  pad.buttons[10] = { pressed: true, value: 1 }; input.endFrame(); input.poll();
  assert.equal(input.nukePressed(), true); assert.equal(input.nukePressed(), false);
  input.endFrame(); input.poll(); assert.equal(input.nukePressed(), false);
});

test('actual Input requires sampled L3 release after reset even when the held press was already observed', t => {
  const { input, pad, setPads } = inputFixture(t); setPads([pad]); input.poll(); input.endFrame();
  pad.buttons[10] = { pressed: true, value: 1 }; input.poll(); assert.equal(input.nukePressed(), true);
  input.reset(); input.poll(); assert.equal(input.nukePressed(), false);
  pad.buttons[10] = { pressed: false, value: 0 }; input.endFrame(); input.poll(); assert.equal(input.nukePressed(), false);
  pad.buttons[10] = { pressed: true, value: 1 }; input.endFrame(); input.poll(); assert.equal(input.nukePressed(), true);
});

test('actual Input initial controller hold cannot spend a nuke before a neutral sample', t => {
  const { input, pad, setPads } = inputFixture(t);
  pad.buttons[10] = { pressed: true, value: 1 }; setPads([pad]); input.poll();
  assert.equal(input.nukePressed(), false); input.endFrame(); input.poll(); assert.equal(input.nukePressed(), false);
  pad.buttons[10] = { pressed: false, value: 0 }; input.endFrame(); input.poll();
  pad.buttons[10] = { pressed: true, value: 1 }; input.endFrame(); input.poll(); assert.equal(input.nukePressed(), true);
});

test('actual Input disconnect, reconnect and pad switching disarm only the held L3 nuke action', t => {
  const { input, pad, setPads, win } = inputFixture(t); setPads([pad]); input.poll(); input.endFrame();
  win.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: { index: pad.index } }));
  pad.buttons[10] = { pressed: true, value: 1 }; input.poll(); assert.equal(input.nukePressed(), false);
  pad.buttons[10] = { pressed: false, value: 0 }; input.endFrame(); input.poll();
  const replacement = { ...pad, index: 1, id: 'replacement pad', buttons: pad.buttons.map(button => ({ ...button })) };
  replacement.buttons[10] = { pressed: true, value: 1 }; replacement.buttons[11] = { pressed: true, value: 1 };
  setPads([replacement]); input.endFrame(); input.poll();
  assert.equal(input.nukePressed(), false); assert.equal(input.edge(11), true);
  assert.equal(input.driver(1 / 60).cameraToggle, true, 'unrelated mapped pad action is unchanged');
  replacement.buttons[10] = { pressed: false, value: 0 }; input.endFrame(); input.poll();
  replacement.buttons[10] = { pressed: true, value: 1 }; input.endFrame(); input.poll(); assert.equal(input.nukePressed(), true);
  setPads([]); input.endFrame(); input.poll(); replacement.buttons[10] = { pressed: true, value: 1 };
  setPads([replacement]); input.endFrame(); input.poll(); assert.equal(input.nukePressed(), false);
});

test('actual Input keyboard nuke edges still work while L3 is quarantined and other buttons keep their edges', t => {
  const { input, pad, setPads, key, release } = inputFixture(t);
  pad.buttons[10] = { pressed: true, value: 1 }; pad.buttons[0] = { pressed: true, value: 1 };
  setPads([pad]); input.poll(); assert.equal(input.edge(0), true); assert.equal(input.nukePressed(), false);
  input.endFrame(); key('KeyN'); input.poll(); assert.equal(input.nukePressed(), true); assert.equal(input.nukePressed(), false);
  release('KeyN'); input.endFrame(); input.poll(); assert.equal(input.nukePressed(), false);
  pad.buttons[10] = { pressed: false, value: 0 }; input.endFrame(); input.poll();
  pad.buttons[10] = { pressed: true, value: 1 }; input.endFrame(); input.poll(); assert.equal(input.nukePressed(), true);
});

test('rebinding, typing, capture loss and blur preserve the global action boundary', t => {
  const { input, key, release, win, doc } = inputFixture(t);
  input.bindings.nuke = ['KeyJ']; key('KeyN'); assert.equal(input.nukePressed(), false);
  input.endFrame(); release('KeyN'); key('KeyJ'); assert.equal(input.nukePressed(), true);
  input.endFrame(); release('KeyJ'); key('KeyJ', { composedPath: () => [{ tagName: 'INPUT' }] }); assert.equal(input.nukePressed(), false);
  input.endFrame(); key('KeyJ'); win.dispatchEvent(new Event('blur')); assert.equal(input.nukePressed(), false);
  input.endFrame(); key('KeyJ'); doc.pointerLockElement = null; doc.dispatchEvent(new Event('pointerlockchange')); assert.equal(input.nukePressed(), false);
  input.bindings.nuke = []; input.endFrame(); key('KeyN'); key('KeyJ'); assert.equal(input.nukePressed(), false);
});

test('nuke bindings persist and conflict with both seats and other global actions', t => {
  const values = new Map(); install(t, { localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  assert.equal(ACTION_LABEL.nuke, 'ACTIVATE NUKE');
  for (const action of ['throttle', 'reload', 'view', 'pause', 'medkit']) {
    assert.ok(conflictSet('nuke').includes(action)); assert.ok(conflictSet(action).includes('nuke'));
  }
  const bindings = defaultBindings(); bindings.nuke = ['KeyJ']; saveBindings(bindings); assert.deepEqual(loadBindings().nuke, ['KeyJ']);
  bindings.nuke = []; saveBindings(bindings); assert.deepEqual(loadBindings().nuke, []);
  assert.deepEqual(defaultBindings().nuke, ['KeyN']);
});

// Generic actual-markup parser, adapted from the repository's hud_health tests.
// No selectors return fabricated HUD nodes; tests inspect real descendants.
class Element {
  constructor(tagName) { this.tagName = tagName.toLowerCase(); this.children = []; this.parentElement = null; this.style = {}; this.attributes = {}; this._text = ''; }
  get id() { return this.attributes.id ?? ''; }
  set id(value) { this.attributes.id = value; }
  get className() { return this.attributes.class ?? ''; }
  set className(value) { this.attributes.class = value; }
  get firstElementChild() { return this.children[0] ?? null; }
  get content() { return this; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children.length = 0; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  addEventListener() {}
  set innerHTML(html) {
    this.children.length = 0; this._text = ''; const stack = [this];
    for (const token of html.match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (token.startsWith('<')) {
        const tag = /^<([\w-]+)/.exec(token); if (!tag) continue;
        const node = new Element(tag[1]);
        for (const attr of token.matchAll(/([\w-]+)="([^"]*)"/g)) node.attributes[attr[1]] = attr[2];
        stack.at(-1).appendChild(node);
        if (!token.endsWith('/>') && !['br', 'hr', 'img', 'input', 'meta', 'link'].includes(node.tagName)) stack.push(node);
      } else stack.at(-1)._text += token;
    }
  }
  matches(selector) {
    const tag = /^[\w-]+/.exec(selector)?.[0]; if (tag && tag.toLowerCase() !== this.tagName) return false;
    for (const part of selector.matchAll(/([.#])([\w-]+)/g)) if (part[1] === '#' ? this.id !== part[2] : !this.className.split(/\s+/).includes(part[2])) return false;
    return true;
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/), found = [];
    const visit = node => { for (const child of node.children) {
      if (child.matches(parts.at(-1))) {
        let ancestor = child.parentElement, index = parts.length - 2;
        while (ancestor && index >= 0) { if (ancestor.matches(parts[index])) index--; ancestor = ancestor.parentElement; }
        if (index < 0) found.push(child);
      }
      visit(child);
    } }; visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function domFixture(t) {
  const doc = { head: new Element('head'), body: new Element('body'), createElement: tag => new Element(tag) };
  doc.getElementById = id => doc.head.querySelector(`#${id}`) ?? doc.body.querySelector(`#${id}`);
  install(t, { document: doc, window: {} }); return doc;
}
const combat = extra => Object.freeze({ runId: 'combat-life-A', revision: 1, combo: 2, best: 2, label: 'DOUBLE KILL', ready: false, award: 0, expiresIn: 3.5, ...extra });
const hudData = extra => ({ speed: 12, rpm01: .4, nitro01: .6, nitroMax: 1, hp01: .75, ...extra });
const gunnerData = () => ({ gunner: { weapon: { name: 'TEST', mag: 10, crosshair: 2, mode: 'auto' }, magNow: 10, reloading: false, reloadT: 0, swapT: 0 } });
const receipt = extra => Object.freeze({ runId: 'combat-life-A', revision: 1, shotId: 1, pelletIndex: 0, penetrationIndex: 0, targetId: 2, zone: 'fuel', damage: 3, killed: false, ...extra });

test('actual controls render the current nuke binding and L3 click for all roles', t => {
  domFixture(t); const ui = { input: { bindings: { ...defaultBindings(), nuke: ['KeyJ'] } } };
  for (const role of ['driver', 'gunner', 'solo']) {
    const screen = new ControlsScreen(ui, role);
    const row = screen.q.kb.querySelectorAll('.kr').find(node => node.querySelector('.kl').textContent === 'ACTIVATE NUKE (20-KILL COMBO)');
    assert.ok(row, role); assert.equal(row.querySelector('kbd').textContent, 'J');
    const padRow = screen.q.pad.querySelectorAll('.lg').find(node => node.querySelector('.lgt').textContent === 'ACTIVATE NUKE');
    assert.ok(padRow, role); assert.equal(padRow.querySelector('.ps').textContent, 'L3'); assert.equal(padRow.querySelector('em').textContent, 'CLICK');
  }
});

test('one combo node expires while the ready chip persists and follows the actual input device', t => {
  domFixture(t); const hud = new Hud(); hud.show({ driver: true, gunner: false });
  const state = combat(); assert.equal(hud.setCombat(state, 'kbm', 'J'), true); assert.equal(hud.q.combatCombo.textContent, 'x2 DOUBLE KILL');
  hud.update(.5, hudData()); assert.ok(hud.combatT > 0);
  hud.setCombat(state, 'kbm', 'J'); hud.update(.26, hudData()); assert.equal(Number(hud.q.combatCombo.style.opacity), 0, 'duplicate state cannot restart the notice');
  const ready = combat({ revision: 2, combo: 20, best: 20, label: 'SUPER ULTRA MEGA KILL', ready: true, award: 1 });
  hud.setCombat(ready, 'kbm', 'J'); assert.equal(hud.q.combatReady.textContent, 'J · NUKE READY');
  hud.update(5, hudData()); assert.equal(hud.q.combatReady.style.display, 'block');
  hud.setCombat(ready, 'pad', 'J'); assert.equal(hud.q.combatReady.textContent, 'L3 · NUKE READY');
  hud.setCombat(combat({ revision: 3, combo: 0, best: 20, label: '', ready: false, award: 1 }), 'pad');
  assert.equal(hud.q.combatReady.style.display, 'none'); assert.equal(hud.el.querySelectorAll('.combat-ready').length, 1); assert.equal(hud.el.querySelectorAll('.combat-combo').length, 1);
  assert.equal(state.combo, 2); assert.equal(ready.ready, true, 'presentation never changes authority readiness');
});

test('HUD ignores stale or foreign life state and show clears previous combat and receipt identities', t => {
  domFixture(t); const hud = new Hud();
  hud.setCombat(combat({ revision: 5, ready: true }));
  assert.equal(hud.setCombat(combat({ revision: 4, ready: false })), false); assert.equal(hud.q.combatReady.style.display, 'block');
  assert.equal(hud.setCombat(combat({ runId: 'combat-life-B', revision: 6 })), false);
  hud.gh.damageReceipt(receipt()); hud.setDefeat('driver'); assert.equal(hud.q.combatReady.style.display, 'none');
  hud.show({ driver: false, gunner: true }); assert.equal(hud.q.combatReady.textContent, ''); assert.equal(hud.q.combatCombo.textContent, ''); assert.equal(hud.gh.q.receipt.textContent, '');
  assert.equal(hud.setCombat(combat({ runId: 'combat-life-B', revision: 0 })), true);
  assert.equal(hud.gh.damageReceipt(receipt({ runId: 'combat-life-B', revision: 0 })), true);
  assert.equal(hud.setCombat(null), true); assert.equal(hud.combatRunId, null); assert.equal(hud.combatRevision, -1);
  assert.equal(hud.q.combatReady.textContent, ''); assert.equal(hud.q.combatCombo.textContent, ''); assert.equal(hud.gh.receiptRunId, null);
  assert.equal(hud.setCombat(combat({ runId: 'combat-life-C', revision: 0 })), true);
});

test('positive actual zone receipts show brief fuel, crew body, head and down feedback', t => {
  domFixture(t); const hud = new Hud(), gh = hud.gh;
  for (const [zone, killed, text, duration] of [['fuel', false, 'FUEL HIT', .28], ['driver', false, 'DRIVER HIT', .28], ['driver_head', false, 'DRIVER HEADSHOT', .28], ['gunner4_head', false, 'GUNNER HEADSHOT', .28], ['gunner3_legs', false, 'GUNNER HIT', .28], ['gunner2', true, 'GUNNER DOWN', .45], ['driver', true, 'DRIVER DOWN', .45]]) {
    gh.show(); const r = receipt({ zone, killed }); assert.equal(gh.damageReceipt(r), true); assert.equal(gh.q.receipt.textContent, text); assert.equal(gh.receiptT, duration);
    gh.update(duration + .01, gunnerData()); assert.equal(Number(gh.q.receipt.style.opacity), 0);
    assert.equal(r.zone, zone); assert.equal(r.damage, 3);
  }
  gh.show(); assert.equal(gh.damageReceipt(receipt({ damage: 0 })), false); assert.equal(gh.q.receipt.textContent, '');
  assert.equal(gh.damageReceipt(receipt({ zone: 'body' })), false); assert.equal(gh.q.receipt.textContent, '');
});

test('bounded receipt revisions reject replays and crew-down priority survives later pellets', t => {
  domFixture(t); const gh = new Hud().gh;
  gh.damageReceipt(receipt({ revision: 5, zone: 'driver_head', killed: true })); gh.update(.1, gunnerData());
  const remaining = gh.receiptT;
  assert.equal(gh.damageReceipt(receipt({ revision: 5, zone: 'fuel' })), false); assert.equal(gh.damageReceipt(receipt({ revision: 4 })), false);
  assert.equal(gh.damageReceipt(receipt({ revision: 6, runId: 'old-life' })), false); assert.equal(gh.receiptT, remaining);
  assert.equal(gh.damageReceipt(receipt({ revision: 6, pelletIndex: 1, zone: 'fuel' })), false); assert.equal(gh.q.receipt.textContent, 'DRIVER DOWN');
  assert.equal(gh.receiptRevision, 6, 'suppressed later pellets still advance the bounded replay watermark');
  gh.update(.36, gunnerData()); assert.equal(gh.damageReceipt(receipt({ revision: 7 })), true); assert.equal(gh.q.receipt.textContent, 'FUEL HIT');
  assert.equal(gh.el.querySelectorAll('.zone-receipt').length, 1);
});

test('zone text cannot replace existing boss labels or hit marker/kill priority', t => {
  domFixture(t); const gh = new Hud().gh;
  gh.bpT = .4; gh.q.bpn.textContent = 'REACTOR'; gh.hit(true, true);
  const marker = gh.q.hm.className;
  assert.equal(gh.damageReceipt(receipt({ zone: 'gunner', killed: true })), true);
  assert.equal(gh.q.bpn.textContent, 'REACTOR'); assert.equal(gh.q.hm.className, marker); assert.equal(gh.hitKind, 2);
  assert.equal(Number(gh.q.receipt.style.opacity), 0);
  gh.update(.2, gunnerData()); assert.equal(Number(gh.q.receipt.style.opacity), 0);
  gh.update(.5, gunnerData()); assert.equal(Number(gh.q.receipt.style.opacity), 0, 'suppressed receipt expires without a delayed queue');
  assert.equal(gh.damageReceipt(receipt({ revision: 2, zone: 'gunner_head' })), true); assert.equal(Number(gh.q.receipt.style.opacity), 1);
});
