import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';
import { Transport } from '../src/net/transport.js';
import { LobbyScreen } from '../src/ui/screens/lobby.js';
import { TitleScreen } from '../src/ui/screens/title.js';
import { Nav } from '../src/ui/nav.js';
import { makeInviteLink, normalizeRoomCode, roomInviteFromUrl, withoutRoomInvite, clearRoomInvite } from '../src/net/invite.js';

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); } finally { css.deregister(); }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
function install(t, name, value) {
  const old = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else delete globalThis[name]; });
}
function fixture(t, booted = false) {
  install(t, 'window', {}); install(t, 'requestAnimationFrame', () => 1);
  const ready = deferred(), joining = deferred(), joins = [], sent = [], titles = [], toasts = [], lobby = [];
  t.mock.method(Transport.prototype, 'join', function(code) { this.code = code; joins.push({ code, transport: this }); return joining.promise; });
  t.mock.method(Transport.prototype, 'send', function(message) { sent.push(message); return true; });
  t.mock.method(Transport.prototype, 'destroy', function() { this.open = false; });
  const ui = { settings: {}, panel: null, modal: false, screen() { return this.panel; }, modalOpen() { return this.modal; },
    hideAll() { this.panel = null; this.modal = false; },
    showTitle(cb) { titles.push(cb); this.panel = { kind: 'title', view: 'menu' }; },
    showLobby(state, cb) { lobby.push({ state, cb }); this.panel = { kind: 'lobby' }; }, updateLobby(state) { lobby.push({ state }); },
    showGarage() { this.panel = { kind: 'garage' }; }, updateGarage() {}, toast(text, kind) { toasts.push({ text, kind }); } };
  const game = { run: null, endRun() { this.run = null; }, fade() {}, showGarage() {},
    garage: { setStage() {}, setPreview() {}, setTab() {}, ready: ready.promise }, audio: { music: { setState() {} } } };
  const profile = DEFAULT_PROFILE(); profile.cash = 4321; profile.totalCash = 8765;
  const app = Object.assign(Object.create(App.prototype), { game, ui, input: {}, profile, personalProfile: profile,
    mode: 'title', screen: 'title', session: null, _flowId: 0, _booted: booted, readyMine: false, readyOther: false,
    _pendingRunMsgs: [], _pendingFast: null, _roomPending: null, _startSelection: null, _startup: null, _pendingResults: null,
    sound() {}, _frameRect() {}, _bootScreen() { return ready.promise; } });
  return { app, game, ui, profile, ready, joining, joins, sent, titles, toasts, lobby };
}

test('invite URLs retain the exact current origin/path and carry only the normalized public room code', () => {
  const href = makeInviteLink('https://ride.maxyaport.com/nested/game/?debug=1&room=OLDXX#private', ' abcde ');
  assert.equal(href, 'https://ride.maxyaport.com/nested/game/?room=ABCDE');
  assert.equal(roomInviteFromUrl(href), 'ABCDE');
  assert.equal(makeInviteLink('http://127.0.0.1:5244//deployment/path?x=1', 'ABCDE'), 'http://127.0.0.1:5244//deployment/path?room=ABCDE');
  assert.equal(new URL(makeInviteLink('https://ride.maxyaport.com//other.example/game', 'ABCDE')).origin, 'https://ride.maxyaport.com');
  assert.equal(withoutRoomInvite('https://ride.maxyaport.com/game?quality=high&room=ABCDE#help'), 'https://ride.maxyaport.com/game?quality=high#help');
});

