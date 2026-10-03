import './helpers/peer-import.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Vector3 } from 'three';
import { Sim } from '../src/sim/sim.js';
import { StageEncounters, STAGE_ACTOR_LIMIT } from '../src/sim/stage_encounters.js';
import { stageEncounterGap } from '../src/data/stage_encounters.js';
import { NET_PROTOCOL } from '../src/net/run_packet.js';
const { Transport, MAX_TRANSIENT_JSON_BYTES } = await import('../src/net/transport.js');
const { Session } = await import('../src/net/session.js');
const { Run } = await import('../src/game/run.js');

function connected() {
  const reliable = [], frames = [], errors = [];
  const channel = { readyState: 'open', bufferedAmount: 0,
    send(bytes) { frames.push(bytes.slice()); this.bufferedAmount += bytes.byteLength; } };
  const conn = { open: true, bufferSize: 0, _buffering: false, dataChannel: channel,
    peerConnection: { sctp: { maxMessageSize: 65536 } },
    send(message) { reliable.push(structuredClone(message)); }, close() {} };
  const transport = new Transport({ iceProvider: null }); transport.conn = conn; transport.open = true;
  transport.onError = error => errors.push(error);
  return { transport, conn, channel, reliable, frames, errors,
    decoded: () => frames.map(frame => JSON.parse(new TextDecoder().decode(frame))) };
}

const stateMessage = (tick, actors = []) => ({ t: 'events', e: [{ t: 'stageState', state: { tick, time: tick / 120, actors } }] });

test('transient JSON drops superseded state on either native or PeerJS backpressure while reliable hits remain reliable', () => {
  const f = connected();
  assert.equal(f.transport.sendTransientJSON(stateMessage(1)), true);
  assert.equal(f.transport.sendTransientJSON(stateMessage(2)), false, 'queued native bytes reject another superseded pose');
  f.channel.bufferedAmount = 0; f.conn.bufferSize = 1;
  assert.equal(f.transport.sendTransientJSON(stateMessage(3)), false, 'an existing PeerJS reliable queue has priority');
  f.conn.bufferSize = 0; f.conn._buffering = true;
  assert.equal(f.transport.sendTransientJSON(stateMessage(4)), false, 'PeerJS retry scheduling also blocks transient traffic');
  assert.equal(f.transport.send({ t: 'hit', h: { shotId: 7 } }), true);
  assert.deepEqual(f.reliable, [{ t: 'hit', h: { shotId: 7 } }], 'important gameplay keeps its existing reliable path');
  f.conn._buffering = false;
  assert.equal(f.transport.sendTransientJSON(stateMessage(5)), true);
  assert.deepEqual(f.decoded().map(message => message.e[0].state.tick), [1, 5]);
  assert.equal(f.conn.bufferSize, 0, 'transient sends never enter a PeerJS retry buffer');
  assert.equal(f.transport.stats.fastOut, 0, 'the reliable JSON path is distinct from binary snapshots');
});

test('transient UTF-8 frame size respects both the hard cap and negotiated SCTP limit, including multibyte text', () => {
  const f = connected(), empty = { text: '' }, overhead = new TextEncoder().encode(JSON.stringify(empty)).byteLength;
  assert.equal(MAX_TRANSIENT_JSON_BYTES, 65536);
  assert.equal(f.transport.sendTransientJSON({ text: 'x'.repeat(MAX_TRANSIENT_JSON_BYTES - overhead) }), true);
  assert.equal(f.frames[0].byteLength, MAX_TRANSIENT_JSON_BYTES);
  f.channel.bufferedAmount = 0;
  assert.equal(f.transport.sendTransientJSON({ text: 'x'.repeat(MAX_TRANSIENT_JSON_BYTES - overhead + 1) }), false);
  const unicode = { text: '🔥'.repeat(Math.ceil(MAX_TRANSIENT_JSON_BYTES / 4)) };
  assert.ok(JSON.stringify(unicode).length < MAX_TRANSIENT_JSON_BYTES, 'UTF-16 character count alone would accept this oversized payload');
  assert.equal(f.transport.sendTransientJSON(unicode), false);
  assert.equal(f.frames.length, 1); assert.equal(f.reliable.length, 0);
  f.conn.peerConnection.sctp.maxMessageSize = 1024;
  assert.equal(f.transport.sendTransientJSON({ text: 'x'.repeat(1024 - overhead) }), true);
  f.channel.bufferedAmount = 0;
  assert.equal(f.transport.sendTransientJSON({ text: 'x'.repeat(1025 - overhead) }), false);
  f.conn.peerConnection.sctp = null;
  assert.equal(f.transport.sendTransientJSON({ text: 'x'.repeat(16300 - overhead) }), false,
    'missing negotiation data preserves the conservative PeerJS interoperability boundary');
  f.conn.peerConnection.sctp = { maxMessageSize: 0 };
  assert.equal(f.transport.sendTransientJSON({ text: 'x'.repeat(MAX_TRANSIENT_JSON_BYTES - overhead) }), true,
    'unlimited negotiated size still retains the application hard cap');
});

