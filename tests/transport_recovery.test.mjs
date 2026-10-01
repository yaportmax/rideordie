import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
const { Transport } = await import('../src/net/transport.js');

// Match PeerJS 1.5.5: failed pre-open DataConnections close without a close event,
// and signalling disconnect/reconnect preserves existing data connections.
class Conn extends EventEmitter {
  constructor() {
    super(); this.open = false; this.closed = false; this.sent = [];
    this.dc = { readyState: 'connecting', bufferedAmount: 0, sent: [], send: (b) => this.dc.sent.push(b), close: () => { this.dc.readyState = 'closed'; } };
    this.peerConnection = { createDataChannel: () => this.dc };
  }
  openNow() { this.open = true; this.emit('open'); }
  send(m) { this.sent.push(m); }
  close() { this.closed = true; if (!this.open) return; this.open = false; this.emit('close'); }
  fail() { this.emit('error', Object.assign(new Error('ICE negotiation failed'), { type: 'negotiation-failed' })); this.close(); }
}
class Peer extends EventEmitter {
  static instances = [];
  constructor(id, options) { super(); this.options = options; Peer.instances.push(this); this.id = id || 'guest-id'; this.savedId = this.id; this.open = false; this.disconnected = false; this.destroyed = false; this.connects = []; this.reconnects = []; this.connections = []; }
  openNow() { this.open = true; this.disconnected = false; this.id = this.savedId; this.emit('open', this.id); }
  incoming(conn = new Conn()) { this.connections.push(conn); this.emit('connection', conn); return conn; }
  connect(id) { const conn = new Conn(); this.connects.push(id); this.connections.push(conn); return conn; }
  disconnect() { if (this.disconnected) return; this.open = false; this.disconnected = true; this.id = null; this.emit('disconnected', this.savedId); }
  reconnect() { assert.equal(this.disconnected, true); assert.equal(this.destroyed, false); this.disconnected = false; this.id = this.savedId; this.reconnects.push(this.id); }
  destroy() { if (this.destroyed) return; this.disconnect(); this.connections.forEach((c) => c.close()); this.destroyed = true; this.emit('close'); }
}
function setup(t, options = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const tp = new Transport({ PeerClass: Peer, ...options });
  const errors = [], states = [];
  tp.onError = (e) => errors.push(e); tp.onState = (status, details) => states.push({ status, ...details });
  t.after(() => tp.destroy());
  return { tp, errors, states, tick: (ms) => t.mock.timers.tick(ms) };
}
async function host(tp) { const pending = tp.host('ABCDE'); const peer = tp.peer; peer.openNow(); await pending; return peer; }

test('failed pre-open host negotiation releases the seat and accepts a new guest', async (t) => {
  const { tp, errors, tick } = setup(t); const peer = await host(tp); let opened = 0, lost = 0;
  tp.onOpen = () => opened++; tp.onClose = () => lost++;
  const failed = peer.incoming(); failed.fail();
  assert.equal(failed.closed, true); assert.equal(tp.conn, null); assert.equal(tp.peer, peer); assert.equal(tp.status, 'waiting'); assert.equal(lost, 0);
  const retry = peer.incoming(); retry.openNow(); tick(20000);
  assert.equal(tp.conn, retry); assert.equal(tp.ready, true); assert.equal(opened, 1); assert.equal(lost, 0); assert.equal(retry.closed, false); assert.equal(errors.length, 1);
});

test('a silent pre-open close cannot reserve the host seat beyond its deadline', async (t) => {
  const { tp, errors, tick } = setup(t, { timeout: 100 }); const peer = await host(tp);
  const vanished = peer.incoming(); vanished.close();
  assert.equal(tp.conn, vanished); tick(100);
  assert.equal(tp.conn, null); assert.equal(tp.peer, peer); assert.equal(tp.status, 'waiting'); assert.match(errors[0].message, /second seat/);
  const retry = peer.incoming(); retry.openNow();
  vanished.openNow(); vanished.emit('data', { stale: true });
  assert.equal(tp.conn, retry); assert.equal(tp.status, 'connected');
});

