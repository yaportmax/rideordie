import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';

const css = registerHooks({ load(url, context, nextLoad) {
  if (/\.css(?:\?.*)?$/.test(url)) return { format: 'module', source: 'export default "";', shortCircuit: true };
  return nextLoad(url, context);
} });
let App;
try { ({ App } = await import('../src/app.js')); } finally { css.deregister(); }

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function fixture(t, mode = 'coop') {
  const oldWindow = globalThis.window, oldRaf = globalThis.requestAnimationFrame;
  globalThis.window = {}; globalThis.requestAnimationFrame = () => 1;
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; if (oldRaf === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = oldRaf; });
  const sent = [], starts = [], toasts = [], fades = [], modals = [];
  const session = mode === 'coop' ? {
    isHost: true, connected: true, runSeq: 3, activeRunId: null,
    me: { role: 'driver', ready: false, name: 'Host' }, other: { role: 'gunner', ready: false, name: 'Friend' },
    sendJSON(m) { sent.push(m); }, leave() { this.connected = false; },
    startRun(cfg) { assert.equal(this.me.ready, true); assert.equal(this.other.ready, true); starts.push(cfg); this.runSeq++; return { ...cfg, role: this.me.role }; },
  } : null;
  const ui = {
    settings: {}, current: null,
    modal(options) {
      this.current?.promise.close();
      const m = { ...deferred(), options }; m.promise.close = () => { if (ui.current === m) ui.current = null; m.resolve(null); };
      modals.push(m); this.current = m; return m.promise;
    },
    connectionLost(text) { return this.modal({ title: 'CONNECTION LOST', text }); },
    hideAll() { this.current?.promise.close(); },
    toast(text, kind) { toasts.push({ text, kind }); },
    showGarage() {}, updateGarage() {}, showTitle() {}, updateLobby() {},
  };
  const game = {
    run: null, paused: false, fade(v, time) { fades.push([v, time]); },
    endRun() { this.run = null; this.paused = false; this.onRunEnd = this.onPause = null; },
    showGarage() {}, garage: { setStage() {}, setPreview() {}, setTab() {}, setTruck() {}, fadeIn() {}, release() {} },
    audio: { music: { setState() {} } },
  };
  const profile = DEFAULT_PROFILE(); profile.best.furthestS = 60000;
  const app = Object.assign(Object.create(App.prototype), {
    profile, personalProfile: profile, mode, screen: 'garage', session, ui, game,
    input: { lastDevice: 'kbm', reset() {}, requestLock() {}, releaseLock() {} },
    readyMine: true, readyOther: true, _flowId: 1, _garageGeneration: 1, _garageEpoch: session?.runSeq || 0,
    _startSelection: null, _startup: null, _lostTransition: null, _peerGarageReady: null,
    _roomPending: null, _pendingRunMsgs: [], _pendingFast: null, _booted: true,
    sound() {}, _watchEnd() {},
  });
  const started = []; app._startRun = (cfg) => { started.push(cfg); };
  return { app, session, ui, game, profile, sent, starts, started, toasts, fades, modals };
}

test('one checkpoint choice starts one run, and BACK returns both crews to an actionable garage state', async (t) => {
  const f = fixture(t), a = f.app._maybeStart();
  await f.app._maybeStart(); assert.equal(f.modals.length, 1);
  f.modals[0].resolve(null); await a;
  assert.equal(f.started.length, 0); assert.equal(f.app.readyMine, false);
  assert.deepEqual(f.sent.at(-1), { t: 'garageReady', epoch: 3, ready: false });
  await f.app._garageCb().onReady();
  assert.equal(f.modals.length, 2);
  f.modals[1].resolve('dam'); await settle();
  assert.equal(f.started.length, 1); assert.equal(f.started[0].startS, 52500); assert.equal(f.session.runSeq, 4);
});

