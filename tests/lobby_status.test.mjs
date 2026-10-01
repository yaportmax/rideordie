import test from 'node:test';
import assert from 'node:assert/strict';
import { LobbyScreen } from '../src/ui/screens/lobby.js';
import { Nav } from '../src/ui/nav.js';

const players = () => [
  { id: 'host', name: 'HOST', you: true, host: true, seat: 'driver', ready: true },
  { id: 'guest', name: 'GUEST', seat: 'gunner', ready: true },
];

function fixture(state = {}) {
  const events = [], screen = Object.create(LobbyScreen.prototype);
  let html = '', nodes = [];
  const safe = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      for (const node of nodes) node.isConnected = false;
      html = value;
      nodes = [...value.matchAll(/<div\b[^>]*>/g)].filter(match => /class="[^"]*\bf\b/.test(match[0])).map(match => {
        const attrs = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(attr => [attr[1], attr[2]]));
        const classes = new Set(attrs.class.split(/\s+/));
        const node = {
          dataset: Object.fromEntries(Object.entries(attrs).filter(([name]) => name.startsWith('data-')).map(([name, value]) => [name.slice(5), value])),
          classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name) },
          getAttribute: name => attrs[name], isConnected: true, offsetParent: {}, tagName: 'DIV',
        };
        node.click = () => screen.onClick({ target: { closest: () => node } });
        return node;
      });
    },
  };
  const query = selector => {
    const attr = selector.match(/^\[data-(act|k)=(?:"([^"]+)"|([^\]]+))\]$/);
    if (attr) return nodes.find(node => node.dataset[attr[1]] === (attr[2] || attr[3])) || null;
    if (selector.startsWith('.')) return nodes.find(node => selector.slice(1).split('.').every(name => node.classList.contains(name))) || null;
    return null;
  };
  const el = { contains: node => nodes.includes(node), querySelector: query, querySelectorAll: () => nodes };
  const ui = { toast: (...args) => events.push(['toast', ...args]), snd: sound => events.push(['sound', sound]), screen: () => screen };
  const nav = Object.assign(Object.create(Nav.prototype), { ui, cur: null, scope: () => el,
    focus(node) { this.cur = node; node.classList.add('is-f'); events.push(['focus', node.dataset.k]); } });
  ui.nav = nav;
  Object.assign(screen, { state: { status: 'connected', code: 'ABCDE', isHost: true, players: players(), ...state }, safe, el, ui,
    cb: { onSeat: role => events.push(['seat', role]), onReady: ready => events.push(['ready', ready]), onStart: () => events.push(['start']),
      onLeave: () => events.push(['leave']), onCopy: () => events.push(['copy']) } });
  screen.render();
  return { screen, events, action: name => query(`[data-act=${name}]`), seat: role => query(`[data-k="seat:${role}"]`) };
}

function installGlobal(t, name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
}

for (const [status, label] of [['closed', 'CONNECTION CLOSED'], ['connecting', 'CONNECTING'], ['reconnecting', 'RECONNECTING'], ['lost', 'CONNECTION LOST']]) {
  test(`${status} lobby labels the connection and blocks actions while leave stays usable`, () => {
    const f = fixture({ status, canStart: true });
    assert.ok(f.screen.safe.innerHTML.includes(label));
    assert.equal(f.screen.canStart(), false, 'stale canStart cannot override a missing connection');
    for (const node of [f.seat('driver'), f.seat('gunner'), f.action('ready'), f.action('start')]) {
      assert.equal(node.getAttribute('aria-disabled'), 'true');
      assert.equal(f.screen.ui.nav.isFocusable(node), false);
      node.click();
      // A click queued before a status refresh must also be blocked.
      node.classList.remove('dis'); node.click();
    }
    f.screen.alt('y');
    assert.deepEqual(f.events, []);
    assert.equal(f.screen.initialFocus(), f.action('leave'));
    assert.equal(f.screen.ui.nav.isFocusable(f.action('leave')), true);
    f.action('leave').click(); f.screen.back();
    assert.equal(f.events.filter(event => event[0] === 'leave').length, 2);
  });
}

test('waiting host can choose an open seat and ready, but cannot start without a connected partner', () => {
  const f = fixture({ status: 'waiting', canStart: true, players: [{ id: 'host', you: true, seat: 'driver', ready: false }] });
  assert.equal(f.screen.safe.innerHTML.includes('WAITING FOR PLAYER'), true);
  assert.equal(f.screen.ui.nav.isFocusable(f.seat('gunner')), true);
  f.seat('gunner').click(); f.action('ready').click(); f.action('start').click();
  assert.deepEqual(f.events.filter(event => ['seat', 'ready', 'start'].includes(event[0])), [['seat', 'gunner'], ['ready', true]]);
});

