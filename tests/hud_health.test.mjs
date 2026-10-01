import test from 'node:test';
import assert from 'node:assert/strict';
import { Hud } from '../src/ui/hud.js';

// Parse the constructor's actual markup into a generic tree. This deliberately
// has no HUD-specific selector answers: structural checks see real descendants.
class Element {
  constructor(tagName) { this.tagName = tagName.toLowerCase(); this.children = []; this.parentElement = null; this.style = {}; this.attributes = {}; this._text = ''; }
  get id() { return this.attributes.id ?? ''; }
  set id(value) { this.attributes.id = value; }
  get className() { return this.attributes.class ?? ''; }
  set className(value) { this.attributes.class = value; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children.length = 0; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  set innerHTML(html) {
    this.children.length = 0; this._text = '';
    const stack = [this];
    for (const token of html.match(/<[^>]+>|[^<]+/g) ?? []) {
      if (token.startsWith('</')) { stack.pop(); continue; }
      if (token.startsWith('<')) {
        const tag = /^<([\w-]+)/.exec(token);
        if (!tag) continue;
        const node = new Element(tag[1]);
        for (const attribute of token.matchAll(/([\w-]+)="([^"]*)"/g)) node.attributes[attribute[1]] = attribute[2];
        stack.at(-1).appendChild(node);
        if (!token.endsWith('/>') && !['br', 'hr', 'img', 'input', 'meta', 'link'].includes(node.tagName)) stack.push(node);
      } else stack.at(-1)._text += token;
    }
  }
  matches(selector) {
    const tag = /^[\w-]+/.exec(selector)?.[0];
    if (tag && tag.toLowerCase() !== this.tagName) return false;
    for (const part of selector.matchAll(/([.#])([\w-]+)/g)) {
      if (part[1] === '#' ? this.id !== part[2] : !this.className.split(/\s+/).includes(part[2])) return false;
    }
    return true;
  }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/), found = [];
    const visit = node => {
      for (const child of node.children) {
        if (child.matches(parts.at(-1))) {
          let ancestor = child.parentElement, index = parts.length - 2;
          while (ancestor && index >= 0) { if (ancestor.matches(parts[index])) index--; ancestor = ancestor.parentElement; }
          if (index < 0) found.push(child);
        }
        visit(child);
      }
    };
    visit(this); return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

function withHud(check) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const doc = { head: new Element('head'), body: new Element('body'), createElement: tag => new Element(tag) };
  doc.getElementById = id => doc.head.querySelector(`#${id}`) ?? doc.body.querySelector(`#${id}`);
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc });
  try { check(new Hud(), doc); }
  finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  }
}

function assertOnlyTruck(hud) {
  const box = hud.el.querySelector('.hpbox');
  assert.equal(box, hud.q.hpbox);
  assert.equal(box.querySelectorAll('.row').length, 1);
  assert.equal(box.querySelectorAll('.bar').length, 1);
  assert.deepEqual(box.querySelectorAll('span').map(node => node.textContent.trim()), ['TRUCK']);
  assert.equal(box.querySelector('.hp i'), hud.q.hp);
  assert.equal(hud.el.querySelector('.dhpbar'), null);
  assert.equal(hud.el.querySelector('.ghpbar'), null);
  assert.equal(Object.hasOwn(hud.q, 'dhp'), false);
  assert.equal(Object.hasOwn(hud.q, 'ghp'), false);
}

const state = extra => ({ speed: 12, rpm01: .4, nitro01: .6, nitroMax: 1, hp01: .75, biome: 'Scorched Highway', ...extra });

test('actual HUD constructor creates only a TRUCK health row and retains separate weapon/boss indicators', () => {
  withHud((hud, doc) => {
    assert.equal(doc.body.querySelector('#hud'), hud.el);
    assertOnlyTruck(hud);
    assert.ok(hud.gh.q.bpi, 'boss part health remains in the gunner layer');
    assert.ok(hud.gh.q.bar, 'weapon reload progress remains in the gunner layer');
    assert.notEqual(hud.gh.q.bpi, hud.q.hp);
    assert.notEqual(hud.gh.q.bar, hud.q.hp);
  });
});

test('driver, gunner and shared co-op views keep one clamped truck bar independent of crew health', () => {
  withHud(hud => {
    for (const role of [{ driver: true, gunner: false }, { driver: false, gunner: true }, { driver: true, gunner: true }]) {
      hud.show(role);
      assert.equal(hud.q.speedBox.style.display, role.driver ? '' : 'none');
      assert.equal(hud.gh.el.style.display, role.gunner ? '' : 'none');
      assert.notEqual(hud.q.hpbox.style.display, 'none');
      for (const [hp01, expected] of [[-.5, 0], [.375, .375], [1.5, 1]]) {
        for (const [dhp01, ghp01] of [[1, 1], [0, 1], [1, 0], [0, 0]]) {
          const data = Object.freeze(state({ hp01, dhp01, ghp01, showDriver: role.driver }));
          const before = { ...data };
          hud.update(1 / 60, data);
          assert.equal(hud.q.hp.style.transform, `scaleX(${expected})`);
          assert.deepEqual(data, before, 'presentation cannot change truck or crew combat health');
          assertOnlyTruck(hud);
        }
      }
    }
  });
});

test('missing-player fallback works without crew HP and keeps finite truck and vignette values', () => {
  withHud(hud => {
    // Run._hudData already supplies hp01:1 when player state is unavailable.
    const fallback = Object.freeze({ speed: 0, rpm01: 0, nitro01: 0, hp01: 1 });
    for (const role of [{ driver: true, gunner: false }, { driver: false, gunner: true }, { driver: true, gunner: true }]) {
      hud.show(role); hud.update(1 / 60, fallback, false);
      assert.equal(hud.q.hp.style.transform, 'scaleX(1)');
      assert.ok(Number.isFinite(Number(hud.q.vig.style.opacity)));
      assert.equal(Object.hasOwn(fallback, 'dhp01'), false);
      assert.equal(Object.hasOwn(fallback, 'ghp01'), false);
      assertOnlyTruck(hud);
    }
  });
});

test('hiding crew bars preserves the gunner low-health vignette without changing the truck bar', () => {
  withHud(hud => {
    const data = Object.freeze(state({ hp01: .75, dhp01: 1, ghp01: .05 }));
    hud.show({ driver: true, gunner: false }); hud.update(1 / 60, data);
    assert.equal(hud.q.vig.style.opacity, 0);
    hud.show({ driver: false, gunner: true }); hud.update(1 / 60, data);
    assert.ok(Number(hud.q.vig.style.opacity) > 0);
    assert.equal(hud.q.hp.style.transform, 'scaleX(0.75)');
    assertOnlyTruck(hud);
  });
});