test('ambiguous, malformed, non-web and missing invitations cannot select a room or destination', () => {
  for (const href of ['https://ride.maxyaport.com/', 'https://ride.maxyaport.com/?room=', 'https://ride.maxyaport.com/?room=AB',
    'https://ride.maxyaport.com/?room=ABCDEFGHIJKLM', 'https://ride.maxyaport.com/?room=AB%00DE',
    'https://ride.maxyaport.com/?room=ABCDE&room=FGHIJ', 'https://ride.maxyaport.com/?room=https://elsewhere.example',
    'javascript:alert(1)', 'file:///game?room=ABCDE', 'not a URL']) assert.equal(roomInviteFromUrl(href), null, href);
  for (const code of [null, 12345, '', '  ', 'AB-CD', '<ABCDE>', 'AB\nDE', 'AB', 'ABCDEFGHIJKLM']) assert.equal(normalizeRoomCode(code), null);
  assert.equal(normalizeRoomCode('abc'), 'ABC'); assert.equal(normalizeRoomCode('abcd'), 'ABCD');
  assert.equal(makeInviteLink('javascript:alert(1)', 'ABCDE'), null); assert.equal(makeInviteLink('https://ride.maxyaport.com/', '../ABCDE'), null);
});

test('valid, malformed and duplicate room parameters are removed without dropping unrelated URL state', () => {
  for (const room of ['room=abcde', 'room=', 'room=AB%00DE', 'room=ABCDE&room=FGHIJ']) {
    const calls = [], state = { marker: 'existing navigation state' }, history = { state, replaceState(...args) { calls.push(args); } };
    assert.equal(clearRoomInvite(`https://ride.maxyaport.com/game/?quality=high&${room}#help`, history), true);
    assert.deepEqual(calls, [[state, '', 'https://ride.maxyaport.com/game/?quality=high#help']]);
  }
  let touched = false;
  const history = { replaceState() { touched = true; } };
  assert.equal(clearRoomInvite('https://ride.maxyaport.com/game?quality=high', history), false);
  assert.equal(clearRoomInvite('file:///game?room=ABCDE', history), false);
  assert.equal(touched, false);
});

test('consumed mixed invitation addresses remove routing shortcuts so manual reload returns to the normal title', () => {
  const calls = [], history = { state: 7, replaceState(...args) { calls.push(args); } };
  assert.equal(clearRoomInvite('https://ride.maxyaport.com/nested/?quality=high&room=ABCDE&solo&devnet=host&as=driver&role=gunner#help', history), true);
  assert.deepEqual(calls, [[7, '', 'https://ride.maxyaport.com/nested/?quality=high&as=driver&role=gunner#help']]);
  const cleaned = new URL(calls[0][2]); assert.equal(cleaned.searchParams.has('room'), false);
  assert.equal(cleaned.searchParams.has('solo'), false); assert.equal(cleaned.searchParams.has('devnet'), false);
  // An ordinary no-room debug URL remains available to explicit development users.
  calls.length = 0; assert.equal(clearRoomInvite('https://ride.maxyaport.com/?solo&as=driver', history), false); assert.deepEqual(calls, []);
});

test('restricted history cannot turn an otherwise valid invite into a fatal boot or a join retry', async t => {
  const href = 'https://ride.maxyaport.com/?room=ABCDE';
  const f = fixture(t, true); await f.app.title();
  assert.equal(clearRoomInvite(href, { replaceState() { throw new Error('History unavailable'); } }), false);
  const pending = f.app.consumeInvite(roomInviteFromUrl(href)); await flush();
  assert.equal(f.joins.length, 1); f.joining.resolve(); assert.equal(await pending, true);
  await f.app.title(); assert.equal(await f.app.consumeInvite(roomInviteFromUrl(href)), false);
  assert.equal(f.joins.length, 1); assert.equal(f.app.session, null);
});

test('actual HTML bootstrap retains the normal menu overlay whenever an invitation parameter is present', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1]; assert.ok(script);
  for (const search of ['?room=ABCDE', '?room=ABCDE&solo', '?room=ABCDE&devnet=host', '?solo&room=', '?room=ABCDE&room=FGHIJ&devnet=join']) {
    let removed = 0;
    vm.runInNewContext(script, { URLSearchParams, location: { search }, document: { getElementById: () => ({ remove() { removed++; } }) } });
    assert.equal(removed, 0, search);
  }
  for (const search of ['?solo', '?devnet=host', '?seed=7&solo']) {
    let removed = 0;
    vm.runInNewContext(script, { URLSearchParams, location: { search }, document: { getElementById: () => ({ remove() { removed++; } }) } });
    assert.equal(removed, 1, search);
  }
});