test('connected lobby enables ready cancellation and a ready host start, excluding the other player seat', () => {
  const f = fixture();
  assert.equal(f.screen.safe.innerHTML.includes('PLAYER CONNECTED'), true);
  assert.equal(f.screen.canStart(), true);
  assert.equal(f.screen.ui.nav.isFocusable(f.action('ready')), true);
  assert.equal(f.screen.ui.nav.isFocusable(f.action('start')), true);
  assert.equal(f.screen.ui.nav.isFocusable(f.seat('gunner')), false);
  f.seat('gunner').click(); f.screen.alt('y'); f.action('start').click();
  assert.deepEqual(f.events.filter(event => ['seat', 'ready', 'start'].includes(event[0])), [['ready', false], ['start']]);
});

test('ready is unavailable until the local player has a seat', () => {
  const f = fixture({ players: [{ id: 'host', you: true, seat: null, ready: false }] });
  assert.equal(f.screen.ui.nav.isFocusable(f.action('ready')), false);
  f.action('ready').click(); f.screen.alt('y');
  assert.deepEqual(f.events, []);
  assert.equal(f.screen.initialFocus(), f.seat('driver'));
});

test('connection updates move focus away from disabled controls and restore normal readiness', () => {
  const f = fixture(); f.screen.ui.nav.focus(f.action('ready')); f.events.length = 0;
  f.screen.update({ ...f.screen.state, status: 'reconnecting', canStart: true });
  assert.equal(f.screen.ui.nav.cur, f.action('leave'));
  assert.equal(f.events.some(event => event[0] === 'sound' && event[1] === 'ready'), false);
  f.screen.update({ ...f.screen.state, status: 'connected', canStart: true });
  assert.equal(f.screen.canStart(), true);
  assert.equal(f.events.filter(event => event[0] === 'sound' && event[1] === 'ready').length, 1);
  f.action('start').click(); assert.equal(f.events.filter(event => event[0] === 'start').length, 1);
});

test('empty and whitespace room codes cannot be copied or report success', async t => {
  let writes = 0;
  installGlobal(t, 'navigator', { clipboard: { writeText: async () => { writes++; } } });
  for (const code of ['', '   ']) {
    const f = fixture({ code });
    assert.equal(f.screen.ui.nav.isFocusable(f.action('copy')), false);
    f.action('copy').click(); await f.screen.copy();
    assert.deepEqual(f.events, []);
  }
  assert.equal(writes, 0);
});

test('clipboard success copies the displayed code and reports success once', async t => {
  const writes = [];
  installGlobal(t, 'navigator', { clipboard: { writeText: async code => { writes.push(code); } } });
  const f = fixture({ code: ' abcde ' });
  await f.screen.copy();
  assert.deepEqual(writes, ['ABCDE']);
  assert.deepEqual(f.events, [['toast', 'ROOM CODE COPIED', 'good', 1800], ['copy']]);
});

test('failed clipboard fallback reports failure and removes its temporary textarea', async t => {
  const selected = [], removed = [], attached = [];
  installGlobal(t, 'navigator', { clipboard: { writeText: async () => { throw new Error('Denied'); } } });
  installGlobal(t, 'document', { body: { appendChild: node => attached.push(node) }, execCommand: () => false,
    createElement: () => ({ style: {}, select() { selected.push(this.value); }, remove() { removed.push(this); } }) });
  const f = fixture(); await f.screen.copy();
  assert.deepEqual(selected, ['ABCDE']); assert.equal(attached.length, 1); assert.equal(removed.length, 1);
  assert.deepEqual(f.events, [['toast', 'COULD NOT COPY - CODE: ABCDE', 'warn']]);
});

test('successful legacy clipboard fallback reports copy success', t => {
  let removed = false;
  installGlobal(t, 'navigator', {});
  installGlobal(t, 'document', { body: { appendChild() {} }, execCommand: command => command === 'copy',
    createElement: () => ({ style: {}, select() {}, remove() { removed = true; } }) });
  const f = fixture(); f.screen.copy();
  assert.equal(removed, true); assert.deepEqual(f.events, [['toast', 'ROOM CODE COPIED', 'good', 1800], ['copy']]);
});