test('closed, absent and congested reliable channels reject transient work before serialization or native send', () => {
  const f = connected(); let serialized = 0;
  const message = { toJSON() { serialized++; return stateMessage(1); } };
  for (const state of ['connecting', 'closing', 'closed']) {
    f.channel.readyState = state; assert.equal(f.transport.sendTransientJSON(message), false);
  }
  f.channel.readyState = 'open'; f.conn.open = false; assert.equal(f.transport.sendTransientJSON(message), false);
  f.conn.open = true; f.channel.bufferedAmount = 1; assert.equal(f.transport.sendTransientJSON(message), false);
  f.channel.bufferedAmount = 0; f.conn.dataChannel = null; assert.equal(f.transport.sendTransientJSON(message), false);
  f.transport.conn = null; assert.equal(f.transport.sendTransientJSON(message), false);
  assert.equal(serialized, 0); assert.equal(f.frames.length, 0); assert.equal(f.reliable.length, 0);
});

test('serialization failures, connection replacement and native send errors do not acknowledge unsent transient state', () => {
  const f = connected(), cycle = {}; cycle.self = cycle;
  for (const bad of [cycle, { value: 1n }, undefined]) assert.equal(f.transport.sendTransientJSON(bad), false);
  assert.equal(f.transport.sendTransientJSON({ toJSON() { f.conn.bufferSize = 1; return stateMessage(1); } }), false);
  f.conn.bufferSize = 0;
  const previous = f.transport.conn;
  assert.equal(f.transport.sendTransientJSON({ toJSON() { f.transport.conn = { ...previous }; return stateMessage(2); } }), false);
  f.transport.conn = previous;
  const send = f.channel.send; f.channel.send = () => { throw new Error('Native send failed'); };
  assert.equal(f.transport.sendTransientJSON(stateMessage(3)), false); assert.equal(f.transport.stats.bytesOut, 0);
  assert.equal(f.errors.length, 1); assert.match(f.errors[0].message, /Native send failed/);
  assert.equal(f.frames.length, 0);
  f.channel.send = send; assert.equal(f.transport.sendTransientJSON(stateMessage(4)), true);
  assert.deepEqual(f.decoded().map(message => message.e[0].state.tick), [4]);
});

test('Session transient state preserves active-life isolation and cannot reclassify hit or ordinary event delivery', () => {
  const f = connected(), session = new Session(f.transport), received = [];
  assert.equal(session.sendTransientJSON(stateMessage(1)), false);
  session.activeRunId = 'stage-active-life'; session._peerProtocol = NET_PROTOCOL; session.on({ run: message => received.push(message) });
  for (const message of [{ t: 'hit', h: {} }, { t: 'events', e: [{ t: 'shot' }] },
    { t: 'events', e: [stateMessage(1).e[0], { t: 'shot' }] }, { t: 'events', e: [] }]) {
    assert.equal(session.sendTransientJSON(message), false);
  }
  assert.equal(session.sendTransientJSON({ ...stateMessage(2), runId: 'forged-life' }), true);
  const accepted = f.decoded()[0]; assert.equal(accepted.runId, 'stage-active-life'); session._onMsg(accepted);
  assert.equal(received.length, 1);
  session.activeRunId = 'stage-next-life'; session._onMsg(accepted); assert.equal(received.length, 1);
  assert.equal(session.sendJSON({ t: 'hit', h: { shotId: 9 } }), true);
  assert.equal(f.reliable.at(-1).runId, 'stage-next-life');
  session.activeRunId = null; f.channel.bufferedAmount = 0;
  assert.equal(session.sendTransientJSON(stateMessage(3)), false); assert.equal(f.frames.length, 1);
});