test('actual main entry prioritizes invitations over development shortcuts and cleans invalid links without opening a room', async t => {
  let serial = 0;
  for (const [search, cleaned] of [
    ['?room=abcde&solo&as=driver', 'https://ride.maxyaport.com/game/?as=driver#help'],
    ['?room=ABCDE&devnet=host&role=driver', 'https://ride.maxyaport.com/game/?role=driver#help'],
    ['?room=ABCDE&room=FGHIJ&devnet=join', 'https://ride.maxyaport.com/game/#help'],
    ['?room=AB%00DE&solo', 'https://ride.maxyaport.com/game/#help'],
  ]) await t.test(search, async st => {
    const entry = { games: 0, apps: 0, loops: 0, title: 0, shortcuts: 0, invites: [], history: [], removed: [], errors: [], toasts: [] };
    install(st, '__inviteEntry', entry); install(st, 'window', {});
    install(st, 'location', { href: `https://ride.maxyaport.com/game/${search}#help`, search });
    install(st, 'history', { state: { retained: true }, replaceState(...args) { entry.history.push(args); } });
    install(st, 'document', { getElementById: () => ({ remove() { entry.removed.push(true); } }) });
    install(st, 'localStorage', { getItem: () => null });
    st.mock.method(console, 'error', (...args) => entry.errors.push(args));
    const token = ++serial, hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        if (result.url.endsWith('/src/game/game.js')) return { url: `invite-entry:game-${token}`, shortCircuit: true };
        if (result.url.endsWith('/src/app.js')) return { url: `invite-entry:app-${token}`, shortCircuit: true };
        if (result.url.endsWith('/src/net/session.js')) return { url: `invite-entry:session-${token}`, shortCircuit: true };
        return result;
      },
      load(url, context, nextLoad) {
        if (url.startsWith('invite-entry:game-')) return { format: 'module', shortCircuit: true, source: `export class Game {
          constructor() { globalThis.__inviteEntry.games++; this.input={}; this.run=null; }
          async boot() {} loop() { globalThis.__inviteEntry.loops++; }
          async startRun() { globalThis.__inviteEntry.shortcuts++; throw new Error('Unexpected debug run'); }
        }` };
        if (url.startsWith('invite-entry:app-')) return { format: 'module', shortCircuit: true, source: `export class App {
          constructor() { globalThis.__inviteEntry.apps++; this.mode=this.screen='title'; this.ui={ screen:()=>({kind:'title'}), toast:(...args)=>globalThis.__inviteEntry.toasts.push(args) }; }
          title() { globalThis.__inviteEntry.title++; return Promise.resolve(true); }
          consumeInvite(code) { globalThis.__inviteEntry.invites.push(code); return Promise.resolve(true); }
        }` };
        if (url.startsWith('invite-entry:session-')) return { format: 'module', shortCircuit: true, source: `export class Session {
          constructor() { globalThis.__inviteEntry.shortcuts++; throw new Error('Unexpected debug network room'); }
        }` };
        return nextLoad(url, context);
      },
    });
    try { await import(`../src/main.js?invite-entry=${token}`); await flush(); }
    finally { hooks.deregister(); }
    assert.deepEqual([entry.games, entry.apps, entry.loops, entry.title, entry.shortcuts], [1, 1, 1, 1, 0]);
    assert.deepEqual(entry.removed, []); assert.deepEqual(entry.errors, []);
    assert.deepEqual(entry.history, [[{ retained: true }, '', cleaned]]);
    const expected = roomInviteFromUrl(location.href); assert.deepEqual(entry.invites, expected ? ['ABCDE'] : []);
    assert.equal(entry.toasts.length, expected ? 0 : 1); assert.equal(window.__ready, true);
  });
});

test('only the latest disconnected title visit mounts after one shared unfinished boot', async t => {
  const f = fixture(t), first = f.app.title(), firstInvite = f.app.consumeInvite('ABCDE');
  const second = f.app.title(); await flush(); assert.equal(f.titles.length, 0); assert.equal(f.joins.length, 0);
  f.ready.resolve(); assert.equal(await first, false); assert.equal(await second, true); assert.equal(await firstInvite, false);
  assert.equal(f.titles.length, 1); assert.equal(f.joins.length, 0);
  assert.equal(await f.app.consumeInvite('FGHIJ'), false, 'cancelled URL consumption cannot revive on a later visit');
});