test('closeConnection releases resources and notifies once while retaining the host room', async (t) => {
  const { tp, tick } = setup(t); const peer = await host(tp); const conn = peer.incoming(); conn.openNow(); let lost = 0;
  tp.onClose = () => lost++; tp.closeConnection(); tp.closeConnection(); conn.emit('close'); tick(20000);
  assert.equal(lost, 1); assert.equal(tp.conn, null); assert.equal(tp.fast, null); assert.equal(tp._pingT, null); assert.equal(tp._seatT, null);
  assert.equal(tp.peer, peer); assert.equal(peer.destroyed, false); assert.equal(tp.status, 'waiting'); assert.equal(conn.dc.readyState, 'closed');
});

test('a waiting host reconnects signalling with the same room ID and cancels its deadline on open', async (t) => {
  const { tp, states, tick } = setup(t); const peer = await host(tp);
  peer.disconnect(); assert.equal(tp.status, 'reconnecting'); tick(499); assert.equal(peer.reconnects.length, 0);
  tick(1); assert.deepEqual(peer.reconnects, ['rod-abcde']); peer.openNow(); tick(30000);
  assert.equal(tp.peer, peer); assert.equal(tp.code, 'ABCDE'); assert.equal(tp.status, 'waiting'); assert.equal(tp.signallingState, 'ready'); assert.equal(peer.reconnects.length, 1);
  assert.equal(tp._reconnectT, null); assert.equal(tp._reconnectDeadline, null); assert.ok(states.some((s) => s.status === 'reconnecting'));
});

test('guest signalling recovery preserves a healthy P2P and adopts its outbound connection only once', async (t) => {
  const { tp, states, tick } = setup(t); let opened = 0, lost = 0, messages = 0;
  tp.onOpen = () => opened++; tp.onClose = () => lost++; tp.onMessage = () => messages++;
  const joined = tp.join(' ABCDE '), peer = tp.peer; peer.openNow(); const conn = tp.conn; conn.openNow(); await joined;
  peer.disconnect(); assert.equal(tp.status, 'connected'); assert.equal(tp.signallingState, 'reconnecting'); assert.equal(tp.send({ t: 'playing' }), true);
  conn.emit('data', { t: 'playing' }); tick(500); peer.openNow(); tick(30000);
  assert.equal(tp.conn, conn); assert.deepEqual(peer.connects, ['rod-abcde']); assert.equal(opened, 1); assert.equal(lost, 0); assert.equal(messages, 1); assert.equal(conn.closed, false);
  assert.equal(tp.status, 'connected'); assert.equal(tp.signallingState, 'ready'); assert.ok(states.some((s) => s.status === 'connected' && s.signalling === 'reconnecting'));
});

test('signalling retries are bounded even when every reconnect socket silently stalls', async (t) => {
  const { tp, errors, tick } = setup(t); const peer = await host(tp); peer.disconnect();
  for (const delay of [500, 1500, 3000]) { tick(delay); tick(5000); }
  assert.deepEqual(peer.reconnects, ['rod-abcde', 'rod-abcde', 'rod-abcde']); assert.equal(tp.status, 'lost'); assert.equal(tp.signallingState, 'lost'); assert.equal(peer.disconnected, true);
  assert.equal(tp._reconnectT, null); assert.equal(tp._reconnectDeadline, null); assert.match(errors.at(-1).message, /Could not reconnect/);
  tick(60000); assert.equal(peer.reconnects.length, 3); assert.equal(errors.length, 1);
});

