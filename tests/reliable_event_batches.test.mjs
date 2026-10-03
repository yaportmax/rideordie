// Authored WORK only. Root must materialize/review the source proposal before
// running this actual-source suite. This is CPU/memory transport, not WebRTC.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { planEventPackets, MAX_EVENT_PACKET_BYTES, MAX_EVENT_PACKET_COUNT } from '../src/net/event_batches.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';
import { Sim } from '../src/sim/sim.js';
// The global test shim intercepts exactly'peerjs', including require.resolve.
// Use the package subpath so focused/full nonisolated tests and frozen source
// resolve the actual installed ancestor dependency even with an existing hook.
const installedPeerPackage = createRequire(import.meta.url).resolve('peerjs/package.json');
const installedPeerDist = join(dirname(installedPeerPackage), 'dist');
await import('./helpers/peer-import.mjs');
const { Session } = await import('../src/net/session.js');
const { Run } = await import('../src/game/run.js');
const encoder = new TextEncoder();
const bytesOf = value => encoder.encode(JSON.stringify(value)).byteLength;
const message = (events, runId = 'packet-life-🚗-é') => ({ t: 'events', e: events, runId });
const flatten = plan => plan.packets.flatMap(packet => packet.e);

function assertBudget(plan) {
  assert.equal(plan.ok, true);
  for (let i = 0; i < plan.packets.length; i++) {
    assert.equal(plan.byteLengths[i], bytesOf(plan.packets[i]), 'estimated bytes equal actual JSON UTF-8 including envelope');
    assert.ok(plan.byteLengths[i] <= MAX_EVENT_PACKET_BYTES);
    assert.ok(plan.byteLengths[i] < 16300, 'actual PeerJS JSON MTU rejects equality');
    assert.ok(plan.packets[i].e.length <= MAX_EVENT_PACKET_COUNT);
  }
}

test('WORK byte ceiling remains below installed PeerJS1.5.5 JSON rejection threshold', () => {
  const installed = JSON.parse(readFileSync(installedPeerPackage, 'utf8'));
  const source = readFileSync(join(installedPeerDist, 'bundler.mjs'), 'utf8');
  assert.equal(installed.version, '1.5.5');
  assert.match(source, /this\.chunkedMTU\s*=\s*16300/);
  assert.match(source, /encodedData\.byteLength\s*>=/);
  assert.ok(MAX_EVENT_PACKET_BYTES < 16300);
});

test('ordered multibyte events partition by UTF-8 bytes, preserve every field and own snapshots', () => {
  const events = Array.from({ length: 150 }, (_, i) => ({ t: 'kill', id: i + 2, text: '塔🚗é'.repeat(19), time: .1 * i }));
  const original = structuredClone(events), plan = planEventPackets(message(events));
  assertBudget(plan); assert.ok(plan.packets.length > 1); assert.deepEqual(flatten(plan), original);
  events[0].text = 'caller changed'; events.push({ t: 'remove', id: 999 });
  assert.deepEqual(flatten(plan), original);
  assert.ok(plan.packets.every(packet => packet.runId === 'packet-life-🚗-é'));
});

test('256-event receiver count boundary splits even when total bytes are tiny', () => {
  for (const count of [0, 1, 255, 256, 257, 513]) {
    const events = Array.from({ length: count }, (_, id) => ({ t: 'x', id })), plan = planEventPackets(message(events, 'life'));
    assertBudget(plan); assert.deepEqual(flatten(plan), events);
    assert.deepEqual(plan.packets.map(packet => packet.e.length), count === 0 ? [0] : Array.from({ length: Math.ceil(count / 256) }, (_, i) => Math.min(256, count - i * 256)));
  }
});