test('actual App and Session join exactly once after title readiness without changing wallets, readiness or run state', async t => {
  const f = fixture(t); const before = structuredClone(f.profile); f.app.title();
  const invitation = f.app.consumeInvite(' abcde '); assert.equal(await f.app.consumeInvite('FGHIJ'), false);
  await flush(); assert.equal(f.joins.length, 0); assert.equal(f.app.session, null);
  f.ready.resolve(); await flush(); assert.equal(f.joins.length, 1); assert.equal(f.joins[0].code, 'ABCDE');
  const s = f.app.session; assert.equal(f.app.screen, 'lobby'); assert.equal(f.lobby[0].state.status, 'connecting');
  assert.equal(s.me.ready, false); assert.equal(f.app.readyMine, false); assert.equal(f.app.readyOther, false); assert.equal(f.game.run, null);
  assert.equal(s.personalProfile, f.profile); assert.equal(s.wallet.cash, 4321); assert.equal(s.wallet.totalCash, 8765);
  f.joining.resolve(); assert.equal(await invitation, true); assert.equal(s.me.role, 'gunner'); assert.equal(s.code, 'ABCDE');
  s.tp.onOpen(); assert.equal(f.sent.find(message => message.t === 'hello').protocol, NET_PROTOCOL);
  assert.equal(s.canStart(), false); assert.ok(!f.sent.some(message => ['ready', 'start', 'runReady'].includes(message.t)));
  assert.deepEqual(f.profile, before); assert.equal(f.game.run, null); assert.equal(await f.app.consumeInvite('ABCDE'), false);
});

test('invalid codes never consume or create an actual Session; a later valid invitation can still join', async t => {
  const f = fixture(t, true); await f.app.title();
  for (const code of ['', 'AB', 'ABCDE!', 'ABCDEFGHIJKLM', null]) assert.equal(await f.app.consumeInvite(code), false);
  assert.equal(f.joins.length, 0); assert.equal(f.app.session, null); assert.equal(f.app._inviteConsumed, undefined);
  const pending = f.app.consumeInvite('ABCDE'); await flush(); assert.equal(f.joins.length, 1); f.joining.resolve(); assert.equal(await pending, true);
});

test('replaced title, solo, run, pending startup and explicit room flow all cancel a delayed invitation', async t => {
  const cases = {
    'new title visit': f => f.app.title(),
    solo: f => { f.app.mode = 'solo'; f.app.screen = 'garage'; f.app._transition(); },
    run: f => { f.game.run = { id: 'real-new-life' }; },
    startup: f => { f.app._startup = { flow: f.app._flowId }; },
    'manual room flow': f => { f.app.session = { leave() {}, isHost: true }; f.app.mode = 'coop'; f.app.screen = 'lobby'; f.app._transition(); },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async st => {
    const f = fixture(st); f.app.title(); const pending = f.app.consumeInvite('ABCDE'); change(f); f.ready.resolve();
    assert.equal(await pending, false); assert.equal(f.joins.length, 0); assert.equal(await f.app.consumeInvite('ABCDE'), false);
  });
});

test('same-flow settings, saves, controls, seat picker, manual join and modal navigation revoke autojoin', async t => {
  for (const navigation of [{ kind: 'settings' }, { kind: 'saves' }, { kind: 'controls' },
    { kind: 'title', view: 'seats' }, { kind: 'title', view: 'join' }, { kind: 'title', view: 'menu', modal: true }]) await t.test(JSON.stringify(navigation), async st => {
    const f = fixture(st, true); await f.app.title(); const pending = f.app.consumeInvite('ABCDE');
    f.ui.panel = navigation; f.ui.modal = !!navigation.modal;
    assert.equal(await pending, false); assert.equal(f.joins.length, 0);
    f.ui.panel = { kind: 'title', view: 'menu' }; f.ui.modal = false; assert.equal(await f.app.consumeInvite('ABCDE'), false);
  });
});