test('checkpoint eligibility is rechecked after delayed choice across screen, session, readiness, roles, and epoch changes', async (t) => {
  const cases = {
    title: (f) => f.app.title(),
    'new session': (f) => { f.app.session = { ...f.session }; },
    'partner disconnect': (f) => { f.session.connected = false; },
    'host unready': (f) => { f.app.readyMine = false; },
    'guest unready': (f) => { f.app.readyOther = false; },
    'host seat changed': (f) => { f.session.me.role = 'gunner'; },
    'guest seat changed': (f) => { f.session.other.role = 'driver'; },
    'next run epoch': (f) => { f.session.runSeq++; },
    'new garage visit': (f) => { f.app.garage(); },
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async (st) => {
    const f = fixture(st), pending = f.app._maybeStart();
    change(f); f.modals[0].resolve('dam'); await pending;
    assert.equal(f.started.length, 0); assert.equal(f.starts.length, 0);
  });
});

test('unready then ready cannot resurrect an old checkpoint choice or erase the new one', async (t) => {
  const f = fixture(t), first = f.app._maybeStart();
  await f.app._garageCb().onReady(); // unready cancels the first choice
  await f.app._garageCb().onReady(); // ready creates a new choice
  const newSelection = f.app._startSelection;
  f.modals[0].resolve('dam'); await first;
  assert.equal(f.app._startSelection, newSelection); assert.equal(f.started.length, 0);
  f.modals[1].resolve('start'); await settle();
  assert.equal(f.started.length, 1); assert.equal(f.started[0].startS, 40);
});

test('a profile change invalidates readiness rather than launching with an unreviewed loadout', async (t) => {
  const f = fixture(t), pending = f.app._maybeStart();
  f.profile.revision++; f.modals[0].resolve('dam'); await pending;
  assert.equal(f.starts.length, 0); assert.equal(f.app.readyMine, false);
  assert.deepEqual(f.sent.at(-1), { t: 'garageReady', epoch: 3, ready: false });
  assert.match(f.toasts.at(-1).text, /Ready up again/);
});

test('solo checkpoint choice is singleflight and cannot start after entering co-op', async (t) => {
  const f = fixture(t, 'solo'), ready = f.app._garageCb().onReady();
  await f.app._garageCb().onReady(); assert.equal(f.modals.length, 1);
  f.app._newSession(); f.app.mode = 'coop'; f.app.screen = 'lobby';
  f.modals[0].resolve('dam'); await ready;
  assert.equal(f.started.length, 0);
});

test('guest READY received while host is on results is restored on entering the matching garage epoch', async (t) => {
  const f = fixture(t); f.app.screen = 'results'; f.app.readyMine = f.app.readyOther = false;
  f.app._onRunMsg({ t: 'garageReady', epoch: 3, ready: true });
  assert.equal(f.app.readyOther, false);
  f.app.garage(); assert.equal(f.app.readyOther, true); assert.equal(f.app.readyMine, false);
  await f.app._garageCb().onReady();
  f.modals[0].resolve('start'); await settle(); assert.equal(f.started.length, 1);
});

test('host-first return accepts current READY while old or malformed readiness cannot overwrite it', async (t) => {
  const f = fixture(t); f.app.garage(); f.app.readyMine = true;
  for (const epoch of [2, undefined, '3', 4, -1]) f.app._onRunMsg({ t: 'garageReady', epoch, ready: true });
  assert.equal(f.app.readyOther, false); assert.equal(f.modals.length, 0);
  f.app._onRunMsg({ t: 'garageReady', epoch: 3, ready: true });
  assert.equal(f.modals.length, 1);
  f.modals[0].resolve('start'); await settle(); assert.equal(f.started.length, 1);
});

test('early UNREADY overwrites cached READY before host leaves results', async (t) => {
  const f = fixture(t); f.app.screen = 'results';
  f.app._onRunMsg({ t: 'garageReady', epoch: 3, ready: true });
  f.app._onRunMsg({ t: 'garageReady', epoch: 3, ready: false });
  f.app.garage(); assert.equal(f.app.readyOther, false); assert.equal(f.modals.length, 0);
});

test('slow loading coalesces controls without losing one-shot readiness, GO, or summary', (t) => {
  const f = fixture(t); f.app.screen = 'run';
  f.app._onRunMsg({ t: 'runReady' }); f.app._onRunMsg({ t: 'go' }); f.app._onRunMsg({ t: 'summary', s: { id: 'result' } });
  for (let i = 0; i < 900; i++) {
    f.app._onRunMsg({ t: 'g', y: i }); f.app._onRunMsg({ t: 'input', i: { gas: i } });
    f.app._onRunMsg({ t: 'feed', text: String(i) });
  }
  const q = f.app._pendingRunMsgs;
  assert.equal(q.length, 256); assert.equal(q.filter((m) => m.t === 'g').length, 1);
  assert.equal(q.find((m) => m.t === 'g').y, 899); assert.equal(q.find((m) => m.t === 'input').i.gas, 899);
  for (const type of ['runReady', 'go', 'summary']) assert.equal(q.filter((m) => m.t === type).length, 1);
});

