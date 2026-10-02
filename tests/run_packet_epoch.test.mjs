import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_PROFILE } from '../src/data/upgrades.js';
import { encodeSnapshot, decodeSnapshot, SnapshotBuffer } from '../src/net/snapshot.js';
import { NET_PROTOCOL, RUN_JSON_TYPES, createRunHeader, encodeRunPacket, decodeRunPacket } from '../src/net/run_packet.js';
import { GARAGE_SEAT_PROTOCOL } from '../src/net/garage_seats.js';
import { PLAYER_VEHICLE_PROTOCOL } from '../src/data/vehicle_families.js';
import { DRIVING_ROUTE_VERSION } from '../src/world/driving_plan.js';
import { CAMPAIGN_PROTOCOL } from '../src/data/campaign.js';
const { Session } = await import('../src/net/session.js');
const { Run } = await import('../src/game/run.js');

class Memory {
  constructor() { this.sent = []; this.fastSent = []; this.rtt = 0; this.closedConnections = 0; }
  async host() { return 'ABCDE'; }
  async join() {}
  send(m) { this.sent.push(structuredClone(m)); if (this.other) queueMicrotask(() => this.other.onMessage(structuredClone(m))); return true; }
  sendFast(b) { const bytes = new Uint8Array(b.buffer, b.byteOffset, b.byteLength).slice(); this.fastSent.push(bytes); return true; }
  closeConnection() { this.closedConnections++; this.onClose(); }
  destroy() { this.destroyed = true; }
}
const flush = () => new Promise(resolve => setImmediate(resolve));
async function pair(hostRole = 'driver') {
  const a = new Memory(), b = new Memory(); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b);
  await host.host(DEFAULT_PROFILE()); await guest.join('ABCDE', DEFAULT_PROFILE());
  a.onOpen(); b.onOpen(); await flush();
  host.setRole(hostRole); guest.setRole(hostRole === 'driver' ? 'gunner' : 'driver'); await flush();
  return { host, guest };
}
async function start(host, guest) {
  host.activeRunId = guest.activeRunId = null;
  host.swap.enterGarage(); guest.swap.enterGarage(); await flush();
  host.swap.ready(true); guest.swap.ready(true); await flush();
  let remote; guest.on({ start: cfg => { remote = cfg; } });
  const cfg = host.startRun({ seed: 17 }); assert.ok(cfg); await flush();
  return { cfg, remote };
}
const frame = (tick, time, state = 'run') => encodeSnapshot({
  cars: new Map(), time, state, projectiles: { rockets: [], grenades: [] }, boss: null,
}, tick, { dist: time * 40, hp01: 1, dhp01: 1, ghp01: 1 });

test('late old-life snapshots cannot poison a fresh Run clock in either host seat', async () => {
  // Demonstrate the underlying failure this envelope must prevent.
  const bare = new SnapshotBuffer(); bare.push(decodeSnapshot(frame(4800, 40, 'over')), 50);
  assert.equal(bare.push(decodeSnapshot(frame(10, 0, 'countdown')), 50.1), false);
  for (const hostRole of ['driver', 'gunner']) {
    const { host, guest } = await pair(hostRole), authority = hostRole === 'driver' ? host : guest;
    const viewer = hostRole === 'driver' ? guest : host;
    await start(host, guest);
    authority.sendFast(frame(4800, 40, 'over')); const oldPacket = authority.tp.fastSent.at(-1);
    const { cfg, remote } = await start(host, guest);
    const run = new Run({ camera: new THREE.PerspectiveCamera() }, { ...(hostRole === 'driver' ? remote : cfg), net: viewer });
    viewer.on({ fast: b => run.onFast(b), run: m => run.onNet(m) });
    authority.sendFast(frame(10, 0, 'countdown'));
    viewer.tp.onFast(oldPacket);
    assert.equal(run.buf.latest, null, 'old life is rejected before Run.onFast');
    viewer.tp.onFast(authority.tp.fastSent.at(-1));
    assert.equal(run.buf.latest.tick, 10); assert.equal(run.buf.latest.time, 0);
    assert.equal(run.buf.latest.state, 'countdown'); assert.equal(run.over, false);
    assert.equal(host.runSeq, 2); assert.equal(guest.runSeq, 2);
  }
});