test('a failed invitation uses the existing normal join error and never rejoins when title returns', async t => {
  const f = fixture(t, true); await f.app.title(); const pending = f.app.consumeInvite('ABCDE'); await flush();
  f.joining.reject(new Error('Room not available')); assert.equal(await pending, false);
  assert.equal(f.app.session, null); assert.equal(f.app.screen, 'title'); assert.equal(f.joins.length, 1);
  assert.ok(f.toasts.some(v => v.text === 'Room not available')); assert.equal(await f.app.consumeInvite('ABCDE'), false);
  assert.equal(f.game.run, null); assert.equal(f.profile.cash, 4321);
});

test('leave or replacement during a real App join prevents stale success or failure from mutating the new flow', async t => {
  for (const fails of [false, true]) await t.test(fails ? 'late failure' : 'late success', async st => {
    const f = fixture(st, true); await f.app.title(); const pending = f.app.consumeInvite('ABCDE'); await flush(); const old = f.app.session;
    await f.app.title(); const replacement = { marker: 'replacement', isHost: true }; f.app.mode = 'coop'; f.app.screen = 'lobby'; f.app.session = replacement;
    const toasts = f.toasts.length, sent = f.sent.length;
    if (fails) f.joining.reject(new Error('Old room failure')); else f.joining.resolve();
    assert.equal(await pending, false); assert.equal(f.app.session, replacement); assert.equal(f.app.screen, 'lobby');
    assert.equal(old.me.role, null); assert.equal(f.toasts.length, toasts); assert.equal(f.sent.length, sent); assert.equal(f.game.run, null);
  });
});

test('detached title callbacks cannot start rooms, saves or solo after a different title visit', async t => {
  const f = fixture(t, true); await f.app.title(); const old = f.titles.at(-1), calls = [];
  f.app.host = () => calls.push('host'); f.app.join = () => calls.push('join');
  f.app.garage = () => calls.push('garage'); f.app._showSaves = () => calls.push('saves');
  await f.app.title();
  old.onHost(); old.onJoin('ABCDE'); old.onSolo('driver'); old.onSaves();
  assert.deepEqual(calls, []); assert.equal(f.app.mode, 'title');
  const current = f.titles.at(-1); current.onHost(); f.ui.panel.view = 'join'; current.onJoin('FGHIJ'); f.ui.panel.view = 'menu'; current.onSaves();
  assert.deepEqual(calls, ['host', 'join', 'saves']);
});

test('a delayed solo callback is revoked by BACK or a same-flow replacement of the title panel', async t => {
  for (const replacement of [false, true]) await t.test(replacement ? 'new panel' : 'back to menu', async st => {
    const f = fixture(st, true); await f.app.title(); const old = f.titles.at(-1), calls = [];
    f.app.garage = () => calls.push('garage'); f.ui.panel.view = 'seats';
    if (replacement) f.app._showTitle(); else f.ui.panel.view = 'menu';
    old.onSolo('driver'); assert.deepEqual(calls, []); assert.equal(f.app.mode, 'title');
    const latest = f.titles.at(-1); f.ui.panel.view = 'seats'; latest.onSolo('gunner');
    assert.deepEqual(calls, ['garage']); assert.equal(f.app.soloRole, 'gunner');
  });
});

test('actual TitleScreen delayed seat activation cannot revive after BACK and reopening the picker', t => {
  const timers = [], starts = [], sounds = []; let current;
  install(t, 'requestAnimationFrame', () => 1);
  t.mock.method(globalThis, 'setTimeout', (fn, milliseconds) => { timers.push({ fn, milliseconds }); return timers.length; });
  const screen = Object.assign(Object.create(TitleScreen.prototype), { _actionGeneration: 0, view: 'menu', hintsEl: {},
    el: { classList: { add() {}, remove() {} } }, viewEl: { querySelector: () => ({ animate() {} }) },
    ui: { settings: {}, screen: () => current, snd: value => sounds.push(value), pressFx() {}, changeSetting() {}, nav: {} },
    cb: { onSolo: role => starts.push(role) } });
  current = screen; screen.showSeats(); screen.onClick({ target: { closest: () => ({ dataset: { seat: 'driver' } }) } });
  assert.equal(timers.at(-1).milliseconds, 120); assert.deepEqual(starts, []);
  screen.back(); screen.showSeats(); timers[0].fn(); assert.deepEqual(starts, []);
  screen.onClick({ target: { closest: () => ({ dataset: { seat: 'gunner' } }) } }); timers.at(-1).fn();
  assert.deepEqual(starts, ['gunner']); assert.ok(sounds.includes('go'));
  screen.onClick({ target: { closest: () => ({ dataset: { seat: 'both' } }) } }); screen.destroy(); timers.at(-1).fn();
  assert.deepEqual(starts, ['gunner']);
});

