import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
const { Transport } = await import('../src/net/transport.js');
const { Session } = await import('../src/net/session.js');

class Peer extends EventEmitter {
  static instances = [];
  constructor() { super(); Peer.instances.push(this); }
  connect() { return this.connection = new Conn(); }
  destroy() { this.destroyed = true; }
}
class Conn extends EventEmitter {
  constructor({ fast = true, open = false } = {}) {
    super(); this.open = open; this.sent = [];
    this.dc = { readyState: 'connecting', bufferedAmount: 0, sent: [], send: (x) => this.dc.sent.push(x), close: () => { this.dc.readyState = 'closed'; } };
    this.peerConnection = { createDataChannel: () => { if (!fast) throw Error('no fast'); return this.dc; } };
  }
  send(m) { this.sent.push(m); }
  close() { this.open = false; this.closed = true; this.emit('close'); }
}

test('snapshots fall back to reliable delivery during negotiation and decode on the receiver', (t) => {
  const tp = new Transport({ PeerClass: Peer }), c = new Conn({ open: true }); t.after(() => tp.destroy()); tp._adopt(c);
  let got = null; tp.onFast = (ab) => { got = [...new Uint8Array(ab)]; };
  const bytes = new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4);
  assert.equal(tp.sendFast(bytes), true); assert.deepEqual(c.sent.at(-1).__fast, [1, 2, 3]);
  c.emit('data', c.sent.at(-1)); assert.deepEqual(got, [1, 2, 3]);
  c.dc.readyState = 'closed'; assert.equal(tp.sendFast(bytes), true);
  c.dc.readyState = 'open'; assert.equal(tp.sendFast(bytes), true); assert.deepEqual([...c.dc.sent.at(-1)], [1, 2, 3]);
  c.dc.bufferedAmount = 300000; assert.equal(tp.sendFast(bytes), false);
});

test('intentional leave suppresses close callbacks and stale messages', () => {
  const tp = new Transport({ PeerClass: Peer }), c = new Conn({ open: true });
  let lost = 0, messages = 0; tp.onClose = () => lost++; tp.onMessage = () => messages++;
  tp._adopt(c); tp.destroy(); c.emit('data', { t: 'hello' }); c.emit('close');
  assert.equal(lost, 0); assert.equal(messages, 0); assert.equal(tp._pingT, null);
});

test('a remote close notifies once and releases the heartbeat', (t) => {
  const tp = new Transport({ PeerClass: Peer }), c = new Conn({ open: true }); t.after(() => tp.destroy());
  let lost = 0; tp.onClose = () => lost++; tp._adopt(c); c.close(); c.emit('close');
  assert.equal(lost, 1); assert.equal(tp.open, false); assert.equal(tp._pingT, null);
});

test('host reserves its second seat before the connection opens', async (t) => {
  const tp = new Transport({ PeerClass: Peer }); t.after(() => tp.destroy());
  const pending = tp.host('ABCDE'), peer = tp.peer; peer.emit('open'); await pending;
  const a = new Conn(), b = new Conn(); peer.emit('connection', a); peer.emit('connection', b);
  assert.equal(tp.conn, a); assert.equal(b.closed, true);
});

test('leaving during a pending host settles the promise and ignores late opens', async () => {
  const tp = new Transport({ PeerClass: Peer }), pending = tp.host('ABCDE'), peer = tp.peer;
  const rejected = assert.rejects(pending, /cancelled/); tp.destroy(); peer.emit('open'); await rejected; assert.equal(tp.peer, null);
});

test('host and join time out cleanly rather than staying on Connecting forever', async () => {
  const a = new Transport({ PeerClass: Peer, timeout: 10 }), b = new Transport({ PeerClass: Peer, timeout: 10 });
  await assert.rejects(a.host('ABCDE'), /Timed out/); await assert.rejects(b.join('ABCDE'), /Timed out/);
  assert.equal(a.peer, null); assert.equal(b.peer, null); await assert.rejects(b.join('!'), /valid room/);
});

test('failed joins destroy the peer and reserved IDs retry only a bounded number of times', async () => {
  const tp = new Transport({ PeerClass: Peer }), joined = tp.join('ABCDE');
  const rejectJoin = assert.rejects(joined, /No room/); tp.peer.emit('error', { type: 'peer-unavailable' }); await rejectJoin;
  assert.equal(tp.peer, null);
  const hosted = tp.host('ABCDE'), rejectHost = assert.rejects(hosted);
  for (let n = 0; n < 5; n++) tp.peer.emit('error', { type: 'unavailable-id' });
  await rejectHost; assert.equal(tp.peer, null);
});

class Memory {
  constructor() { this.rtt = 0; }
  async host() { return 'ABCDE'; }
  async join() {}
  send(m) { if (this.other) queueMicrotask(() => this.other.onMessage(structuredClone(m))); }
  sendFast() {}
  destroy() {}
}
const flush = () => new Promise((r) => setImmediate(r));
async function pair() {
  const a = new Memory(), b = new Memory(); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b);
  await host.host(DEFAULT_PROFILE()); await guest.join('ABCDE', DEFAULT_PROFILE());
  a.onOpen(); b.onOpen(); await flush(); host.setRole('driver'); guest.setRole('gunner'); await flush();
  return { host, guest };
}

test('a role clash clears the guest seat and both readiness flags on both machines', async () => {
  const { host, guest } = await pair();
  host.setReady(true); guest.setReady(true); await flush(); assert.equal(host.canStart(), true);
  host.setRole('gunner'); await flush();
  assert.equal(host.other.role, null); assert.equal(guest.me.role, null); assert.equal(host.me.ready, false); assert.equal(guest.me.ready, false);
  assert.equal(host.canStart(), false); assert.equal(host.startRun(), null);
  guest.setRole('driver'); await flush(); host.setReady(true); guest.setReady(true); await flush();
  assert.equal(host.canStart(), true);
  let cfg; guest.on({ start: (v) => { cfg = v; } }); const mine = host.startRun({ seed: 17 }); await flush();
  assert.equal(mine.role, 'gunner'); assert.equal(cfg.role, 'driver'); assert.equal(cfg.runId, mine.runId); assert.equal(cfg.seed, 17);
});

test('guest weapon-track purchases spend host cash and mirror into the shared campaign', async () => {
  const store = new Map(); globalThis.localStorage = { getItem: (k) => store.get(k), setItem: (k, v) => store.set(k, v) };
  const { host, guest } = await pair(); host.profile.cash = 10000; host.broadcastProfile(); await flush();
  const cash = host.profile.cash; guest.buy('weaponTrack', 'pistol', 'dmg'); await flush();
  assert.equal(host.profile.weapons.pistol.dmg, 1); assert.ok(host.profile.cash < cash); assert.equal(guest.profile.cash, host.profile.cash);
  let denied = 0; guest.on({ buyDenied: () => denied++ });
  guest.buy('upgrade', 'missing'); guest.buy('track', 'pistol', 'bad'); guest.buy('color', -3); await flush();
  assert.equal(denied, 3); assert.equal(host.profile.cash, guest.profile.cash);
});

test('guest profile mirroring does not replace its personal primary save', async () => {
  const store = new Map([['rideordie.profile.v1', 'personal']]); globalThis.localStorage = { getItem: (k) => store.get(k), setItem: (k, v) => store.set(k, v) };
  const { host, guest } = await pair(); host.broadcastProfile(); await flush();
  assert.equal(store.get('rideordie.profile.v1'), 'personal'); assert.ok(store.has('rideordie.profile.v1.' + guest.profile.campaignId));
  assert.doesNotThrow(() => guest._onMsg(null));
});