test('all 48 full-precision valid actors fit one bounded frame and decode through the installed PeerJS JSON receive method', () => {
  const manager = new StageEncounters(), viewer = new StageEncounters({ authoritative: false });
  manager.sim = { tick: 2147483647, time: 9999999.123456789 };
  try {
    for (let index = 0; index < STAGE_ACTOR_LIMIT; index++) {
      const site = { id: '地'.repeat(96), biome: 'space', s0: 9999999.123456789,
        gapD: -6.123456789012345, gap: 12.12345678901234 };
      const actor = manager._create(null, ['gate', 'tower', 'drone', 'boat'][index % 4], site,
        { x: -9876543.123456789 + index, y: 8765432.123456789, z: -7654321.123456789 },
        { x: 19.12345678901234, y: 18.12345678901234, z: 17.12345678901234 }, 9999.123456789012,
        { yaw: 123456.123456789, groundY: 7654321.123456789, owner: 59999, weapon: 'grenade' });
      assert.ok(actor);
      actor.hp = 8765.123456789012; actor.age = 9999999.123456789; actor.firePhase = .9999999999999999;
      actor.veh.poseRevision = 65535; actor.aimDirection.copy(new Vector3(.1234567890123456, .2345678901234567, .3456789012345678).normalize());
      manager._weak(actor, [19.12345678901234, -18.12345678901234, 17.12345678901234], 1.123456789012345);
      manager._refreshMuzzle(actor);
    }
    const state = manager.snapshot(); assert.equal(state.actors.length, STAGE_ACTOR_LIMIT);
    const f = connected(), sender = new Session(f.transport);
    sender.activeRunId = 'full-precision-stage-life';
    assert.equal(sender.sendTransientJSON({ t: 'events', e: [{ t: 'stageState', state }] }), true);
    assert.ok(f.frames[0].byteLength > 16300 && f.frames[0].byteLength <= MAX_TRANSIENT_JSON_BYTES,
      'the actual maximum-count snapshot needs a negotiated frame beyond the old PeerJS send limit');

    // Exercise the installed dependency's own decoder, rather than replacing
    // it with an assumed JSON.parse-only receiver or its restricted _send.
    const require = createRequire(import.meta.url);
    const source = readFileSync(require.resolve('peerjs/dist/bundler.mjs'), 'utf8');
    const decoders = [...source.matchAll(/    _handleDataMessage\(\{ data: data \}\) \{[\s\S]*?\n    \}/g)]
      .filter(match => match[0].includes('this.parse(this.decoder.decode(data))'));
    assert.equal(decoders.length, 1, 'identify the installed JSON UTF-8 decoder, excluding BinaryPack and raw serializers');
    const decoder = decoders[0], method = decoder[0];
    assert.ok(source.slice(decoder.index, decoder.index + 1800).includes('.JSON, this.encoder = new TextEncoder()'),
      'the selected actual method belongs to the JSON serialization class');
    const Receiver = new Function('Base', 'return class extends Base {\n' + method + '\n}')(class {
      emit(type, message) { assert.equal(type, 'data'); this.onData(message); }
    });
    const peerReceiver = new Receiver(); peerReceiver.decoder = new TextDecoder(); peerReceiver.parse = JSON.parse;
    const receiver = new Session({ send: () => true, sendFast: () => true });
    receiver.activeRunId = sender.activeRunId; receiver._peerProtocol = NET_PROTOCOL;
    const run = Object.assign(Object.create(Run.prototype), { sim: null, encounters: viewer,
      simState: 'run', states: new Map(), playerId: 1, netEvents: [] });
    receiver.on({ run: message => run.onNet(message) }); peerReceiver.onData = message => receiver._onMsg(message);
    peerReceiver._handleDataMessage({ data: f.frames[0] });
    assert.equal(viewer.entities.size, STAGE_ACTOR_LIMIT); assert.equal(viewer.lastSnapshotTick, state.tick);
    assert.deepEqual(run.netEvents, []);
    for (const data of state.actors) {
      const actor = viewer.entities.get(data.id);
      assert.deepEqual(actor.pos.toArray(), data.pos); assert.deepEqual(actor.quat.toArray(), data.quat);
      assert.equal(actor.hp, data.hp); assert.equal(actor.age, data.age); assert.equal(actor.veh.poseRevision, data.poseRevision);
      assert.deepEqual(actor.zones.find(zone => zone.kind === 'weakpoint').c, data.weakpoint.local);
    }
  } finally { viewer.dispose(); manager.dispose(null); }
});