test('exact envelope budget accepts equality and rejects an individually larger event before any packet', () => {
  const event = { t: 'x', text: '' }, empty = bytesOf(message([event], 'life'));
  event.text = 'a'.repeat(MAX_EVENT_PACKET_BYTES - empty);
  const boundary = planEventPackets(message([event], 'life')); assertBudget(boundary);
  assert.equal(boundary.byteLengths[0], MAX_EVENT_PACKET_BYTES);
  event.text += 'a';
  const rejected = planEventPackets(message([{ t: 'small' }, event], 'life'));
  assert.deepEqual(rejected, { ok: false, reason: 'oversized-event', index: 1, packets: [], byteLengths: [] });
});

test('malformed, cyclic, BigInt and oversized-envelope cases are explicit preflight rejection', () => {
  for (const value of [null, [], {}, { t: 'events', e: [], runId: '' }, { t: 'events', e: 'x', runId: 'life' }]) {
    assert.equal(planEventPackets(value).reason, 'malformed-envelope');
  }
  for (const event of [null, 1, [], {}, { t: '' }]) {
    const rejected = planEventPackets(message([{ t: 'valid' }, event]));
    assert.equal(rejected.reason, 'malformed-event'); assert.equal(rejected.index, 1); assert.deepEqual(rejected.packets, []);
  }
  const cyclic = { t: 'x' }; cyclic.self = cyclic;
  for (const event of [cyclic, { t: 'x', value: 1n }, { t: 'x', toJSON() { throw Error('getter failure'); } }]) {
    assert.equal(planEventPackets(message([event])).reason, 'nonserializable-envelope');
  }
  assert.equal(planEventPackets({ ...message([]), metadata: 'a'.repeat(MAX_EVENT_PACKET_BYTES) }).reason, 'oversized-envelope');
});

class BoundedMemory {
  constructor() { this.sent = []; this.attempts = 0; this.rtt = 0; this.failAt = -1; }
  send(packet) {
    const index = this.attempts++;
    assert.ok(bytesOf(packet) < 16300, 'actual consumer never reaches mocked PeerJS oversize discard');
    if (index === this.failAt) return false;
    const value = JSON.parse(JSON.stringify(packet)); this.sent.push(value);
    this.other?.onMessage(JSON.parse(JSON.stringify(value))); return true;
  }
  sendFast() { return true; }
  destroy() {}
}
function linked(hostRole) {
  const a = new BoundedMemory(), b = new BoundedMemory(); a.other = b; b.other = a;
  const host = new Session(a), guest = new Session(b);
  const roles = { host: hostRole, guest: hostRole === 'driver' ? 'gunner' : 'driver' };
  for (const [session, isHost] of [[host, true], [guest, false]]) {
    session.isHost = isHost; session._peerProtocol = NET_PROTOCOL; session.activeRunId = 'consumer-life';
    session._activeRunRoles = { ...roles };
  }
  return { authority: hostRole === 'driver' ? host : guest, viewer: hostRole === 'driver' ? guest : host };
}
function viewerRun(session) {
  const seen = { states: [], receipts: [], messages: [] };
  const game = { camera: new THREE.PerspectiveCamera(), input: { lastDevice: 'kbm', bindings: { nuke: ['KeyN'] } },
    hud: { setCombat: value => seen.states.push(value), gh: { damageReceipt: value => seen.receipts.push(value) }, message: value => seen.messages.push(value) } };
  const run = new Run(game, { role: 'gunner', runId: 'consumer-life', seed: 7, net: session });
  run.started = true; run.simState = 'run'; session.on({ run: packet => run.onNet(packet) });
  return { run, seen };
}

test('actual Session reports rejected singleton before dispatch and stops on transport failure without retry', () => {
  const tp = new BoundedMemory(), session = new Session(tp), errors = [];
  session.activeRunId = 'life'; session.on({ error: error => errors.push(error) });
  assert.equal(session.sendJSON({ t: 'events', e: [{ t: 'small' }, { t: 'huge', text: '🚗'.repeat(8000) }] }), false);
  assert.equal(tp.attempts, 0); assert.equal(errors[0].reason, 'oversized-event'); assert.equal(errors[0].index, 1);
  assert.equal(errors[0].type, 'event-packet-rejected');
  tp.failAt = 1;
  const events = Array.from({ length: 10 }, (_, id) => ({ t: 'x', id, text: 'a'.repeat(6000) }));
  assert.equal(session.sendJSON({ t: 'events', e: events }), false);
  assert.equal(tp.attempts, 2); assert.equal(tp.sent.length, 1, 'already delivered first packet is explicit partial delivery');
  assert.equal(session.activeRunId, 'life'); assert.equal(session._eventRetryQueue, undefined);
});