function startup(f) {
  f.app._startRun = App.prototype._startRun;
  const pending = deferred(); f.game.startRun = () => pending.promise;
  const promise = f.app._startRun({ role: 'driver', profile: f.profile });
  return { pending, promise, loading: f.modals.at(-1) };
}

test('canceling current startup restores visible garage; late failure cannot abandon a later session', async (t) => {
  const f = fixture(t), s = startup(f);
  assert.equal(s.loading.options.title, 'GETTING READY'); s.loading.resolve('cancel'); await settle();
  assert.equal(f.app.screen, 'garage'); assert.deepEqual(f.fades.at(-1), [0, 0]);
  assert.deepEqual(f.sent, [{ t: 'abort' }]);
  const old = f.session; f.app._newSession(); const fresh = f.app.session;
  f.app.screen = 'lobby'; s.pending.reject(new Error('old initializer failed')); await s.promise;
  assert.equal(f.app.session, fresh); assert.equal(f.app.screen, 'lobby'); assert.equal(f.toasts.length, 0);
  assert.equal(f.sent.length, 1); assert.equal(old.connected, false);
});

test('a replaced startup result cannot install callbacks, send readiness, or drain messages into a new run', async (t) => {
  const f = fixture(t), s = startup(f);
  f.app.garage(); const freshRun = { id: 'fresh' }; f.game.run = freshRun;
  f.app._pendingRunMsgs = [{ t: 'runReady' }];
  const oldRun = { onNet() { assert.fail('old run must not receive queue'); }, onFast() { assert.fail('old run must not receive packet'); } };
  s.pending.resolve(oldRun); await s.promise;
  assert.equal(f.game.run, freshRun); assert.equal(f.game.onRunEnd, null);
  assert.equal(f.sent.length, 0); assert.equal(globalThis.window.__run, undefined);
  assert.equal(f.app._pendingRunMsgs.length, 1);
});

test('current startup success drains delayed readiness and latest controls once before releasing capture', async (t) => {
  const f = fixture(t), s = startup(f), received = [];
  let lockRequests = 0; f.app.input.requestLock = () => { lockRequests++; };
  f.app._onRunMsg({ t: 'runReady' });
  for (let i = 0; i < 300; i++) f.app._onRunMsg({ t: 'g', y: i });
  const run = { onNet(m) { received.push(m); }, onFast() {} }; f.game.run = run;
  s.pending.resolve(run); await s.promise;
  assert.deepEqual(received.map((m) => m.t), ['runReady', 'g']); assert.equal(received[1].y, 299);
  assert.deepEqual(f.sent, [{ t: 'runReady' }]); assert.equal(lockRequests, 1);
  assert.equal(f.ui.current, null); assert.equal(f.app._pendingRunMsgs.length, 0); assert.equal(window.__run, run);
});

test('disconnect during startup keeps its recovery dialog after late initializer failure; stale acknowledgment cannot close a fresh room', async (t) => {
  const f = fixture(t), s = startup(f);
  f.app._lost(f.session); const lost = f.modals.at(-1);
  assert.equal(lost.options.title, 'CONNECTION LOST'); assert.deepEqual(f.fades.at(-1), [0, 0]);
  s.pending.reject(new Error('late failure')); await s.promise;
  assert.equal(f.ui.current, lost); assert.equal(f.toasts.length, 0); assert.equal(f.sent.length, 0);
  lost.resolve(0); f.app._newSession(); const fresh = f.app.session; f.app.screen = 'lobby';
  await settle(); assert.equal(f.app.session, fresh); assert.equal(f.app.screen, 'lobby');
});