test('every gameplay JSON type is current-life scoped before any handler or startup queue', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const { host, guest } = await pair(hostRole); const { cfg: old } = await start(host, guest);
    const queued = [], results = [], over = [];
    guest.on({ run: m => queued.push(m), results: m => results.push(m), runOver: m => over.push(m) });
    const { cfg } = await start(host, guest);
    for (const type of RUN_JSON_TYPES) {
      guest.tp.onMessage({ t: type }); guest.tp.onMessage({ t: type, runId: old.runId });
      assert.equal(queued.length + results.length + over.length, 0, `${type} rejected without current identity`);
    }
    for (const type of RUN_JSON_TYPES) host.sendJSON({ t: type, runId: 'forged-old', e: [], s: { id: cfg.runId } });
    // Only the driver's simulation can send a summary. A host-gunner summary
    // is deliberately refused by the guest-driver authority.
    await flush(); assert.equal(queued.length + results.length + over.length, RUN_JSON_TYPES.size - (hostRole === 'gunner' ? 1 : 0));
    for (const m of [...queued, ...results, ...over]) assert.equal(m.runId, cfg.runId);
    const before = host.tp.sent.length; host.activeRunId = null;
    for (const type of RUN_JSON_TYPES) assert.equal(host.sendJSON({ t: type }), false);
    assert.equal(host.tp.sent.length, before);
    const controls = ['garageReady', 'toGarage', 'profile', 'lobby'];
    for (const type of controls) host.sendJSON({ t: type, epoch: host.runSeq });
    assert.ok(host.tp.sent.slice(-controls.length).every(m => !('runId' in m)));
  }
});

test('late summary, events, readiness and abort do not mutate the fresh life', async () => {
  const { host, guest } = await pair(); const { cfg: old } = await start(host, guest);
  const { remote } = await start(host, guest);
  const run = new Run({ camera: new THREE.PerspectiveCamera() }, { ...remote, net: guest });
  let appAborts = 0; guest.on({ run: m => { if (m.t === 'abort') appAborts++; else run.onNet(m); } });
  for (const m of [{ t: 'summary', s: { id: old.runId } }, { t: 'events', e: [{ type: 'explode', car: 1 }] }, { t: 'runReady' }, { t: 'abort' }]) {
    guest.tp.onMessage({ ...m, runId: old.runId });
  }
  assert.equal(run.partnerReady, false); assert.equal(run.over, false); assert.equal(run.remoteSummary, undefined);
  assert.equal(run.netEvents, undefined); assert.equal(appAborts, 0);
  host.sendJSON({ t: 'runReady' }); await flush(); assert.equal(run.partnerReady, true);
});

test('fast envelopes preserve ArrayBuffer, typed-array and DataView subranges without a receive copy', () => {
  const id = 'life-🚗-é', header = createRunHeader(id), cached = header.slice();
  const padded = new Uint8Array([88, 99, 1, 2, 3, 77]), view = new DataView(padded.buffer, 2, 3);
  for (const payload of [new Uint8Array([1, 2, 3]).buffer, padded.subarray(2, 5), view]) {
    const packet = encodeRunPacket(header, payload), body = decodeRunPacket(header, packet);
    assert.deepEqual([...body], [1, 2, 3]); assert.equal(body.buffer, packet.buffer);
    const wrapped = new Uint8Array(packet.length + 8); wrapped.set(packet, 4);
    assert.deepEqual([...decodeRunPacket(header, new DataView(wrapped.buffer, 4, packet.length))], [1, 2, 3]);
  }
  const packet = encodeRunPacket(header, view); padded.fill(0);
  assert.deepEqual([...decodeRunPacket(header, packet)], [1, 2, 3]);
  assert.deepEqual(header, cached, 'cached header is immutable during encoding');
  assert.deepEqual(decodeRunPacket(createRunHeader('other-life'), packet), null);
  assert.equal(createRunHeader(''), null); assert.equal(createRunHeader('x'.repeat(129)), null);
  assert.equal(createRunHeader('\ud800'), null); assert.equal(createRunHeader('\udc00'), null);
});