test('actual Session life pin overrides supplied ID and revocation during dispatch stops later packets', () => {
  const tp = new BoundedMemory(), session = new Session(tp); session.activeRunId = 'life';
  const original = tp.send.bind(tp); tp.send = packet => { const result = original(packet); session.activeRunId = null; return result; };
  assert.equal(session.sendJSON({ t: 'events', runId: 'forged-life', e: Array.from({ length: 10 }, (_, id) => ({ t: 'x', id, text: 'a'.repeat(6000) })) }), false);
  assert.equal(tp.sent.length, 1); assert.equal(tp.sent[0].runId, 'life');
  assert.equal(session.sendJSON({ t: 'events', e: [{ t: 'x' }] }), false); assert.equal(tp.attempts, 1);
});

test('actual Run send filters and Session/Run receiver retain complete ordered terminal burst in both host seats', async () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = linked(hostRole), observed = viewerRun(f.viewer), sim = await new Sim({ seed: 7 }).init();
    try {
      sim.world.gravity = { x: 0, y: 0, z: 0 }; sim.director.enabled = false; sim.director.r = () => .2;
      sim.encounters.plan = []; sim.encounters.sim = sim; sim.hazards.update = () => {};
      sim.spawnCar('truck_t1', { kind: 'player', s: 40 }); sim.start();
      sim.configureCombat('consumer-life', { weapons: ['pistol'], levels: {} }); sim.drainEvents();
      // Match the observed second-life fractional simulation time through
      // actual steps, preserving long JSON number fields rather than setting
      // an invented clock or padding a too-small time-zero packet.
      for (let i = 0; i < 19; i++) sim.step(1 / 120);
      sim.drainEvents();
      for (let i = 0; i < 20; i++) {
        const car = sim.spawnCar('e_sedan', { s: 540 + i * 40, d: 30 });
        sim.damageCar(car, car.hp + 1, { cause: 'bullet', src: 1 });
      }
      const events = sim.drainEvents();
      assert.equal(events.filter(event => event.t === 'spawn').length, 20);
      assert.equal(events.filter(event => event.t === 'kill').length, 20);
      assert.equal(sim.combat.ready, true);
      assert.ok(bytesOf(message(events, 'consumer-life')) >= 16300, 'original production envelope reproduces the observed MTU defect');
      const sendFixture = { net: f.authority, events: [...events, { t: 'shot', remote: true }, { t: 'boom', localOnly: true }], snapAcc: 0 };
      Run.prototype._sendNet.call(sendFixture, 0);
      assert.ok(f.authority.tp.sent.length > 1);
      const delivered = f.authority.tp.sent.flatMap(packet => packet.e);
      assert.deepEqual(delivered, events, 'no dropped, repeated, reordered, remote or localOnly event');
      assert.ok(f.authority.tp.sent.every(packet => bytesOf(packet) <= MAX_EVENT_PACKET_BYTES && packet.e.length <= 256));
      assert.deepEqual(observed.seen.states.map(state => state.revision), Array.from({ length: 20 }, (_, i) => i + 1));
      assert.equal(observed.run.combatHud.ready, true); assert.equal(observed.run.combatHud.award, 1);
      assert.equal(observed.run.netEvents.filter(event => event.t === 'kill').length, 20);
      const before = observed.run.netEvents.length;
      for (const packet of f.authority.tp.sent) f.viewer.tp.onMessage({ ...packet, runId: 'old-life' });
      assert.equal(observed.run.netEvents.length, before, 'Session rejects all old-life chunks before Run');
      f.viewer._activeRunRoles[f.viewer.isHost ? 'guest' : 'host'] = 'gunner';
      const state = { ...sim.combat.state(), revision: 21, award: 2 };
      f.authority.sendJSON({ t: 'events', e: [{ t: 'combatState', state }] });
      assert.equal(observed.run.combatRevision, 20, 'Run retains driver authority after splitting');
      const countBefore = observed.run.netEvents.length;
      observed.run.onNet({ t: 'events', runId: 'consumer-life', e: Array.from({ length: 256 }, (_, id) => ({ t: 'x', id })) });
      assert.equal(observed.run.netEvents.length, countBefore + 256, 'actual receiver accepts its complete256-event boundary');
      observed.run.onNet({ t: 'events', runId: 'consumer-life', e: Array.from({ length: 257 }, () => ({ t: 'x' })) });
      assert.equal(observed.run.netEvents.length, countBefore + 256, 'receiver count guard remains intact');
    } finally { sim.dispose(); }
  }
});