test('exhausted signalling recovery does not tear down a healthy game connection', async (t) => {
  const { tp, tick } = setup(t); const peer = await host(tp); const conn = peer.incoming(); conn.openNow(); let lost = 0; tp.onClose = () => lost++;
  peer.disconnect(); for (const delay of [500, 1500, 3000]) { tick(delay); tick(5000); }
  assert.equal(tp.signallingState, 'lost'); assert.equal(tp.status, 'connected'); assert.equal(tp.conn, conn); assert.equal(conn.closed, false); assert.equal(lost, 0);
  assert.equal(tp.send({ t: 'playing' }), true);
});

test('destroy cancels seat and recovery timers and ignores stale peer and connection callbacks', async (t) => {
  const { tp, errors, states, tick } = setup(t); const peer = await host(tp); const conn = peer.incoming(); let lost = 0; tp.onClose = () => lost++;
  peer.disconnect(); tick(500); tp.destroy(); const stateCount = states.length;
  peer.openNow(); peer.emit('disconnected'); peer.incoming(); conn.openNow(); conn.fail(); conn.emit('close'); tick(60000);
  assert.equal(tp.peer, null); assert.equal(tp.conn, null); assert.equal(tp.status, 'closed'); assert.equal(lost, 0); assert.equal(errors.length, 0); assert.equal(states.length, stateCount);
  assert.equal(tp._seatT, null); assert.equal(tp._reconnectT, null); assert.equal(tp._reconnectDeadline, null); assert.equal(tp._pingT, null); assert.equal(peer.reconnects.length, 1);
});

test('an old recovery cannot alter a replacement room or reconnect its peer', async (t) => {
  const { tp, errors, tick } = setup(t); const old = await host(tp); old.disconnect();
  const pending = tp.host('FGHJK'), replacement = tp.peer; replacement.openNow(); await pending;
  old.openNow(); old.emit('disconnected'); old.emit('error', new Error('old socket')); tick(60000);
  assert.equal(tp.peer, replacement); assert.equal(tp.code, 'FGHJK'); assert.equal(tp.status, 'waiting'); assert.equal(replacement.destroyed, false); assert.equal(old.reconnects.length, 0); assert.equal(errors.length, 0);
});

test('pre-open guest negotiation failure settles joining and tears down its pending peer', async (t) => {
  const { tp, tick } = setup(t); const pending = tp.join('ABCDE'), rejected = assert.rejects(pending, /ICE negotiation failed/), peer = tp.peer;
  peer.openNow(); const conn = tp.conn; conn.fail(); await rejected; tick(60000);
  assert.equal(tp.peer, null); assert.equal(tp.conn, null); assert.equal(peer.destroyed, true); assert.equal(tp._seatT, null); assert.equal(tp._cancelPending, null);
});

test('a peer that closes before registering a room rejects immediately and cancels the creation deadline', async (t) => {
  const { tp, errors, tick } = setup(t); const pending = tp.host('ABCDE'), rejected = assert.rejects(pending, /service connection closed/); tp.peer.destroy(); await rejected;
  tick(60000); assert.equal(tp.peer, null); assert.equal(tp.status, 'lost'); assert.equal(tp._cancelPending, null); assert.equal(errors.length, 1);
});