test('actual TitleScreen seat feedback delay is revoked if another screen becomes current', t => {
  const timers = [], starts = []; let current;
  install(t, 'requestAnimationFrame', () => 1);
  t.mock.method(globalThis, 'setTimeout', fn => { timers.push(fn); return timers.length; });
  const screen = Object.assign(Object.create(TitleScreen.prototype), { _actionGeneration: 1, view: 'seats',
    ui: { screen: () => current, snd() {}, pressFx() {}, changeSetting() {} }, cb: { onSolo: role => starts.push(role) } });
  current = screen; screen.onClick({ target: { closest: () => ({ dataset: { seat: 'driver' } }) } });
  current = { kind: 'lobby' }; timers[0](); assert.deepEqual(starts, []);
});

test('actual title navigation revokes queued focus from previous views and detached screens', t => {
  const frames = [], focused = [], control = { animate() {} }; let current;
  install(t, 'requestAnimationFrame', fn => { frames.push(fn); return frames.length; });
  const screen = Object.assign(Object.create(TitleScreen.prototype), { _actionGeneration: 0, view: 'menu', hintsEl: {},
    el: { classList: { add() {}, remove() {} } }, viewEl: { querySelector: () => control },
    ui: { settings: {}, screen: () => current, nav: { focus: node => focused.push(node), ensure: node => focused.push(node) } }, cb: {} });
  current = screen; screen.showSeats(); const seats = frames.at(-1); screen.showJoin(); const join = frames.at(-1);
  seats(); assert.deepEqual(focused, []); join(); assert.deepEqual(focused, [control]);
  screen.showMenu(); const menu = frames.at(-1); current = { kind: 'lobby' }; menu(); assert.deepEqual(focused, [control]);
  current = screen; screen.showSeats(); const detached = frames.at(-1); screen.destroy(); detached(); assert.deepEqual(focused, [control]);
});

test('detached title callbacks do not override an active settings, saves or controls panel', async t => {
  for (const kind of ['settings', 'saves', 'controls']) await t.test(kind, async st => {
    const f = fixture(st, true); await f.app.title(); const cb = f.titles.at(-1), calls = [];
    f.app.host = () => calls.push('host'); f.app.join = () => calls.push('join'); f.app.garage = () => calls.push('garage');
    f.ui.panel = { kind }; cb.onHost(); cb.onJoin('ABCDE'); cb.onSolo('gunner');
    assert.deepEqual(calls, []); assert.equal(f.app.mode, 'title'); assert.equal(f.app.session, null);
  });
});

test('lobby callbacks remain valid across ordinary same-room updates but cannot act on a replacement room', async t => {
  const f = fixture(t, true); await f.app.title(); const pending = f.app.join('ABCDE'); await flush();
  const cb = f.lobby[0].cb, room = f.app.session;
  f.joining.resolve(); assert.equal(await pending, true);
  f.app._lobbyRefresh(); cb.onSeat('driver'); assert.equal(room.me.role, 'driver');
  cb.onReady(true); assert.equal(room.me.ready, true);
  await f.app.title(); const calls = [];
  f.app.session = { setRole() { calls.push('seat'); }, setReady() { calls.push('ready'); }, canStart() { return true; },
    sendJSON() { calls.push('send'); }, broadcastProfile() { calls.push('profile'); } };
  f.app.mode = 'coop'; f.app.screen = 'lobby'; f.app.garage = () => calls.push('garage'); f.app.title = () => calls.push('leave');
  cb.onSeat('gunner'); cb.onReady(true); cb.onStart(); cb.onLeave();
  assert.deepEqual(calls, []);
});