test('actual Session/Run chunks preserve receipt revisions, cue order, replay and role/life guards', () => {
  for (const hostRole of ['driver', 'gunner']) {
    const f = linked(hostRole), observed = viewerRun(f.viewer), runId = 'consumer-life';
    const states = [1, 2].map(revision => ({ t: 'combatState', state: { runId, revision, combo: 2, best: 2, label: 'DOUBLE KILL', ready: false, award: 0, expiresIn: 3.5 } }));
    const receipts = [1, 2].map(revision => ({ t: 'damageReceipt', runId, revision, shotId: revision, pelletIndex: 0, penetrationIndex: 0, targetId: 2, zone: 'fuel', damage: 1, killed: false }));
    const cues = [1, 2].map(award => ({ t: 'combatNuke', runId, award, pos: [0, 2, 40], cars: 3, actors: 1, bossDamage: 100 }));
    const events = [states[0], receipts[0], { t: 'padding', text: 'a'.repeat(9000) }, cues[0], states[1], receipts[1], { t: 'padding', text: 'b'.repeat(9000) }, cues[1]];
    assert.equal(f.authority.sendJSON({ t: 'events', e: events }), true);
    assert.ok(f.authority.tp.sent.length > 1); assert.deepEqual(f.authority.tp.sent.flatMap(packet => packet.e), events);
    assert.deepEqual(observed.seen.states.map(state => state.revision), [1, 2]);
    assert.deepEqual(observed.seen.receipts.map(receipt => receipt.revision), [1, 2]);
    assert.deepEqual(observed.run.netEvents.filter(event => event.t === 'combatNuke').map(event => event.award), [1, 2]);
    const queued = observed.run.netEvents.length;
    for (const packet of f.authority.tp.sent) f.viewer.tp.onMessage(packet);
    assert.deepEqual(observed.seen.states.map(state => state.revision), [1, 2]);
    assert.deepEqual(observed.seen.receipts.map(receipt => receipt.revision), [1, 2]);
    assert.equal(observed.run.netEvents.filter(event => event.t === 'combatNuke').length, 2, 'presentation cue replay remains rejected');
    // Ordinary cosmetics already have their existing replay behavior; do not
    // pretend the batching boundary adds global event deduplication.
    assert.ok(observed.run.netEvents.length >= queued);
    const protectedBefore = [observed.seen.states.length, observed.seen.receipts.length, observed.run.nukeShownAward];
    for (const packet of f.authority.tp.sent) f.viewer.tp.onMessage({ ...packet, runId: 'old-life' });
    f.viewer._activeRunRoles[f.viewer.isHost ? 'guest' : 'host'] = 'gunner';
    f.authority.sendJSON({ t: 'events', e: [{ ...states[1], state: { ...states[1].state, revision: 3 } }, { ...receipts[1], revision: 3 }, { ...cues[1], award: 3 }] });
    assert.deepEqual([observed.seen.states.length, observed.seen.receipts.length, observed.run.nukeShownAward], protectedBefore);
  }
});