test('truncated, unscoped, oversized and malformed fast packets are safely rejected', () => {
  const header = createRunHeader('life'), packet = encodeRunPacket(header, frame(10, 0));
  for (let n = 0; n < packet.length; n++) assert.equal(decodeRunPacket(header, packet.subarray(0, n)), null);
  for (const offset of [0, 4, 6, 10]) {
    const invalid = packet.slice(); invalid[offset] ^= 255; assert.equal(decodeRunPacket(header, invalid), null);
  }
  const trailing = new Uint8Array(packet.length + 1); trailing.set(packet); assert.equal(decodeRunPacket(header, trailing), null);
  for (const invalid of [null, {}, [], 'bytes', new ArrayBuffer(0), frame(1, 0)]) assert.equal(decodeRunPacket(header, invalid), null);
  assert.equal(encodeRunPacket(null, frame(1, 0)), null); assert.equal(decodeRunPacket(null, packet), null);
  assert.equal(encodeRunPacket(header, new Uint8Array(262144)), null);
});

test('garage, leave and physical disconnect revoke the current fast header and gameplay identity', async () => {
  for (const action of ['garage', 'leave', 'disconnect']) {
    const { host, guest } = await pair(); await start(host, guest);
    host.sendFast(frame(1, 0)); const delayed = host.tp.fastSent.at(-1);
    let received = 0; guest.on({ fast: () => received++, run: () => received++, start: () => received++ });
    const id = guest.activeRunId;
    if (action === 'garage') guest.activeRunId = null;
    else if (action === 'leave') guest.leave();
    else guest.tp.onClose();
    guest.tp.onFast(delayed); guest.tp.onMessage({ t: 'go', runId: id }); assert.equal(received, 0);
    assert.equal(guest.sendFast(frame(1, 0)), false); assert.equal(guest.activeRunId, null);
    if (action !== 'garage') {
      const lateStart = structuredClone(host.tp.sent.findLast(m => m.t === 'start'));
      lateStart.cfg.runId = 'future-but-closed-life'; lateStart.cfg.runSeq++;
      guest.tp.onMessage(lateStart); assert.equal(received, 0); assert.equal(guest.activeRunId, null);
    }
  }
});

test('missing or mismatching hello version blocks a run and closes only the data connection', async () => {
  for (const protocol of [undefined, 1, 3, NET_PROTOCOL + 1, '4']) {
    const tp = new Memory(), s = new Session(tp); await s.host(DEFAULT_PROFILE());
    const errors = []; let disconnects = 0;
    s.on({ error: e => errors.push(e), disconnect: () => disconnects++ }); tp.onOpen();
    s._onMsg({ t: 'hello', protocol, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, wallet: { playerId: 'guest', cash: 100, totalCash: 100 } });
    s.me.role = 'driver'; s.me.ready = true;
    assert.equal(s.canStart(), false); assert.equal(s.startRun(), null);
    assert.equal(tp.closedConnections, 1); assert.equal(tp.destroyed, undefined);
    assert.equal(errors.length, 1); assert.equal(errors[0].type, 'protocol-mismatch');
    assert.match(errors[0].message, /reload ride\.maxyaport\.com/); assert.equal(disconnects, 0);
  }
});