test('actual Run retries dropped empty retirement and sends only the current actor state after congestion clears', async () => {
  const sim = await new Sim({ seed: 7, journey: { mode: 'campaign', level: 1 } }).init();
  const viewer = new StageEncounters({ authoritative: false });
  try {
    sim.director.enabled = false; sim.spawnCar('truck_t1', { kind: 'player', s: 1000, hold: true });
    sim.state = 'run'; sim.encounters.sim = sim; sim.encounters.plan = [];
    sim.encounters._spawnSite(sim, { id: 'backpressure-gate', kind: 'shoot_gate', biome: 'desert', s0: 1100, s1: 1320,
      side: 1, ...stageEncounterGap(1, 1), warningS: 820, title: 'Fuse gate', hint: 'Shoot the fuse' });
    const gate = [...sim.encounters.targets()][0], f = connected(), session = new Session(f.transport);
    session.activeRunId = 'backpressure-life';
    // Run's normal binary traffic is independent; this fixture preserves its
    // cadence without making that traffic block the reliable-state channel.
    f.transport.sendFast = () => true;
    const run = Object.assign(Object.create(Run.prototype), { sim, player: sim.player, encounters: sim.encounters,
      net: session, snapAcc: 0, encounterSendAcc: 0, events: [], cash: 0, medkits: 0,
      _bossHud: () => ({ id: 0, hp01: 0 }) });
    const tick = number => { sim.tick = number; sim.time = number / 10; run._sendNet(.1); };
    tick(1); assert.equal(run.sentEncounterActors, 1); assert.equal(f.frames.length, 1);
    assert.equal(viewer.applySnapshot(f.decoded()[0].e[0].state), true); assert.equal(viewer.entities.size, 1);
    sim.encounters.entities.clear();
    tick(2); tick(3); assert.equal(f.frames.length, 1); assert.equal(run.sentEncounterActors, 1,
      'a dropped empty state cannot falsely acknowledge remote retirement');
    f.channel.bufferedAmount = 0; tick(4);
    assert.equal(f.frames.length, 2); assert.equal(run.sentEncounterActors, 0);
    const retired = f.decoded().at(-1).e[0].state; assert.equal(retired.tick, 4); assert.deepEqual(retired.actors, []);
    assert.equal(viewer.applySnapshot(retired), true); assert.equal(viewer.entities.size, 0);
    tick(5); assert.equal(f.frames.length, 2, 'a delivered retirement is not repeated');
    sim.encounters.entities.set(gate.id, gate); gate.hp = 45; tick(6);
    gate.hp = 15; tick(7); assert.equal(f.frames.length, 2, 'unsent intermediate poses are not retained anywhere');
    f.channel.bufferedAmount = 0; tick(8);
    const current = f.decoded().at(-1).e[0].state;
    assert.equal(current.tick, 8); assert.equal(current.actors[0].hp, 15); assert.equal(f.frames.length, 3);
    assert.equal(viewer.applySnapshot(current), true); assert.equal(viewer.entities.get(gate.id).hp, 15);
    run.events = [{ t: 'hit', carId: sim.player.id }]; tick(9);
    assert.equal(f.reliable.at(-1).e[0].t, 'hit'); assert.equal(f.reliable.at(-1).runId, session.activeRunId);
  } finally {
    viewer.dispose(); sim.dispose();
  }
});