test('manual joining rejects malformed room IDs before changing the current menu or session', async t => {
  const f = fixture(t, true); await f.app.title(); const before = structuredClone(f.profile);
  for (const code of ['', 'AB', '../ABCDE', 'ABCDE!', 'ABCDEFGHIJKLM']) assert.equal(await f.app.join(code), false);
  assert.equal(f.joins.length, 0); assert.equal(f.app.session, null); assert.equal(f.app.mode, 'title');
  assert.equal(f.app.screen, 'title'); assert.deepEqual(f.profile, before);
  const pending = f.app.join(' abcde '); await flush(); assert.equal(f.joins[0].code, 'ABCDE'); f.joining.resolve(); assert.equal(await pending, true);
});

test('actual first-launch boot readiness waits for garage readiness and for the visible boot overlay to leave', async t => {
  const f = fixture(t), timers = [], removed = [];
  const boot = { classList: { add: value => removed.push(value) }, remove: () => removed.push('removed') };
  install(t, 'document', { getElementById: () => boot });
  t.mock.method(globalThis, 'setTimeout', (fn, milliseconds) => { timers.push({ fn, milliseconds }); return timers.length; });
  f.app._bootScreen = App.prototype._bootScreen; const title = f.app.title(); const invite = f.app.consumeInvite('ABCDE');
  await flush(); assert.equal(f.titles.length, 0); assert.equal(f.joins.length, 0);
  f.ready.resolve(); await flush(); assert.deepEqual(removed, ['done']); assert.equal(f.titles.length, 0);
  const fade = timers.find(v => v.milliseconds === 800); assert.ok(fade); fade.fn(); await title; await flush();
  assert.deepEqual(removed, ['done', 'removed']); assert.equal(f.titles.length, 1); assert.equal(f.joins.length, 1);
  f.joining.resolve(); assert.equal(await invite, true);
});

test('actual lobby copy methods keep code copying and produce a current-path invitation with clipboard fallback', async t => {
  const writes = [], toasts = [], fallback = [], removed = [];
  install(t, 'location', { href: 'https://ride.maxyaport.com/game/?solo=1&seed=7#details' });
  install(t, 'navigator', { clipboard: { writeText: async value => { writes.push(value); } } });
  const screen = Object.assign(Object.create(LobbyScreen.prototype), { state: { code: ' abcde ' }, ui: { toast: (...v) => toasts.push(v) }, cb: {} });
  await screen.copy(); await screen.copy(true); assert.deepEqual(writes, ['ABCDE', 'https://ride.maxyaport.com/game/?room=ABCDE']);
  assert.deepEqual(toasts.map(v => v[0]), ['ROOM CODE COPIED', 'INVITE LINK COPIED']);
  navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); };
  install(t, 'document', { body: { appendChild() {} }, execCommand: () => true,
    createElement: () => ({ style: {}, select() { fallback.push(this.value); }, remove() { removed.push(true); } }) });
  await screen.copy(true); assert.deepEqual(fallback, ['https://ride.maxyaport.com/game/?room=ABCDE']); assert.equal(removed.length, 1);
  screen.state.code = '../ABCDE'; await screen.copy(true); assert.equal(fallback.length, 1); assert.equal(toasts.at(-1)[0], 'COULD NOT CREATE INVITE LINK - CODE: ../ABCDE');
});