test('missing or incompatible vehicle families rejects mixed catalogues before receiving a campaign', async () => {
  for (const familyVehicles of [undefined, 0, PLAYER_VEHICLE_PROTOCOL + 1, '1']) {
    const tp = new Memory(), session = new Session(tp); await session.host(DEFAULT_PROFILE());
    const initial = structuredClone(session.profile), errors = [];
    session.on({ error: error => errors.push(error) }); tp.onOpen();
    session._onMsg({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, familyVehicles,
      wallet: { playerId: 'guest', cash: 100, totalCash: 100 } });
    assert.equal(session.connected, false); assert.equal(session.other, null); assert.equal(session.peerWallet, null);
    assert.equal(session.canStart(), false); assert.equal(session.startRun(), null);
    assert.deepEqual(session.profile, initial); assert.equal(tp.closedConnections, 1);
    assert.equal(errors.length, 1); assert.equal(errors[0].type, 'protocol-mismatch');
    assert.match(errors[0].message, /Both players should reload/);
  }
});

test('missing or incompatible garage consent support rejects mixed builds before lobby readiness', async () => {
  for (const garageSeats of [undefined, 0, GARAGE_SEAT_PROTOCOL + 1, '1']) {
    const tp = new Memory(), s = new Session(tp); await s.host(DEFAULT_PROFILE());
    const errors = []; s.on({ error: e => errors.push(e) }); tp.onOpen();
    s._onMsg({ t: 'hello', protocol: NET_PROTOCOL, garageSeats, familyVehicles: PLAYER_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, wallet: { playerId: 'guest', cash: 100, totalCash: 100 } });
    assert.equal(s.connected, false); assert.equal(s.other, null); assert.equal(s.peerWallet, null);
    assert.equal(s.canStart(), false); assert.equal(tp.closedConnections, 1);
    assert.equal(errors.length, 1); assert.equal(errors[0].type, 'protocol-mismatch');
    assert.match(errors[0].message, /Both players should reload/);
  }
});

test('mixed driving route versions reject before lobby or campaign changes', async () => {
  for (const drivingRoutes of [undefined, 0, DRIVING_ROUTE_VERSION + 1, String(DRIVING_ROUTE_VERSION)]) {
    const tp = new Memory(), s = new Session(tp); await s.host(DEFAULT_PROFILE());
    const profile = structuredClone(s.profile), errors = []; s.on({ error: e => errors.push(e) }); tp.onOpen();
    s._onMsg({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, drivingRoutes, campaignProtocol: CAMPAIGN_PROTOCOL, wallet: { playerId: 'guest', cash: 100, totalCash: 100 } });
    assert.equal(s.connected, false); assert.equal(s.canStart(), false); assert.equal(s.startRun(), null);
    assert.equal(s.peerWallet, null); assert.equal(s.other, null); assert.deepEqual(s.profile, profile);
    assert.equal(tp.closedConnections, 1); assert.equal(errors.length, 1); assert.equal(errors[0].type, 'protocol-mismatch');
  }
});

test('valid hello before local open survives and transport status is forwarded', async () => {
  const tp = new Memory(), s = new Session(tp); await s.host(DEFAULT_PROFILE());
  s._onMsg({ t: 'hello', protocol: NET_PROTOCOL, garageSeats: GARAGE_SEAT_PROTOCOL, familyVehicles: PLAYER_VEHICLE_PROTOCOL, drivingRoutes: DRIVING_ROUTE_VERSION, campaignProtocol: CAMPAIGN_PROTOCOL, wallet: { playerId: 'guest', cash: 100, totalCash: 100 } });
  tp.onOpen(); s.me.role = 'driver'; s.other.role = 'gunner'; s.me.ready = s.other.ready = true;
  assert.equal(s.canStart(), true); assert.equal(s.status, 'connected'); assert.equal(s.signallingState, 'unknown');
  let state; s.on({ state: (...args) => { state = args; } });
  tp.onState('connected', { signalling: 'reconnecting', connected: true, code: 'ABCDE' });
  assert.deepEqual(state, ['connected', { signalling: 'reconnecting', connected: true, code: 'ABCDE' }]);
  tp.status = 'waiting'; tp.signallingState = 'open'; assert.equal(s.status, 'waiting'); assert.equal(s.signallingState, 'open');
});