const iceConfig = { iceServers: [{ urls: 'turn:relay.example:3478', username: 'fixture', credential: 'fixture' }], iceTransportPolicy: 'relay' };
const flushIce = () => new Promise((resolve) => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

test('hosting stays connecting while asynchronous ICE configuration loads, then passes it to PeerJS', async (t) => {
  const load = deferred(); let calls = 0;
  const { tp, states } = setup(t, { iceProvider: () => { calls++; return load.promise; } });
  const pending = tp.host('ABCDE'); assert.equal(tp.peer, null); assert.equal(tp.status, 'connecting'); await flushIce();
  assert.equal(calls, 1); load.resolve(iceConfig); await flushIce(); const peer = tp.peer;
  assert.equal(peer.options.config, iceConfig); assert.equal(tp.status, 'connecting'); peer.openNow(); assert.equal(await pending, 'ABCDE');
  assert.equal(tp.status, 'waiting'); assert.ok(states.some((s) => s.status === 'connecting'));
});

test('joining waits for ICE and still creates exactly one outbound connection after signalling recovery', async (t) => {
  const load = deferred(); const { tp, tick } = setup(t, { iceProvider: () => load.promise });
  const pending = tp.join('ABCDE'); assert.equal(tp.peer, null); await flushIce(); load.resolve(iceConfig); await flushIce();
  const peer = tp.peer; assert.equal(peer.options.config, iceConfig); peer.openNow(); const conn = tp.conn; conn.openNow(); await pending;
  peer.disconnect(); tick(500); peer.openNow();
  assert.equal(tp.conn, conn); assert.deepEqual(peer.connects, ['rod-abcde']); assert.equal(tp.status, 'connected');
});

for (const method of ['host', 'join']) {
  test(`destroy cancels ${method} immediately while ICE is pending and ignores its late result`, async (t) => {
    const load = deferred(); let calls = 0;
    const { tp, errors, states, tick } = setup(t, { iceProvider: () => { calls++; return load.promise; } });
    const count = Peer.instances.length, pending = tp[method]('ABCDE'), rejected = assert.rejects(pending, /cancelled/);
    await flushIce(); assert.equal(calls, 1); tp.destroy(); await rejected; const stateCount = states.length;
    load.resolve(iceConfig); await flushIce(); tick(60000);
    assert.equal(Peer.instances.length, count); assert.equal(tp.peer, null); assert.equal(tp.status, 'closed'); assert.equal(tp._cancelPending, null);
    assert.equal(errors.length, 0); assert.equal(states.length, stateCount);
  });
}

test('leaving before asynchronous preparation starts does not request relay credentials', async (t) => {
  let calls = 0; const { tp } = setup(t, { iceProvider: async () => { calls++; return iceConfig; } });
  const count = Peer.instances.length;
  for (const method of ['host', 'join']) {
    const pending = tp[method]('ABCDE'), rejected = assert.rejects(pending, /cancelled/);
    tp.destroy(); await rejected; await flushIce();
  }
  assert.equal(calls, 0); assert.equal(Peer.instances.length, count); assert.equal(tp.peer, null); assert.equal(tp.status, 'closed');
});

for (const outcome of ['resolve', 'reject']) {
  test(`a cancelled ICE ${outcome} cannot create a peer or change a newer host/join operation`, async (t) => {
    const oldLoad = deferred(), currentLoad = deferred(); let calls = 0;
    const { tp, errors } = setup(t, { iceProvider: () => (++calls === 1 ? oldLoad.promise : currentLoad.promise) });
    const count = Peer.instances.length;
    const oldMethod = outcome === 'resolve' ? 'host' : 'join', currentMethod = outcome === 'resolve' ? 'join' : 'host';
    const cancelled = tp[oldMethod]('ABCDE'), rejected = assert.rejects(cancelled, /cancelled/); await flushIce();
    const current = tp[currentMethod]('FGHJK'); await rejected; await flushIce();
    currentLoad.resolve(iceConfig); await flushIce(); const peer = tp.peer; peer.openNow();
    if (currentMethod === 'join') tp.conn.openNow(); await current;
    if (outcome === 'resolve') oldLoad.resolve({ iceServers: [] }); else oldLoad.reject(new Error('stale relay error'));
    await flushIce();
    assert.equal(Peer.instances.length, count + 1); assert.equal(tp.peer, peer); assert.equal(peer.destroyed, false); assert.equal(tp.code, 'FGHJK');
    assert.equal(tp.status, currentMethod === 'join' ? 'connected' : 'waiting'); assert.equal(errors.length, 0); assert.equal(calls, 2);
  });
}

for (const method of ['host', 'join']) {
  test(`the ${method} deadline also bounds a stalled ICE provider and ignores its eventual result`, async (t) => {
    const load = deferred(); const { tp, errors, tick } = setup(t, { timeout: 100, iceProvider: () => load.promise });
    const count = Peer.instances.length, pending = tp[method]('ABCDE'), rejected = assert.rejects(pending, /Timed out/);
    await flushIce(); tick(100); await rejected; load.resolve(iceConfig); await flushIce(); tick(60000);
    assert.equal(tp.peer, null); assert.equal(tp._cancelPending, null); assert.equal(Peer.instances.length, count); assert.equal(errors.length, 1);
  });
}

for (const outcome of ['resolve', 'reject']) {
  test(`stale ICE ${outcome} leaves a replacement still awaiting its own credentials untouched`, async (t) => {
    const oldLoad = deferred(), nextLoad = deferred(); let calls = 0;
    const { tp, errors, states } = setup(t, { iceProvider: () => (++calls === 1 ? oldLoad.promise : nextLoad.promise) });
    const count = Peer.instances.length, old = tp.host('ABCDE'), cancelled = assert.rejects(old, /cancelled/); await flushIce();
    const next = tp.join('FGHJK'); await cancelled; await flushIce(); const stateCount = states.length;
    if (outcome === 'resolve') oldLoad.resolve(iceConfig); else oldLoad.reject(new Error('old fetch failed'));
    await flushIce(); assert.equal(tp.peer, null); assert.equal(tp.code, 'FGHJK'); assert.equal(tp.status, 'connecting');
    assert.equal(Peer.instances.length, count); assert.equal(errors.length, 0); assert.equal(states.length, stateCount);
    nextLoad.resolve(iceConfig); await flushIce(); tp.peer.openNow(); tp.conn.openNow(); await next;
    assert.equal(tp.status, 'connected'); assert.equal(Peer.instances.length, count + 1);
  });
}

test('an unavailable ICE provider fails clearly without constructing a peer with broken defaults', async (t) => {
  const { tp, errors } = setup(t, { iceProvider: async () => { throw new Error('Multiplayer relay is unavailable. Please try again.'); } });
  const count = Peer.instances.length; await assert.rejects(tp.join('ABCDE'), /relay is unavailable/);
  assert.equal(Peer.instances.length, count); assert.equal(tp.peer, null); assert.equal(tp._cancelPending, null); assert.equal(errors.length, 1);
});

test('a missing ICE result rejects rather than falling back to PeerJS defaults', async (t) => {
  const { tp, errors } = setup(t, { iceProvider: async () => undefined }); const count = Peer.instances.length;
  await assert.rejects(tp.host('ABCDE'), /Could not load multiplayer connection settings/);
  assert.equal(Peer.instances.length, count); assert.equal(tp.peer, null); assert.equal(tp._cancelPending, null); assert.equal(errors.length, 1);
});

test('explicit ICE configuration bypasses the provider and preserves synchronous fixture setup', async (t) => {
  let calls = 0;
  const { tp } = setup(t, { peerOptions: { config: iceConfig }, iceProvider: () => { calls++; throw new Error('must not fetch'); } });
  const hosted = tp.host('ABCDE'); let peer = tp.peer; assert.ok(peer); assert.equal(peer.options.config, iceConfig); peer.openNow(); await hosted;
  const joined = tp.join('FGHJK'); peer = tp.peer; assert.ok(peer); assert.equal(peer.options.config, iceConfig); peer.openNow(); tp.conn.openNow(); await joined;
  assert.equal(calls, 0);
});

test('room ID collision retries reuse the fetched ICE configuration without calling the provider again', async (t) => {
  let calls = 0; const { tp } = setup(t, { iceProvider: async () => { calls++; return iceConfig; } });
  const pending = tp.host('ABCDE'); await flushIce();
  for (let n = 0; n < 4; n++) {
    const old = tp.peer; old.emit('error', { type: 'unavailable-id' });
    assert.notEqual(tp.peer, old); assert.equal(old.destroyed, true); assert.equal(tp.peer.options.config, iceConfig);
  }
  tp.peer.openNow(); await pending; assert.equal(calls, 1); assert.equal(tp.status, 'waiting');
});