test('clipboard continuations cannot create, select, toast or invoke callbacks after the lobby is disposed or replaced', async t => {
  for (const state of ['disposed success', 'disposed rejection', 'replaced rejection']) await t.test(state, async st => {
    const clip = deferred(), events = []; let current;
    install(st, 'location', { href: 'https://ride.maxyaport.com/' });
    install(st, 'navigator', { clipboard: { writeText: () => clip.promise } });
    install(st, 'document', { body: { appendChild() { events.push('append'); } }, createElement() { events.push('create'); return { style: {}, select() { events.push('select'); }, remove() { events.push('remove'); } }; }, execCommand() { events.push('command'); return true; } });
    const screen = Object.assign(Object.create(LobbyScreen.prototype), { state: { code: 'ABCDE' },
      ui: { screen: () => current, toast() { events.push('toast'); } }, cb: { onCopy() { events.push('callback'); } } });
    current = screen; const pending = screen.copy(true);
    if (state.startsWith('disposed')) screen.destroy(); else current = { kind: 'title' };
    if (state.endsWith('success')) clip.resolve(); else clip.reject(new Error('Denied'));
    await pending; assert.deepEqual(events, []);
  });
});

test('failed invite clipboard fallback exposes a selectable URL and retains it through normal lobby refresh', async t => {
  const toasts = [], focused = [], removed = [], active = { isConnected: true, selectionStart: 2, selectionEnd: 4,
    focus(options) { focused.push(options); }, setSelectionRange(...values) { focused.push(values); } };
  install(t, 'location', { href: 'https://ride.maxyaport.com/game/?debug=1#help' });
  install(t, 'navigator', { clipboard: { writeText() { throw new Error('Denied'); } } });
  install(t, 'document', { activeElement: active, body: { appendChild() {} }, execCommand: () => false,
    createElement: () => ({ style: {}, select() {}, remove() { removed.push(true); } }) });
  const screen = Object.assign(Object.create(LobbyScreen.prototype), { state: { code: 'ABCDE', status: 'waiting', players: [] }, safe: {},
    ui: { screen: () => screen, toast: (...args) => toasts.push(args) }, cb: {} });
  await screen.copy(true); assert.equal(removed.length, 1);
  assert.deepEqual(focused, [{ preventScroll: true }, [2, 4]]);
  assert.match(screen.safe.innerHTML, /aria-label="Invite link: select and copy"/);
  assert.match(screen.safe.innerHTML, /readonly value="https:\/\/ride\.maxyaport\.com\/game\/\?room=ABCDE"/);
  assert.ok(toasts.at(-1)[0].includes('Select and copy'));
  screen.state = { ...screen.state, status: 'connected' }; screen.render();
  assert.match(screen.safe.innerHTML, /readonly value="https:\/\/ride\.maxyaport\.com\/game\/\?room=ABCDE"/);
  screen.state.code = 'FGHIJ'; screen.render(); assert.equal(screen.safe.innerHTML.includes('Invite link: select and copy'), false);
});

test('failed copy rerender restores navigation to the replacement control instead of a detached old button', async t => {
  const events = [], makeNode = key => ({ dataset: { k: key }, isConnected: true, offsetParent: {},
    classList: { contains: () => false, add() {}, remove() {} }, tagName: 'DIV' });
  const old = makeNode('invite'), replacement = makeNode('invite'), field = makeNode('invite-url'); let html = '';
  install(t, 'location', { href: 'https://ride.maxyaport.com/' });
  install(t, 'navigator', { clipboard: { writeText: async () => { throw new Error('Denied'); } } });
  install(t, 'document', { activeElement: old, body: { appendChild() {} }, execCommand: () => false,
    createElement: () => ({ style: {}, select() {}, remove() {} }) });
  const screen = Object.assign(Object.create(LobbyScreen.prototype), { state: { code: 'ABCDE', status: 'waiting', players: [] }, cb: {} });
  screen.safe = { get innerHTML() { return html; }, set innerHTML(value) { html = value; old.isConnected = false; } };
  screen.el = { querySelector: selector => selector === '[data-k="invite"]' ? replacement : field, querySelectorAll: () => [replacement, field] };
  screen.ui = { screen: () => screen, toast() {}, navScope: () => screen.el };
  screen.ui.nav = Object.assign(Object.create(Nav.prototype), { ui: screen.ui, cur: old, focus(node) { this.cur = node; events.push(node.dataset.k); } });
  await screen.copy(true); assert.equal(old.isConnected, false); assert.equal(screen.ui.nav.cur, replacement);
  assert.deepEqual(events, ['invite']); assert.match(html, /Invite link: select and copy/);
});