test('obsolete session callbacks cannot mutate the replacement room, and current state preserves retry feedback and typed code', (t) => {
  const f = fixture(t); const old = f.app._newSession(); const current = f.app._newSession();
  let refreshes = 0; f.app._lobbyRefresh = () => { refreshes++; };
  const originalProfile = f.app.profile;
  old.h.profile(DEFAULT_PROFILE()); old.h.error({ message: 'stale' }); old.h.state('lost'); old.h.disconnect(); old.h.start({});
  assert.equal(f.app.profile, originalProfile); assert.equal(f.toasts.length, 0); assert.equal(refreshes, 0); assert.equal(f.started.length, 0);
  f.app.screen = 'lobby'; current.tp._signallingState = 'reconnecting';
  f.app._roomPending = { session: current, code: 'ABC123' }; current.h.state('reconnecting');
  assert.equal(refreshes, 1); assert.equal(f.app._lobbyState().status, 'reconnecting'); assert.equal(f.app._lobbyState().code, 'ABC123');
  current.h.error({ type: 'protocol-mismatch', message: 'Both players should reload ride.maxyaport.com.' });
  assert.match(f.toasts.at(-1).text, /Both players should reload/); assert.equal(f.app.session, current);
});

test('actual Session can start the next life after cached guest readiness reaches the host garage', async (t) => {
  const f = fixture(t), session = f.app._newSession();
  session.isHost = true; session.connected = true; session._runSeq = 4; session._peerProtocol = NET_PROTOCOL;
  session.me.role = 'gunner'; session.other = { role: 'driver', name: 'Friend', ready: false };
  session.profile = f.profile; session.peerWallet = { playerId: 'friend', cash: 1000 };
  session.tp.send = (m) => f.sent.push(m);
  f.app.screen = 'results'; f.app._onRunMsg({ t: 'garageReady', epoch: 4, ready: true });
  f.app.garage(); await f.app._garageCb().onReady(); f.modals[0].resolve('dam'); await settle();
  assert.equal(f.started.length, 1); assert.equal(f.started[0].runSeq, 5); assert.equal(f.started[0].role, 'gunner');
  assert.equal(f.sent.filter((m) => m.t === 'start').length, 1);
});

test('leave and victory modal choices resolved just before a transition cannot navigate the fresh session', async (t) => {
  const f = fixture(t), leave = f.app._garageCb().onMenu();
  f.modals[0].resolve('leave'); f.app._newSession(); const fresh = f.app.session; f.app.screen = 'lobby';
  await leave; assert.equal(f.app.session, fresh); assert.equal(f.app.screen, 'lobby');
  f.app.screen = 'results'; f.game.run = { id: 'won' };
  const victory = f.app._victoryModal(); f.modals.at(-1).resolve('garage');
  f.app._newSession(); f.app.screen = 'lobby'; await victory;
  assert.equal(f.app.screen, 'lobby'); assert.equal(f.app.session.isHost, false);
});

test('loading cancel records intent before a queued successful initializer continuation', async (t) => {
  const f = fixture(t), s = startup(f);
  const run = { onNet() {}, onFast() {} }; f.game.run = run;
  s.pending.resolve(run);
  // A native click closes Ui's modal and invokes onClick in the same task.
  s.loading.resolve('cancel'); s.loading.options.buttons[0].onClick();
  await s.promise;
  assert.equal(f.app.screen, 'garage'); assert.equal(f.game.run, null);
  assert.deepEqual(f.sent, [{ t: 'abort' }]); assert.equal(window.__run, undefined);
});

test('co-op Results closes old pause confirmation and stale pause callbacks cannot abort or resume it', (t) => {
  const f = fixture(t), run = { summary: { id: 'paid', distance: 100, time: 4, kills: 1, won: false } };
  f.app.screen = 'run'; f.game.run = run;
  let pauseCallbacks, resultsShown = 0;
  f.ui.showPause = (cb) => { pauseCallbacks = cb; };
  f.ui.showResults = () => { resultsShown++; };
  f.session.creditResult = () => {};
  f.app._pause(); const quitDialog = f.ui.modal({ title: 'QUIT?' });
  f.app._results(run);
  assert.equal(f.app.screen, 'results'); assert.equal(f.ui.current, null); assert.equal(resultsShown, 1);
  pauseCallbacks.onQuit(); pauseCallbacks.onResume();
  assert.equal(f.app.screen, 'results'); assert.equal(f.game.run, run); assert.equal(f.sent.length, 0);
  return quitDialog.then((value) => assert.equal(value, null));
});
